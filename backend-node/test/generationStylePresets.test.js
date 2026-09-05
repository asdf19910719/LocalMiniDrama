const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStylePreset } = require('../src/constants/generationStylePresets');

const EXTRA = [
  '2d gufeng',
  'xianxia 3d',
  'gufeng 3d',
  'neo chinese guochao',
  'neo gufeng',
  'urban romance comic',
  'korean romance webtoon',
];

for (const value of EXTRA) {
  test(`resolves ${value}`, () => {
    const p = resolveStylePreset(value);
    assert.ok(p, `missing preset ${value}`);
    assert.ok(p.zh.length > 10);
    assert.ok(p.en.length > 10);
  });
}

test('custom is not a preset', () => {
  assert.equal(resolveStylePreset('custom'), null);
});

test('cinematic keeps every principal face clear in multi-character shots', () => {
  const preset = resolveStylePreset('cinematic');

  assert.ok(preset);
  assert.doesNotMatch(preset.zh, /浅景深|虚化背景/);
  assert.doesNotMatch(preset.en, /shallow depth of field/i);
  assert.match(preset.zh, /景深随镜头叙事动态选择/);
  assert.match(preset.zh, /所有主要人物面部保持清晰可辨/);
  assert.match(preset.en, /shot-appropriate depth of field/i);
  assert.match(preset.en, /all principal characters' faces sharply focused and clearly identifiable/i);
});
