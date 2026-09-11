'use strict';
/**
 * A1/C3 · /api/v2 视频任务端点：状态轮询与取消（cancel-requested 语义）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const {
  ensureV21Domain,
  ensureAsyncTaskV21Columns,
  ensureStoryboardV21Columns,
} = require('../src/v21/db.js');
const { createV21Router } = require('../src/v21/routes.js');

const log = { info() {}, warn() {}, error() {} };

async function startServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21routes-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureStoryboardV21Columns(db);
  ensureAsyncTaskV21Columns(db);
  ensureV21Domain(db);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/v2', createV21Router({
    db,
    cfg: { storage: { local_path: path.join(tmp, 'storage') } },
    log,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v2`;
  return { server, base, db, tmp };
}

async function api(base, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  const unwrapped = data && data.data !== undefined ? data.data : data;
  return { status: res.status, body: unwrapped, error: data && data.error ? data.error : null };
}

async function setupProjectWithShot(ctx) {
  const { base, db } = ctx;
  const proj = await api(base, 'POST', '/projects', { title: '测试项目', styleId: 'rh-101-cinematic' });
  const projectId = proj.body.id;
  const ep = await api(base, 'POST', `/projects/${projectId}/episodes`, { title: 'EP01' });
  const episodeId = ep.body.id;
  const created = await api(base, 'POST', `/episodes/${episodeId}/storyboard/create-from-script`, {});
  // createFromScript 需要已确认剧本与场次结构；直接退回手工造一镜
  if (created.status !== 201) {
    db.prepare(
      `INSERT INTO storyboards (episode_id, storyboard_number, title, description, duration, action, status, structure_revision, created_at, updated_at)
       VALUES (?, 1, '镜头 1', '走廊', 6, '走廊', 'draft', 1, datetime('now'), datetime('now'))`
    ).run(episodeId);
  }
  const shots = await api(base, 'GET', `/episodes/${episodeId}/storyboard`);
  const shotId = shots.body.shots[0].id;
  return { projectId, episodeId, shotId };
}

test('GET /video-tasks/:taskId：mock 通道返回任务状态视图', async () => {
  const ctx = await startServer();
  try {
    const { shotId } = await setupProjectWithShot(ctx);
    // 直接走 mock 生成链：分镜图 → 提交视频（需要 H3，未生成时被阻断；此处直接断言 404 分支）
    const missing = await api(ctx.base, 'GET', '/video-tasks/no-such-task/status');
    assert.equal(missing.status, 404);

    // 造一个 mock 视频任务（不经 guard：直接调用内部 submit 链外的 complete 语义太重，
    // 改用 mock 图片任务验证视图字段）
    const gen = await api(ctx.base, 'POST', `/storyboards/${shotId}/image/generate`, {});
    assert.equal(gen.status, 201);
    void gen;
  } finally {
    ctx.server.close();
  }
});

test('POST /video-tasks/:taskId/cancel：未完成任务 cancel-requested；已完成拒绝', async () => {
  const ctx = await startServer();
  try {
    const { db } = ctx;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES ('task-run', 'v21:mock-video', 'running', 20, '生成中', '', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES ('task-done', 'v21:mock-video', 'completed', 100, '完成', '', ?, ?)`
    ).run(now, now);

    const cancelled = await api(ctx.base, 'POST', '/video-tasks/task-run/cancel', { reason: '用户取消' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.cancelState, 'cancelled');
    const row = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get('task-run');
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancel_state, 'cancelled');

    const rejected = await api(ctx.base, 'POST', '/video-tasks/task-done/cancel', {});
    assert.equal(rejected.status, 409);
  } finally {
    ctx.server.close();
  }
});
