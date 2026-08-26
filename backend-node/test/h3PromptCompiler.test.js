const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createH3PromptCompiler, h3Mode, validateH3Prompt } = require('../src/services/h3PromptCompiler');

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

  it('compiles through the configured text model and never falls back to source text', async () => {
    const calls = [];
    const compiler = createH3PromptCompiler({ generateText: async (...args) => { calls.push(args); return valid; } });
    const result = await compiler.compile({}, {}, { prompt: '雨夜车站，女孩转身。', duration: 5 });
    assert.equal(result.compiledPrompt, valid);
    assert.equal(result.sourcePrompt, '雨夜车站，女孩转身。');
    assert.equal(result.promptFormat, 'T2VA');
    assert.match(calls[0][4], /integrated_multimodal_description/);
  });

  it('fails closed when the text model returns invalid output', async () => {
    const compiler = createH3PromptCompiler({ generateText: async () => '中文原文' });
    await assert.rejects(() => compiler.compile({}, {}, { prompt: '雨夜' }), (error) => error.code === 'H3_PROMPT_FORMAT_INVALID');
  });

  it('retries once with a strict correction instruction when the first draft is incomplete', async () => {
    let attempts = 0;
    const compiler = createH3PromptCompiler({ generateText: async () => (++attempts === 1 ? 'integrated_multimodal_description: [Shot 1] draft' : valid) });
    const result = await compiler.compile({}, {}, { prompt: '雨夜' });
    assert.equal(result.compiledPrompt, valid);
    assert.equal(attempts, 2);
  });

  it('compiles Ref2VA through the six-section instruction', async () => {
    const calls = [];
    const compiler = createH3PromptCompiler({ generateText: async (...args) => { calls.push(args); return validRef; } });
    const result = await compiler.compile({}, {}, { prompt: 'use the supplied reference assets', referenceUrls: ['/ref.png'], duration: 5 });
    assert.equal(result.promptFormat, 'Ref2VA');
    assert.match(calls[0][4], /subject_definitions/);
    assert.match(result.compiledPrompt, /detailed_description:/);
  });
});
