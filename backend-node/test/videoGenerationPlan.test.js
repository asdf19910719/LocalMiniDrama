const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVideoGenerationPlan } = require('../src/services/videoGenerationPlan');

describe('video generation plan', () => {
  const base = { prompt: 'A woman crosses a rainy street.', reference_image_urls: ['scene.png'], width: 864, height: 480, duration: 5, frame_rate: 24, seed: 42 };

  test('creates one canonical s0 R2V segment and stable hash', () => {
    const result = buildVideoGenerationPlan(base);
    assert.equal(result.plan.workflowId, 'minimax_h3_director_r2v');
    assert.equal(result.plan.mode, 'single_reference');
    assert.equal(result.plan.segments.length, 1);
    assert.equal(result.plan.segments[0].id, 's0');
    assert.equal(result.plan.segments[0].continuityFromPrev, false);
    assert.match(result.planHash, /^sha256:[a-f0-9]{64}$/);
  });

  test('accepts one and nine refs but rejects zero and ten', () => {
    assert.doesNotThrow(() => buildVideoGenerationPlan({ ...base, reference_image_urls: ['a.png'] }));
    assert.doesNotThrow(() => buildVideoGenerationPlan({ ...base, reference_image_urls: Array.from({ length: 9 }, (_, i) => `${i}.png`) }));
    assert.throws(() => buildVideoGenerationPlan({ ...base, reference_image_urls: [] }), /REFERENCE_COUNT/);
    assert.throws(() => buildVideoGenerationPlan({ ...base, reference_image_urls: Array.from({ length: 10 }, (_, i) => `${i}.png`) }), /REFERENCE_COUNT/);
  });

  test('fails closed for continuity, dimensions, seed, and unknown fields', () => {
    assert.throws(() => buildVideoGenerationPlan({ ...base, continuity_enabled: true }), /CONTINUITY/);
    assert.throws(() => buildVideoGenerationPlan({ ...base, width: 865 }), /32/);
    assert.throws(() => buildVideoGenerationPlan({ ...base, seed: -1 }), /SEED/);
    assert.throws(() => buildVideoGenerationPlan({ ...base, arbitrary: true }), /UNSUPPORTED/);
  });

  test('includes the requested seed in the reproducibility hash', () => {
    const first = buildVideoGenerationPlan({ ...base, seed: 41 });
    const second = buildVideoGenerationPlan({ ...base, seed: 42 });
    assert.notEqual(first.planHash, second.planHash);
    assert.equal(first.plan.common.seed, 41);
  });
});
