'use strict';
/**
 * A1 真实 Provider 接入 · 图片/视频真实执行器
 * fake adapter 不发真实请求：imageExecutor 用注入的假 imageService，videoExecutor 用注入的
 * 假统一视频服务；候选→采用合同所需的 director 三表写入走真实 candidateGroupService。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createRealImageExecutor } = require('../src/v21/realImageExecutor.js');
const { createRealVideoExecutor } = require('../src/v21/realVideoExecutor.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21real-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  const storageRoot = path.join(tmp, 'storage');
  fs.mkdirSync(storageRoot, { recursive: true });
  return { db, tmp, storageRoot };
}

function writeMedia(dir, name, bytes = 2048) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, crypto.randomBytes(bytes));
  return filePath;
}

// ---------- 图片执行器 ----------

function fakeImageService(db, { flipTo = 'completed', delayMs = 20 } = {}) {
  return {
    create(db2, log2, req) {
      const now = new Date().toISOString();
      const info = db2
        .prepare(
          `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, model, status, task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
        )
        .run(req.storyboard_id ?? null, req.drama_id, req.provider, req.prompt, req.model, `task-${Date.now()}-${Math.random()}`, now, now);
      const id = Number(info.lastInsertRowid);
      const mediaPath = writeMedia(path.dirname(require('node:os').tmpdir()), `img-${id}.png`).replace(/\\/g, '/');
      setTimeout(() => {
        if (flipTo === 'completed') {
          const file = path.join(os.tmpdir(), `v21real-img-${id}.png`);
          fs.writeFileSync(file, Buffer.from(`png-${id}`));
          db2.prepare("UPDATE image_generations SET status = 'completed', image_url = ?, local_path = ?, updated_at = ? WHERE id = ?")
            .run(`/static/gen/${id}.png`, file, new Date().toISOString(), id);
        } else {
          db2.prepare("UPDATE image_generations SET status = 'failed', error_msg = ?, updated_at = ? WHERE id = ?")
            .run('余额不足', new Date().toISOString(), id);
        }
      }, delayMs);
      return { id, task_id: `task-${id}`, status: 'pending' };
    },
  };
}

test('图片执行器：提交→轮询至完成→返回候选契约（candidateId/url/sha256）', async () => {
  const { db, storageRoot } = setup();
  const executor = createRealImageExecutor({
    db,
    log,
    storageRoot,
    imageServiceImpl: fakeImageService(db),
    pollIntervalMs: 10,
    pollTimeoutMs: 5000,
  });
  const result = await executor.generate({
    dramaId: 1,
    shotId: 7,
    prompt: '画面：走廊',
    serviceType: 'storyboard_image',
    config: { id: 3, provider: 'volces', model: ['seedream-4'], default_model: 'seedream-4', settings: null },
  });
  assert.ok(result.candidateId > 0);
  assert.match(result.url, /\/static\/gen\//);
  const row = db.prepare('SELECT * FROM image_generations WHERE id = ?').get(result.candidateId);
  assert.equal(row.status, 'completed');
  assert.equal(result.sha256, crypto.createHash('sha256').update(fs.readFileSync(row.local_path)).digest('hex'));
});

test('图片执行器：Provider 失败 → IMAGE_GENERATION_FAILED 且携带原因', async () => {
  const { db, storageRoot } = setup();
  const executor = createRealImageExecutor({
    db,
    log,
    storageRoot,
    imageServiceImpl: fakeImageService(db, { flipTo: 'failed' }),
    pollIntervalMs: 10,
    pollTimeoutMs: 5000,
  });
  await assert.rejects(
    () => executor.generate({ dramaId: 1, shotId: 7, prompt: 'p', serviceType: 'storyboard_image', config: { id: 3, provider: 'volces', model: ['m'], default_model: 'm', settings: null } }),
    (err) => err.code === 'IMAGE_GENERATION_FAILED' && /余额不足/.test(err.message)
  );
});

test('图片执行器：轮询超时 → IMAGE_GENERATION_TIMEOUT', async () => {
  const { db, storageRoot } = setup();
  const stuck = {
    create(db2, log2, req) {
      const now = new Date().toISOString();
      const info = db2
        .prepare(
          `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, status, task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'processing', 'x', ?, ?)`
        )
        .run(req.storyboard_id ?? null, req.drama_id, req.provider, req.prompt, now, now);
      return { id: Number(info.lastInsertRowid), task_id: 'x', status: 'processing' };
    },
  };
  const executor = createRealImageExecutor({
    db,
    log,
    storageRoot,
    imageServiceImpl: stuck,
    pollIntervalMs: 10,
    pollTimeoutMs: 60,
  });
  await assert.rejects(
    () => executor.generate({ dramaId: 1, shotId: 7, prompt: 'p', serviceType: 'storyboard_image', config: { id: 3, provider: 'p', model: ['m'], default_model: 'm', settings: null } }),
    (err) => err.code === 'IMAGE_GENERATION_TIMEOUT'
  );
});

// ---------- 视频执行器 ----------

function fakeUnifiedService(db, { auto = 'review' } = {}) {
  let seq = 0;
  const svc = {
    created: [],
    async createVideoGeneration(input) {
      seq += 1;
      const taskId = `fake-task-${seq}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
         VALUES (?, 'video_generation', 'pending', 0, '', '', ?, ?)`
      ).run(taskId, now, now);
      const info = db.prepare(
        `INSERT INTO video_generations
           (drama_id, storyboard_id, provider, protocol, prompt, model, config_id, config_snapshot,
            duration, candidate_group_id, status, task_id, created_at, updated_at)
         VALUES (?, ?, 'minimax_h3', 'minimax_h3', ?, 'MiniMax-H3', 1, '{}', ?, ?, 'waiting', ?, ?, ?)`
      ).run(
        input.drama_id ?? null,
        input.storyboard_id ?? null,
        input.prompt || '',
        input.duration ?? 6,
        input.candidate_group_id ?? null,
        taskId,
        now,
        now
      );
      const id = Number(info.lastInsertRowid);
      svc.created.push({ id, taskId, input });
      return { id, task_id: taskId, status: 'waiting' };
    },
    /** 测试用：把生成置为终态（模拟 Provider 完成/失败） */
    settle(genId, status, { localPath = null, videoUrl = null, errorMsg = null } = {}) {
      const now = new Date().toISOString();
      db.prepare('UPDATE video_generations SET status = ?, local_path = ?, video_url = ?, error_msg = ?, completed_at = ?, updated_at = ? WHERE id = ?')
        .run(status, localPath, videoUrl, errorMsg, now, now, genId);
      const row = db.prepare('SELECT task_id FROM video_generations WHERE id = ?').get(genId);
      if (row) {
        db.prepare("UPDATE async_tasks SET status = ?, progress = 100, updated_at = ? WHERE id = ?")
          .run(status === 'review' ? 'completed' : 'failed', now, row.task_id);
      }
    },
    async cancelVideoGeneration(id) {
      svc.settle(id, 'cancelled', { errorMsg: '用户已取消视频生成' });
      return { id, status: 'cancelled' };
    },
    async retryVideoGeneration(id) {
      const now = new Date().toISOString();
      const taskId = `fake-retry-${id}`;
      db.prepare(
        `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
         VALUES (?, 'video_generation', 'pending', 0, '', '', ?, ?)`
      ).run(taskId, now, now);
      db.prepare("UPDATE video_generations SET status = 'waiting', task_id = ?, error_msg = NULL, updated_at = ? WHERE id = ?").run(taskId, now, id);
      return { id, task_id: taskId, status: 'waiting' };
    },
  };
  return svc;
}

