# H3 Skill-Calling Prompt Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every H3 prompt compilation require the configured text model to call `load_skill("h3-prompt-writing")`, consume the complete skill resources, and return a validated prompt with persisted skill provenance.

**Architecture:** Add a project-local allowlisted skill registry, a narrow OpenAI-compatible non-streaming tool-call transport, and a two-request `h3SkillAgent`. Keep `h3PromptCompiler` responsible for deterministic mode selection and output validation, but replace its direct `generateText()` call with the agent and fail closed when tool calling is unsupported.

**Tech Stack:** Node.js 22, CommonJS, Express 4, OpenAI-compatible Chat Completions, built-in `node:test`, `better-sqlite3`, Vue 3/Vite.

**Spec:** `docs/superpowers/specs/2026-08-26-h3-skill-agent-design.md`

## Global Constraints

- The model must produce a real `load_skill` tool call; prompt injection is not an allowed fallback.
- Only `h3-prompt-writing` is allowlisted, and model-provided filesystem paths are never accepted.
- The first version supports existing OpenAI-compatible `/chat/completions` text providers only.
- The agent performs at most two model requests and exactly one skill-tool execution.
- Non-H3 calls through `aiClient.generateText()` and `streamGenerateText()` remain unchanged.
- Skill payloads and full prompts must not be written to ordinary logs.
- Use Node `E:/AI/tools/node-v22.22.3-win-x64/node.exe` for every test command.
- Preserve all unrelated dirty files in the main worktree.

## File Structure

- `backend-node/skills/h3-prompt-writing/`: exact portable skill payload consumed by the model.
- `backend-node/src/services/skillRegistry.js`: allowlist, resource selection, containment checks, byte limits, and package hashing.
- `backend-node/src/services/aiClient.js`: one non-streaming raw Chat Completions entry point that returns the complete assistant message.
- `backend-node/src/services/h3SkillAgent.js`: forced two-turn `load_skill` orchestration and stable errors.
- `backend-node/src/services/h3PromptCompiler.js`: delegates text generation to the skill agent and returns provenance.
- `backend-node/src/services/unifiedVideoGenerationService.js`: persists and exposes provenance.
- `backend-node/migrations/26_h3_skill_provenance.sql` and `backend-node/src/db/migrate.js`: schema migration and startup ensure.
- Focused backend and frontend test files mirror each production boundary.

---

### Task 1: Vendor and Load the Allowlisted H3 Skill Package

**Files:**
- Create: `backend-node/skills/h3-prompt-writing/SKILL.md`
- Create: `backend-node/skills/h3-prompt-writing/references/base-en.txt`
- Create: `backend-node/skills/h3-prompt-writing/references/ref-en.txt`
- Create: `backend-node/src/services/skillRegistry.js`
- Create: `backend-node/test/skillRegistry.test.js`

**Interfaces:**
- Consumes: `loadSkillPackage(skillName, { mode })` with exact skill name and one of `T2VA`, `I2VA`, `FL2VA`, `L2VA`, `Ref2VA`.
- Produces: `{ skillName, sha256, resources: [{ name, content }] }`.

- [ ] **Step 1: Add the exact portable skill resources**

Add the three files byte-for-byte from:

```text
C:/Users/26373/.codex/skills/h3-prompt-writing/SKILL.md
C:/Users/26373/.codex/skills/h3-prompt-writing/references/base-en.txt
C:/Users/26373/.codex/skills/h3-prompt-writing/references/ref-en.txt
```

Verify their individual SHA-256 values before continuing:

```text
SKILL.md               a7000443588ca3f145e3b3fd8900f14e0325dc460bd811268fac89a9dc8e56d0
references/base-en.txt 2cfebc096a6e08370f288d468d90b60f7f9bcb938f94bf090816e910e48e75fc
references/ref-en.txt  1e574f356716ad55612247ffb7bbccbcdb484ad96599d63c7dca1af186b1fab7
```

- [ ] **Step 2: Write failing registry tests**

Create tests that assert base modes return `SKILL.md` plus `base-en.txt`, Ref2VA returns `SKILL.md` plus `ref-en.txt`, two identical loads return the same 64-character lowercase hash, and names such as `../h3-prompt-writing`, absolute paths, and `unknown` throw `SKILL_NOT_ALLOWLISTED`.

```js
const { loadSkillPackage } = require('../src/services/skillRegistry');

it('loads the complete Ref2VA skill package with stable provenance', () => {
  const first = loadSkillPackage('h3-prompt-writing', { mode: 'Ref2VA' });
  const second = loadSkillPackage('h3-prompt-writing', { mode: 'Ref2VA' });
  assert.deepEqual(first.resources.map((item) => item.name), [
    'SKILL.md',
    'references/ref-en.txt',
  ]);
  assert.match(first.resources[1].content, /subject_definitions/);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.sha256, second.sha256);
});
```

