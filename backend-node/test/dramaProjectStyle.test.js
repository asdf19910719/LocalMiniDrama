const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const dramaService = require('../src/services/dramaService');
const { assertNoStyleOverride, hasProjectStyleOverride, requireProjectStyle } = require('../src/services/projectStyleService');

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE dramas (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, genre TEXT, style TEXT, style_id TEXT, metadata TEXT, status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE custom_styles (id TEXT PRIMARY KEY, spec_json TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);`);
  return db;
}

const log = { info() {} };

test('project creation requires a canonical style_id and stores no prompt copy', () => {
  const db = setup();
  assert.throws(() => dramaService.createDrama(db, log, { title: '无风格' }), (error) => error.code === 'PROJECT_STYLE_REQUIRED');
  assert.throws(() => dramaService.createDrama(db, log, { title: '旧字段', style: 'cinematic' }), (error) => error.code === 'PROJECT_STYLE_OVERRIDE_FORBIDDEN');
  const drama = dramaService.createDrama(db, log, { title: '新项目', style_id: 'rh-101-cinematic' });
  assert.equal(drama.style_id, 'rh-101-cinematic');
  assert.equal('style' in drama, false);
  assert.deepEqual(drama.metadata, { storage_folder_label: '新项目' });
  assert.equal(requireProjectStyle(db, drama.id).runningHubId, '101');
});

test('project updates validate style ids and generation overrides fail closed', () => {
  const db = setup();
  const drama = dramaService.createDrama(db, log, { title: '新项目', style_id: 'rh-101-cinematic' });
  assert.throws(() => dramaService.updateDrama(db, log, drama.id, { style: 'anime' }), (error) => error.code === 'PROJECT_STYLE_OVERRIDE_FORBIDDEN');
  assert.throws(() => dramaService.updateDrama(db, log, drama.id, { style_id: 'missing' }), (error) => error.code === 'STYLE_NOT_FOUND');
  assert.throws(() => assertNoStyleOverride({ style_id: 'rh-102-bw-film' }), (error) => error.code === 'PROJECT_STYLE_OVERRIDE_FORBIDDEN');
  assert.equal(hasProjectStyleOverride({ styleSnapshot: {} }), true);
  assert.equal(hasProjectStyleOverride({ model: 'image-model' }), false);
});
