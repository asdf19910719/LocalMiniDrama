'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createProjectService } = require('../src/v21/projects/projectService.js');
const { createStageStateService } = require('../src/v21/stage/stageStateService.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  return { db, svc: createProjectService(db, { log }) };
}

function insertDrama(db, { id, title, updatedAt }) {
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)`
  ).run(id, title, updatedAt, updatedAt);
}

function insertEpisode(db, { id, dramaId, number, title, updatedAt }) {
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`
  ).run(id, dramaId, number, title || '', updatedAt, updatedAt);
}

test('createProject：只写名称/画幅/题材，无任何时长字段', () => {
  const { db, svc } = setup();
  const project = svc.createProject({
    title: '午夜回廊',
    aspectRatio: '16:9',
    genre: '悬疑',
    description: '一栋老楼的深夜故事',
  });
  assert.ok(project.id > 0);
  const row = db.prepare('SELECT * FROM dramas WHERE id = ?').get(project.id);
  assert.equal(row.title, '午夜回廊');
  const meta = JSON.parse(row.metadata);
  assert.equal(meta.aspect_ratio, '16:9');
  assert.equal(meta.genre, '悬疑');
  // 铁律：项目资料不含默认单集时长 / 输出偏好
  assert.equal('duration' in meta, false);
  assert.equal('default_episode_duration' in meta, false);
  assert.equal('output_preference' in meta, false);
  // 原型合同：新建项目无时长入参
  assert.throws(() => svc.createProject({ title: 'x', durationTargetSeconds: 90 }), /不支持/);
});

test('listProjects：卡片携带上次工作（剧集+阶段）、健康摘要，q 过滤与排序生效', () => {
  const { db, svc } = setup();
  insertDrama(db, { id: 1, title: '午夜回廊', updatedAt: '2026-09-10T10:00:00Z' });
  insertDrama(db, { id: 2, title: '城中村故事', updatedAt: '2026-09-09T10:00:00Z' });
  insertEpisode(db, { id: 11, dramaId: 1, number: 1, updatedAt: '2026-09-10T10:00:00Z' });
  db.prepare(
    `INSERT INTO episode_script_revisions (episode_id, revision, status, content, created_at)
     VALUES (11, 1, 'draft', '第一场……', '2026-09-10T10:00:00Z')`
  ).run();

  const all = svc.listProjects({});
  assert.equal(all.items.length, 2);
  const card = all.items.find((c) => c.id === 1);
  assert.equal(card.title, '午夜回廊');
  assert.equal(card.episodeCount, 1);
  assert.deepEqual(card.lastWork, { episodeId: 11, episodeNumber: 1, stage: 'script' });

  const filtered = svc.listProjects({ q: '午夜' });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].id, 1);

  const byTitle = svc.listProjects({ sort: 'title' });
  assert.deepEqual(byTitle.items.map((c) => c.title), ['城中村故事', '午夜回廊']);
});

test('listProjects：阶段状态 stale 计入 needsUpdate，状态筛选 needs-attention 命中', () => {
  const { db, svc } = setup();
  insertDrama(db, { id: 1, title: 'A 项目', updatedAt: '2026-09-10T10:00:00Z' });
  insertDrama(db, { id: 2, title: 'B 项目', updatedAt: '2026-09-10T10:00:00Z' });
  insertEpisode(db, { id: 11, dramaId: 1, number: 1, updatedAt: '2026-09-10T10:00:00Z' });
  const stages = createStageStateService(db);
  stages.ensureStage(1, 11, 'script');
  stages.markInProgress(11, 'script', {});
  stages.submitReview(11, 'script', { fingerprint: 'fp' });
  stages.approve(11, 'script', { expectedRevision: 1, expectedFingerprint: 'fp' });
  stages.markStale(11, 'script', { newFingerprint: 'fp2' });

  const attention = svc.listProjects({ status: 'needs-attention' });
  assert.equal(attention.items.length, 1);
  assert.equal(attention.items[0].id, 1);
  const card = attention.items[0];
  assert.equal(card.health.needsUpdate, 1);
});