test('视频执行器：提交 N 个候选并回写任务归属与候选行', async () => {
  const { db, storageRoot } = setup();
  const svc = fakeUnifiedService(db);
  const executor = createRealVideoExecutor({
    db,
    log,
    storageRoot,
    videoGenerationService: svc,
    pollIntervalMs: 10,
  });
  db.prepare(
    `INSERT INTO director_candidate_groups (id, shot_id, status, created_at, updated_at) VALUES ('grp_1', '7', 'pending', ?, ?)`
  ).run(new Date().toISOString(), new Date().toISOString());
  const result = await executor.submit({
    shotId: 7,
    dramaId: 1,
    count: 2,
    prompt: 'H3 文本',
    duration: 6,
    groupId: 'grp_1',
    h3PromptDraftId: null,
    resolved: { config: { id: 1 }, model: 'MiniMax-H3', provider: 'minimax_h3', protocol: 'minimax_h3' },
  });
  assert.equal(result.tasks.length, 2);
  for (const task of result.tasks) {
    const row = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(task.taskId);
    assert.equal(row.owner_type, 'storyboard_video');
    assert.equal(row.owner_id, '7');
    const input = JSON.parse(row.input_json);
    assert.equal(input.videoGenerationId, task.videoGenerationId);
    const cand = db.prepare('SELECT * FROM director_candidates WHERE id = ?').get(task.candidateId);
    assert.equal(cand.video_generation_id, task.videoGenerationId);
    assert.equal(cand.group_id, 'grp_1');
  }
  void storageRoot;
});

