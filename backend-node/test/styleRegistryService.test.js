const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { validateStyleSpec } = require('../src/schemas/styleSpec');
const { createStyleRegistryService } = require('../src/services/styleRegistryService');

const catalogPath = path.join(__dirname, '..', 'src', 'catalog', 'stylePresets.v1.json');

test('system catalog contains exactly 169 valid bilingual styles', () => {
  const registry = createStyleRegistryService({ catalogPath });
  const styles = registry.listStyles({ includeDisabled: true });

  assert.equal(styles.length, 169);
  assert.equal(new Set(styles.map((style) => style.id)).size, 169);
  assert.equal(new Set(styles.map((style) => style.key)).size, 169);
  assert.equal(new Set(styles.map((style) => style.runningHubId)).size, 169);

  for (const style of styles) {
    const validation = validateStyleSpec(style);
    assert.equal(validation.valid, true, `${style.id}: ${validation.errors.join('; ')}`);
    assert.ok(style.descriptionZh.trim());
    assert.ok(style.promptZh.trim());
    assert.match(style.promptEn, /[A-Za-z]{4}/);
    assert.notEqual(style.promptEn.trim(), style.promptZh.trim());
    assert.equal(style.type, 'system');
    assert.equal(style.version, 1);
  }
});

test('registry supports stable filters and fails closed for unknown styles', () => {
  const registry = createStyleRegistryService({ catalogPath });
  assert.equal(registry.listStyles({ category: 'realistic' }).length, 39);
  assert.ok(registry.listStyles({ query: '电影' }).length > 0);
  assert.equal(registry.getStyle('missing-style'), null);
  assert.throws(() => registry.requireStyle('missing-style'), (error) => error.code === 'STYLE_NOT_FOUND');
});

test('StyleSpec validator rejects copied Chinese text in promptEn', () => {
  const registry = createStyleRegistryService({ catalogPath });
  const invalid = { ...registry.listStyles()[0], promptEn: '只有中文提示词' };
  const result = validateStyleSpec(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes('promptEn')));
});
