'use strict';
/**
 * B1 「更新分镜结构」diff 向导：previewStructureDiff 只读推导（复用 createFromScript 的
 * 场次→镜头推导）与当前结构对比；applyStructureDiff 在事务内按 diff 增/改/软删，
 * 人工改动镜头可跳过；媒体候选保留；受影响镜头 structure_revision 递增。
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
const { createMockProvider } = require('../src/v21/mockProvider.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21diff-'));
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
  const mock = createMockProvider({ db, log, storageDir: path.join(tmp, 'storage') });
  const script = createScriptService(db, { log });
  const svc = createStoryboardService(db, { log, mockProvider: mock });
  return { db, svc, script };
}

test('diff 预览：新增/变更/未变正确分组；只读不改行', () => {
  const ctx = setup();
  const { db, svc, script } = ctx;
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。\n\n第二场 外景·天台·夜\n林夏仰望天空。' });
  script.confirmScript(1, {});
  svc.createFromScript(1);
  // 之后剧本追加第三场
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。\n\n第二场 外景·天台·夜\n林夏仰望天空。\n\n第三场 内景·门口·黎明\n门开了。' });
  script.confirmScript(1, {});

  const before = svc.listShots(1).map((s) => s.id).join(',');
  const diff = svc.previewStructureDiff(1);
  assert.equal(before, svc.listShots(1).map((s) => s.id).join(','), '预览不得改行');
  assert.equal(diff.unchanged, 2);
  assert.equal(diff.added.length, 1);
  assert.match(diff.added[0].title, /第三场|门口|镜头 3/);
  assert.equal(diff.removed.length, 0);
});

test('diff 预览：镜头被删场次 → removed；人工编辑镜头标 humanEdited', () => {
  const ctx = setup();
  const { db, svc, script } = ctx;
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。\n\n第二场 外景·天台·夜\n林夏仰望天空。' });
  script.confirmScript(1, {});
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  // 人工编辑第二镜（时段编辑 → structure_revision 递增）
  const segments = svc.getShotDetail(shots[1].id).segments;
  svc.editSegment(shots[1].id, segments[0].id, { visual: '手工调整的画面' });
  // 新剧本只保留第一场
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。' });
  script.confirmScript(1, {});
  const diff = svc.previewStructureDiff(1);
  assert.equal(diff.unchanged, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].shotId, shots[1].id);
  assert.equal(diff.removed[0].humanEdited, true, '人工改动镜头必须标注');
});

test('apply：added 创建 / changed 更新 / removed 软删且候选保留；跳过的人工镜头不动', async () => {
  const ctx = setup();
  const { db, svc, script } = ctx;
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。\n\n第二场 外景·天台·夜\n林夏仰望天空。' });
  script.confirmScript(1, {});
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  const shotA = shots[0].id;
  const shotB = shots[1].id;
  // B 有分镜图候选（软删后必须保留）；A 为人工编辑镜头
  await svc.generateImage(shotB, {});
  const segA = svc.getShotDetail(shotA).segments[0];
  svc.editSegment(shotA, segA.id, { visual: '手工调整的画面' });
  // 新剧本只保留第一场且文本变化
  script.saveDraft(1, { content: '第一场 内景·走廊·清晨\n林夏在晨光中走过长廊。' });
  script.confirmScript(1, {});
  const diff = svc.previewStructureDiff(1);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed.length, 1, '人工改动镜头在 changed 中出现且标注 humanEdited');
  assert.equal(diff.changed[0].humanEdited, true);
  assert.equal(diff.removed.length, 1);

  const result = svc.applyStructureDiff(1, {
    added: diff.added,
    changed: diff.changed.map((c) => ({ ...c, skip: c.humanEdited })),
    removed: diff.removed.map((r) => ({ ...r, skip: r.humanEdited })),
  }, {});
  assert.equal(result.applied.added, 0);
  assert.equal(result.applied.changed, 0, '人工改动镜头默认跳过不更新');
  assert.equal(result.applied.skipped, 1, '仅人工改动镜头计入跳过');
  assert.equal(result.applied.removed, 1, '非人工改动的多余镜头按 diff 删除');
  const softDeletedNow = db.prepare('SELECT deleted_at FROM storyboards WHERE id = ?').get(shotB);
  assert.ok(softDeletedNow.deleted_at, 'removed 镜头软删');
  const cand = db.prepare('SELECT COUNT(*) AS n FROM image_generations WHERE storyboard_id = ?').get(shotB).n;
  assert.equal(cand, 1, '媒体候选保留');
  const shotsAfter = svc.listShots(1);
  assert.equal(shotsAfter.length, 1);
  assert.equal(shotsAfter[0].id, shotA);
  assert.equal(svc.getShotDetail(shotA).segments[0].visual, '手工调整的画面', '跳过的镜头内容不动');

  // 二次确认应用 changed（此时 removed 已处理，传空）
  const result2 = svc.applyStructureDiff(1, { added: [], changed: diff.changed, removed: [] }, {});
  assert.equal(result2.applied.changed, 1);
  assert.equal(svc.getShotDetail(shotA).segments[0].visual, '林夏在晨光中走过长廊。', 'changed 镜头视觉被更新');
});

test('apply：变更镜头的 structure_revision 递增（下游冲突保护仍生效）', () => {
  const ctx = setup();
  const { svc, script } = ctx;
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。' });
  script.confirmScript(1, {});
  svc.createFromScript(1);
  const shotId = svc.listShots(1)[0].id;
  const before = svc.getShotDetail(shotId).expectedRevision;
  script.saveDraft(1, { content: '第一场 内景·走廊·清晨\n林夏在晨光中走过长廊。' });
  script.confirmScript(1, {});
  const diff = svc.previewStructureDiff(1);
  svc.applyStructureDiff(1, { added: [], changed: diff.changed, removed: [] }, {});
  const after = svc.getShotDetail(shotId).expectedRevision;
  assert.equal(after, before + 1);
  // SHOT_REVISION_CONFLICT 合同不破
  assert.throws(
    () => svc.editSegment(shotId, svc.getShotDetail(shotId).segments[0].id, { visual: 'x', expectedRevision: before }),
    (err) => err.code === 'SHOT_REVISION_CONFLICT'
  );
});
