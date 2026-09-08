const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const createRoutes = require('../src/routes/director');
const { createUnifiedVideoGenerationService } = require('../src/services/unifiedVideoGenerationService');

const SCHEMA = `
  CREATE TABLE storyboards (
    id INTEGER PRIMARY KEY, duration REAL, video_url TEXT, local_path TEXT,
    updated_at TEXT, deleted_at TEXT
  );
  CREATE TABLE ai_service_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, service_type TEXT NOT NULL, provider TEXT,
    api_protocol TEXT, base_url TEXT, api_key TEXT, model TEXT, default_model TEXT,
    endpoint TEXT, query_endpoint TEXT, settings TEXT, is_default INTEGER,
    is_active INTEGER, deleted_at TEXT
  );
  CREATE TABLE async_tasks (
    id TEXT PRIMARY KEY, type TEXT, status TEXT, progress INTEGER DEFAULT 0,
    message TEXT, error TEXT, result TEXT, resource_id TEXT, created_at TEXT,
    updated_at TEXT, completed_at TEXT, deleted_at TEXT
  );
  CREATE TABLE video_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, storyboard_id INTEGER,
    provider TEXT, protocol TEXT, prompt TEXT, negative_prompt TEXT, model TEXT,
    config_id INTEGER, config_snapshot TEXT, duration REAL, aspect_ratio TEXT,
    resolution TEXT, width INTEGER, height INTEGER, frame_rate REAL, seed INTEGER,
    camera_fixed INTEGER, watermark INTEGER, continuity_mode TEXT, anchor_id TEXT,
    candidate_group_id TEXT, image_gen_id INTEGER, image_url TEXT,
    first_frame_url TEXT, last_frame_url TEXT, reference_image_urls TEXT,
    video_url TEXT, local_path TEXT, status TEXT, task_id TEXT,
    provider_task_id TEXT, completed_at TEXT, error_msg TEXT, created_at TEXT,
    updated_at TEXT, deleted_at TEXT
  );
  CREATE TABLE director_jobs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, attempt_number INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL, lease_expires_at TEXT, error_code TEXT,
    error_message TEXT, input_json TEXT NOT NULL, workflow_id TEXT,
    workflow_version TEXT, artifact_path TEXT, artifact_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
  );
  CREATE TABLE director_artifacts (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
    version INTEGER NOT NULL, status TEXT NOT NULL, artifact_path TEXT NOT NULL,
    parent_artifact_id TEXT, sha256 TEXT NOT NULL, file_size INTEGER NOT NULL,
    ffprobe_json TEXT, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL,
    ready_at TEXT
  );
  CREATE TABLE director_candidate_groups (
    id TEXT PRIMARY KEY, shot_id TEXT NOT NULL, status TEXT NOT NULL,
    selected_candidate_id TEXT, selected_artifact_id TEXT, selected_by TEXT,
    selected_at TEXT, selection_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE director_candidates (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
    job_id TEXT, video_generation_id INTEGER, status TEXT NOT NULL, error_code TEXT, error_message TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(group_id, artifact_id)
  );
  CREATE TABLE director_timelines (
    id TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL,
    input_json TEXT NOT NULL, manifest_json TEXT NOT NULL, ffmpeg_command TEXT NOT NULL,
    output_path TEXT, output_sha256 TEXT, ffprobe_json TEXT, created_at TEXT NOT NULL
  );
`;

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendFile(filePath) { this.sentFile = filePath; return this; },
  };
}

function registry() {
  return {
    version: 1,
    workflows: [
      { id: 'h3-continuity-v1', status: 'verified', workflowSha256: 'sha256:verified' },
      { id: 'invalid-workflow', status: 'invalid', workflowSha256: 'sha256:invalid' },
    ],
  };
}

function seedDefaultVideoConfig(db, {
  provider = 'cloud-provider',
  protocol = 'openai',
  model = 'cloud-default-model',
  settings = { width: 1280, height: 704, frame_rate: 24 },
} = {}) {
  db.prepare("UPDATE ai_service_configs SET is_default = 0 WHERE service_type = 'video'").run();
  return Number(db.prepare(`INSERT INTO ai_service_configs
    (service_type, provider, api_protocol, base_url, api_key, model, default_model,
     settings, is_default, is_active)
    VALUES ('video', ?, ?, 'https://video.example.test', 'secret', ?, ?, ?, 1, 1)`)
    .run(provider, protocol, JSON.stringify([model]), model, JSON.stringify(settings)).lastInsertRowid);
}

