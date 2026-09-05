const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  runFinalizationStages,
  normalizeUpscaleOptions,
  configureVideoUpscaleRuntime,
  finalizeMergedLocalVideo,
  resumeVideoMergeAfterUpscale,
} = require('../src/services/videoMergeService');

test('merge finalization runs cloud upscale before subtitles and watermark', async () => {
  const order = [];
  const result = await runFinalizationStages({
    baseVideoPath: 'base.mp4',
    upscale: { enabled: true, method: 'flash' },
    postProcessNeeded: true,
  }, {
    runUpscale: async (input) => { order.push(`upscale:${input.method}:${input.sourcePath}`); return { status: 'completed', outputPath: '2x.mp4', jobId: 'job-1' }; },
    runPostProcess: async (input) => { order.push(`post:${input}`); return { ok: true, outputPath: 'final.mp4' }; },
  });

  assert.deepEqual(order, ['upscale:flash:base.mp4', 'post:2x.mp4']);
  assert.deepEqual(result, { status: 'completed', outputPath: 'final.mp4', upscaleJobId: 'job-1', upscaleSkipped: false });
});

test('merge finalization pauses without postprocessing while cloud is offline', async () => {
  let postCalls = 0;
  const result = await runFinalizationStages({
    baseVideoPath: 'base.mp4', upscale: { enabled: true, method: 'seed' }, postProcessNeeded: true,
  }, {
    runUpscale: async () => ({ status: 'waiting_provider', jobId: 'job-wait' }),
    runPostProcess: async () => { postCalls += 1; },
  });
  assert.deepEqual(result, { status: 'waiting_upscale', outputPath: 'base.mp4', upscaleJobId: 'job-wait', upscaleSkipped: false });
  assert.equal(postCalls, 0);
});

test('skipping a failed upscale explicitly continues with the base video', async () => {
  const result = await runFinalizationStages({
    baseVideoPath: 'base.mp4', upscale: { enabled: true, method: 'flash' }, postProcessNeeded: true,
  }, {
    runUpscale: async () => ({ status: 'skipped', jobId: 'job-skip' }),
    runPostProcess: async (input) => ({ ok: true, outputPath: `${input}.post.mp4` }),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.outputPath, 'base.mp4.post.mp4');
  assert.equal(result.upscaleSkipped, true);
});

test('cancelling upscale stops merge finalization instead of leaving it waiting forever', async () => {
  let postCalls = 0;
  const result = await runFinalizationStages({
    baseVideoPath: 'base.mp4', upscale: { enabled: true, method: 'flash' }, postProcessNeeded: true,
  }, {
    runUpscale: async () => ({ status: 'cancelled', jobId: 'job-cancelled' }),
    runPostProcess: async () => { postCalls += 1; },
  });
  assert.deepEqual(result, {
    status: 'cancelled', outputPath: 'base.mp4', upscaleJobId: 'job-cancelled', upscaleSkipped: false,
  });
  assert.equal(postCalls, 0);
});

test('completed upscale must provide an output artifact before postprocessing', async () => {
  await assert.rejects(() => runFinalizationStages({
    baseVideoPath: 'base.mp4', upscale: { enabled: true, method: 'seed' }, postProcessNeeded: true,
  }, {
    runUpscale: async () => ({ status: 'completed', jobId: 'job-without-output' }),
    runPostProcess: async () => ({ ok: true }),
  }), error => error.code === 'UPSCALE_OUTPUT_MISSING');
});

test('upscale request accepts only explicit Flash or Seed selection', () => {
  assert.deepEqual(normalizeUpscaleOptions({ enabled: true }), { enabled: true, method: 'flash', failure_policy: 'wait_for_action' });
  assert.deepEqual(normalizeUpscaleOptions({ enabled: true, method: 'seed' }), { enabled: true, method: 'seed', failure_policy: 'wait_for_action' });
  assert.deepEqual(normalizeUpscaleOptions(), { enabled: false, method: 'flash', failure_policy: 'wait_for_action' });
  assert.throws(() => normalizeUpscaleOptions({ enabled: true, method: 'rtx' }), /flash 或 seed/);
});

test('real merge finalizer commits the upscaled artifact to merge episode and task', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-upscale-finalize-'));
  const basePath = path.join(root, 'base.mp4');
  const upscaledPath = path.join(root, 'base_flash_2x.mp4');
  fs.writeFileSync(basePath, 'base');
  fs.writeFileSync(upscaledPath, 'upscaled');
  const db = new Database(':memory:');
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); configureVideoUpscaleRuntime(null); });
  db.exec(`
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY, episode_id INTEGER, task_id TEXT, status TEXT,
      merged_url TEXT, base_merged_url TEXT, upscale_job_id TEXT, duration INTEGER,
      completed_at TEXT, error_msg TEXT
    );
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, video_url TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY, status TEXT, progress INTEGER, message TEXT, error TEXT,
      result TEXT, updated_at TEXT, completed_at TEXT, deleted_at TEXT
    );
    INSERT INTO video_merges (id, episode_id, task_id, status) VALUES (1, 7, 'task-1', 'processing');
    INSERT INTO episodes (id, status) VALUES (7, 'processing');
    INSERT INTO async_tasks (id, status, progress) VALUES ('task-1', 'processing', 30);
  `);
  const fakeRuntime = {
    createAndRun: async () => ({ id: 'upscale-1', status: 'completed', output_path: upscaledPath }),
    getJob: () => ({ id: 'upscale-1', status: 'completed', output_path: upscaledPath }),
  };
  configureVideoUpscaleRuntime(fakeRuntime);
  const mergeRow = db.prepare('SELECT * FROM video_merges WHERE id = 1').get();

  const result = await finalizeMergedLocalVideo(db, { warn() {}, info() {} }, {
    mergeRow, scenes: [{ duration: 5 }],
    mergeOpts: { upscale: { enabled: true, method: 'flash' } },
    storageRoot: root, baseVideoPath: basePath, totalDuration: 5,
  });

  assert.equal(result.deferred, false);
  assert.equal(db.prepare('SELECT status, merged_url, base_merged_url, upscale_job_id FROM video_merges WHERE id = 1').get().status, 'completed');
  assert.equal(db.prepare('SELECT video_url, status FROM episodes WHERE id = 7').get().video_url, 'base_flash_2x.mp4');
  assert.equal(db.prepare("SELECT status, progress FROM async_tasks WHERE id = 'task-1'").get().progress, 100);
});

