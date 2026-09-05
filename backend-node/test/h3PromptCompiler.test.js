const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createH3PromptCompiler, H3PromptError, h3Mode, validateH3Prompt } = require('../src/services/h3PromptCompiler');

const valid = 'integrated_multimodal_description: [Shot 1] A woman walks toward the door.\noverall_soundscape: Footsteps and rain.\nnon_diegetic_music: N/A';
const validRef = 'subject_definitions:\n<Subject 1> is a woman in <Picture 1>.\nsummary:\n[reference generation] The target video follows <Subject 1>.\nretention_analysis:\n<Subject 1>: fully_preserved - identity retained.\ndetailed_description:\n[Shot 1] <Subject 1> walks toward the door.\noverall_soundscape: Footsteps and rain.\nnon_diegetic_music: N/A';

describe('H3 prompt compiler', () => {
  it('selects the H3 mode from supplied keyframes', () => {
    assert.equal(h3Mode({}), 'T2VA');
    assert.equal(h3Mode({ firstFrameUrl: '/first.png' }), 'I2VA');
    assert.equal(h3Mode({ firstFrameUrl: '/first.png', lastFrameUrl: '/last.png' }), 'FL2VA');
    assert.equal(h3Mode({ lastFrameUrl: '/last.png' }), 'L2VA');
  });

  it('rejects output that is not in the required H3 structure', () => {
    assert.throws(() => validateH3Prompt('A Chinese prompt'), (error) => error.code === 'H3_PROMPT_FORMAT_INVALID');
  });

  it('requires the six-section full-reference structure for Ref2VA', () => {
    assert.throws(() => validateH3Prompt(valid, { durationSeconds: 5, mode: 'Ref2VA' }), (error) => error.code === 'H3_PROMPT_FORMAT_INVALID');
    assert.equal(validateH3Prompt(validRef, { durationSeconds: 5, mode: 'Ref2VA' }), validRef);
  });

  it('rejects required fields that are present but empty', () => {
    assert.throws(() => validateH3Prompt('integrated_multimodal_description:\noverall_soundscape: rain\nnon_diegetic_music: N/A', { durationSeconds: 5 }), (error) => error.code === 'H3_PROMPT_FORMAT_INVALID');
  });

  it('delegates every H3 mode to the skill agent and returns provenance', async () => {
    const calls = [];
    const skillAgent = {
      async run(db, log, request) {
        calls.push({ db, log, request });
        return {
          prompt: request.mode === 'Ref2VA' ? validRef : valid,
          provenance: {
            skillName: 'h3-prompt-writing',
            skillSha256: 'a'.repeat(64),
            skillResources: request.mode === 'Ref2VA' ? ['SKILL.md', 'references/ref-en.txt'] : ['SKILL.md', 'references/base-en.txt'],
            toolCallId: `call-${calls.length}`,
          },
        };
      },
    };
    const compiler = createH3PromptCompiler({ skillAgent, generateText: () => { throw new Error('generateText must not be called'); } });
    const inputs = [
      { prompt: 'text mode' },
      { prompt: 'first mode', firstFrameUrl: '/first.png' },
      { prompt: 'last mode', lastFrameUrl: '/last.png' },
      { prompt: 'first-last mode', firstFrameUrl: '/first.png', lastFrameUrl: '/last.png' },
      { prompt: 'reference mode', referenceUrls: ['/ref.png'] },
    ];
    const expectedModes = ['T2VA', 'I2VA', 'L2VA', 'FL2VA', 'Ref2VA'];
    for (let index = 0; index < inputs.length; index += 1) {
      const result = await compiler.compile({}, {}, inputs[index]);
      assert.equal(result.promptFormat, expectedModes[index]);
      assert.equal(result.compilerVersion, 'h3-skill-agent-v1');
      assert.equal(result.skillProvenance.skillName, 'h3-prompt-writing');
      assert.equal(result.skillProvenance.toolCallId, `call-${index + 1}`);
      assert.equal(result.compiledPrompt, expectedModes[index] === 'Ref2VA' ? validRef : valid);
      assert.equal(calls[index].request.mode, expectedModes[index]);
      assert.equal(calls[index].request.durationSeconds, 5);
      assert.match(calls[index].request.sourceBundle, new RegExp(`MODE: ${expectedModes[index]}`));
    }
  });

  it('fails closed when the skill agent returns invalid output', async () => {
    const compiler = createH3PromptCompiler({ skillAgent: { run: async () => ({ prompt: 'Chinese source', provenance: {} }) } });
    await assert.rejects(() => compiler.compile({}, {}, { prompt: 'rain' }), (error) => error.code === 'H3_PROMPT_FORMAT_INVALID');
  });

  it('preserves stable skill-agent error codes as H3PromptError', async () => {
    for (const code of ['H3_SKILL_TOOL_CALL_UNSUPPORTED', 'SKILL_RESOURCE_MISSING']) {
      const sourceError = Object.assign(new Error('skill request failed'), {
        code,
        details: { sceneKey: 'h3_prompt_compile' },
      });
      const compiler = createH3PromptCompiler({ skillAgent: { run: async () => { throw sourceError; } } });
      await assert.rejects(
        () => compiler.compile({}, {}, { prompt: 'rain' }),
        (error) => error instanceof H3PromptError
          && error.code === code
          && error.details.sceneKey === 'h3_prompt_compile',
      );
    }
  });

  it('passes the selected Ref2VA mode and source bundle unchanged to the skill agent', async () => {
    const calls = [];
    const compiler = createH3PromptCompiler({
      skillAgent: {
        run: async (_db, _log, request) => {
          calls.push(request);
          return { prompt: validRef, provenance: { skillName: 'h3-prompt-writing', skillSha256: 'b'.repeat(64), skillResources: [], toolCallId: 'call-ref' } };
        },
      },
    });
    const result = await compiler.compile({}, {}, { prompt: 'use reference', referenceUrls: ['/ref.png'], duration: 7 });
    assert.equal(result.promptFormat, 'Ref2VA');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, 'Ref2VA');
    assert.equal(calls[0].durationSeconds, 7);
    assert.match(calls[0].sourceBundle, /REFERENCE_ASSETS: \/ref\.png/);
  });

  it('passes complete AV and reference semantics from Generation Context to the skill agent', async () => {
    const calls = [];
    const contextualPrompt = [
      'subject_definitions:',
      '<Subject 1> is Lin Xia in <Picture 1>, used as character identity.',
      '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
      'summary:',
      '[reference generation + audio reference] Lin Xia opens a door.',
      'retention_analysis:',
      '<Subject 1>: fully_preserved - identity retained.',
      '<Audio 1>: reference - voice timbre retained.',
      'detailed_description:',
      '[Shot 1] <Subject 1> from <Picture 1> opens the door while rain remains audible; <Audio 1> anchors the owned voice timbre.',
      'overall_soundscape: Rain and a metal door scrape.',
      'non_diegetic_music: N/A',
    ].join('\n');
    const compiler = createH3PromptCompiler({
      skillAgent: { run: async (_db, _log, request) => { calls.push(request); return { prompt: contextualPrompt, provenance: {} }; } },
    });
    const context = {
      audio_enabled: true,
      storyboard: { visual_prompt: 'Lin Xia opens the door', duration: 6 },
      episode: { audio_plan: { bgm: { mode: 'none' }, speech: { dialogue_owner: 'none', narration_owner: 'none' } } },
      audio: { ambience: ['rain'], sound_effects: ['metal door scrape'], music_cue: { mode: 'mute' } },
      transition: { type: 'cut' },
      references: [{ slot: 1, entity_name: 'Lin Xia', reference_role: 'character_identity', image_url: '/lin.png', audio_label: 'Audio 1', audio_url: '/lin.wav' }],
    };
    const result = await compiler.compile({}, {}, { context, prompt: 'legacy fallback' });
    assert.equal(result.promptFormat, 'Ref2VA');
    assert.match(calls[0].sourceBundle, /AUDIO_PLAN:/);
    assert.match(calls[0].sourceBundle, /metal door scrape/);
    assert.match(calls[0].sourceBundle, /<Audio 1>/);
    assert.equal(result.compiledPrompt, contextualPrompt);
  });
});
