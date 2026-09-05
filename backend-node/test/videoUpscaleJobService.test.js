const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');

const { VideoUpscaleError } = require('../src/services/videoUpscale/upscaleErrors');
const { createVideoUpscaleRepository } = require('../src/services/videoUpscale/videoUpscaleRepository');
const { createVideoUpscaleJobService } = require('../src/services/videoUpscale/videoUpscaleJobService');

function setup() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE video_merges (id INTEGER PRIMARY KEY, upscale_job_id TEXT, base_merged_url TEXT)');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '33_video_upscale_jobs.sql'), 'utf8'));
  db.prepare('INSERT INTO video_merges (id) VALUES (1)').run();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-upscale-job-'));
  const sourcePath = path.join(root, 'base.mp4');
  fs.writeFileSync(sourcePath, 'source');
  const outputPath = path.join(root, 'upscaled.mp4');
  const media = {
    probe: async () => ({
      width: 1312, height: 736, fpsNumerator: 24, fpsDenominator: 1,
      frameCount: 241, duration: 241 / 24, hasAudio: true,
    }),
    validateSegment: async () => true,
    stitch: async () => { fs.writeFileSync(outputPath, 'upscaled'); return outputPath; },
    validateFinal: async () => true,
    fingerprint: () => 'fingerprint',
  };
  const config = {
    enabled: true, provider: 'zealman', base_url: 'https://panel.test', api_key: '', default_method: 'flash',
    workflows: { flash: 'M20', seed: 'M19' }, expected_source_width: 1312, expected_source_height: 736,
    scale: 2, segment_frame_cap: 240, overlap_frames: 4, auto_start_comfy: true,
    offline_wait_hours: 24, max_poll_hours: 8, poll_interval_seconds: 1, tls_verify: true,
  };
  return { db, root, sourcePath, outputPath, media, config, repo: createVideoUpscaleRepository(db) };
}

function successfulClient(calls) {
  return {
    health: async () => { calls.health += 1; return { ok: true }; },
    getComfyStatus: async () => ({ running: true, reason: 'ready' }),
    uploadVideo: async () => { calls.upload += 1; return 'remote-source.mp4'; },
    submitSegment: async ({ clientId, targetWidth, targetHeight, scale }) => {
      calls.submit.push({ clientId, targetWidth, targetHeight, scale });
      return `prompt-${calls.submit.length}`;
    },
    getResult: async (promptId) => { calls.query.push(promptId); return { status: 'completed', url: `https://panel.test/${promptId}.mp4`, raw: { promptId } }; },
    downloadResult: async (_url, destination) => { calls.download += 1; fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, 'segment'); },
    freeMemory: async () => null,
  };
}

test('upscale job runs Flash segments sequentially and persists completion', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const calls = { health: 0, upload: 0, submit: [], query: [], download: 0 };
  const service = createVideoUpscaleJobService({
    db: ctx.db, repository: ctx.repo, config: ctx.config, client: successfulClient(calls), media: ctx.media,
  });

  const result = await service.createAndRun({
    episodeId: 3, videoMergeId: 1, sourcePath: ctx.sourcePath, outputPath: ctx.outputPath, method: 'flash',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.workflow_id, 'M20');
  assert.equal(result.segments.length, 2);
  assert.equal(calls.upload, 1);
  assert.deepEqual(calls.submit.map(item => item.clientId), [`${result.id}:0`, `${result.id}:1`]);
  assert.deepEqual(calls.submit.map(({ targetWidth, targetHeight, scale }) => ({ targetWidth, targetHeight, scale })), [
    { targetWidth: 2624, targetHeight: 1472, scale: 2 },
    { targetWidth: 2624, targetHeight: 1472, scale: 2 },
  ]);
  assert.equal(calls.download, 2);
  assert.equal(fs.existsSync(ctx.outputPath), true);
});

