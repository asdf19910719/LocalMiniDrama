const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createGenerationCacheKey,
  estimatePeakVramMb,
  validateH3Dimensions,
  validateVramBudget,
} = require('../src/director/directorGenerationPolicy');

describe('Director generation resource policy', () => {
  it('creates the same cache key for semantically identical object ordering', () => {
    const first = createGenerationCacheKey({ workflowId: 'h3', prompt: { b: 2, a: 1 }, inputs: { seed: 42 } });
    const second = createGenerationCacheKey({ inputs: { seed: 42 }, prompt: { a: 1, b: 2 }, workflowId: 'h3' });
    assert.equal(first, second);
    assert.equal(first.length, 64);
  });

  it('estimates higher peak VRAM for larger output and blocks an unsafe request', () => {
    assert.ok(estimatePeakVramMb({ width: 1920, height: 1080 }) > estimatePeakVramMb({ width: 864, height: 480 }));
    assert.throws(() => validateVramBudget({ width: 1920, height: 1080 }, { totalVramMb: 15000, reserveMb: 512 }), /VRAM/i);
    assert.doesNotThrow(() => validateVramBudget({ width: 864, height: 480 }, { totalVramMb: 16303, reserveMb: 512 }));
  });

  it('requires both H3 dimensions to be positive integer multiples of 32', () => {
    assert.deepEqual(validateH3Dimensions({ width: '1280', height: '704' }), { width: 1280, height: 704 });
    for (const dimensions of [
      { width: 0, height: 704 },
      { width: 1280, height: -32 },
      { width: 1279, height: 704 },
      { width: 1280, height: 720 },
      { width: 1280.5, height: 704 },
    ]) {
      assert.throws(() => validateH3Dimensions(dimensions), /32 的倍数/);
    }
  });
});
