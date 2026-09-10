'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21mock-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '01_init.sql'), 'utf8'));
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  return { db, storageDir: path.join(tmp, 'storage') };
}

test('submit：创建 queued 任务并保存输入快照/幂等键/费用快照', () => {
  const { db, storageDir } = setup();
  const provider = createMockProvider({ db, log, storageDir });
  const { taskId } = provider.submit({
    kind: 'image',
    ownerType: 'episode_asset',
    ownerId: 'character:1',
    input: { prompt: '酒店走廊，冷色调', size: '720x480' },
    cost: { estimated: 0, currency: 'local', note: 'mock 本地执行，不产生 API 费用' },
    idempotencyKey: 'idem-1',
  });
  const task = provider.getTask(taskId);
  assert.ok(task, '任务已创建');
  assert.equal(task.status, 'pending');
  const row = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(taskId);
  assert.equal(row.type, 'v21:mock-image');
  assert.equal(row.idempotency_key, 'idem-1');
  assert.equal(row.owner_type, 'episode_asset');
  assert.deepEqual(JSON.parse(row.input_json).prompt, '酒店走廊，冷色调');
  assert.deepEqual(JSON.parse(row.cost_json).estimated, 0);
});

test('submit：同幂等键重复提交被去重，不创建重复任务', () => {
  const { db, storageDir } = setup();
  const provider = createMockProvider({ db, log, storageDir });
  const first = provider.submit({
    kind: 'image',
    ownerType: 'shot',
    ownerId: 'storyboard:1',
    input: { prompt: 'x' },
    idempotencyKey: 'same-key',
  });
  const second = provider.submit({
    kind: 'image',
    ownerType: 'shot',
    ownerId: 'storyboard:1',
    input: { prompt: 'x' },
    idempotencyKey: 'same-key',
  });
  assert.equal(second.deduped, true);
  assert.equal(second.taskId, first.taskId);
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM async_tasks WHERE type LIKE 'v21:mock-%'")
    .get();
  assert.equal(count.n, 1);
});

test('run：图片任务确定性产出真实 PNG 并写结果快照', async () => {
  const { db, storageDir } = setup();
  const provider = createMockProvider({ db, log, storageDir });
  const { taskId } = provider.submit({
    kind: 'image',
    ownerType: 'shot',
    ownerId: 'storyboard:9',
    input: { prompt: '分镜图 A' },
    idempotencyKey: 'img-1',
  });
  const result = await provider.run(taskId);
  assert.equal(result.artifactPath.endsWith('.png'), true);
  assert.ok(fs.existsSync(result.artifactPath), '产物文件存在');
  const head = fs.readFileSync(result.artifactPath).subarray(0, 4);
  assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47], '是真实 PNG（\x89PNG 魔数）');
  const task = provider.getTask(taskId);
  assert.equal(task.status, 'completed');
  assert.equal(task.progress, 100);
  const stored = task.result;
  assert.equal(stored.artifactPath, result.artifactPath);
  assert.match(stored.sha256, /^[a-f0-9]{64}$/);
});

test('run：视频任务产出 MP4 文件并记录输出时长', async () => {
  const { db, storageDir } = setup();
  const provider = createMockProvider({ db, log, storageDir, ffmpegPath: path.join(__dirname, '..', 'tools', 'ffmpeg', 'ffmpeg.exe') });
  const { taskId } = provider.submit({
    kind: 'video',
    ownerType: 'shot',
    ownerId: 'storyboard:9',
    input: { prompt: 'H3 视频', durationSeconds: 1 },
    idempotencyKey: 'vid-1',
  });
  const result = await provider.run(taskId);
  assert.equal(result.artifactPath.endsWith('.mp4'), true);
  assert.ok(fs.existsSync(result.artifactPath));
  assert.ok(fs.statSync(result.artifactPath).size > 0, '视频文件非空');
  const task = provider.getTask(taskId);
  const stored = task.result;
  assert.ok(stored.durationSeconds >= 0.5);
  assert.equal(stored.channel, 'mock');
});

test('cancel：运行前取消进入 cancelled 并保留任务记录与输入快照', async () => {
  const { db, storageDir } = setup();
  const provider = createMockProvider({ db, log, storageDir });
  const { taskId } = provider.submit({
    kind: 'image',
    ownerType: 'shot',
    ownerId: 's:1',
    input: { prompt: 'x' },
    idempotencyKey: 'c-1',
  });
  const state = await provider.cancel(taskId, '用户取消');
  assert.equal(state.cancelState, 'cancelled');
  const task = provider.getTask(taskId);
  assert.equal(task.status, 'cancelled');
  assert.ok(JSON.parse(db.prepare('SELECT input_json FROM async_tasks WHERE id=?').get(taskId).input_json));
});

test('retry：失败/取消任务按原输入快照创建新 attempt，不复用旧记录', async () => {
  const { db, storageDir } = setup();
  const provider = createMockProvider({ db, log, storageDir });
  const first = provider.submit({
    kind: 'image',
    ownerType: 'shot',
    ownerId: 's:1',
    input: { prompt: '原输入' },
    idempotencyKey: 'r-1',
  });
  provider.cancel(first.taskId, 'x');
  const second = provider.retry(first.taskId);
  assert.notEqual(second.taskId, first.taskId);
  const oldRow = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(first.taskId);
  const newRow = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(second.taskId);
  assert.equal(oldRow.status, 'cancelled', '旧任务记录保留');
  assert.equal(newRow.idempotency_key, null, '新 attempt 允许再次执行');
  assert.equal(JSON.parse(newRow.input_json).prompt, '原输入', '输入快照复用');
  const result = await provider.run(second.taskId);
  assert.ok(fs.existsSync(result.artifactPath));
});
