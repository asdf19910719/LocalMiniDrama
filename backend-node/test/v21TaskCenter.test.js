'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const {
  ensureV21Domain,
  ensureAsyncTaskV21Columns,
  ensureExternalAiTaskV21Columns,
  ensureCutVersionsV21Columns,
} = require('../src/v21/db.js');
const { createTaskCenterService } = require('../src/v21/tasks/taskCenterService.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21taskcenter-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  ensureExternalAiTaskV21Columns(db);
  ensureCutVersionsV21Columns(db);
  const now = '2026-09-11T00:00:00Z';
  db.prepare(`INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (2, 1, 9, 'EP09', 'draft', ?, ?)`).run(now, now);
  const service = createTaskCenterService(db, { log });
  return { db, service };
}

function insertShot(db, { id, episodeId = 1, number }) {
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, created_at, updated_at) VALUES (?, ?, ?, '2026-09-11', '2026-09-11')`
  ).run(id, episodeId, number);
}

function insertAsyncTask(db, overrides = {}) {
  const row = {
    id: 'task-video-1',
    type: 'v21:mock-video',
    status: 'running',
    progress: 40,
    message: 'mock 通道生成中',
    resource_id: '',
    error: null,
    completed_at: null,
    owner_type: 'storyboard_video',
    owner_id: '10',
    created_at: '2026-09-11T01:00:00Z',
    updated_at: '2026-09-11T01:01:00Z',
    ...overrides,
  };
  db.prepare(
    `INSERT INTO async_tasks
      (id, type, status, progress, message, resource_id, error, completed_at, created_at, updated_at, owner_type, owner_id, input_json, cost_json)
     VALUES (@id, @type, @status, @progress, @message, @resource_id, @error, @completed_at, @created_at, @updated_at, @owner_type, @owner_id, '{}', '{}')`
  ).run(row);
  return row;
}

function insertExternalTask(db, overrides = {}) {
  const row = {
    package_id: 'abcd1234-efgh-ijkl',
    drama_id: 1,
    target_episode_id: 2,
    target_episode_number: 9,
    created_at: '2026-09-11T02:00:00Z',
    imported_at: null,
    cancelled_at: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO external_ai_package_tasks
      (package_id, drama_id, target_episode_id, target_episode_number, assets_digest, context_markdown,
       instructions_markdown, asset_manifest_json, asset_snapshot_json, response_schema_json,
       created_at, imported_at, cancelled_at)
     VALUES (@package_id, @drama_id, @target_episode_id, @target_episode_number, 'd', 'c', 'i', '{}', '{}', '{}', @created_at, @imported_at, @cancelled_at)`
  ).run(row);
  return row;
}

function insertCutVersion(db, overrides = {}) {
  const row = {
    episode_id: 1,
    version: 1,
    status: 'composing',
    error_message: null,
    created_at: '2026-09-11T03:00:00Z',
    updated_at: '2026-09-11T03:01:00Z',
    ...overrides,
  };
  const info = db.prepare(
    `INSERT INTO episode_cut_versions (episode_id, version, status, settings_json, shots_json, task_id, error_message, created_at, updated_at)
     VALUES (@episode_id, @version, @status, '{}', '[]', NULL, @error_message, @created_at, @updated_at)`
  ).run(row);
  return { ...row, id: Number(info.lastInsertRowid) };
}

test('三类来源各插一例都能出现在列表且形状正确（含 updated_at DESC 排序）', () => {
  const { db, service } = setup();
  insertShot(db, { id: 10, number: 5 });
  insertAsyncTask(db);
  insertExternalTask(db);
  insertCutVersion(db);

  const { items, total, page, pageSize } = service.listTasks({});
  assert.equal(total, 3);
  assert.equal(page, 1);
  assert.equal(pageSize, 100);
  assert.deepEqual(items.map((i) => i.source), ['compose', 'external', 'async'], '按 updated_at DESC 排序');

  const video = items.find((i) => i.source === 'async');
  assert.equal(video.id, 'v21task:async:task-video-1');
  assert.equal(video.sourceId, 'task-video-1');
  assert.equal(video.taskType, 'video');
  assert.equal(video.title, '镜头 5 · 视频生成');
  assert.equal(video.status, 'running');
  assert.equal(video.progress, 40);
  assert.equal(video.statusMessage, 'mock 通道生成中');
  assert.equal(video.costNote, null);
  assert.deepEqual(video.target, { projectId: 1, episodeId: 1, shotId: 10, stage: 'storyboard' });
  assert.equal(video.createdAt, '2026-09-11T01:00:00Z');
  assert.equal(video.updatedAt, '2026-09-11T01:01:00Z');
  assert.equal(video.completedAt, null);

  const external = items.find((i) => i.source === 'external');
  assert.equal(external.id, 'v21task:external:abcd1234-efgh-ijkl');
  assert.equal(external.sourceId, 'abcd1234-efgh-ijkl');
  assert.equal(external.taskType, 'external');
  assert.equal(external.status, 'waiting_external');
  assert.ok(external.title.includes('第 9 集'), '标题带目标集号');
  assert.ok(external.title.includes('abcd1234'), '标题带 package_id 前 8 位');
  assert.equal(external.progress, null);
  assert.equal(external.statusMessage, null);
  assert.deepEqual(external.target, { projectId: 1, episodeId: 2, shotId: null, stage: 'episodes' });

  const compose = items.find((i) => i.source === 'compose');
  assert.equal(compose.source, 'compose');
  assert.equal(compose.id, `v21task:compose:${compose.sourceId}`);
  assert.equal(compose.taskType, 'compose');
  assert.equal(compose.status, 'composing');
  assert.equal(compose.title, '成片 v1 · 整集合成');
  assert.deepEqual(compose.target, { projectId: 1, episodeId: 1, shotId: null, stage: 'cut' });
});

