const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const videoService = require('../src/services/videoService');
const { createUnifiedVideoGenerationService } = require('../src/services/unifiedVideoGenerationService');
const { createH3PromptCompiler } = require('../src/services/h3PromptCompiler');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      provider TEXT,
      api_protocol TEXT,
      base_url TEXT,
      api_key TEXT,
      model TEXT,
      default_model TEXT,
      endpoint TEXT,
      query_endpoint TEXT,
      settings TEXT,
      is_default INTEGER,
      is_active INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      storyboard_id INTEGER,
      provider TEXT,
      protocol TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      model TEXT,
      config_id INTEGER,
      config_snapshot TEXT,
      duration REAL,
      aspect_ratio TEXT,
      resolution TEXT,
      width INTEGER,
      height INTEGER,
      frame_rate REAL,
      seed INTEGER,
      camera_fixed INTEGER,
      watermark INTEGER,
      continuity_mode TEXT,
      anchor_id TEXT,
      candidate_group_id TEXT,
      image_gen_id INTEGER,
      image_url TEXT,
      first_frame_url TEXT,
      last_frame_url TEXT,
      reference_image_urls TEXT,
      video_url TEXT,
      local_path TEXT,
      status TEXT,
      task_id TEXT,
      provider_task_id TEXT,
      completed_at TEXT,
      error_msg TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      created_at TEXT,
      updated_at TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      duration REAL,
      video_url TEXT,
      local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function seedDefaultConfig(db, overrides = {}) {
  const config = {
    provider: 'fake',
    api_protocol: 'fake-protocol',
    base_url: 'https://old-provider.example.test/v1',
    api_key: 'current-secret',
    model: JSON.stringify(['old-model']),
    default_model: 'old-model',
    endpoint: '/generate?token=hidden',
    query_endpoint: '/tasks/{taskId}?token=hidden',
    settings: JSON.stringify({ width: 1280, height: 704, frame_rate: 24, secret: 'hidden' }),
    is_default: 1,
    is_active: 1,
    ...overrides,
  };
  const result = db.prepare(`
    INSERT INTO ai_service_configs
      (service_type, provider, api_protocol, base_url, api_key, model, default_model,
       endpoint, query_endpoint, settings, is_default, is_active)
    VALUES ('video', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    config.provider,
    config.api_protocol,
    config.base_url,
    config.api_key,
    config.model,
    config.default_model,
    config.endpoint,
    config.query_endpoint,
    config.settings,
    config.is_default,
    config.is_active,
  );
  return Number(result.lastInsertRowid);
}

function replaceDefaultConfig(db) {
  db.prepare("UPDATE ai_service_configs SET is_default = 0 WHERE service_type = 'video'").run();
  return seedDefaultConfig(db, {
    provider: 'other-provider',
    api_protocol: 'other-protocol',
    base_url: 'https://new-provider.example.test',
    api_key: 'new-secret',
    model: JSON.stringify(['new-model']),
    default_model: 'new-model',
  });
}

function createHarness({ submit = [], query = [], recover = [] } = {}) {
  const jobs = [];
  const calls = { submit: [], query: [], recover: [], cancel: [] };
  const queues = {
    submit: [...submit],
    query: [...query],
    recover: [...recover],
  };
  const provider = {
    async submit(context) {
      calls.submit.push(context);
      const next = queues.submit.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(context) : next;
    },
    async query(context) {
      calls.query.push(context);
      const next = queues.query.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(context) : next;
    },
    async recover(context) {
      calls.recover.push(context);
      const next = queues.recover.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(context) : next;
    },
    async cancel(context) {
      calls.cancel.push(context);
      return { providerTaskId: context.providerTaskId, status: 'cancelled', progress: 100 };
    },
  };
  const registry = {
    has(name) {
      return name === 'fake';
    },
    get(name) {
      assert.equal(name, 'fake');
      return provider;
    },
  };
  return {
    calls,
    jobs,
    registry,
    schedule(job) {
      jobs.push(job);
    },
    async runNext() {
      const job = jobs.shift();
      assert.ok(job, 'expected a scheduled lifecycle job');
      await job();
    },
  };
}

function buildService(db, harness, overrides = {}) {
  return createUnifiedVideoGenerationService({
    db,
    log: { info() {}, warn() {}, error() {} },
    providerRegistry: harness.registry,
    schedule: harness.schedule,
    pollIntervalMs: 0,
    prepareVideoOutput: async () => null,
    ...overrides,
  });
}

describe('unified video generation lifecycle', () => {
  it('uses the skill-agent compiler for H3 prompt previews', async () => {
    const db = createTestDb();
    seedDefaultConfig(db, {
      provider: 'comfyui',
      model: JSON.stringify(['h3-continuity-v1']),
      default_model: 'h3-continuity-v1',
    });
    const validPrompt = 'integrated_multimodal_description: [Shot 1] A woman walks.\noverall_soundscape: Footsteps.\nnon_diegetic_music: N/A';
    const calls = [];
    const compiler = createH3PromptCompiler({
      skillAgent: {
        async run(_db, _log, request) {
          calls.push(request);
          return {
            prompt: validPrompt,
            provenance: {
              skillName: 'h3-prompt-writing',
              skillSha256: 'a'.repeat(64),
              skillResources: ['SKILL.md', 'references/base-en.txt'],
              toolCallId: 'call-preview',
            },
          };
        },
      },
    });
    const harness = createHarness();
    const service = buildService(db, harness, { h3PromptCompiler: compiler });

    const result = await service.previewH3Prompt({ prompt: 'a woman walks', duration: 5 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, 'T2VA');
    assert.equal(result.compilerVersion, 'h3-skill-agent-v1');
    assert.equal(result.skillProvenance.toolCallId, 'call-preview');
    assert.equal(result.compiledPrompt, validPrompt);
    db.close();
  });

  it('requeues a candidate when ComfyUI reports a temporary GPU lock', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    const harness = createHarness({
      submit: [new Error('GPU_BUSY'), { status: 'running', providerTaskId: 'prompt-after-wait', progress: 0 }],
    });
    const service = buildService(db, harness, { gpuBusyRetryDelayMs: 1 });

    const created = await service.createVideoGeneration({ prompt: 'wait for the GPU' });
    await harness.runNext();

    const waiting = service.getVideoGeneration(created.id);
    assert.equal(waiting.status, 'queued');
    assert.equal(waiting.error_msg, null);
    assert.equal(harness.calls.submit.length, 1);
    assert.equal(harness.jobs.length, 1);

    await harness.runNext();

    const submitted = service.getVideoGeneration(created.id);
    assert.equal(submitted.status, 'running');
    assert.equal(db.prepare('SELECT provider_task_id FROM video_generations WHERE id = ?').get(created.id).provider_task_id, 'prompt-after-wait');
    assert.equal(harness.calls.submit.length, 2);
    db.close();
  });

  it('never demotes a selected provider result back to review', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    const harness = createHarness({
      submit: [{ status: 'selected', progress: 100, output: { localPath: 'videos/selected.mp4' } }],
    });
    const service = buildService(db, harness);

    const created = await service.createVideoGeneration({ prompt: 'selected result' });
    await harness.runNext();

    assert.equal(service.getVideoGeneration(created.id).status, 'selected');
    db.close();
  });

  it('selects a review video and makes it the storyboard current video', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    db.prepare('INSERT INTO storyboards (id) VALUES (12)').run();
    const harness = createHarness();
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ storyboard_id: 12, prompt: 'select result' });
    db.prepare(`UPDATE video_generations SET status = 'review', video_url = ?, local_path = ? WHERE id = ?`)
      .run('https://cdn.example.test/selected.mp4', 'projects/demo/videos/selected.mp4', created.id);

    const selected = await service.selectVideoGeneration(created.id);

    assert.equal(selected.status, 'selected');
    assert.deepEqual(db.prepare('SELECT video_url, local_path FROM storyboards WHERE id = 12').get(), {
      video_url: 'https://cdn.example.test/selected.mp4',
      local_path: 'projects/demo/videos/selected.mp4',
    });
    db.close();
  });

  it('prefers an explicit duration and uses storyboard duration only as a fallback', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    db.prepare("INSERT INTO dramas (id, metadata) VALUES (3, '{\"aspect_ratio\":\"9：16\"}')").run();
    db.prepare('INSERT INTO storyboards (id, duration) VALUES (5, 8)').run();
    const harness = createHarness();
    const service = buildService(db, harness);

    const created = await service.createVideoGeneration({
      drama_id: 3,
      storyboard_id: 5,
      prompt: '兼容输入',
      duration: 3,
    });

    const fallback = await service.createVideoGeneration({
      drama_id: 3,
      storyboard_id: 5,
      prompt: '兼容输入回退',
    });

    assert.equal(created.aspect_ratio, '9:16');
    assert.equal(created.duration, 3);
    assert.equal(fallback.duration, 8);
    assert.equal(created.width, 1280);
    assert.equal(created.height, 704);
  });

  it('persists an isolated routing snapshot and retries with it after the default changes', async () => {
    const db = createTestDb();
    const originalConfigId = seedDefaultConfig(db);
    const providerError = Object.assign(new Error('提交失败'), { code: 'FAKE_SUBMIT_FAILED' });
    const harness = createHarness({
      submit: [providerError, { providerTaskId: null, status: 'completed', progress: 100, output: { videoUrl: 'https://cdn.example.test/retry.mp4' } }],
    });
    const service = buildService(db, harness);

    const created = await service.createVideoGeneration({
      drama_id: 9,
      storyboard_id: 17,
      provider: 'untrusted-provider',
      prompt: '原始提示词',
      width: 864,
      height: 480,
      seed: 42,
    });
    assert.equal(created.config_id, originalConfigId);
    assert.equal(created.provider, 'fake');
    assert.equal(created.status, 'waiting');
    assert.deepEqual(created.routing_snapshot.settings, { width: 1280, height: 704, frame_rate: 24 });
    assert.equal(JSON.stringify(created.routing_snapshot).includes('secret'), false);

    await harness.runNext();
    assert.equal(service.getVideoGeneration(created.id).status, 'failed');
    replaceDefaultConfig(db);

    const retried = await service.retryVideoGeneration(created.id);
    assert.equal(retried.status, 'waiting');
    await harness.runNext();

    assert.equal(harness.calls.submit.length, 2);
    assert.equal(harness.calls.submit[1].snapshot.configId, originalConfigId);
    assert.equal(harness.calls.submit[1].snapshot.model, 'old-model');
    assert.equal(harness.calls.submit[1].config.api_key, 'current-secret');
    assert.equal(harness.calls.submit[1].config.base_url, 'https://old-provider.example.test/v1');
    assert.equal(service.getVideoGeneration(created.id).status, 'review');
  });

  it('normalizes provider statuses and persists progress through the existing async task', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    const harness = createHarness({
      submit: [{ providerTaskId: 'upstream-1', status: 'submitted', progress: 7 }],
      query: [
        { providerTaskId: 'upstream-1', status: 'processing', progress: 43 },
        { providerTaskId: 'upstream-1', status: 'succeeded', progress: 100, output: { video_url: 'https://cdn.example.test/final.mp4' } },
      ],
    });
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ prompt: '状态测试' });

    await harness.runNext();
    assert.equal(service.getVideoGeneration(created.id).status, 'queued');
    assert.equal(service.getVideoGeneration(created.id).progress, 7);
    await harness.runNext();
    assert.equal(service.getVideoGeneration(created.id).status, 'running');
    assert.equal(service.getVideoGeneration(created.id).progress, 43);
    await harness.runNext();

    const completed = service.getVideoGeneration(created.id);
    assert.equal(completed.status, 'review');
    assert.equal(completed.progress, 100);
    assert.equal(completed.video_url, 'https://cdn.example.test/final.mp4');
    const task = db.prepare('SELECT status, progress, result FROM async_tasks WHERE id = ?').get(completed.task_id);
    assert.equal(task.status, 'completed');
    assert.equal(task.progress, 100);
    assert.equal(JSON.parse(task.result).lifecycle_status, 'review');
  });

  it('continues polling a provider task returned in pending state', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    const harness = createHarness({
      submit: [{ providerTaskId: 'pending-upstream', status: 'pending', progress: 0 }],
      query: [{ providerTaskId: 'pending-upstream', status: 'completed', progress: 100, output: { localPath: 'videos/pending.mp4' } }],
    });
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ prompt: '等待上游' });

    await harness.runNext();
    assert.equal(service.getVideoGeneration(created.id).status, 'waiting');
    assert.equal(harness.jobs.length, 1);
    harness.jobs.length = 0;

    const restartedHarness = createHarness({
      recover: [{ providerTaskId: 'pending-upstream', status: 'completed', progress: 100, output: { localPath: 'videos/pending.mp4' } }],
    });
    const restartedService = buildService(db, restartedHarness);
    assert.equal(await restartedService.recoverVideoGenerations(), 1);
    await restartedHarness.runNext();
    assert.equal(restartedHarness.calls.submit.length, 0);
    assert.equal(restartedHarness.calls.recover.length, 1);
    assert.equal(restartedService.getVideoGeneration(created.id).status, 'review');
  });

  it('cancels locally and ignores a provider result that arrives after cancellation', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    let resolveQuery;
    const lateQuery = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    const harness = createHarness({
      submit: [{ providerTaskId: 'late-task', status: 'queued', progress: 5 }],
      query: [() => lateQuery],
    });
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ prompt: '取消测试' });
    await harness.runNext();

    const pendingQuery = harness.jobs.shift()();
    const cancelled = await service.cancelVideoGeneration(created.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(harness.calls.cancel.length, 1);
    assert.equal(harness.calls.cancel[0].providerTaskId, 'late-task');

    resolveQuery({
      providerTaskId: 'late-task',
      status: 'completed',
      progress: 100,
      output: { videoUrl: 'https://cdn.example.test/too-late.mp4' },
    });
    await pendingQuery;

    const persisted = service.getVideoGeneration(created.id);
    assert.equal(persisted.status, 'cancelled');
    assert.equal(persisted.progress, 100);
    assert.equal(persisted.video_url, null);
    assert.equal(JSON.parse(db.prepare('SELECT error_msg FROM video_generations WHERE id = ?').get(created.id).error_msg).code, 'VIDEO_CANCELLED');
  });

  it('retries an existing upstream task by recovery instead of submitting again', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    const harness = createHarness({
      submit: [{ providerTaskId: 'paid-upstream-task', status: 'queued', progress: 1 }],
      query: [{ providerTaskId: 'paid-upstream-task', status: 'failed', progress: 100, output: { error: '查询暂时失败' } }],
      recover: [{ providerTaskId: 'paid-upstream-task', status: 'completed', progress: 100, output: { videoUrl: 'https://cdn.example.test/recovered.mp4' } }],
    });
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ prompt: '继续查询' });
    await harness.runNext();
    await harness.runNext();
    assert.equal(service.getVideoGeneration(created.id).status, 'failed');

    await service.retryVideoGeneration(created.id);
    await harness.runNext();

    assert.equal(harness.calls.submit.length, 1);
    assert.equal(harness.calls.recover.length, 1);
    assert.equal(harness.calls.recover[0].providerTaskId, 'paid-upstream-task');
    assert.equal(service.getVideoGeneration(created.id).status, 'review');
  });

  it('recovers unfinished tasks with their original snapshot and marks unresumable work interrupted', async () => {
    const db = createTestDb();
    const originalConfigId = seedDefaultConfig(db);
    const firstHarness = createHarness({ submit: [{ providerTaskId: 'restart-task', status: 'running', progress: 20 }] });
    const firstService = buildService(db, firstHarness);
    const resumable = await firstService.createVideoGeneration({ prompt: '重启恢复' });
    await firstHarness.runNext();
    const stranded = await firstService.createVideoGeneration({ prompt: '无上游任务' });
    db.prepare("UPDATE video_generations SET status = 'running' WHERE id = ?").run(stranded.id);
    firstHarness.jobs.length = 0;
    db.prepare("UPDATE async_tasks SET status = 'failed', error = 'startup orphan error' WHERE id = ?")
      .run(firstService.getVideoGeneration(resumable.id).task_id);
    replaceDefaultConfig(db);

    const recoveryHarness = createHarness({
      recover: [{ providerTaskId: 'restart-task', status: 'completed', progress: 100, output: { localPath: 'director-artifacts/recovered.mp4' } }],
    });
    const recoveryService = buildService(db, recoveryHarness);
    const scheduled = await recoveryService.recoverVideoGenerations();
    assert.equal(scheduled, 2);
    await recoveryHarness.runNext();

    assert.equal(recoveryHarness.calls.recover[0].snapshot.configId, originalConfigId);
    assert.equal(recoveryHarness.calls.recover[0].config.base_url, 'https://old-provider.example.test/v1');
    assert.equal(recoveryService.getVideoGeneration(resumable.id).status, 'review');
    assert.equal(recoveryService.getVideoGeneration(resumable.id).error, null);
    assert.equal(recoveryService.getVideoGeneration(stranded.id).status, 'interrupted');
  });

  it('fails strictly when a cloud task loses the original credential source', async () => {
    const db = createTestDb();
    const configId = seedDefaultConfig(db, {
      provider: 'cloud-provider',
      api_protocol: 'openai',
      base_url: 'http://127.0.0.1:1',
    });
    const harness = createHarness();
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ prompt: '凭据丢失' });
    db.prepare('DELETE FROM ai_service_configs WHERE id = ?').run(configId);

    await harness.runNext();

    const failed = service.getVideoGeneration(created.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.code, 'VIDEO_CONFIG_CREDENTIALS_MISSING');
    assert.equal(failed.error.stage, 'submit');
  });

  it('rejects inactive and soft-deleted original configs as missing credential sources', async () => {
    for (const invalidation of [
      "UPDATE ai_service_configs SET is_active = 0 WHERE id = ?",
      "UPDATE ai_service_configs SET deleted_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
    ]) {
      const db = createTestDb();
      const configId = seedDefaultConfig(db, {
        provider: 'cloud-provider',
        api_protocol: 'openai',
        base_url: 'http://127.0.0.1:1',
      });
      const harness = createHarness();
      const service = buildService(db, harness);
      const created = await service.createVideoGeneration({ prompt: 'invalid credential config' });
      db.prepare(invalidation).run(configId);

      await harness.runNext();

      const failed = service.getVideoGeneration(created.id);
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error.code, 'VIDEO_CONFIG_CREDENTIALS_MISSING');
      assert.equal(failed.error.stage, 'submit');
      db.close();
    }
  });

  it('does not invoke a registered provider after its original config is inactive', async () => {
    const db = createTestDb();
    const configId = seedDefaultConfig(db);
    const harness = createHarness({
      submit: [{ status: 'completed', progress: 100, output: { localPath: 'videos/should-not-run.mp4' } }],
    });
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ prompt: 'inactive registered config' });
    db.prepare('UPDATE ai_service_configs SET is_active = 0 WHERE id = ?').run(configId);

    await harness.runNext();

    assert.equal(harness.calls.submit.length, 0);
    assert.equal(service.getVideoGeneration(created.id).error.code, 'VIDEO_CONFIG_CREDENTIALS_MISSING');
  });

  it('never persists or returns the private provider task id in structured errors', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    const providerFailure = Object.assign(new Error('upstream query failed'), {
      code: 'UPSTREAM_QUERY_FAILED',
      details: { providerTaskId: 'leaked-from-error', provider_task_id: 'also-private', retryable: true },
    });
    const harness = createHarness({
      submit: [{ providerTaskId: 'private-upstream-id', status: 'queued', progress: 1 }],
      query: [providerFailure],
    });
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ prompt: 'private error test' });
    await harness.runNext();
    await harness.runNext();

    const raw = db.prepare('SELECT provider_task_id, error_msg FROM video_generations WHERE id = ?').get(created.id);
    assert.equal(raw.provider_task_id, 'private-upstream-id');
    assert.equal(raw.error_msg.includes('private-upstream-id'), false);
    assert.equal(raw.error_msg.includes('leaked-from-error'), false);
    assert.equal(raw.error_msg.includes('also-private'), false);
    const persisted = JSON.parse(raw.error_msg);
    assert.deepEqual(persisted.details, { retryable: true, provider: 'fake' });

    const publicItem = service.getVideoGeneration(created.id);
    assert.equal(JSON.stringify(publicItem).includes('private-upstream-id'), false);
    assert.deepEqual(publicItem.error.details, persisted.details);
  });

  it('imports a real provider artifact into storage and persists only its storage-relative path', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'video-artifact-contract-'));
    try {
      const sourceDir = path.join(tempRoot, 'director-output');
      const storagePath = path.join(tempRoot, 'storage');
      fs.mkdirSync(sourceDir, { recursive: true });
      const artifactPath = path.join(sourceDir, 'comfy-final.mp4');
      fs.writeFileSync(artifactPath, Buffer.from('real-video-artifact'));

      const db = createTestDb();
      db.prepare(`
        INSERT INTO dramas (id, title, created_at, updated_at, metadata)
        VALUES (9, 'Artifact Project', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '{}')
      `).run();
      const relativePath = await videoService.importSuccessfulVideoArtifact(
        db,
        { warn() {} },
        { id: 42, drama_id: 9 },
        artifactPath,
        { storagePath },
      );

      assert.equal(path.isAbsolute(relativePath), false);
      assert.match(relativePath, /^projects\/0009_20260102_Artifact_Project\/videos\/vg_42_[a-f0-9]{8}\.mp4$/);
      assert.equal(fs.readFileSync(path.join(storagePath, relativePath), 'utf8'), 'real-video-artifact');
      db.close();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('routes an absolute provider artifact through storage import before persisting review', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    const artifactPath = path.resolve('director-output', 'absolute-final.mp4');
    const imported = [];
    const harness = createHarness({
      submit: [{ status: 'completed', progress: 100, output: { artifactPath } }],
    });
    const service = buildService(db, harness, {
      importVideoArtifact: async (_db, _log, row, value) => {
        imported.push({ row, value });
        return 'projects/demo/videos/imported-final.mp4';
      },
    });
    const created = await service.createVideoGeneration({ prompt: 'artifact wiring' });
    await harness.runNext();

    assert.equal(imported.length, 1);
    assert.equal(imported[0].value, artifactPath);
    assert.equal(service.getVideoGeneration(created.id).local_path, 'projects/demo/videos/imported-final.mp4');
  });

  it('persists strict structured provider errors while retaining legacy read fields and history', async () => {
    const db = createTestDb();
    seedDefaultConfig(db);
    const providerError = Object.assign(new Error('工作流不可用'), {
      code: 'WORKFLOW_UNAVAILABLE',
      details: { workflowId: 'old-model' },
    });
    const harness = createHarness({ submit: [providerError] });
    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({ prompt: '错误测试' });
    await harness.runNext();

    const raw = db.prepare('SELECT status, error_msg FROM video_generations WHERE id = ?').get(created.id);
    const persistedError = JSON.parse(raw.error_msg);
    assert.deepEqual(Object.keys(persistedError).sort(), ['code', 'details', 'message', 'stage']);
    assert.equal(persistedError.code, 'WORKFLOW_UNAVAILABLE');
    assert.equal(persistedError.stage, 'submit');
    const item = service.getVideoGeneration(created.id);
    assert.equal(item.error_msg, '工作流不可用');
    assert.deepEqual(item.error, persistedError);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO video_generations (provider, prompt, status, error_msg, created_at, updated_at)
      VALUES ('legacy', 'old running', 'processing', NULL, ?, ?),
             ('legacy', 'old completed', 'completed', NULL, ?, ?)
    `).run(now, now, now, now);
    assert.equal(videoService.getById(db, created.id + 1).status, 'running');
    assert.equal(videoService.getById(db, created.id + 2).status, 'review');
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(created.id + 1).status, 'processing');
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(created.id + 2).status, 'completed');
  });
});