test('one cloud provider serializes concurrent upscale jobs', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const calls = { health: 0, upload: 0, submit: [], query: [], download: 0 };
  const client = successfulClient(calls);
  let releaseFirstHealth;
  const firstHealthGate = new Promise(resolve => { releaseFirstHealth = resolve; });
  client.health = async () => {
    calls.health += 1;
    if (calls.health === 1) await firstHealthGate;
    return { ok: true };
  };
  const service = createVideoUpscaleJobService({
    db: ctx.db, repository: ctx.repo, config: ctx.config, client, media: ctx.media,
  });

  const first = service.createAndRun({ sourcePath: ctx.sourcePath, outputPath: ctx.outputPath, method: 'flash' });
  await new Promise(resolve => setImmediate(resolve));
  const second = service.createAndRun({ sourcePath: ctx.sourcePath, outputPath: `${ctx.outputPath}.second`, method: 'flash' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.health, 1, 'second job must wait until the first leaves the provider slot');

  releaseFirstHealth();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(job => job.status), ['completed', 'completed']);
  assert.equal(calls.health, 2);
});

test('normal multi-segment jobs clear stale models once instead of cold-starting every segment', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const calls = { health: 0, upload: 0, submit: [], query: [], download: 0, free: 0 };
  const client = successfulClient(calls);
  client.freeMemory = async () => { calls.free += 1; };
  const service = createVideoUpscaleJobService({
    db: ctx.db, repository: ctx.repo, config: ctx.config, client, media: ctx.media,
  });

  const result = await service.createAndRun({ sourcePath: ctx.sourcePath, outputPath: ctx.outputPath });

  assert.equal(result.status, 'completed');
  assert.equal(result.segments.length, 2);
  assert.equal(calls.free, 1, 'normal segment boundaries should retain the already-loaded model');
});

test('provider outage becomes a durable waiting job instead of failing the merge', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const client = successfulClient({ health: 0, upload: 0, submit: [], query: [], download: 0 });
  client.health = async () => { throw new VideoUpscaleError('PROVIDER_UNAVAILABLE', 'offline', { retryable: true }); };
  const service = createVideoUpscaleJobService({ db: ctx.db, repository: ctx.repo, config: ctx.config, client, media: ctx.media });

  const result = await service.createAndRun({
    episodeId: 3, videoMergeId: 1, sourcePath: ctx.sourcePath, outputPath: ctx.outputPath,
  });

  assert.equal(result.status, 'waiting_provider');
  assert.equal(result.error_code, 'PROVIDER_UNAVAILABLE');
  assert.ok(result.next_retry_at);
  assert.equal(fs.existsSync(ctx.sourcePath), true);
});

test('a stopped cloud ComfyUI is started before any workflow submission', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const calls = { health: 0, upload: 0, submit: [], query: [], download: 0, status: 0, start: 0 };
  const client = successfulClient(calls);
  client.getComfyStatus = async () => {
    calls.status += 1;
    return calls.status === 1 ? { running: false, reason: 'stopped' } : { running: true, reason: 'ready' };
  };
  client.startComfy = async () => { calls.start += 1; };
  const service = createVideoUpscaleJobService({
    db: ctx.db, repository: ctx.repo, config: ctx.config, client, media: ctx.media, sleep: async () => {},
  });

  const result = await service.createAndRun({ sourcePath: ctx.sourcePath, outputPath: ctx.outputPath });

  assert.equal(result.status, 'completed');
  assert.equal(calls.start, 1);
  assert.equal(calls.submit.length, 2);
});

test('resume queries an existing prompt and never submits it twice', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const calls = { health: 0, upload: 0, submit: [], query: [], download: 0 };
  const client = successfulClient(calls);
  client.submitSegment = async () => { throw new Error('duplicate submit'); };
  ctx.repo.createJob({
    id: 'resume-job', episodeId: 3, videoMergeId: 1, method: 'flash', workflowId: 'M20',
    sourcePath: ctx.sourcePath, outputPath: ctx.outputPath, sourceFingerprint: 'fingerprint', configSnapshot: ctx.config,
    source: { width: 1312, height: 736, fpsNumerator: 24, fpsDenominator: 1, frameCount: 241, hasAudio: true },
    target: { width: 2624, height: 1472 },
    segments: [
      { index: 0, startFrame: 0, frameCount: 240, trimLeadingFrames: 0 },
      { index: 1, startFrame: 236, frameCount: 5, trimLeadingFrames: 4 },
    ],
  });
  ctx.repo.updateJob('resume-job', { status: 'running', remote_input_name: 'remote-source.mp4' });
  ctx.repo.updateSegment('resume-job', 0, { status: 'running', prompt_id: 'prompt-existing' });
  ctx.repo.updateSegment('resume-job', 1, { status: 'completed', local_output_path: path.join(ctx.root, 'part-1.mp4') });
  fs.writeFileSync(path.join(ctx.root, 'part-1.mp4'), 'segment');
  const service = createVideoUpscaleJobService({ db: ctx.db, repository: ctx.repo, config: ctx.config, client, media: ctx.media });

  const result = await service.runJob('resume-job');

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls.query, ['prompt-existing']);
  assert.equal(calls.upload, 0);
  assert.equal(calls.download, 1);
});

