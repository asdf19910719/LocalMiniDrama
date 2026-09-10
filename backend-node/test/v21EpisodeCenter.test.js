'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createEpisodeCenterService } = require('../src/v21/episodes/episodeCenterService.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const now = '2026-09-10T10:00:00Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', ?, ?)`
  ).run(now, now);
  return { db, svc: createEpisodeCenterService(db, { log }) };
}

test('createEpisode：自动分配下一集号并创建空白草稿（无时长要求）', () => {
  const { db, svc } = setup();
  const first = svc.createEpisode(1, { title: '凌晨两点' });
  assert.equal(first.episodeNumber, 1);
  assert.equal(first.blank, true);
  const second = svc.createEpisode(1, {});
  assert.equal(second.episodeNumber, 2);
  const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(first.id);
  assert.equal(row.title, '凌晨两点');
  assert.equal(!row.script_content, true, '空白草稿无剧本内容');
});

test('listEpisodes：默认集号升序，状态筛选与搜索生效', () => {
  const { svc } = setup();
  const e1 = svc.createEpisode(1, { title: '第一集' });
  const e2 = svc.createEpisode(1, { title: '第二集' });
  const e3 = svc.createEpisode(1, { title: '特别篇' });
  const all = svc.listEpisodes(1, {});
  assert.deepEqual(all.items.map((i) => i.episodeNumber), [1, 2, 3]);
  const searched = svc.listEpisodes(1, { q: '特别' });
  assert.equal(searched.items.length, 1);
  assert.equal(searched.items[0].id, e3.id);
  assert.ok(e1.id > 0 && e2.id > 0);
});

test('listEpisodes：集阶段投影（stage 与 needsAttention）', () => {
  const { db, svc } = setup();
  const e1 = svc.createEpisode(1, { title: '第一集' });
  db.prepare(
    `INSERT INTO episode_script_revisions (episode_id, revision, status, content, created_at)
     VALUES (?, 1, 'draft', '第一场...', datetime('now'))`
  ).run(e1.id);
  const items = svc.listEpisodes(1, {}).items;
  assert.equal(items[0].stage, 'script');
  assert.equal(items[0].status, 'making');
});

test('renameEpisode：修改标题；getEpisode 返回行数据', () => {
  const { svc } = setup();
  const e1 = svc.createEpisode(1, { title: '旧名' });
  const updated = svc.renameEpisode(e1.id, { title: '新名' });
  assert.equal(updated.title, '新名');
  assert.equal(svc.getEpisode(e1.id).title, '新名');
});

test('reorderEpisodes：调整集序；冲突返回 409 且不覆盖', () => {
  const { svc } = setup();
  const e1 = svc.createEpisode(1, {});
  const e2 = svc.createEpisode(1, {});
  const e3 = svc.createEpisode(1, {});
  const result = svc.reorderEpisodes(1, { order: [e3.id, e1.id, e2.id] });
  assert.deepEqual(
    svc.listEpisodes(1, {}).items.map((i) => i.id),
    [e3.id, e1.id, e2.id]
  );
  assert.throws(
    () => svc.reorderEpisodes(1, { order: [e1.id, e2.id] }),
    (err) => err.code === 'EPISODE_ORDER_CONFLICT' && err.status === 409
  );
  assert.ok(result.updated >= 3);
  // 集序调整不改变剧集 ID（E-03）
  assert.equal(svc.getEpisode(e1.id).id, e1.id);
});

test('softDeleteEpisode：回收站式删除并列出影响；restore 可恢复', () => {
  const { db, svc } = setup();
  const e1 = svc.createEpisode(1, { title: '要删的集' });
  db.prepare(
    `INSERT INTO episode_script_revisions (episode_id, revision, status, content, created_at)
     VALUES (?, 1, 'draft', 'x', datetime('now'))`
  ).run(e1.id);
  db.prepare(
    `INSERT INTO storyboards (episode_id, storyboard_number, created_at, updated_at)
     VALUES (?, 1, datetime('now'), datetime('now'))`
  ).run(e1.id);
  const result = svc.softDeleteEpisode(e1.id);
  assert.equal(result.deleted, true);
  assert.equal(result.recoverable, true);
  assert.ok(result.impacts.scriptRevisions >= 1);
  assert.ok(result.impacts.storyboards >= 1);
  assert.equal(svc.listEpisodes(1, {}).items.length, 0);
  svc.restoreEpisode(e1.id);
  assert.equal(svc.listEpisodes(1, {}).items.length, 1);
});

test('getBlankStatus：空白判定（23.5 非空条件）', () => {
  const { db, svc } = setup();
  const e1 = svc.createEpisode(1, {});
  assert.deepEqual(svc.getBlankStatus(e1.id), { blank: true, reasons: [] });

  // 剧本非空 → 非空
  db.prepare('UPDATE episodes SET script_content = ? WHERE id = ?').run('有剧本了', e1.id);
  let status = svc.getBlankStatus(e1.id);
  assert.equal(status.blank, false);
  assert.ok(status.reasons.some((r) => r.code === 'SCRIPT_NOT_EMPTY'));

  // 清空剧本但已有分镜 → 非空
  db.prepare('UPDATE episodes SET script_content = NULL WHERE id = ?').run(e1.id);
  db.prepare(
    `INSERT INTO storyboards (episode_id, storyboard_number, created_at, updated_at)
     VALUES (?, 1, datetime('now'), datetime('now'))`
  ).run(e1.id);
  status = svc.getBlankStatus(e1.id);
  assert.equal(status.blank, false);
  assert.ok(status.reasons.some((r) => r.code === 'HAS_STORYBOARDS'));

  // 成功导入记录 → 非空
  const e2 = svc.createEpisode(1, {});
  db.prepare(
    `INSERT INTO episode_imports (episode_id, task_package_id, imported_at, source_sha256, import_report)
     VALUES (?, 'pkg-1', datetime('now'), ?, '{}')`
  ).run(e2.id, 'a'.repeat(64));
  status = svc.getBlankStatus(e2.id);
  assert.equal(status.blank, false);
  assert.ok(status.reasons.some((r) => r.code === 'IMPORTED'));
});

test('listBlankEpisodes：目标选择器只列空白剧集', () => {
  const { db, svc } = setup();
  const e1 = svc.createEpisode(1, {});
  const e2 = svc.createEpisode(1, { title: '有内容的' });
  db.prepare('UPDATE episodes SET script_content = ? WHERE id = ?').run('x', e2.id);
  const blanks = svc.listBlankEpisodes(1);
  assert.equal(blanks.items.length, 1);
  assert.equal(blanks.items[0].id, e1.id);
});

test('getImportSource：无来源时返回 null，有来源返回只读审计', () => {
  const { db, svc } = setup();
  const e1 = svc.createEpisode(1, {});
  assert.equal(svc.getImportSource(e1.id), null);
  db.prepare(
    `INSERT INTO episode_imports (episode_id, task_package_id, imported_at, source_sha256, import_report)
     VALUES (?, 'pkg-9', datetime('now'), ?, '{"shots":10}')`
  ).run(e1.id, 'b'.repeat(64));
  const source = svc.getImportSource(e1.id);
  assert.equal(source.packageId, 'pkg-9');
  assert.equal(source.readOnly, true);
});
