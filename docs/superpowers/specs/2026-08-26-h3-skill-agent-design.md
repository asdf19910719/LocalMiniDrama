# H3 Skill-Calling Prompt Agent Design

## Goal

Replace the current one-shot H3 prompt rewrite with an agent loop in which the
configured text model must call `load_skill("h3-prompt-writing")`, receive the
complete skill package, and then use that skill to produce the final MiniMax H3
prompt.

This change applies only to H3 video-prompt compilation. Existing text,
storyboard, image, and other AI generation calls continue to use the current
`aiClient.generateText()` path.

## Current State

`h3PromptCompiler` currently sends a shortened H3 instruction to
`aiClient.generateText()`. The request is a normal streamed Chat Completions
request and cannot receive or execute tool calls. The compiler validates only a
small subset of the final structure. It does not prove that the model loaded or
followed the `h3-prompt-writing` skill.

## Required Behavior

For every H3 preview or generation request:

1. The backend starts a skill-capable text-agent conversation.
2. The first model turn is forced to call `load_skill` with
   `skill_name: "h3-prompt-writing"`.
3. The backend validates the tool name and arguments against an allowlist.
4. The backend loads the complete skill package: `SKILL.md` plus the references
   selected by that skill's workflow.
5. The backend returns the loaded resources as a tool result, including a
   deterministic package SHA-256.
6. The model produces the final H3 prompt in the next turn, following the
   loaded skill.
7. The existing H3 compiler validates the returned prompt before submission.
8. If the provider cannot return tool calls, calls a different tool, omits the
   required skill, or returns no final prompt, compilation fails closed. It
   never silently falls back to the old shortened instruction.

## Skill Package and Registry

The application owns a project-local, versioned copy of the portable skill at:

```text
backend-node/skills/h3-prompt-writing/
  SKILL.md
  references/base-en.txt
  references/ref-en.txt
```

These files are the skill payload returned to the text model. They remain
complete resources rather than being translated into application templates or
duplicated as hand-written business rules.

`skillRegistry.js` exposes one allowlisted skill:

```js
loadSkillPackage('h3-prompt-writing', { mode })
```

The registry:

- rejects unknown names and all path-like input;
- resolves files only beneath `backend-node/skills`;
- always reads `SKILL.md` completely;
- reads `references/base-en.txt` for T2VA, I2VA, FL2VA, and L2VA;
- reads `references/ref-en.txt` for Ref2VA;
- returns resource names, full text, and a SHA-256 over canonical resource
  names and bytes;
- applies explicit byte limits so a changed package cannot create an unbounded
  model request.

The application, not the model, chooses which references are required after
the existing deterministic `h3Mode()` result is known. The model still calls
the skill and follows its workflow; the registry only supplies the relevant
complete resources.

## Text Agent Protocol

Add a narrow OpenAI-compatible non-streaming Chat Completions function. Its
request includes exactly one tool:

```json
{
  "type": "function",
  "function": {
    "name": "load_skill",
    "description": "Load an allowlisted project skill before performing the task.",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": ["skill_name"],
      "properties": {
        "skill_name": {
          "type": "string",
          "enum": ["h3-prompt-writing"]
        }
      }
    }
  }
}
```

The first request uses:

```json
{
  "tool_choice": {
    "type": "function",
    "function": { "name": "load_skill" }
  }
}
```

The first assistant response must contain one `load_skill` call and no final
answer. The backend appends that assistant message and a matching `tool`
message containing the skill package. The second request sets
`tool_choice: "none"` and asks for the final prompt only.

The agent loop has a hard maximum of two model requests and one tool execution.
Arbitrary or recursive tool use is not supported.

## Provider Capability

The first implementation supports providers configured with the existing
OpenAI-compatible `/chat/completions` protocol. A provider is considered
skill-capable only when it returns a standard assistant `tool_calls` array and
accepts a subsequent `tool` role message.

Unsupported behavior produces a stable error:

```text
H3_SKILL_TOOL_CALL_UNSUPPORTED
```

The error tells the user to select a tool-calling text model for the
`h3_prompt_compile` scene. No fallback to prompt injection is permitted,
because that would violate the requirement that the text model call the skill.

## H3 Compilation Flow

```text
storyboard and generation inputs
  -> h3Mode(input)
  -> H3 skill agent turn 1
  -> load_skill tool execution
  -> H3 skill agent turn 2
  -> final H3 prompt
  -> validateH3Prompt
  -> persist skill provenance
  -> submit provider
```

`h3PromptCompiler` remains responsible for mode selection and H3 output
validation. It delegates model execution to `h3SkillAgent` instead of calling
`aiClient.generateText()` directly.

Prompt preview and real candidate generation use the same compiler path, so a
preview cannot use a different skill or model flow from the submitted prompt.

## Provenance

Successful compilation returns and persists:

```js
{
  skillName: 'h3-prompt-writing',
  skillSha256: '...',
  skillResources: ['SKILL.md', 'references/ref-en.txt'],
  toolCallId: '...',
  compilerVersion: 'h3-skill-agent-v1'
}
```

Add nullable columns to `video_generations` for skill name, skill hash, and a
JSON provenance object. Historical rows remain unchanged. API responses expose
the provenance without exposing the configured API key or full model request.

## Error Handling

The agent rejects and records distinct error codes for:

- provider did not return `tool_calls`;
- tool name was not `load_skill`;
- arguments were malformed or selected a non-allowlisted skill;
- tool-call ID was missing;
- skill package was missing, unreadable, oversized, or escaped its root;
- second model turn attempted another tool call;
- second model turn returned empty content;
- final content failed H3 validation.

Skill files and full prompts are not written to ordinary logs. Logs include
skill name, hash, resource names, model, elapsed time, and stable error code.

## Security Boundaries

- The model never supplies a filesystem path.
- The loader accepts only exact registry names.
- Resolved resources must remain beneath the configured project skill root.
- The tool cannot execute commands, access the network, or load arbitrary
  Codex/user skills.
- Only the H3 compiler can invoke this agent in the first version.
- API keys retain the current redaction behavior.

## Compatibility

- No change to non-H3 AI calls.
- No change to ComfyUI workflow submission.
- Existing H3 rows remain readable.
- Existing providers without tool support continue to work for other AI
  features but cannot compile H3 prompts.
- The UI surfaces the unsupported-tool-call error instead of presenting it as
  a generic generation failure.

## Testing

Backend tests cover:

1. registry loads the full base-mode resources and returns a stable hash;
2. registry loads the full Ref2VA resources;
3. registry rejects traversal and non-allowlisted skill names;
4. agent forces `load_skill` on the first request;
5. tool result uses the model's exact tool-call ID;
6. second request contains the assistant tool call and matching tool result;
7. final prompt and skill provenance are returned;
8. missing tool calls fail with `H3_SKILL_TOOL_CALL_UNSUPPORTED`;
9. wrong, malformed, repeated, or empty tool/final responses fail closed;
10. H3 compiler uses the agent for all five modes;
11. preview and persisted generation share the same path;
12. skill provenance is stored without changing historical rows;
13. non-H3 `generateText()` behavior is unchanged.

Focused tests run before the complete backend suite. The frontend suite and
build run if UI error mapping or provenance display changes.

## Non-Goals

- A general-purpose autonomous agent runtime.
- Arbitrary skill discovery from user directories.
- Allowing the model to execute shell commands or load external URLs.
- Replacing every existing `generateText()` call with tools.
- Guaranteeing that the video model renders every spoken word correctly; this
  design guarantees that the configured text model actually loads the skill
  before producing the H3 prompt.