- [ ] **Step 3: Run the registry test and verify RED**

Run:

```powershell
Set-Location E:/project/LocalMiniDrama/backend-node
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/skillRegistry.test.js
```

Expected: FAIL because `../src/services/skillRegistry` does not exist.

- [ ] **Step 4: Implement the minimal registry**

Use an immutable registry, `path.resolve()` containment verification, UTF-8 reads, per-resource and package byte limits, and canonical hashing:

```js
const canonical = resources
  .map(({ name, content }) => `${name}\n${Buffer.byteLength(content, 'utf8')}\n${content}`)
  .join('\n');
const sha256 = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
```

Throw errors with stable `code` values `SKILL_NOT_ALLOWLISTED`, `SKILL_RESOURCE_INVALID`, `SKILL_RESOURCE_MISSING`, or `SKILL_PACKAGE_TOO_LARGE`.

- [ ] **Step 5: Run the registry tests and verify GREEN**

Run the command from Step 3. Expected: all tests pass with zero failures.

- [ ] **Step 6: Commit Task 1**

```powershell
git add backend-node/skills/h3-prompt-writing backend-node/src/services/skillRegistry.js backend-node/test/skillRegistry.test.js
git commit -m "feat: add allowlisted H3 skill package"
```

### Task 2: Add Raw Tool-Calling Chat Completions Transport

**Files:**
- Modify: `backend-node/src/services/aiClient.js`
- Create: `backend-node/test/aiClientToolCalling.test.js`

**Interfaces:**
- Consumes: `createChatCompletion(db, log, serviceType, messages, options)` where `options` contains `scene_key`, `tools`, `tool_choice`, `temperature`, and `max_tokens`.
- Produces: `{ message, model, configId, elapsedMs }`, preserving `message.content` and `message.tool_calls` exactly.

- [ ] **Step 1: Write failing transport contract tests**

Start a local HTTP test server that records the JSON request and returns:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call-1",
        "type": "function",
        "function": {
          "name": "load_skill",
          "arguments": "{\"skill_name\":\"h3-prompt-writing\"}"
        }
      }]
    }
  }]
}
```

Assert that `createChatCompletion()` sends `stream: false`, preserves `tools` and `tool_choice`, routes through `scene_key: 'h3_prompt_compile'`, and returns the complete assistant message instead of only its text content.

- [ ] **Step 2: Run the transport test and verify RED**

```powershell
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/aiClientToolCalling.test.js
```

Expected: FAIL because `createChatCompletion` is not exported.

- [ ] **Step 3: Implement `createChatCompletion` without changing existing callers**

Reuse `getConfigFromModelMap`, `getDefaultConfig`, `buildChatUrl`, `getModelFromConfig`, `applyDeepSeekChatOptions`, and `postJSONNonStream`. Change `postJSONNonStream` to return parsed JSON in an additional `json` property while preserving its existing `body` behavior for vision calls.

```js
return {
  message: response.json?.choices?.[0]?.message || null,
  model,
  configId: config.id,
  elapsedMs: Date.now() - startMs,
};
```

Do not log message content, tool arguments, skill contents, or API keys.

- [ ] **Step 4: Run focused transport and existing AI client tests**

```powershell
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/aiClientToolCalling.test.js test/aiClientReasoning.test.js
```

Expected: all tests pass. If the repository uses a different existing AI-client regression filename, select it with `rg --files test | rg 'aiClient'` and run every returned test file.

- [ ] **Step 5: Commit Task 2**

```powershell
git add backend-node/src/services/aiClient.js backend-node/test/aiClientToolCalling.test.js
git commit -m "feat: support text model tool calls"
```

### Task 3: Implement the Forced Two-Turn H3 Skill Agent

**Files:**
- Create: `backend-node/src/services/h3SkillAgent.js`
- Create: `backend-node/test/h3SkillAgent.test.js`

**Interfaces:**
- Consumes: `createH3SkillAgent({ createChatCompletion, loadSkillPackage }).run(db, log, { mode, durationSeconds, sourceBundle })`.
- Produces: `{ prompt, provenance: { skillName, skillSha256, skillResources, toolCallId, model, configId } }`.

- [ ] **Step 1: Write the happy-path failing test**

Inject a fake `createChatCompletion` that returns a `load_skill` call on request one and final H3 content on request two. Assert:

```js
assert.equal(calls.length, 2);
assert.deepEqual(calls[0].options.tool_choice, {
  type: 'function',
  function: { name: 'load_skill' },
});
assert.equal(calls[1].messages.at(-1).role, 'tool');
assert.equal(calls[1].messages.at(-1).tool_call_id, 'call-1');
assert.equal(result.provenance.skillName, 'h3-prompt-writing');
```

- [ ] **Step 2: Write fail-closed tests**

Add separate tests for missing `tool_calls`, wrong tool name, malformed JSON arguments, wrong skill name, missing tool-call ID, a second-turn tool call, and empty final content. Assert stable codes:

```text
H3_SKILL_TOOL_CALL_UNSUPPORTED
H3_SKILL_TOOL_CALL_INVALID
H3_SKILL_TOOL_CALL_REPEATED
H3_SKILL_FINAL_EMPTY
```

- [ ] **Step 3: Run the agent test and verify RED**

```powershell
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/h3SkillAgent.test.js
```

Expected: FAIL because `h3SkillAgent.js` does not exist.

- [ ] **Step 4: Implement the minimal two-request loop**

The first system message states that the assistant must call the provided skill before performing the H3 conversion. The first request offers only `load_skill` and forces it with `tool_choice`. Parse exactly one call, invoke the injected registry, append the assistant message unchanged, and append this tool message:

```js
{
  role: 'tool',
  tool_call_id: toolCall.id,
  name: 'load_skill',
  content: JSON.stringify(skillPackage),
}
```

The second request sets `tool_choice: 'none'`. Return only trimmed final content and provenance. Cap the loop at two requests in code structure rather than using an open-ended loop.

- [ ] **Step 5: Run the agent tests and verify GREEN**

Run the command from Step 3. Expected: all happy-path and fail-closed cases pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add backend-node/src/services/h3SkillAgent.js backend-node/test/h3SkillAgent.test.js
git commit -m "feat: add H3 skill-calling agent"
```

