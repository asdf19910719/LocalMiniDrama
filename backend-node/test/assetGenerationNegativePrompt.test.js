const { it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const sceneService = require('../src/services/sceneService');
const imageClient = require('../src/services/imageClient');

it('passes a scene negative prompt to both normal and quad-grid API generation', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, style TEXT, metadata TEXT, deleted_at TEXT);
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, location TEXT, time TEXT, prompt TEXT,
      polished_prompt TEXT, polished_prompt_single TEXT, negative_prompt TEXT,
      updated_at TEXT, deleted_at TEXT
    );
    INSERT INTO dramas VALUES (7, 'cinematic', '{}', NULL);
    INSERT INTO scenes VALUES (1, 7, '雨夜街道', '夜', 'wet street', 'quad prompt', 'single prompt', 'daylight, watermark', NULL, NULL);
  `);
  const originalResolve = imageClient.resolveAssetUserNegativeForApi;
  const originalCreate = imageClient.createAndGenerateImage;
  const calls = [];
  imageClient.resolveAssetUserNegativeForApi = (model, negative) => `${model}:${negative}`;
  imageClient.createAndGenerateImage = (_db, _log, input) => {
    calls.push(input);
    return { id: calls.length };
  };
  try {
    await sceneService.generateSceneSingleImage(db, console, {}, 1, 'image-model');
    await sceneService.generateSceneFourViewImage(db, console, {}, 1, 'image-model');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].user_negative_prompt, 'image-model:daylight, watermark');
    assert.equal(calls[1].user_negative_prompt, 'image-model:daylight, watermark');
    assert.doesNotMatch(calls[0].prompt, /场景四宫格版式/);
    assert.match(calls[1].prompt, /场景四宫格版式/);
  } finally {
    imageClient.resolveAssetUserNegativeForApi = originalResolve;
    imageClient.createAndGenerateImage = originalCreate;
    db.close();
  }
});
