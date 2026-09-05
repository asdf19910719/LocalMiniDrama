const test = require('node:test');
const assert = require('node:assert/strict');

const { createPreparedVideoGenerationService } = require('../src/services/preparedVideoGenerationService');

test('H3 preparation compiles once and submits the prepared draft plus ordered assets', async () => {
  const calls = { compile: 0, create: [] };
  const service = createPreparedVideoGenerationService({
    resolveRuntime: () => ({ isH3: true, configId: 4, workflowId: 'h3' }),
    drafts: {
      getLatestDraft: () => null,
      compileDraft: async () => {
        calls.compile += 1;
        return {
          id: 42,
          status: 'valid',
          reference_snapshot: JSON.stringify({
            slots: [{ image_available: true, image_url: 'scene.png' }],
            audio: [{ audio_url: 'voice.wav' }],
          }),
        };
      },
      evaluateDraftFreshness: () => ({ stale: false, reasons: [] }),
    },
    createVideoGeneration: async (input) => { calls.create.push(input); return { id: 9 }; },
  });
  const result = await service.prepareAndCreateVideoGeneration({ storyboard_id: 7, prompt: 'business prompt' });
  assert.equal(calls.compile, 1);
  assert.equal(calls.create[0].h3_prompt_draft_id, 42);
  assert.deepEqual(calls.create[0].reference_image_urls, ['scene.png']);
  assert.deepEqual(calls.create[0].reference_audios, [{ audio_url: 'voice.wav' }]);
  assert.equal(result.generation.id, 9);
});

test('non-H3 preparation never invokes the H3 compiler', async () => {
  let compiled = false;
  const service = createPreparedVideoGenerationService({
    resolveRuntime: () => ({ isH3: false }),
    drafts: { compileDraft: () => { compiled = true; } },
    createVideoGeneration: async () => ({ id: 10 }),
  });
  await service.prepareAndCreateVideoGeneration({ storyboard_id: 7, prompt: 'cloud prompt' });
  assert.equal(compiled, false);
});

test('prepared batch keeps input order and isolates item failures', async () => {
  const service = createPreparedVideoGenerationService({
    resolveRuntime: () => ({ isH3: false }),
    createVideoGeneration: async (input) => {
      if (input.storyboard_id === 2) throw Object.assign(new Error('broken'), { code: 'BROKEN' });
      return { id: input.storyboard_id * 10 };
    },
  });
  const results = await service.prepareAndCreateMany([
    { storyboard_id: 1 }, { storyboard_id: 2 }, { storyboard_id: 3 },
  ]);
  assert.deepEqual(results.map((item) => item.storyboard_id), [1, 2, 3]);
  assert.deepEqual(results.map((item) => item.status), ['created', 'failed', 'created']);
  assert.equal(results[1].error.code, 'BROKEN');
});

test('concurrent H3 candidates share preparation but create separate generations', async () => {
  let compileCount = 0;
  let createCount = 0;
  let releaseCompile;
  const compileGate = new Promise((resolve) => { releaseCompile = resolve; });
  const service = createPreparedVideoGenerationService({
    resolveRuntime: () => ({ isH3: true, configId: 4, workflowId: 'h3' }),
    drafts: {
      getLatestDraft: () => null,
      compileDraft: async () => {
        compileCount += 1;
        await compileGate;
        return { id: 88, status: 'valid', reference_snapshot: '{}' };
      },
    },
    createVideoGeneration: async () => ({ id: ++createCount }),
  });
  const first = service.prepareAndCreateVideoGeneration({ storyboard_id: 7, prompt: 'candidate one' });
  const second = service.prepareAndCreateVideoGeneration({ storyboard_id: 7, prompt: 'candidate two' });
  releaseCompile();
  const results = await Promise.all([first, second]);
  assert.equal(compileCount, 1);
  assert.equal(createCount, 2);
  assert.deepEqual(results.map((item) => item.generation.id), [1, 2]);
});
