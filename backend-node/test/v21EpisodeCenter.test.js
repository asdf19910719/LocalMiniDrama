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

test('copyDraftEpisode：复制为草稿副本（两集共存、内容一致、新集零媒体）', () => {
  const { db, svc } = setup();
  const src = svc.createEpisode(1, { title: '雨夜追踪' });
  db.prepare(
    `INSERT INTO episode_script_revisions (episode_id, revision, status, title, content, source, parent_revision_id, created_at, updated_at)
     VALUES (?, 1, 'draft', '雨夜追踪', '第一场 雨夜 天台……', 'manual', NULL, datetime('now'), datetime('now'))`
  ).run(src.id);
  // 源集已有分镜/媒体 → 副本不得携带
  db.prepare(
    `INSERT INTO storyboards (episode_id, storyboard_number, created_at, updated_at)
     VALUES (?, 1, datetime('now'), datetime('now'))`
  ).run(src.id);
  const copy = svc.copyDraftEpisode(src.id);
  // 源/新两集各自存在
  const list = svc.listEpisodes(1, {});
  assert.deepEqual(
    list.items.map((i) => i.id).sort(),
    [src.id, copy.id].sort()
  );
  // 集号 = MAX+1，标题 = 原标题（草稿副本）
  assert.equal(copy.episodeNumber, 2);
  assert.equal(copy.title, '雨夜追踪（草稿副本）');
  // 剧本草稿内容与源集最新剧本一致
  const copyRev = db
    .prepare('SELECT content FROM episode_script_revisions WHERE episode_id = ? ORDER BY revision DESC LIMIT 1')
    .get(copy.id);
  assert.equal(copyRev.content, '第一场 雨夜 天台……');
  // 新集零媒体任务：无分镜、无图片/视频生成
  const boards = db.prepare('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ?').get(copy.id).n;
  assert.equal(boards, 0);
  const media = db
    .prepare(
      `SELECT COUNT(*) AS n FROM image_generations g JOIN storyboards sb ON sb.id = g.storyboard_id WHERE sb.episode_id = ?`
    )
    .get(copy.id).n;
  assert.equal(media, 0);
});

test('copyDraftEpisode：源集无剧本时副本为空白草稿', () => {
  const { svc } = setup();
  const src = svc.createEpisode(1, { title: '空集' });
  const copy = svc.copyDraftEpisode(src.id);
  assert.equal(copy.episodeNumber, 2);
  assert.equal(copy.status, 'blank');
  assert.equal(copy.title, '空集（草稿副本）');
});

test('renameEpisode：支持设置与清除目标时长；越界 400；列表行回带 targetDuration', () => {
  const { db, svc } = setup();
  const e1 = svc.createEpisode(1, { title: '带时长的集' });
  assert.ok(
    db.prepare('PRAGMA table_info(episodes)').all().some((c) => c.name === 'target_duration_seconds'),
    'episodes 表应有 target_duration_seconds 列'
  );
  // 仅传 targetDuration（不传 title）也应可用
  assert.equal(svc.renameEpisode(e1.id, { targetDuration: 90 }).targetDuration, 90);
  assert.equal(svc.listEpisodes(1, {}).items[0].targetDuration, 90);
  assert.equal(svc.renameEpisode(e1.id, { targetDuration: null }).targetDuration, null);
  assert.throws(
    () => svc.renameEpisode(e1.id, { targetDuration: 9 }),
    (err) => err.status === 400
  );
  assert.throws(
    () => svc.renameEpisode(e1.id, { targetDuration: 3601 }),
    (err) => err.status === 400
  );
  assert.throws(
    () => svc.renameEpisode(e1.id, { targetDuration: 'abc' }),
    (err) => err.status === 400
  );
});

test('listEpisodes：sort=recent 按 updated_at 倒序，默认与 sort=episode 按集号升序', () => {
  const { db, svc } = setup();
  const e1 = svc.createEpisode(1, { title: '第一集' });
  const e2 = svc.createEpisode(1, { title: '第二集' });
  db.prepare('UPDATE episodes SET updated_at = ? WHERE id = ?').run('2026-09-01T08:00:00Z', e1.id);
  db.prepare('UPDATE episodes SET updated_at = ? WHERE id = ?').run('2026-09-10T08:00:00Z', e2.id);
  const byEpisode = svc.listEpisodes(1, {});
  assert.deepEqual(byEpisode.items.map((i) => i.episodeNumber), [1, 2]);
  assert.deepEqual(svc.listEpisodes(1, { sort: 'episode' }).items.map((i) => i.id), [e1.id, e2.id]);
  const byRecent = svc.listEpisodes(1, { sort: 'recent' });
  assert.deepEqual(byRecent.items.map((i) => i.id), [e2.id, e1.id]);
});

test('listEpisodes：status=archived 列出已删除剧集（供恢复入口）', () => {
  const { svc } = setup();
  const e1 = svc.createEpisode(1, { title: '待归档' });
  svc.softDeleteEpisode(e1.id);
  assert.equal(svc.listEpisodes(1, {}).items.length, 0);
  const archived = svc.listEpisodes(1, { status: 'archived' });
  assert.equal(archived.items.length, 1);
  assert.equal(archived.items[0].id, e1.id);
  assert.ok(archived.items[0].deletedAt, '归档行应带 deletedAt');
  svc.restoreEpisode(e1.id);
  assert.equal(svc.listEpisodes(1, { status: 'archived' }).items.length, 0);
  assert.equal(svc.listEpisodes(1, {}).items.length, 1);
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