test('download failure retries the existing remote prompt without paying for new inference', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const calls = { health: 0, upload: 0, submit: [], query: [], download: 0 };
  const client = successfulClient(calls);
  let failDownload = true;
  client.downloadResult = async (_url, destination) => {
    calls.download += 1;
    if (failDownload) {
      failDownload = false;
      throw new VideoUpscaleError('DOWNLOAD_FAILED', 'network reset', { retryable: true });
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, 'segment');
  };
  const service = createVideoUpscaleJobService({
    db: ctx.db, repository: ctx.repo, config: ctx.config, client, media: ctx.media,
  });
  const waiting = await service.createAndRun({ sourcePath: ctx.sourcePath, outputPath: ctx.outputPath });
  assert.equal(waiting.status, 'waiting_provider');
  assert.equal(calls.submit.length, 1);

  const result = await service.retryJob(waiting.id);

  assert.equal(result.status, 'completed');
  assert.equal(calls.submit.length, 2, 'only the untouched second segment should require another inference');
  assert.equal(calls.query.filter(id => id === 'prompt-1').length, 2, 'the failed download reuses prompt-1');
});

test('skip and cancel retain the base video and expose terminal states', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const client = successfulClient({ health: 0, upload: 0, submit: [], query: [], download: 0 });
  client.health = async () => { throw new VideoUpscaleError('PROVIDER_UNAVAILABLE', 'offline', { retryable: true }); };
  const service = createVideoUpscaleJobService({ db: ctx.db, repository: ctx.repo, config: ctx.config, client, media: ctx.media });
  const waiting = await service.createAndRun({ episodeId: 3, videoMergeId: 1, sourcePath: ctx.sourcePath, outputPath: ctx.outputPath });

  assert.equal(service.skipJob(waiting.id).status, 'skipped');
  assert.equal(fs.existsSync(ctx.sourcePath), true);

  ctx.db.prepare('INSERT INTO video_merges (id) VALUES (2)').run();
  const waiting2 = await service.createAndRun({ episodeId: 3, videoMergeId: 2, sourcePath: ctx.sourcePath, outputPath: `${ctx.outputPath}.2` });
  assert.equal(service.cancelJob(waiting2.id).status, 'cancelled');
  assert.equal(fs.existsSync(ctx.sourcePath), true);
});

test('repeated OOM replans only unfinished frames with a smaller frame cap', async (t) => {
  const ctx = setup();
  t.after(() => { ctx.db.close(); fs.rmSync(ctx.root, { recursive: true, force: true }); });
  const calls = { health: 0, upload: 0, submit: [], query: [], download: 0 };
  const client = successfulClient(calls);
  let oomCount = 0;
  client.getResult = async (promptId) => {
    calls.query.push(promptId);
    if (oomCount < 2) {
      oomCount += 1;
      throw new VideoUpscaleError('REMOTE_OOM', 'CUDA out of memory', { retryable: true });
    }
    return { status: 'completed', url: `https://panel.test/${promptId}.mp4`, raw: { promptId } };
  };
  const service = createVideoUpscaleJobService({ db: ctx.db, repository: ctx.repo, config: ctx.config, client, media: ctx.media });

  const result = await service.createAndRun({
    episodeId: 3, videoMergeId: 1, sourcePath: ctx.sourcePath, outputPath: ctx.outputPath,
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.segments.map((segment) => segment.requested_frame_count), [120, 120, 9]);
  assert.deepEqual(result.segments.map((segment) => segment.start_frame), [0, 116, 232]);
  assert.equal(calls.submit.length, 5, 'two failed 240-frame attempts plus three smaller segments');
});