test('视频执行器：等待至终态后经 candidate 三表产出候选与 artifact', async () => {
  const { db, storageRoot } = setup();
  const svc = fakeUnifiedService(db);
  const executor = createRealVideoExecutor({
    db,
    log,
    storageRoot,
    videoGenerationService: svc,
    pollIntervalMs: 10,
  });
  db.prepare(
    `INSERT INTO director_candidate_groups (id, shot_id, status, created_at, updated_at) VALUES ('grp_2', '7', 'running', ?, ?)`
  ).run(new Date().toISOString(), new Date().toISOString());
  const submitted = await executor.submit({
    shotId: 7,
    dramaId: 1,
    count: 1,
    prompt: 'H3 文本',
    duration: 6,
    groupId: 'grp_2',
    resolved: { config: { id: 1 }, model: 'MiniMax-H3', provider: 'minimax_h3', protocol: 'minimax_h3' },
  });
  const { taskId, videoGenerationId } = submitted.tasks[0];
  // Provider 异步完成：媒体落盘在受控 storage 内（与真实 importVideoArtifact 语义一致）
  const mediaPath = writeMedia(storageRoot, 'gen.mp4');
  setTimeout(() => svc.settle(videoGenerationId, 'review', { localPath: mediaPath, videoUrl: '/static/gen.mp4' }), 30);
  const done = await executor.waitForTask(taskId);
  assert.equal(done.group, 'grp_2');
  assert.ok(done.candidateId);
  const artifact = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(done.artifactId);
  assert.equal(artifact.status, 'ready');
  const cand = db.prepare('SELECT * FROM director_candidates WHERE id = ?').get(done.candidateId);
  assert.equal(cand.artifact_id, done.artifactId);
  assert.equal(done.url, '/static/gen.mp4');
});

test('视频执行器：失败终态 → VIDEO_GENERATION_FAILED 携带 Provider 错误', async () => {
  const { db, storageRoot } = setup();
  const svc = fakeUnifiedService(db);
  const executor = createRealVideoExecutor({
    db,
    log,
    storageRoot,
    videoGenerationService: svc,
    pollIntervalMs: 10,
  });
  db.prepare(
    `INSERT INTO director_candidate_groups (id, shot_id, status, created_at, updated_at) VALUES ('grp_3', '7', 'running', ?, ?)`
  ).run(new Date().toISOString(), new Date().toISOString());
  const submitted = await executor.submit({
    shotId: 7,
    dramaId: 1,
    count: 1,
    prompt: 'p',
    duration: 6,
    groupId: 'grp_3',
    resolved: { config: { id: 1 }, model: 'MiniMax-H3', provider: 'minimax_h3', protocol: 'minimax_h3' },
  });
  const { taskId, videoGenerationId } = submitted.tasks[0];
  setTimeout(() => svc.settle(videoGenerationId, 'failed', { errorMsg: '{"code":"PROVIDER_QUOTA","message":"配额不足"}' }), 20);
  await assert.rejects(
    () => executor.waitForTask(taskId),
    (err) => err.code === 'VIDEO_GENERATION_FAILED' && /配额不足/.test(err.message)
  );
});

test('视频执行器：取消走统一服务并保留记录；重试产出新任务', async () => {
  const { db, storageRoot } = setup();
  const svc = fakeUnifiedService(db);
  const executor = createRealVideoExecutor({
    db,
    log,
    storageRoot,
    videoGenerationService: svc,
    pollIntervalMs: 10,
  });
  db.prepare(
    `INSERT INTO director_candidate_groups (id, shot_id, status, created_at, updated_at) VALUES ('grp_4', '7', 'running', ?, ?)`
  ).run(new Date().toISOString(), new Date().toISOString());
  const submitted = await executor.submit({
    shotId: 7,
    dramaId: 1,
    count: 1,
    prompt: 'p',
    duration: 6,
    groupId: 'grp_4',
    resolved: { config: { id: 1 }, model: 'MiniMax-H3', provider: 'minimax_h3', protocol: 'minimax_h3' },
  });
  const { taskId, videoGenerationId } = submitted.tasks[0];

  const cancelled = await executor.cancel(taskId);
  assert.equal(cancelled.cancelState, 'cancelled');
  const taskRow = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(taskId);
  assert.equal(taskRow.status, 'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM async_tasks WHERE id = ?').get(taskId).n, 1, '取消保留记录');

  const retried = await executor.retry(taskId);
  assert.notEqual(retried.taskId, taskId);
  const genRow = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(videoGenerationId);
  assert.equal(genRow.task_id, retried.taskId);
  assert.equal(genRow.status, 'waiting');
  const newTaskRow = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(retried.taskId);
  assert.equal(newTaskRow.owner_type, 'storyboard_video');
  assert.equal(newTaskRow.owner_id, '7');
});