test('status=attention 过滤返回 failed+waiting_external 而不含 completed', () => {
  const { db, service } = setup();
  insertShot(db, { id: 11, number: 6 });
  insertAsyncTask(db, {
    id: 'task-failed',
    type: 'v21:mock-image',
    status: 'failed',
    progress: 0,
    message: '',
    error: 'boom',
    owner_type: 'quick_create',
    owner_id: 'free',
  });
  insertExternalTask(db);
  insertAsyncTask(db, {
    id: 'task-done',
    status: 'completed',
    progress: 100,
    message: '生成完成',
    completed_at: '2026-09-11T01:05:00Z',
  });

  const { items, total } = service.listTasks({ status: 'attention' });
  assert.equal(total, 2);
  assert.deepEqual(
    [...new Set(items.map((i) => i.status))].sort(),
    ['failed', 'waiting_external'],
    'attention 页签只含 failed 与 waiting_external'
  );
  assert.ok(!items.some((i) => i.status === 'completed'), '不含 completed');
  const failed = items.find((i) => i.status === 'failed');
  assert.equal(failed.taskType, 'quick-create');
  assert.equal(failed.statusMessage, 'boom');
});

test('q 过滤命中标题', () => {
  const { db, service } = setup();
  insertShot(db, { id: 10, number: 5 });
  insertAsyncTask(db);
  insertExternalTask(db);
  insertCutVersion(db);

  const { items, total } = service.listTasks({ q: '镜头 5' });
  assert.equal(total, 1);
  assert.equal(items[0].title, '镜头 5 · 视频生成');

  const byPackage = service.listTasks({ q: 'abcd1234' });
  assert.equal(byPackage.total, 1);
  assert.equal(byPackage.items[0].source, 'external');
});

test('分页 total 正确（内存分页），翻页保持排序稳定', () => {
  const { db, service } = setup();
  for (let i = 1; i <= 3; i += 1) {
    insertAsyncTask(db, {
      id: `qc-${i}`,
      type: 'v21:mock-image',
      status: 'completed',
      progress: 100,
      message: '生成完成',
      owner_type: 'quick_create',
      owner_id: 'free',
      created_at: `2026-09-11T0${i}:00:00Z`,
      updated_at: `2026-09-11T0${i}:30:00Z`,
    });
  }
  const page1 = service.listTasks({ page: 1, page_size: 2 });
  assert.equal(page1.total, 3);
  assert.equal(page1.items.length, 2);
  assert.equal(page1.items[0].sourceId, 'qc-3', 'updated_at DESC');
  const page2 = service.listTasks({ page: 2, page_size: 2 });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0].sourceId, 'qc-1');
});

test('type 多值过滤与 status=done 映射（ready→completed、cancel-requested 失败行→cancelled）', () => {
  const { db, service } = setup();
  insertShot(db, { id: 10, number: 5 });
  insertAsyncTask(db);
  insertAsyncTask(db, {
    id: 'qc-done',
    type: 'v21:mock-image',
    status: 'completed',
    progress: 100,
    message: '生成完成',
    owner_type: 'quick_create',
    owner_id: 'free',
    completed_at: '2026-09-11T05:00:00Z',
  });
  insertExternalTask(db, { imported_at: '2026-09-11T04:00:00Z' });
  insertCutVersion(db, { status: 'exported' });
  insertCutVersion(db, { version: 2, status: 'failed', error_message: 'cancel-requested' });

  const externalOnly = service.listTasks({ type: 'external' });
  assert.equal(externalOnly.total, 1);
  const multi = service.listTasks({ type: 'video,external' });
  assert.equal(multi.total, 2);
  assert.ok(multi.items.every((i) => ['video', 'external'].includes(i.taskType)));

  const done = service.listTasks({ status: 'done' });
  assert.deepEqual(
    [...done.items.map((i) => i.status)].sort(),
    ['cancelled', 'completed', 'exported', 'imported'],
    'done 页签含 completed/cancelled/exported/imported'
  );
});