### Task 4: Route Every H3 Compilation Through the Skill Agent

**Files:**
- Modify: `backend-node/src/services/h3PromptCompiler.js`
- Modify: `backend-node/test/h3PromptCompiler.test.js`
- Modify: `backend-node/test/unifiedVideoGenerationService.test.js`

**Interfaces:**
- Consumes: `createH3PromptCompiler({ skillAgent })`; default agent uses `aiClient.createChatCompletion` and `skillRegistry.loadSkillPackage`.
- Produces: existing compiler fields plus `skillProvenance` and `compilerVersion: 'h3-skill-agent-v1'`.

- [ ] **Step 1: Replace old mock expectations with failing skill-agent expectations**

Update compiler tests to inject:

```js
const skillAgent = {
  run: async (_db, _log, request) => {
    calls.push(request);
    return {
      prompt: valid,
      provenance: {
        skillName: 'h3-prompt-writing',
        skillSha256: 'a'.repeat(64),
        skillResources: ['SKILL.md', 'references/base-en.txt'],
        toolCallId: 'call-1',
      },
    };
  },
};
```

Assert all five `h3Mode()` inputs reach `skillAgent.run`, the selected mode is passed unchanged, provenance is returned, and `aiClient.generateText()` is no longer part of this compiler path.

- [ ] **Step 2: Run compiler tests and verify RED**

```powershell
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/h3PromptCompiler.test.js test/unifiedVideoGenerationService.test.js
```

Expected: FAIL because the compiler still expects `generateText` and returns `h3-v1` without provenance.

- [ ] **Step 3: Implement skill-agent delegation**

Remove `compilerInstruction()` and the old model retry from the H3 execution path. Keep `h3Mode`, `sourceBundle`, `stripCodeFence`, and `validateH3Prompt`. Call:

```js
const generated = await skillAgent.run(db, log, {
  mode,
  durationSeconds,
  sourceBundle: sourceBundle(input, mode),
});
const output = validateH3Prompt(generated.prompt, { durationSeconds, mode });
```

Map agent stable errors into `H3PromptError` without replacing their codes with the generic `H3_PROMPT_COMPILE_FAILED` code.

- [ ] **Step 4: Verify focused compilation tests GREEN**

Run the command from Step 2. Expected: all tests pass and existing non-H3 video generation behavior remains green.

- [ ] **Step 5: Commit Task 4**

```powershell
git add backend-node/src/services/h3PromptCompiler.js backend-node/test/h3PromptCompiler.test.js backend-node/test/unifiedVideoGenerationService.test.js
git commit -m "refactor: compile H3 prompts through skill agent"
```

### Task 5: Persist and Expose Skill Provenance

**Files:**
- Create: `backend-node/migrations/26_h3_skill_provenance.sql`
- Modify: `backend-node/src/db/migrate.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/test/unifiedVideoGenerationService.test.js`

**Interfaces:**
- Consumes: compiler `skillProvenance`.
- Produces: row/API fields `skillName`, `skillSha256`, and parsed `skillProvenance`.

- [ ] **Step 1: Add failing persistence tests**

