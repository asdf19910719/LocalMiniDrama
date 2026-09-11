'use strict';
/**
 * C4 schema 化 Shot Package 导出：GET /episodes/:id/storyboard/shot-package
 * 按 docs/superpowers/specs/schemas/shot-package-v2.1.schema.json 组装（storyboards+segments+references+style）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns, ensureStoryboardV21Columns } = require('../src/v21/db.js');
const { createStoryboardService } = require('../src/v21/storyboard/storyboardService.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');
const { createShotPackageService } = require('../src/v21/storyboard/shotPackageService.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureStoryboardV21Columns(db);
  ensureAsyncTaskV21Columns(db);
  ensureV21Domain(db);
  const now = '2026-09-11T00:00:00Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '剧', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(now, now);
  const script = createScriptService(db, { log });
  const svc = createStoryboardService(db, { log });
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。\n\n第二场 外景·天台·夜\n林夏仰望天空。' });
  script.confirmScript(1, {});
  svc.createFromScript(1);
  return { db, svc, script };
}

/** 对 schema 关键约束的最小结构校验（无 ajv，逐项断言） */
function assertShotPackageShape(pkg) {
  for (const key of ['schema', 'version', 'shot_id', 'revision', 'story_scene_ids', 'planned_duration_seconds', 'story_intent', 'visual', 'timed_segments', 'continuity', 'look_ref', 'references', 'audio']) {
    assert.ok(Object.prototype.hasOwnProperty.call(pkg, key), `缺少必填字段 ${key}`);
  }
  assert.equal(pkg.schema, 'local-mini-drama.shot-package');
  assert.equal(pkg.version, '2.1');
  assert.ok(Number.isInteger(pkg.revision) && pkg.revision >= 1);
  assert.ok(Array.isArray(pkg.story_scene_ids) && pkg.story_scene_ids.length >= 1);
  assert.ok(pkg.planned_duration_seconds > 0);
  assert.ok(String(pkg.story_intent).length >= 1);
  for (const key of ['shot_size', 'camera_angle', 'camera_movement', 'composition', 'lighting']) {
    assert.ok(String(pkg.visual[key]).length >= 1, `visual.${key} 非空`);
  }
  assert.ok(Array.isArray(pkg.timed_segments) && pkg.timed_segments.length >= 1);
  for (const seg of pkg.timed_segments) {
    assert.ok(seg.end_seconds > seg.start_seconds);
    assert.ok(String(seg.action).length >= 1);
    assert.ok(Array.isArray(seg.scene_asset_version_ids) && seg.scene_asset_version_ids.length >= 1);
    for (const key of ['character_state_version_ids', 'prop_version_ids']) {
      assert.ok(Array.isArray(seg[key]));
    }
    for (const speech of seg.dialogue || []) {
      assert.ok(speech.end_seconds > speech.start_seconds);
      assert.ok(String(speech.text).length >= 1);
    }
  }
  assert.deepEqual(Object.keys(pkg.continuity).sort(), ['axis', 'entry', 'exit']);
  assert.match(pkg.look_ref.fingerprint, /^[a-fA-F0-9]{64}$/);
  assert.ok(pkg.look_ref.version_id);
  for (const ref of pkg.references) {
    assert.ok(['scene_view', 'character_state', 'prop'].includes(ref.role));
    assert.ok(ref.asset_version_id != null || ref.artifact_id != null, 'reference 必须携带 asset_version_id 或 artifact_id');
    assert.ok(typeof ref.required === 'boolean');
  }
  assert.deepEqual(Object.keys(pkg.audio).sort(), ['ambience', 'dialogue', 'music_intent', 'narration', 'sound_effects']);
}

test('shot-package：每个镜头产出符合 schema 形状的包（结构/时段/引用/风格/音频）', async () => {
  const ctx = setup();
  const { db, svc } = ctx;
  const shots = svc.listShots(1);
  // 镜头 1：加引用与台词，验证引用/音频组装
  const charId = db.prepare(
    `INSERT INTO characters (drama_id, name, image_url, created_at, updated_at) VALUES (1, '林夏', '/static/c.png', datetime('now'), datetime('now'))`
  ).run().lastInsertRowid;
  svc.addReference(shots[0].id, { assetType: 'character', assetId: Number(charId) });
  const seg = svc.getShotDetail(shots[0].id).segments[0];
  svc.editSegment(shots[0].id, seg.id, { visual: '林夏走向 208', dialogue: '林夏：谁在门后？' });

  const service = createShotPackageService({ db, log });
  const doc = service.buildEpisodePackage(1);
  assert.equal(doc.schema, 'local-mini-drama.shot-package');
  assert.equal(doc.version, '2.1');
  assert.equal(doc.episode_id, 1);
  assert.equal(doc.shots.length, 2);
  for (const pkg of doc.shots) assertShotPackageShape(pkg);
  // 引用：场景 + 人物状态
  const first = doc.shots[0];
  assert.ok(first.references.some((r) => r.role === 'character_state'));
  assert.ok(first.references.some((r) => r.role === 'scene_view'));
  // 时段：动作来自 visual，台词进入 audio.dialogue 与 segment.dialogue
  assert.match(first.timed_segments[0].action, /林夏/);
  const speeches = first.timed_segments[0].dialogue || [];
  assert.equal(speeches.length, 1);
  assert.match(speeches[0].text, /谁在门后/);
  assert.deepEqual(first.audio.dialogue, speeches);
  // 风格指纹来自项目 style_id
  assert.equal(first.look_ref.version_id, 'style:rh-101-cinematic');
});
