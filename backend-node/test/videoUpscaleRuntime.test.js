const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createVideoUpscaleRuntime } = require('../src/services/videoUpscale/videoUpscaleRuntime');

function createRuntime(overrides = {}) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE video_merges (id INTEGER PRIMARY KEY, upscale_job_id TEXT, base_merged_url TEXT);');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '33_video_upscale_jobs.sql'), 'utf8'));
  let healthCalls = 0;
  const client = overrides.client || {
    async health() { healthCalls += 1; return { ok: true }; },
    async getComfyStatus() { return { running: true, reason: 'ready' }; },
  };
  const runtime = createVideoUpscaleRuntime({
    db,
    appConfig: {
      video_upscale: {
        enabled: true,
        offline_wait_hours: 1,
        workflows: { flash: 'M20', seed: 'M19' },
      },
    },
    clientFactory: () => client,
    media: overrides.media,
    sleep: overrides.sleep,
    log: { error() {}, warn() {} },
  });
  return { db, runtime, getHealthCalls: () => healthCalls };
}

function addJob(runtime, id, status = 'pending', extra = {}) {
  runtime.repository.createJob({
    id,
    method: 'flash',
    workflowId: 'M20',
    sourcePath: 'base.mp4',
    sourceFingerprint: 'hash',
    source: { width: 1312, height: 736, fpsNumerator: 24, fpsDenominator: 1, frameCount: 10 },
    target: { width: 2624, height: 1472 },
    outputPath: 'upscaled.mp4',
    configSnapshot: {},
    segments: [{ index: 0, startFrame: 0, frameCount: 10, trimLeadingFrames: 0 }],
  });
  runtime.repository.updateJob(id, { status, ...extra });
  return runtime.getJob(id);
}

test('runtime rejects invalid retries synchronously so HTTP routes can return 404/409', () => {
  const { db, runtime } = createRuntime();
  assert.throws(() => runtime.retryJob('missing'), error => error.code === 'UPSCALE_JOB_NOT_FOUND');
  addJob(runtime, 'done', 'completed');
  assert.throws(() => runtime.retryJob('done'), error => error.code === 'UPSCALE_STATE_CONFLICT');
  db.close();
});

test('runtime notifies finalizer after a local cancellation', async () => {
  const { db, runtime } = createRuntime();
  addJob(runtime, 'cancel-me');
  let notified = null;
  runtime.setCompletionHandler(job => { notified = job; });
  const cancelled = runtime.cancelJob('cancel-me');
  assert.equal(cancelled.status, 'cancelled');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notified?.status, 'cancelled');
  db.close();
});

test('recovery stops automatic polling after the configured offline window', async () => {
  const { db, runtime, getHealthCalls } = createRuntime();
  addJob(runtime, 'old-wait', 'waiting_provider', {
    waiting_since: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    next_retry_at: new Date(Date.now() - 1000).toISOString(),
  });
  await runtime.recoverDueJobs();
  const job = runtime.getJob('old-wait');
  assert.equal(getHealthCalls(), 0);
  assert.equal(job.status, 'waiting_provider');
  assert.equal(job.current_stage, 'waiting_manual');
  assert.equal(job.next_retry_at, null);
  assert.match(job.error_message, /自动等待已停止/);
  assert.equal(runtime.listRecoverable().some(row => row.id === job.id), false);
  db.close();
});

test('overlapping recovery scans finalize one active job only once', async () => {
  let releaseHealth;
  const healthGate = new Promise(resolve => { releaseHealth = resolve; });
  const client = {
    async health() { await healthGate; return { ok: true }; },
    async getComfyStatus() { return { running: true, reason: 'ready' }; },
    async uploadVideo() { return 'base.mp4'; },
    async freeMemory() {},
    async submitSegment() { return 'prompt-1'; },
    async getResult() { return { status: 'completed', url: 'https://test/result.mp4' }; },
    async downloadResult() {},
  };
  const media = {
    async validateSegment() { return true; },
    async stitch() {},
    async validateFinal() {},
  };
  const { db, runtime } = createRuntime({ client, media });
  addJob(runtime, 'recover-once');
  let notifications = 0;
  runtime.setCompletionHandler(() => { notifications += 1; });

  const first = runtime.recoverDueJobs();
  const second = runtime.recoverDueJobs();
  releaseHealth();
  await Promise.all([first, second]);

  assert.equal(runtime.getJob('recover-once').status, 'completed');
  assert.equal(notifications, 1);
  db.close();
});

test('periodic recovery does not attach a second finalizer to an in-process job', async () => {
  let releaseHealth;
  const healthGate = new Promise(resolve => { releaseHealth = resolve; });
  const client = {
    async health() { await healthGate; return { ok: true }; },
    async getComfyStatus() { return { running: true, reason: 'ready' }; },
    async uploadVideo() { return 'base.mp4'; },
    async freeMemory() {},
    async submitSegment() { return 'prompt-1'; },
    async getResult() { return { status: 'completed', url: 'https://test/result.mp4' }; },
    async downloadResult() {},
  };
  const media = {
    async validateSegment() { return true; }, async stitch() {}, async validateFinal() {},
  };
  const { db, runtime } = createRuntime({ client, media });
  addJob(runtime, 'already-running');
  let notifications = 0;
  runtime.setCompletionHandler(() => { notifications += 1; });

  const directRun = runtime.runJob('already-running');
  await new Promise(resolve => setImmediate(resolve));
  const recovery = runtime.recoverDueJobs();
  await new Promise(resolve => setImmediate(resolve));
  releaseHealth();
  await Promise.all([directRun, recovery]);

  assert.equal(runtime.getJob('already-running').status, 'completed');
  assert.equal(notifications, 0, 'the original caller owns finalization for active jobs');
  db.close();
});