Extend the test schema with nullable columns and assert an H3 creation persists:

```js
assert.equal(row.h3_skill_name, 'h3-prompt-writing');
assert.equal(row.h3_skill_sha256, 'a'.repeat(64));
assert.deepEqual(created.skillProvenance.skillResources, [
  'SKILL.md',
  'references/base-en.txt',
]);
```

Also insert a historical row with all three columns `NULL` and assert serialization returns `null` fields without throwing.

- [ ] **Step 2: Run persistence tests and verify RED**

```powershell
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/unifiedVideoGenerationService.test.js
```

Expected: FAIL because provenance is neither inserted nor serialized.

- [ ] **Step 3: Add migration and startup ensure**

Create migration 26:

```sql
ALTER TABLE video_generations ADD COLUMN h3_skill_name TEXT;
ALTER TABLE video_generations ADD COLUMN h3_skill_sha256 TEXT;
ALTER TABLE video_generations ADD COLUMN h3_skill_provenance TEXT;
```

Add matching nullable `ensureColumns()` entries in `migrate.js`.

- [ ] **Step 4: Persist and serialize provenance**

When `compiled?.skillProvenance` exists, append the three insert columns and values. Extend the existing row serializer near `promptCompilerVersion` to return camelCase fields and parse JSON with the service's existing safe JSON helper.

Persist only resource names, hashes, IDs, model/config identifiers, and no skill content or API key.

- [ ] **Step 5: Run migration and persistence tests GREEN**

```powershell
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/unifiedVideoGenerationService.test.js
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/migrate*.test.js
```

Expected: all selected tests pass. If the migration glob matches no files in PowerShell, identify the actual migration tests with `rg --files test | rg 'migrat'` and run those paths explicitly.

- [ ] **Step 6: Commit Task 5**

```powershell
git add backend-node/migrations/26_h3_skill_provenance.sql backend-node/src/db/migrate.js backend-node/src/services/unifiedVideoGenerationService.js backend-node/test/unifiedVideoGenerationService.test.js
git commit -m "feat: persist H3 skill provenance"
```

### Task 6: Surface Unsupported Skill Calling and Verify the Product

**Files:**
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `frontweb/test/videoGenerationPanel.test.js`
- Modify: `docs/configuration.md`

**Interfaces:**
- Consumes: backend error code `H3_SKILL_TOOL_CALL_UNSUPPORTED`.
- Produces: actionable Chinese UI copy directing users to a tool-calling text model for `h3_prompt_compile`.

- [ ] **Step 1: Write the failing frontend error-copy test**

```js
assert.equal(
  videoErrorCopy({
    code: 'H3_SKILL_TOOL_CALL_UNSUPPORTED',
    message: 'H3_SKILL_TOOL_CALL_UNSUPPORTED',
  }).summary,
  '当前文本模型不支持技能工具调用，请为 H3 提示词编译选择支持 tool calling 的模型。',
);
```

- [ ] **Step 2: Run the frontend test and verify RED**

```powershell
Set-Location E:/project/LocalMiniDrama/frontweb
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/videoGenerationPanel.test.js
```

Expected: FAIL because the stable code has no explicit summary.

- [ ] **Step 3: Add the error mapping and configuration documentation**

Add the exact Chinese summary to `ERROR_SUMMARIES`. Document that the text config selected by `ai_model_map.key = 'h3_prompt_compile'` must support OpenAI-compatible `tools`, forced `tool_choice`, assistant `tool_calls`, and `tool` role messages.

- [ ] **Step 4: Run focused frontend test GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Run complete verification**

Backend:

```powershell
Set-Location E:/project/LocalMiniDrama/backend-node
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/*.test.js
```

Frontend:

```powershell
Set-Location E:/project/LocalMiniDrama/frontweb
& E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/*.test.js
& E:/AI/tools/node-v22.22.3-win-x64/npm.cmd run build
```

Expected: zero test failures and Vite exits with code 0.

- [ ] **Step 6: Perform one local tool-call smoke check without generating video**

Use the existing “预览 H3 提示词” action for a storyboard with the configured `h3_prompt_compile` text model. Confirm the response contains a final H3 prompt and skill provenance with `skillName = h3-prompt-writing`, a 64-character hash, and the selected resource names. Do not submit a ComfyUI generation as part of this smoke check.

- [ ] **Step 7: Commit Task 6**

```powershell
git add frontweb/src/composables/useVideoGenerationPanel.js frontweb/test/videoGenerationPanel.test.js docs/configuration.md
git commit -m "docs: require tool-calling model for H3 skills"
```

- [ ] **Step 8: Inspect final scope**

```powershell
git status --short
git log --oneline -8
```

Expected: only the user's pre-existing research artifacts, dependency directory, and root `package-lock.json` remain outside the task commits.
