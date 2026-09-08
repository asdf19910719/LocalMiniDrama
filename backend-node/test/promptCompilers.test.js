const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { compileImagePrompt } = require('../src/services/imagePromptCompiler');
const { compileVideoPrompt } = require('../src/services/videoPromptCompiler');
const { createReferenceRegistry } = require('../src/services/referenceRegistry');
const { createStyleRegistryService } = require('../src/services/styleRegistryService');
const { compileCanonicalVideoStyle } = require('../src/services/unifiedVideoGenerationService');

const style = createStyleRegistryService().requireStyle('rh-101-cinematic');

test('image compiler handles every production asset mode with style first and no duplicate style block', () => {
  const cases = [
    ['character', 'TURNAROUND'], ['character', 'SINGLE'], ['character_variant', 'SINGLE'],
    ['scene', 'NORMAL'], ['scene', 'MULTI_VIEW'], ['scene', 'PANORAMA'], ['scene', 'TOP_DOWN'],
    ['prop', 'SINGLE'], ['storyboard', 'FRAME'],
  ];
  for (const [targetType, mode] of cases) {
    const result = compileImagePrompt({ targetType, mode, basePrompt: `${style.promptEn} Subject description`, negativePrompt: 'blurry', style, language: 'en' });
    assert.ok(result.finalPrompt.startsWith(style.promptEn));
    assert.equal(result.finalPrompt.split(style.promptEn).length - 1, 1);
    assert.match(result.finalPrompt, /Subject description/);
    assert.match(result.negativePrompt, /blurry/);
  }
});

test('video compiler injects style before references, timeline, dialogue, audio, and output rules', () => {
  const references = createReferenceRegistry([{ path: 'person.png', name: '林晚', role: 'character' }, { path: 'room.png', name: '旧屋', role: 'scene' }], 'mixed');
  const result = compileVideoPrompt({
    style, language: 'mixed', references, duration: 8,
    basePrompt: '林晚推门进入旧屋',
    storyboard: { dialogue: '林晚：有人吗？', movement: 'slow dolly in', shot_type: 'medium shot' },
    audio: { environment: 'rain outside', effects: 'door creak' },
  });
  assert.ok(result.finalPrompt.startsWith(style.promptZh));
  assert.match(result.finalPrompt, /@图片1/);
  assert.match(result.finalPrompt, /\[00:00-08:00\]/);
  assert.match(result.finalPrompt, /林晚：有人吗？/);
  assert.match(result.finalPrompt, /rain outside/);
  assert.doesNotMatch(result.finalPrompt, /\. Style:/);
});

test('project video compilation resolves only the persisted style_id and rejects request overrides', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, style_id TEXT, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, description TEXT, dialogue TEXT, deleted_at TEXT);
    INSERT INTO dramas VALUES (7, 'rh-101-cinematic', NULL);
    INSERT INTO storyboards VALUES (9, '雨夜追逐', '停下！', NULL);
  `);
  const result = compileCanonicalVideoStyle(db, {
    drama_id: 7,
    storyboard_id: 9,
    prompt: '人物冲入窄巷',
  }, { capabilities: { promptLanguage: 'mixed' } }, [], 5);
  assert.equal(result.compilation.style.id, 'rh-101-cinematic');
  assert.ok(result.prompt.startsWith(style.promptZh));
  assert.match(result.prompt, /人物冲入窄巷/);
  assert.throws(
    () => compileCanonicalVideoStyle(db, { drama_id: 7, prompt: 'x', style: 'anime' }, {}, [], 5),
    (error) => error.code === 'PROJECT_STYLE_OVERRIDE_FORBIDDEN'
  );
  assert.throws(
    () => compileCanonicalVideoStyle(db, { prompt: 'x' }, {}, [], 5),
    (error) => error.code === 'PROJECT_STYLE_REQUIRED'
  );
  db.close();
});
