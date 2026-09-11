'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');

const log = { info() {}, warn() {}, error() {} };

const SCRIPT_V1 = [
  '第一场 内景·公寓客厅·雨夜',
  '林夏坐在沙发上，手机在茶几上震动。',
  '林夏：喂？',
].join('\n');

const SCRIPT_V2 = [
  '第一场 内景·公寓客厅·雨夜',
  '林夏坐在沙发上，手机在茶几上震动。她盯着屏幕，犹豫后接起。',
  '林夏：喂？……你是谁？',
  '',
  '第二场 内景·公寓卧室·深夜',
  '她挂断电话，走向卧室，走廊尽头的灯忽然熄灭。',
].join('\n');

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const now = '2026-09-11T00:00:00Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(now, now);
  return { db, svc: createScriptService(db, { log }) };
}

test('getSceneStats：每场字数/内外景/对白数与全集合计', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_V2 });
  const stats = svc.getSceneStats(1);
  assert.equal(stats.totalScenes, 2);
  assert.equal(stats.scenes[0].interiorExterior, '内景');
  assert.equal(stats.scenes[0].dialogueCount, 1);
  assert.ok(stats.totalChars > 0);
  assert.ok(stats.estimatedSeconds > 0);
});

test('getConfirmPreview：确认前检查/预计素材变化/下游影响/修订链', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_V1 });
  svc.confirmScript(1, { expectedRevision: 1 });
  svc.saveDraft(1, { content: SCRIPT_V2 });
  const preview = svc.getConfirmPreview(1);
  assert.equal(preview.check.scenes, 2);
  assert.equal(preview.check.blockers, 0);
  assert.equal(preview.assetChanges.added, 1, '第二场为新增');
  assert.equal(preview.assetChanges.changed, 1, '第一场有修改');
  assert.ok(preview.downstream.storyboardPackagesStale >= 0);
  assert.equal(preview.revisionChain.draftRevision, 2);
  assert.equal(preview.revisionChain.approvedRevision, 1);
});

test('getConfirmPreview：assetChanges.items 逐项明细与计数字段一致（含场次号/标题）', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_V1 });
  svc.confirmScript(1, { expectedRevision: 1 });
  svc.saveDraft(1, { content: SCRIPT_V2 });
  const preview = svc.getConfirmPreview(1);
  const { added, changed, removed, items } = preview.assetChanges;
  assert.equal(items.added.length, added, '新增明细数与计数字段一致');
  assert.equal(items.changed.length, changed, '修改明细数与计数字段一致');
  assert.equal(items.removed.length, removed, '删除明细数与计数字段一致');
  assert.equal(items.added[0].sceneNumber, 2);
  assert.equal(items.added[0].heading, '内景·公寓卧室·深夜');
  assert.equal(items.changed[0].sceneNumber, 1);
  assert.equal(items.changed[0].heading, '内景·公寓客厅·雨夜');
  for (const list of [items.added, items.changed, items.removed]) {
    for (const row of list) {
      assert.ok(Number.isInteger(row.sceneNumber), '明细含场次序号');
      assert.ok(typeof row.heading === 'string' && row.heading.length > 0, '明细含场次标题');
    }
  }
});

test('getDiff：场次级行 diff（绿增/红删）', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_V1 });
  svc.confirmScript(1, { expectedRevision: 1 });
  svc.saveDraft(1, { content: SCRIPT_V2 });
  const diff = svc.getDiff(1, 1, 2);
  const scene1 = diff.scenes.find((s) => s.no === 1);
  assert.ok(scene1.lines.some((l) => l.type === 'add'), '新增行存在');
  const scene2 = diff.scenes.find((s) => s.no === 2);
  assert.equal(scene2.status, 'added');
  assert.equal(diff.summary.added, 1);
});

test('getStageNav：四阶段 meta 与完成度', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_V1 });
  svc.confirmScript(1, {});
  const nav = svc.getStageNav(1);
  assert.equal(nav.stages.length, 4);
  assert.match(nav.stages[0].meta, /已确认 v1/);
  assert.equal(nav.stages[0].idx, 1);
  assert.ok(nav.completionPercent > 0);
});
