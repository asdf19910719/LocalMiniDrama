const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createH3SkillAgent } = require('../src/services/h3SkillAgent');

const validPrompt = [
  'integrated_multimodal_description: [Shot 1] A woman walks toward the door.',
  'overall_soundscape: Footsteps and rain.',
  'non_diegetic_music: N/A',
].join('\n');

function skillPackage() {
  return {
    skillName: 'h3-prompt-writing',
    sha256: 'a'.repeat(64),
    resources: [
      { name: 'SKILL.md', content: 'skill contents' },
      { name: 'references/base-en.txt', content: 'reference contents' },
    ],
  };
}

function createHarness({ firstMessage, secondMessage = { role: 'assistant', content: validPrompt }, loadSkill = skillPackage } = {}) {
  const calls = [];
  const createChatCompletion = async (db, log, serviceType, messages, options) => {
    calls.push({ db, log, serviceType, messages, options });
    return calls.length === 1
      ? { message: firstMessage, model: 'tool-model', configId: 42, elapsedMs: 1 }
      : { message: secondMessage, model: 'tool-model', configId: 42, elapsedMs: 1 };
  };
  return {
    calls,
    agent: createH3SkillAgent({ createChatCompletion, loadSkillPackage: loadSkill }),
  };
}

function toolCall(overrides = {}) {
  return {
    id: 'call-1',
    type: 'function',
    function: {
      name: 'load_skill',
      arguments: '{"skill_name":"h3-prompt-writing"}',
    },
    ...overrides,
  };
}

describe('H3 skill agent', () => {
  it('forces one load_skill call, executes it, and returns the final prompt with provenance', async () => {
    const { agent, calls } = createHarness({
      firstMessage: { role: 'assistant', content: null, tool_calls: [toolCall()] },
    });

    const result = await agent.run({}, {}, {
      mode: 'T2VA',
      durationSeconds: 5,
      sourceBundle: 'MODE: T2VA\nPROMPT: a woman walks',
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].options.tool_choice, {
      type: 'function',
      function: { name: 'load_skill' },
    });
    assert.equal(calls[0].options.scene_key, 'h3_prompt_compile');
    assert.equal(calls[1].options.tool_choice, 'none');
    assert.equal(calls[1].messages.at(-2).role, 'assistant');
    assert.equal(calls[1].messages.at(-1).role, 'tool');
    assert.equal(calls[1].messages.at(-1).tool_call_id, 'call-1');
    assert.equal(calls[1].messages.at(-1).name, 'load_skill');
    assert.deepEqual(JSON.parse(calls[1].messages.at(-1).content), skillPackage());
    assert.equal(result.prompt, validPrompt);
    assert.deepEqual(result.provenance, {
      skillName: 'h3-prompt-writing',
      skillSha256: 'a'.repeat(64),
      skillResources: ['SKILL.md', 'references/base-en.txt'],
      toolCallId: 'call-1',
      model: 'tool-model',
      configId: 42,
    });
  });

  it('fails closed when the provider omits tool_calls', async () => {
    const { agent } = createHarness({ firstMessage: { role: 'assistant', content: 'I cannot call tools' } });
    await assert.rejects(
      () => agent.run({}, {}, { mode: 'T2VA', durationSeconds: 5, sourceBundle: 'source' }),
      (error) => error.code === 'H3_SKILL_TOOL_CALL_UNSUPPORTED',
    );
  });

  it('rejects wrong tool names, malformed arguments, wrong skill names, and missing IDs', async () => {
    const cases = [
      { name: 'wrong tool name', call: toolCall({ function: { name: 'other_tool', arguments: '{}' } }) },
      { name: 'malformed JSON', call: toolCall({ function: { name: 'load_skill', arguments: '{' } }) },
      { name: 'wrong skill name', call: toolCall({ function: { name: 'load_skill', arguments: '{"skill_name":"other"}' } }) },
      { name: 'missing tool-call ID', call: toolCall({ id: '' }) },
    ];
    for (const item of cases) {
      const { agent } = createHarness({ firstMessage: { role: 'assistant', content: null, tool_calls: [item.call] } });
      await assert.rejects(
        () => agent.run({}, {}, { mode: 'T2VA', durationSeconds: 5, sourceBundle: item.name }),
        (error) => error.code === 'H3_SKILL_TOOL_CALL_INVALID',
        item.name,
      );
    }
  });

  it('rejects more than one first-turn tool call as invalid', async () => {
    const { agent } = createHarness({
      firstMessage: { role: 'assistant', content: null, tool_calls: [toolCall(), toolCall({ id: 'call-2' })] },
    });
    await assert.rejects(
      () => agent.run({}, {}, { mode: 'T2VA', durationSeconds: 5, sourceBundle: 'source' }),
      (error) => error.code === 'H3_SKILL_TOOL_CALL_INVALID',
    );
  });

  it('rejects a second-turn tool call without making a third request', async () => {
    const { agent, calls } = createHarness({
      firstMessage: { role: 'assistant', content: null, tool_calls: [toolCall()] },
      secondMessage: { role: 'assistant', content: null, tool_calls: [toolCall({ id: 'call-2' })] },
    });
    await assert.rejects(
      () => agent.run({}, {}, { mode: 'T2VA', durationSeconds: 5, sourceBundle: 'source' }),
      (error) => error.code === 'H3_SKILL_TOOL_CALL_REPEATED',
    );
    assert.equal(calls.length, 2);
  });

  it('rejects an empty final content', async () => {
    const { agent } = createHarness({
      firstMessage: { role: 'assistant', content: null, tool_calls: [toolCall()] },
      secondMessage: { role: 'assistant', content: '   ' },
    });
    await assert.rejects(
      () => agent.run({}, {}, { mode: 'T2VA', durationSeconds: 5, sourceBundle: 'source' }),
      (error) => error.code === 'H3_SKILL_FINAL_EMPTY',
    );
  });

  it('rejects tool calls and final prompts from non-assistant messages', async () => {
    const { agent } = createHarness({
      firstMessage: { role: 'tool', content: null, tool_calls: [toolCall()] },
    });
    await assert.rejects(
      () => agent.run({}, {}, { mode: 'T2VA', durationSeconds: 5, sourceBundle: 'source' }),
      (error) => error.code === 'H3_SKILL_TOOL_CALL_INVALID',
    );

    const harness = createHarness({
      firstMessage: { role: 'assistant', content: null, tool_calls: [toolCall()] },
      secondMessage: { role: 'tool', content: validPrompt },
    });
    await assert.rejects(
      () => harness.agent.run({}, {}, { mode: 'T2VA', durationSeconds: 5, sourceBundle: 'source' }),
      (error) => error.code === 'H3_SKILL_TOOL_CALL_INVALID',
    );
  });
});