test('getOverview：Hero（无时长字段）+ 素材一行聚合 + 下一步', () => {
  const { db, svc } = setup();
  insertDrama(db, { id: 1, title: '午夜回廊', updatedAt: '2026-09-10T10:00:00Z' });
  db.prepare("UPDATE dramas SET genre = '悬疑', metadata = ? WHERE id = 1").run(
    JSON.stringify({ aspect_ratio: '16:9', genre: '悬疑' })
  );
  insertEpisode(db, { id: 11, dramaId: 1, number: 1, updatedAt: '2026-09-10T10:00:00Z' });
  db.prepare(
    "INSERT INTO characters (drama_id, name, image_url, created_at, updated_at) VALUES (1, '林夏', '', '2026-09-10', '2026-09-10')"
  ).run();
  db.prepare(
    "INSERT INTO characters (drama_id, name, image_url, created_at, updated_at) VALUES (1, '经理', 'http://x/1.png', '2026-09-10', '2026-09-10')"
  ).run();

  const overview = svc.getOverview(1);
  assert.deepEqual(overview.hero, {
    projectId: 1,
    title: '午夜回廊',
    genre: '悬疑',
    aspectRatio: '16:9',
    episodeCount: 1,
    updatedAt: '2026-09-10T10:00:00Z',
    description: null,
    thumbnail: null,
  });
  // 原型合同：概览素材只保留一行聚合（对象数 + 缺少可用形象数）
  assert.deepEqual(overview.assetsAggregate, { objectCount: 2, missingImageCount: 1 });
  assert.deepEqual(overview.nextStep, { episodeId: 11, episodeNumber: 1, stage: 'script' });
  assert.equal('durations' in overview, false);
  assert.equal(JSON.stringify(overview).includes('duration'), false);
});

test('updateProfile：编辑名称/题材/画幅/简介（窄抽屉字段集）', () => {
  const { db, svc } = setup();
  insertDrama(db, { id: 1, title: '旧名', updatedAt: '2026-09-10T10:00:00Z' });
  svc.updateProfile(1, {
    title: '新名',
    genre: '都市',
    aspectRatio: '9:16',
    description: '竖屏短剧',
  });
  const row = db.prepare('SELECT * FROM dramas WHERE id = 1').get();
  assert.equal(row.title, '新名');
  assert.equal(row.genre, '都市');
  const meta = JSON.parse(row.metadata);
  assert.equal(meta.aspect_ratio, '9:16');
  assert.equal(row.description, '竖屏短剧');
});

test('applyStyle：应用风格只写事件与项目指针，明确"只影响之后的新生成"', () => {
  const { db, svc } = setup();
  insertDrama(db, { id: 1, title: '午夜回廊', updatedAt: '2026-09-10T10:00:00Z' });
  const result = svc.applyStyle(1, { styleId: 'rh-101-cinematic' });
  assert.equal(result.styleId, 'rh-101-cinematic');
  assert.equal(result.appliesTo, 'future-generations-only');
  const row = db.prepare('SELECT style_id AS style FROM dramas WHERE id = 1').get();
  assert.equal(row.style, 'rh-101-cinematic');
  const evt = db
    .prepare("SELECT * FROM project_style_events WHERE drama_id = 1 AND event_type = 'style-applied'")
    .get();
  assert.ok(evt, '写入风格应用事件');
  assert.equal(JSON.parse(evt.payload_json).styleId, 'rh-101-cinematic');
});

test('回收站：软删除项目从默认列表消失，archived 筛选可见，可恢复', () => {
  const { db, svc } = setup();
  insertDrama(db, { id: 1, title: '要删的项目', updatedAt: '2026-09-10T10:00:00Z' });
  insertDrama(db, { id: 2, title: '留下的项目', updatedAt: '2026-09-10T10:00:00Z' });
  svc.softDeleteProject(1);
  assert.equal(svc.listProjects({}).items.map((i) => i.id).join(','), '2');
  assert.equal(svc.listProjects({ status: 'archived' }).items[0].id, 1);
  svc.restoreProject(1);
  assert.equal(svc.listProjects({}).items.length, 2);
});