function createLifecycle(db) {
  return createUnifiedVideoGenerationService({
    db,
    log: { info() {}, warn() {}, error() {} },
    providerRegistry: { has() { return false; }, get() { throw new Error('not scheduled in route tests'); } },
    schedule() {},
    videoStyleCompiler: (_db, input) => ({ prompt: String(input.prompt || ''), compilation: null }),
  });
}

function insertLegacyCandidate(db, {
  jobId = 'legacy-job',
  groupId = 'legacy-group',
  candidateId = 'legacy-candidate',
  jobStatus = 'pending',
  candidateStatus = 'pending',
  attemptNumber = 0,
} = {}) {
  const now = '2026-08-25T00:00:00.000Z';
  db.prepare(`INSERT INTO director_candidate_groups
    (id, shot_id, status, created_at, updated_at) VALUES (?, '1', ?, ?, ?)`)
    .run(groupId, candidateStatus === 'failed' ? 'failed' : 'pending', now, now);
  db.prepare(`INSERT INTO director_jobs
    (id, status, attempt_number, max_attempts, input_json, workflow_id, workflow_version, created_at, updated_at)
    VALUES (?, ?, ?, 3, '{}', 'legacy-workflow', '1', ?, ?)`)
    .run(jobId, jobStatus, attemptNumber, now, now);
  db.prepare(`INSERT INTO director_candidates
    (id, group_id, artifact_id, job_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(candidateId, groupId, `pending-artifact-${jobId}`, jobId, candidateStatus, now, now);
  return { jobId, groupId, candidateId };
}

describe('Director generation routes', () => {
  let db;
  let enqueued;
  let routes;
  let lifecycle;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA);
    db.prepare('INSERT INTO storyboards (id) VALUES (1)').run();
    seedDefaultVideoConfig(db);
    lifecycle = createLifecycle(db);
    enqueued = [];
    routes = createRoutes(db, { error() {} }, {
      registry: registry(),
      allowExperimental: false,
      videoGenerationService: lifecycle,
      runner: {
        enqueue(jobId) {
          enqueued.push(jobId);
          return jobId;
        },
      },
    });
  });

  afterEach(() => db.close());

  it('uses cloud and ComfyUI defaults for unified candidates and ignores incoming provider overrides', async () => {
    for (const expected of [
      { provider: 'cloud-provider', protocol: 'openai', model: 'cloud-default-model' },
      { provider: 'comfyui', protocol: 'comfyui', model: 'h3-default-workflow' },
    ]) {
      seedDefaultVideoConfig(db, expected);
      const res = responseCapture();
      await routes.generateCandidates({
        params: { shotId: '1' },
        body: {
          provider: 'incoming-provider-must-be-ignored',
          candidateCount: 2,
          structured: {
            prompt: 'A tracked shot through a rainy alley',
            width: 864,
            height: 480,
            frameRate: 24,
            durationSeconds: 5,
            seed: 42,
          },
        },
      }, res);

      assert.equal(res.statusCode, 202);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.group.shot_id, '1');
      assert.equal(res.body.data.group.status, 'pending');
      assert.equal(res.body.data.video_generations.length, 2);
      assert.equal(enqueued.length, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);
      const candidates = res.body.data.group.candidates;
      assert.equal(candidates.length, 2);
      assert.ok(candidates.every((candidate) => Number.isInteger(candidate.video_generation_id)));
      for (const candidate of candidates) {
        const generation = db.prepare(`SELECT provider, protocol, model, prompt, candidate_group_id
          FROM video_generations WHERE id = ?`).get(candidate.video_generation_id);
        assert.deepEqual(generation, {
          provider: expected.provider,
          protocol: expected.protocol,
          model: expected.model,
          prompt: 'A tracked shot through a rainy alley',
          candidate_group_id: res.body.data.group.id,
        });
      }
    }
  });

  it('rejects a missing shot without writing a generation batch', async () => {
    const missingShot = responseCapture();
    await routes.generateCandidates({
      params: { shotId: '999' },
      body: { candidateCount: 1, structured: { prompt: 'missing shot' } },
    }, missingShot);
    assert.equal(missingShot.statusCode, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidate_groups').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);
    assert.equal(enqueued.length, 0);
  });

  it('uses the backend default when a legacy caller omits workflowId', async () => {
    const res = responseCapture();
    await routes.generateCandidates({
      params: { shotId: '1' },
      body: { candidateCount: 1, structured: { prompt: 'shot without explicit workflow' } },
    }, res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.video_generations.length, 1);
    const generation = db.prepare('SELECT provider, model FROM video_generations WHERE id = ?')
      .get(res.body.data.video_generations[0].id);
    assert.equal(generation.provider, 'cloud-provider');
    assert.equal(generation.model, 'cloud-default-model');
  });

  it('preserves conflicting workflow aliases for canonical validation and returns the stable error code', async () => {
    const captured = [];
    const conflictRoutes = createRoutes(db, { error() {} }, {
      videoGenerationService: {
        async createVideoGeneration(input) {
          captured.push(input);
          const error = new Error('model、workflow_id 与 workflowId 必须指向同一工作流');
          error.code = 'VIDEO_WORKFLOW_CONFLICT';
          error.status = 400;
          error.details = { model: input.model, workflow_id: input.workflow_id, workflowId: input.workflowId };
          throw error;
        },
        async cancelVideoGeneration() {},
      },
    });
    const res = responseCapture();

    await conflictRoutes.generateCandidates({
      params: { shotId: '1' },
      body: {
        candidateCount: 1,
        model: 'model-alias',
        inputs: { workflow_id: 'snake-alias' },
        structured: { prompt: 'conflicting aliases', workflowId: 'camel-alias' },
      },
    }, res);

    assert.deepEqual(captured.map(({ model, workflow_id, workflowId }) => ({ model, workflow_id, workflowId })), [{
      model: 'model-alias', workflow_id: 'snake-alias', workflowId: 'camel-alias',
    }]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'VIDEO_WORKFLOW_CONFLICT');
  });

  it('cancels created videos and removes the whole group when a later candidate fails', async () => {
    let creationAttempt = 0;
    const compensatingLifecycle = {
      async createVideoGeneration(input) {
        creationAttempt += 1;
        if (creationAttempt === 2) throw new Error('second candidate creation failed');
        return lifecycle.createVideoGeneration(input);
      },
      async cancelVideoGeneration(id) {
        return lifecycle.cancelVideoGeneration(id);
      },
    };
    const compensatingRoutes = createRoutes(db, { error() {} }, {
      videoGenerationService: compensatingLifecycle,
      runner: { enqueue() { throw new Error('legacy enqueue must not run'); } },
    });
    const res = responseCapture();

    await compensatingRoutes.generateCandidates({
      params: { shotId: '1' },
      body: { candidateCount: 2, structured: { prompt: 'atomic candidate batch' } },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidate_groups').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidates').get().count, 0);
    assert.deepEqual(db.prepare('SELECT status FROM video_generations').all(), [{ status: 'cancelled' }]);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM video_generations WHERE status IN ('waiting', 'queued', 'running')").get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);
  });

  it('durably terminates created videos when batch cancellation rejects', async () => {
    let creationAttempt = 0;
    const rejectingCancellationLifecycle = {
      async createVideoGeneration(input) {
        creationAttempt += 1;
        if (creationAttempt === 2) throw new Error('second candidate creation failed');
        return lifecycle.createVideoGeneration(input);
      },
      async cancelVideoGeneration() {
        throw new Error('provider cancellation rejected');
      },
    };
    const rejectingCancellationRoutes = createRoutes(db, { error() {} }, {
      videoGenerationService: rejectingCancellationLifecycle,
    });
    const res = responseCapture();

    await rejectingCancellationRoutes.generateCandidates({
      params: { shotId: '1' },
      body: { candidateCount: 2, structured: { prompt: 'durable batch compensation' } },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidate_groups').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidates').get().count, 0);
    const video = db.prepare('SELECT status, error_msg, task_id FROM video_generations').get();
    assert.equal(video.status, 'cancelled');
    assert.equal(JSON.parse(video.error_msg).code, 'DIRECTOR_BATCH_COMPENSATED');
    assert.deepEqual(db.prepare('SELECT status, progress FROM async_tasks WHERE id = ?').get(video.task_id), {
      status: 'failed',
      progress: 100,
    });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM video_generations WHERE status IN ('waiting', 'queued', 'running', 'processing')").get().count, 0);
  });

  it('rejects invalid candidate, prompt, inputs, and retry values before writing', async () => {
    const invalidBodies = [
      { candidateCount: 0, structured: { prompt: 'shot' } },
      { candidateCount: 4, structured: { prompt: 'shot' } },
      { candidateCount: 1, prompt: [] },
      { candidateCount: 1, structured: [] },
      { candidateCount: 1, structured: { prompt: 'shot' }, inputs: [] },
      { candidateCount: 1, structured: { prompt: 'shot' }, maxAttempts: 0 },
    ];

    for (const body of invalidBodies) {
      const res = responseCapture();
      await routes.generateCandidates({ params: { shotId: '1' }, body }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidate_groups').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);
  });

  it('rejects downstream continuity generation until its source artifact is selected', async () => {
    const body = {
      candidateCount: 1,
      structured: { prompt: 'continue from the selected source' },
      inputs: { continuityMode: 'state_anchor', sourceArtifactId: 'artifact-unselected' },
    };
    const rejected = responseCapture();
    await routes.generateCandidates({ params: { shotId: '1' }, body }, rejected);
    assert.equal(rejected.statusCode, 400);
    assert.match(rejected.body.error.message, /selected/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);

    db.prepare(`INSERT INTO director_candidate_groups
      (id, shot_id, status, selected_artifact_id, created_at, updated_at)
      VALUES ('source-group', '1', 'review', 'artifact-selected', ?, ?)`)
      .run(new Date().toISOString(), new Date().toISOString());
    const stillRejected = responseCapture();
    await routes.generateCandidates({
      params: { shotId: '1' },
      body: { ...body, inputs: { continuityMode: 'state_anchor', sourceArtifactId: 'artifact-selected' } },
    }, stillRejected);
    assert.equal(stillRejected.statusCode, 400);
    assert.match(stillRejected.body.error.message, /selected/i);

    db.prepare(`INSERT INTO director_artifacts
      (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size,
       manifest_json, created_at, ready_at)
      VALUES ('artifact-selected', 'source-job', 1, 1, 'ready', 'source.mp4', 'hash', 1, '{}', ?, ?)`)
      .run(new Date().toISOString(), new Date().toISOString());
    db.prepare("UPDATE director_candidate_groups SET status = 'selected' WHERE id = 'source-group'").run();
    const accepted = responseCapture();
    await routes.generateCandidates({
      params: { shotId: '1' },
      body: { ...body, inputs: { continuityMode: 'state_anchor', sourceArtifactId: 'artifact-selected' } },
    }, accepted);
    assert.equal(accepted.statusCode, 202);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);
  });

  it('returns durable job details and a not-found response', () => {
    const { jobId } = insertLegacyCandidate(db);

    const found = responseCapture();
    routes.getJob({ params: { jobId } }, found);
    assert.equal(found.statusCode, 200);
    assert.equal(found.body.data.id, jobId);
    assert.deepEqual(found.body.data.artifacts, []);

    const missing = responseCapture();
    routes.getJob({ params: { jobId: 'missing-job' } }, missing);
    assert.equal(missing.statusCode, 404);
  });

  it('never sends new candidates to the legacy Director runner', async () => {
    const failingRoutes = createRoutes(db, { error() {} }, {
      registry: registry(),
      videoGenerationService: lifecycle,
      runner: { enqueue() { throw new Error('queue unavailable'); } },
    });
    const res = responseCapture();

    await failingRoutes.generateCandidates({
      params: { shotId: '1' },
      body: { candidateCount: 1, structured: { prompt: 'unified only' } },
    }, res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.data.group.status, 'pending');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);
  });

  it('cancels a pending job and finalizes its candidate group', async () => {
    const { jobId } = insertLegacyCandidate(db);
    const cancelled = responseCapture();
    await routes.cancelJob({ params: { jobId } }, cancelled);
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.body.data.status, 'cancelled');
    assert.equal(db.prepare('SELECT status FROM director_candidates WHERE job_id = ?').get(jobId).status, 'failed');
  });

  it('retries a failed job and enqueues it again', () => {
    const failingRoutes = createRoutes(db, { error() {} }, {
      registry: registry(),
      runner: {
        enqueue(jobId) { enqueued.push(jobId); },
      },
    });
    const { jobId } = insertLegacyCandidate(db, {
      jobStatus: 'failed',
      candidateStatus: 'failed',
      attemptNumber: 1,
    });
    const retried = responseCapture();
    failingRoutes.retryJob({ params: { jobId } }, retried);
    assert.equal(retried.statusCode, 202);
    assert.equal(retried.body.data.status, 'pending');
    assert.equal(db.prepare('SELECT status FROM director_candidates WHERE job_id = ?').get(jobId).status, 'pending');
    assert.ok(enqueued.includes(jobId));
  });

  it('delegates cancel, retry, and selection for linked candidates to the unified lifecycle', async () => {
    const created = responseCapture();
    await routes.generateCandidates({
      params: { shotId: '1' },
      body: { candidateCount: 1, structured: { prompt: 'cancel and retry' } },
    }, created);
    const generationId = created.body.data.group.candidates[0].video_generation_id;
    const calls = [];
    const delegatedRoutes = createRoutes(db, { error() {} }, {
      videoGenerationService: {
        async cancelVideoGeneration(id) {
          calls.push(['cancel', Number(id)]);
          db.prepare("UPDATE video_generations SET status = 'cancelled' WHERE id = ?").run(Number(id));
          return { id: Number(id), status: 'cancelled' };
        },
        async retryVideoGeneration(id) {
          calls.push(['retry', Number(id)]);
          db.prepare("UPDATE video_generations SET status = 'waiting' WHERE id = ?").run(Number(id));
          return { id: Number(id), status: 'waiting' };
        },
        async selectVideoGeneration(id) {
          calls.push(['select', Number(id)]);
          const now = '2026-08-25T00:00:05.000Z';
          db.prepare("UPDATE video_generations SET status = 'selected', updated_at = ? WHERE id = ?").run(now, Number(id));
          return { id: Number(id), status: 'selected' };
        },
      },
      runner: { enqueue() { throw new Error('legacy enqueue must not run'); } },
    });

    const cancelled = responseCapture();
    await delegatedRoutes.cancelJob({ params: { jobId: String(generationId) } }, cancelled);
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.body.data.status, 'cancelled');

    const retried = responseCapture();
    await delegatedRoutes.retryJob({ params: { jobId: String(generationId) } }, retried);
    assert.equal(retried.statusCode, 202);
    assert.equal(retried.body.data.status, 'waiting');
    assert.deepEqual(calls, [['cancel', generationId], ['retry', generationId]]);
    assert.equal(db.prepare('SELECT status FROM director_candidates WHERE video_generation_id = ?').get(generationId).status, 'pending');

    db.prepare(`UPDATE video_generations SET status = 'review', video_url = ?, updated_at = ? WHERE id = ?`)
      .run('https://cdn.example.test/selected.mp4', '2026-08-25T00:00:04.000Z', generationId);
    const refreshed = responseCapture();
    routes.getCandidates({ params: { groupId: created.body.data.group.id } }, refreshed);
    const candidateId = refreshed.body.data.candidates[0].id;
    const selected = responseCapture();
    await delegatedRoutes.selectCandidate({
      params: { groupId: created.body.data.group.id },
      body: { candidateId },
    }, selected);
    assert.equal(selected.statusCode, 200);
    assert.equal(selected.body.data.status, 'selected');
    assert.deepEqual(calls, [['cancel', generationId], ['retry', generationId], ['select', generationId]]);
  });

  it('leaves Director selection unchanged when the unified lifecycle rejects it', async () => {
    const created = responseCapture();
    await routes.generateCandidates({
      params: { shotId: '1' },
      body: { candidateCount: 1, structured: { prompt: 'selection rejection' } },
    }, created);
    const groupId = created.body.data.group.id;
    const candidate = created.body.data.group.candidates[0];
    db.prepare(`UPDATE video_generations SET status = 'review', video_url = ? WHERE id = ?`)
      .run('https://cdn.example.test/not-selected.mp4', candidate.video_generation_id);
    const review = responseCapture();
    routes.getCandidates({ params: { groupId } }, review);
    assert.equal(review.body.data.status, 'review');

    const rejectingRoutes = createRoutes(db, { error() {} }, {
      videoGenerationService: {
        async selectVideoGeneration() { throw new Error('selection rejected'); },
      },
    });
    const rejected = responseCapture();
    await rejectingRoutes.selectCandidate({
      params: { groupId },
      body: { candidateId: candidate.id },
    }, rejected);

    assert.equal(rejected.statusCode, 400);
    assert.equal(db.prepare('SELECT status FROM director_candidate_groups WHERE id = ?').get(groupId).status, 'review');
    assert.equal(db.prepare('SELECT status FROM director_candidates WHERE id = ?').get(candidate.id).status, 'review');
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(candidate.video_generation_id).status, 'review');
    assert.deepEqual(db.prepare('SELECT video_url, local_path FROM storyboards WHERE id = 1').get(), {
      video_url: null,
      local_path: null,
    });
  });

  it('does not synchronize stale Director rows before unified selection succeeds', async () => {
    const created = responseCapture();
    await routes.generateCandidates({
      params: { shotId: '1' },
      body: { candidateCount: 1, structured: { prompt: 'read-only selection check' } },
    }, created);
    const groupId = created.body.data.group.id;
    const candidate = created.body.data.group.candidates[0];
    db.prepare(`UPDATE video_generations SET status = 'review', video_url = ? WHERE id = ?`)
      .run('https://cdn.example.test/stale-review.mp4', candidate.video_generation_id);
    db.prepare(`UPDATE director_candidate_groups SET updated_at = ? WHERE id = ?`)
      .run('2026-08-25T00:01:00.000Z', groupId);
    db.prepare(`UPDATE director_candidates SET error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`)
      .run('STALE_SENTINEL', 'must remain untouched', '2026-08-25T00:01:01.000Z', candidate.id);
    const beforeGroup = JSON.stringify(db.prepare('SELECT * FROM director_candidate_groups WHERE id = ?').get(groupId));
    const beforeCandidate = JSON.stringify(db.prepare('SELECT * FROM director_candidates WHERE id = ?').get(candidate.id));

    const rejectingRoutes = createRoutes(db, { error() {} }, {
      videoGenerationService: {
        async selectVideoGeneration() { throw new Error('selection rejected before sync'); },
      },
    });
    const rejected = responseCapture();
    await rejectingRoutes.selectCandidate({
      params: { groupId },
      body: { candidateId: candidate.id },
    }, rejected);

    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.body.error.message, 'selection rejected before sync');
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM director_candidate_groups WHERE id = ?').get(groupId)), beforeGroup);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM director_candidates WHERE id = ?').get(candidate.id)), beforeCandidate);
  });

  it('leaves a failed Director candidate unchanged when unified retry rejects', async () => {
    const created = responseCapture();
    await routes.generateCandidates({
      params: { shotId: '1' },
      body: { candidateCount: 1, structured: { prompt: 'retry rejection' } },
    }, created);
    const groupId = created.body.data.group.id;
    const candidate = created.body.data.group.candidates[0];
    db.prepare(`UPDATE video_generations SET status = 'failed', error_msg = ? WHERE id = ?`)
      .run(JSON.stringify({ code: 'UPSTREAM_FAILED', message: 'upstream failed' }), candidate.video_generation_id);
    const failed = responseCapture();
    routes.getCandidates({ params: { groupId } }, failed);
    assert.equal(failed.body.data.status, 'failed');
    assert.equal(failed.body.data.candidates[0].status, 'failed');

    const rejectingRoutes = createRoutes(db, { error() {} }, {
      videoGenerationService: {
        async retryVideoGeneration() { throw new Error('retry rejected'); },
      },
    });
    const rejected = responseCapture();
    await rejectingRoutes.retryJob({
      params: { jobId: String(candidate.video_generation_id) },
    }, rejected);

    assert.equal(rejected.statusCode, 400);
    assert.equal(db.prepare('SELECT status FROM director_candidate_groups WHERE id = ?').get(groupId).status, 'failed');
    assert.deepEqual(db.prepare('SELECT status, error_code, error_message FROM director_candidates WHERE id = ?').get(candidate.id), {
      status: 'failed',
      error_code: 'UPSTREAM_FAILED',
      error_message: 'upstream failed',
    });
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(candidate.video_generation_id).status, 'failed');
  });

  it('restores the newest candidate group for a shot with parsed artifact metadata', () => {
    const createdAt = '2026-08-23T00:00:00.000Z';
    const groupId = 'group-persisted';
    const candidateId = 'candidate-persisted';
    const artifactId = 'artifact-persisted';
    const jobId = 'job-persisted';
    db.prepare(`INSERT INTO director_candidate_groups
      (id, shot_id, status, created_at, updated_at) VALUES (?, ?, 'review', ?, ?)`)
      .run(groupId, '1', createdAt, createdAt);
    db.prepare(`INSERT INTO director_jobs
      (id, status, attempt_number, max_attempts, input_json, created_at, updated_at)
      VALUES (?, 'succeeded', 1, 3, '{}', ?, ?)`)
      .run(jobId, createdAt, createdAt);
    db.prepare(`INSERT INTO director_artifacts
      (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size,
       ffprobe_json, manifest_json, created_at, ready_at)
      VALUES (?, ?, 1, 1, 'ready', 'E:/artifacts/result.mp4', 'sha256:video', 123,
        ?, ?, ?, ?)`)
      .run(artifactId, jobId, JSON.stringify({ streams: [{ width: 864, height: 480, r_frame_rate: '24/1' }], format: { duration: '5.0' } }), JSON.stringify({ kind: 'video', sha256: 'sha256:video' }), createdAt, createdAt);
    db.prepare(`INSERT INTO director_candidates
      (id, group_id, artifact_id, job_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'review', ?, ?)`)
      .run(candidateId, groupId, artifactId, jobId, createdAt, createdAt);

    const res = responseCapture();
    routes.getShotCandidates({ params: { shotId: '1' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.latest.id, groupId);
    assert.equal(res.body.data.groups[0].candidates[0].artifact.id, artifactId);
    assert.equal(res.body.data.groups[0].candidates[0].artifact.media.width, 864);
    assert.equal(res.body.data.groups[0].candidates[0].artifact.preview_url, `/api/v1/director/artifacts/${artifactId}/content`);
    assert.equal(res.body.data.groups[0].candidates[0].artifact.artifact_path, undefined);
  });

  it('returns empty history for a valid shot and 404 for a missing shot', () => {
    const empty = responseCapture();
    routes.getShotCandidates({ params: { shotId: '1' } }, empty);
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.body.data, { groups: [], latest: null });

    const missing = responseCapture();
    routes.getShotCandidates({ params: { shotId: '999' } }, missing);
    assert.equal(missing.statusCode, 404);
  });

  it('serves only ready persisted artifacts through the content handler', () => {
    const createdAt = new Date().toISOString();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'director-artifacts-'));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'director-storage-'));
    const readyPath = path.join(artifactRoot, 'ready.mp4');
    const storedVideoPath = path.join(storageRoot, 'projects', 'shot-5.mp4');
    const outsidePath = path.join(os.tmpdir(), `director-outside-${Date.now()}.mp4`);
    fs.writeFileSync(readyPath, 'test');
    fs.mkdirSync(path.dirname(storedVideoPath), { recursive: true });
    fs.writeFileSync(storedVideoPath, 'test');
    fs.writeFileSync(outsidePath, 'test');
    db.prepare(`INSERT INTO director_artifacts
      (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size,
       manifest_json, created_at, ready_at)
      VALUES ('artifact-ready', 'job-ready', 1, 1, 'ready', ?, 'hash', 1, '{}', ?, ?),
             ('artifact-failed', 'job-failed', 1, 1, 'failed', 'E:/artifacts/failed.mp4', '', 0, '{}', ?, NULL),
             ('artifact-outside', 'job-outside', 1, 1, 'ready', ?, 'hash', 1, '{}', ?, ?)`)
      .run(readyPath, createdAt, createdAt, createdAt, outsidePath, createdAt, createdAt);
    db.prepare(`INSERT INTO director_artifacts
      (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size,
       manifest_json, created_at, ready_at)
      VALUES ('artifact-storage', 'job-storage', 1, 1, 'ready', ?, 'hash', 1, '{}', ?, ?)`)
      .run(storedVideoPath, createdAt, createdAt);
    const contentRoutes = createRoutes(db, { error() {} }, { artifactRoot, storageRoot });

    const ready = responseCapture();
    contentRoutes.getArtifactContent({ params: { artifactId: 'artifact-ready' } }, ready);
    assert.equal(ready.statusCode, null);
    assert.equal(ready.sentFile, readyPath);

    const failed = responseCapture();
    contentRoutes.getArtifactContent({ params: { artifactId: 'artifact-failed' } }, failed);
    assert.equal(failed.statusCode, 404);

    const outside = responseCapture();
    contentRoutes.getArtifactContent({ params: { artifactId: 'artifact-outside' } }, outside);
    assert.equal(outside.statusCode, 404);
    const stored = responseCapture();
    contentRoutes.getArtifactContent({ params: { artifactId: 'artifact-storage' } }, stored);
    assert.equal(stored.statusCode, null);
    assert.equal(stored.sentFile, storedVideoPath);
    fs.rmSync(artifactRoot, { recursive: true, force: true });
    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(outsidePath, { force: true });
  });
});
