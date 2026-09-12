'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createEpisodeCenterService } = require('../src/v21/episodes/episodeCenterService.js');
const { createNovelSplitService } = require('../src/v21/import/novelSplitService.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const now = '2026-09-12T08:00:00Z';
  db.prepare(`INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, '来源标签项目', 'draft', ?, ?)`).run(now, now);
  return { db, episodes: createEpisodeCenterService(db, { log }) };
}

test('小说拆集来源：confirm 后各集 importSchema=novel-split，导入来源抽屉可读', () => {
  const { db, episodes } = setup();
  const novel = createNovelSplitService({ db, log });
  // 章节正文需超过 20 字才被检测为一章
  const text = [
    '第一章 夜行',
    '凌晨的街道空无一人，只有路灯在雾里晃动，林夏收起伞，沿着湿漉漉的青石板走向巷口深处。',
    '',
    '第二章 巷口',
    '巷口的老钟敲了三下，陈默靠在斑驳的墙边等待，远处的脚步声由远及近，打破了整条街的寂静。',
  ].join('\n');
  const result = novel.confirm(text, { dramaId: 1, maxChapters: 5 });
  assert.equal(result.episodes.length, 2);
  const list = episodes.listEpisodes(1, {});
  for (const ep of list.items) assert.equal(ep.importSchema, 'novel-split');
  const src = episodes.getImportSource(result.episodes[0].episodeId);
  assert.equal(src.schemaName, 'novel-split');
});

test('来源标签口径：手工创建集 importSchema 为 null，制作包导入集透出 episode-package', () => {
  const { db, episodes } = setup();
  const manual = episodes.createEpisode(1, { title: '手工集' });
  assert.equal(episodes.listEpisodes(1, {}).items.find((i) => i.id === manual.id).importSchema, null);
  const now = '2026-09-12T09:00:00Z';
  db.prepare(`INSERT INTO episode_imports (episode_id, schema_name, schema_version, imported_at) VALUES (?, 'episode-package', '2.1', ?)`).run(manual.id, now);
  assert.equal(episodes.listEpisodes(1, {}).items.find((i) => i.id === manual.id).importSchema, 'episode-package');
});
