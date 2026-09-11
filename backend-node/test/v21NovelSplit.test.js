'use strict';
/**
 * B2 小说/长文本拆集：预览（建议集号 + 冲突标注）→ 确认逐集创建草稿（零媒体任务）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createNovelSplitService } = require('../src/v21/import/novelSplitService.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-11T00:00:00Z';

const NOVEL = [
  '第一章 入夜',
  '林夏走进走廊，灯光忽明忽暗。她数着门牌，208 室就在尽头。空气里有潮湿的味道，她握紧了手里的钥匙。',
  '第二章 天台',
  '天台的风很大。林夏仰望夜空，城市的霓虹在云层下起伏。她想起白天电话里的那句话。',
  '第三章 门开',
  '黎明前最黑暗的时刻，208 的门缓缓打开。没有人说话，走廊尽头传来滴水声。',
].join('\n');

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '剧', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, '第 1 集', 'draft', ?, ?)`
  ).run(NOW, NOW);
  const svc = createNovelSplitService({ db, log });
  return { db, svc };
}

test('preview：章节解析 + 建议集号 + 冲突标注（起始集号已存在 → warn）', () => {
  const { svc } = setup();
  const preview = svc.preview(NOVEL, { maxChapters: 20, startNumber: 1 });
  assert.equal(preview.chapterCount, 3);
  assert.equal(preview.existingEpisodes, 1);
  assert.equal(preview.preview.length, 3);
  assert.equal(preview.preview[0].suggestedEpisodeNumber, 1);
  assert.equal(preview.preview[0].conflict, true, '第 1 集已存在 → 冲突警告');
  assert.equal(preview.preview[1].suggestedEpisodeNumber, 2);
  assert.equal(preview.preview[1].conflict, false);
  assert.ok(preview.preview[0].chars > 20);
});

test('confirm：逐集创建草稿剧集与剧本版本，冲突集跳过；零媒体任务', () => {
  const { db, svc } = setup();
  const script = createScriptService(db, { log });
  void script;
  const result = svc.confirm(NOVEL, { title: '小说', maxChapters: 20, startNumber: 2 });
  assert.equal(result.episodes.length, 3);
  assert.equal(result.episodes[0].episodeNumber, 2);
  assert.equal(result.skipped.length, 0);
  const rows = db.prepare('SELECT id, episode_number, title, status FROM episodes WHERE deleted_at IS NULL ORDER BY episode_number').all();
  assert.equal(rows.length, 4);
  assert.equal(rows[1].status, 'draft');
  // 草稿剧本版本已写入（建议集号 3 ← 第二章「天台」）
  const third = rows.find((r) => r.episode_number === 3);
  const draft = db
    .prepare("SELECT content FROM episode_script_revisions WHERE episode_id = ? ORDER BY id DESC LIMIT 1")
    .get(third.id);
  assert.match(draft.content, /天台/);
  // 零媒体任务
  const tasks = db.prepare('SELECT COUNT(*) AS n FROM async_tasks').get().n;
  assert.equal(tasks, 0);
});

test('confirm：maxChapters 限制拆分数；空文本拒绝', () => {
  const { db, svc } = setup();
  const result = svc.confirm(NOVEL, { maxChapters: 2, startNumber: 2 });
  assert.equal(result.episodes.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM episodes WHERE deleted_at IS NULL').get().n, 3);
  assert.throws(() => svc.confirm('   ', {}), /小说文本/);
});
