'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureV21Domain, V21_SCHEMA_VERSION } = require('../src/v21/db.js');

function createTempDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  return db;
}

test('V2.1 领域表在空库上创建并写入 app_schema_version=2.1.0', () => {
  const db = createTempDb();
  ensureV21Domain(db);

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );
  for (const name of [
    'app_meta',
    'production_stage_states',
    'production_stage_events',
    'episode_script_revisions',
    'story_scenes',
    'storyboard_segments',
    'episode_asset_selections',
    'episode_asset_set_snapshots',
    'episode_cut_versions',
    'gate_waivers',
    'project_style_events',
  ]) {
    assert.ok(tables.has(name), `缺少 V2.1 表 ${name}`);
  }

  const version = db
    .prepare("SELECT value FROM app_meta WHERE key = 'app_schema_version'")
    .get();
  assert.equal(version.value, V21_SCHEMA_VERSION);
  assert.equal(V21_SCHEMA_VERSION, '2.1.0');
});

test('production_stage_states 在 (episode_id, stage) 上唯一', () => {
  const db = createTempDb();
  ensureV21Domain(db);
  const insert = db.prepare(
    `INSERT INTO production_stage_states (drama_id, episode_id, stage, status, created_at, updated_at)
     VALUES (1, 1, 'script', 'not_started', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')`
  );
  insert.run();
  assert.throws(() => insert.run(), /UNIQUE/);
});

test('episode_script_revisions 在 (episode_id, revision) 上唯一', () => {
  const db = createTempDb();
  ensureV21Domain(db);
  const insert = db.prepare(
    `INSERT INTO episode_script_revisions (episode_id, revision, status, content, created_at)
     VALUES (1, 1, 'draft', 'x', '2026-09-11T00:00:00Z')`
  );
  insert.run();
  assert.throws(() => insert.run(), /UNIQUE/);
});

test('stage 列只允许四个阶段枚举', () => {
  const db = createTempDb();
  ensureV21Domain(db);
  const insert = db.prepare(
    `INSERT INTO production_stage_states (drama_id, episode_id, stage, status, created_at, updated_at)
     VALUES (1, 2, 'bible', 'not_started', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')`
  );
  assert.throws(() => insert.run(), /CHECK/);
});

test('ensureV21Domain 幂等：重复执行不抛错且版本不变', () => {
  const db = createTempDb();
  ensureV21Domain(db);
  ensureV21Domain(db);
  const version = db
    .prepare("SELECT value FROM app_meta WHERE key = 'app_schema_version'")
    .get();
  assert.equal(version.value, '2.1.0');
});

test('episode_cut_versions 在 (episode_id, version) 上唯一', () => {
  const db = createTempDb();
  ensureV21Domain(db);
  const insert = db.prepare(
    `INSERT INTO episode_cut_versions (episode_id, version, status, created_at)
     VALUES (1, 1, 'composing', '2026-09-11T00:00:00Z')`
  );
  insert.run();
  assert.throws(() => insert.run(), /UNIQUE/);
});