test('cancel notification closes the parent merge and keeps the base artifact', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-upscale-cancel-'));
  const basePath = path.join(root, 'base.mp4');
  fs.writeFileSync(basePath, 'base');
  const db = new Database(':memory:');
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); configureVideoUpscaleRuntime(null); });
  db.exec(`
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY, episode_id INTEGER, task_id TEXT, status TEXT, scenes TEXT,
      merge_options TEXT, merged_url TEXT, base_merged_url TEXT, upscale_job_id TEXT,
      duration INTEGER, completed_at TEXT, error_msg TEXT, deleted_at TEXT
    );
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, video_url TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY, status TEXT, progress INTEGER, message TEXT, error TEXT,
      result TEXT, updated_at TEXT, completed_at TEXT, deleted_at TEXT
    );
  `);
  db.prepare(`INSERT INTO video_merges
    (id, episode_id, task_id, status, scenes, merge_options, base_merged_url, upscale_job_id, duration)
    VALUES (1, 7, 'task-1', 'waiting_upscale', '[]', ?, ?, 'cancelled-job', 5)`)
    .run(JSON.stringify({ upscale: { enabled: true, method: 'flash' } }), basePath);
  db.prepare("INSERT INTO episodes (id, status) VALUES (7, 'processing')").run();
  db.prepare("INSERT INTO async_tasks (id, status, progress) VALUES ('task-1', 'processing', 35)").run();
  configureVideoUpscaleRuntime({
    getJob: () => ({ id: 'cancelled-job', status: 'cancelled', output_path: null }),
  });

  const result = await resumeVideoMergeAfterUpscale(db, { warn() {}, info() {} }, 1);

  assert.equal(result.cancelled, true);
  assert.equal(fs.existsSync(basePath), true);
  assert.equal(db.prepare('SELECT status FROM video_merges WHERE id = 1').get().status, 'failed');
  assert.equal(db.prepare("SELECT status FROM async_tasks WHERE id = 'task-1'").get().status, 'failed');
});
