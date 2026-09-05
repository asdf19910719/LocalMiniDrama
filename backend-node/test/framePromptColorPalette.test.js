const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCharacterAnchorText,
  parseColorPalette,
} = require('../src/services/framePromptService');

test('parseColorPalette accepts JSON string or array of hex codes', () => {
  assert.deepEqual(parseColorPalette('["#1A0A00","#C8A96E"]'), ['#1A0A00', '#C8A96E']);
  assert.deepEqual(parseColorPalette(['#F5DEB3', ' #FDDBB4 ']), ['#F5DEB3', '#FDDBB4']);
});

test('parseColorPalette tolerates invalid input', () => {
  assert.deepEqual(parseColorPalette(null), []);
  assert.deepEqual(parseColorPalette('not json'), []);
  assert.deepEqual(parseColorPalette('["红色","#1A0A00",42]'), ['#1A0A00']);
  assert.deepEqual(parseColorPalette([]), []);
});

test('fallback anchor line includes color palette hex codes when anchors missing', () => {
  const line = buildCharacterAnchorText('姬野', null, '黑色中短发，米白衬衫', ['#1A0A00', '#FDDBB4']);
  assert.ok(line.includes('姬野'));
  assert.ok(line.includes('#1A0A00'), 'hex color must appear in fallback anchor line');
  assert.ok(line.includes('#FDDBB4'));
  assert.ok(line.includes('固定色彩锚点'), 'must label the color anchors');
});

test('fallback with palette but no appearance still emits color anchors', () => {
  const line = buildCharacterAnchorText('秋', null, '', ['#C8A96E']);
  assert.ok(line.startsWith('秋'));
  assert.ok(line.includes('#C8A96E'));
});

test('fallback without palette keeps legacy behavior', () => {
  const line = buildCharacterAnchorText('姬野', null, '黑色中短发', []);
  assert.ok(line.includes('姬野'));
  assert.ok(!line.includes('固定色彩锚点'));
  assert.equal(buildCharacterAnchorText('路人', null, '', []), '路人');
});

test('structured identity anchors path is unchanged and does not duplicate palette', () => {
  const anchors = {
    face_shape: 'oval face',
    hair_style: 'short black hair',
    color_anchors: { hair: '#1A0A00', skin: '#FDDBB4' },
  };
  const line = buildCharacterAnchorText('姬野', anchors, 'x', ['#FF0000']);
  assert.ok(line.includes('Face: oval face'));
  assert.ok(line.includes('hair=#1A0A00'));
  assert.ok(!line.includes('#FF0000'), 'palette must not duplicate color_anchors');
});
