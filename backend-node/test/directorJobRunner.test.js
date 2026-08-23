const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createGpuMutex } = require('../src/director/gpuMutex');
const { createDirectorJobRunner, runDirectorJob } = require('../src/director/directorJobRunner');

const SCHEMA = `
  CREATE TABLE director_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_number INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    lease_expires_at TEXT,
    error_code TEXT,
    error_message TEXT,
    input_json TEXT NOT NULL DEFAULT '{}',
    workflow_id TEXT,
    workflow_version TEXT,
    artifact_path TEXT,
    artifact_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX idx_director_jobs_status_lease
    ON director_jobs(status, lease_expires_at);

  CREATE TABLE director_artifacts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    artifact_path TEXT NOT NULL,
    parent_artifact_id TEXT,
    sha256 TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    ffprobe_json TEXT,
    manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ready_at TEXT,
    UNIQUE(job_id, version)
  );
  CREATE INDEX idx_director_artifacts_job
    ON director_artifacts(job_id, version);

  CREATE TABLE director_candidate_groups (
    id TEXT PRIMARY KEY,
    shot_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    selected_candidate_id TEXT,
    selected_artifact_id TEXT,
    selected_by TEXT,
    selected_at TEXT,
    selection_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE director_candidates (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    job_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(group_id, artifact_id)
  );
  CREATE INDEX idx_director_candidates_group
    ON director_candidates(group_id, status);

  CREATE TABLE director_anchors (
    id TEXT PRIMARY KEY,
    source_artifact_id TEXT NOT NULL,
    derived_artifact_id TEXT NOT NULL,
    frame_number INTEGER NOT NULL,
    reference_role TEXT NOT NULL,
    reference_use TEXT NOT NULL,
    prompt_label TEXT,
    source_sha256 TEXT NOT NULL,
    parameters_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_director_anchors_source
    ON director_anchors(source_artifact_id, frame_number);

  CREATE TABLE director_timelines (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'validated',
    input_json TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    ffmpeg_command TEXT NOT NULL,
    output_path TEXT,
    output_sha256 TEXT,
    ffprobe_json TEXT,
    created_at TEXT NOT NULL
  );
`;

function id() {
  return crypto.randomUUID();
}

function now() {
  return '2026-08-23T00:00:00.000Z';
}

function seedPendingJob(db, { shotId = 'shot-1', jobId = id(), groupId = id(), candidateId = id() } = {}) {
  const timestamp = now();
  const artifactId = `pending-artifact-${jobId}`;
  const prompt = { '5': { class_type: 'MiniMaxH3Director', inputs: { global_prompt: 'a rainy street' } } };
  const inputs = { seed: 42, prompt: 'a rainy street' };
  const groupExists = db.prepare('SELECT 1 FROM director_candidate_groups WHERE id = ?').get(groupId);
  if (!groupExists) {
    db.prepare(`
      INSERT INTO director_candidate_groups
        (id, shot_id, status, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(groupId, shotId, timestamp, timestamp);
  }
  db.prepare(`
    INSERT INTO director_jobs
      (id, status, attempt_number, max_attempts, input_json, workflow_id,
       workflow_version, created_at, updated_at)
    VALUES (?, 'pending', 0, 2, ?, 'h3-continuity-v1', '1', ?, ?)
  `).run(jobId, JSON.stringify({
    shotId, groupId, candidateId, workflowId: 'h3-continuity-v1', prompt, inputs,
  }), timestamp, timestamp);
  db.prepare(`
    INSERT INTO director_candidates
      (id, group_id, artifact_id, job_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(candidateId, groupId, artifactId, jobId, timestamp, timestamp);
  return { shotId, jobId, groupId, candidateId, artifactId };
}

function getJob(db, jobId) {
  return db.prepare('SELECT * FROM director_jobs WHERE id = ?').get(jobId);
}

function getCandidate(db, candidateId) {
  return db.prepare('SELECT * FROM director_candidates WHERE id = ?').get(candidateId);
}

function getGroup(db, groupId) {
  return db.prepare('SELECT * FROM director_candidate_groups WHERE id = ?').get(groupId);
}

function getArtifact(db, jobId) {
  return db.prepare('SELECT * FROM director_artifacts WHERE job_id = ? ORDER BY version DESC LIMIT 1').get(jobId);
}

describe('Director job runner', () => {
  let db;
  let outputDir;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA);
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'director-runner-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('runs a pending job to success and moves its candidate group into review', async () => {
    const seeded = seedPendingJob(db);
    const artifactPath = path.join(outputDir, 'success.mp4');
    fs.writeFileSync(artifactPath, 'successful sibling output');
    const calls = [];
    const comfyClient = {
      async runWorkflow(input) {
        const runningJob = getJob(db, seeded.jobId);
        assert.equal(runningJob.status, 'running');
        assert.equal(runningJob.attempt_number, 1);
        assert.ok(runningJob.started_at);
        calls.push(input);
        return {
          artifactPath,
          ffprobe: { format: { duration: '4' }, streams: [{ codec_type: 'video' }] },
          promptId: 'prompt-success',
          queue: { number: 7 },
          history: { status: { completed: true, status_str: 'success' } },
          pollTimestamps: ['2026-08-23T00:00:01.000Z'],
          workflowId: 'h3-continuity-v1',
          workflowSha256: 'sha256:test',
        };
      },
    };
    const gpuMutex = createGpuMutex();

    const result = await runDirectorJob(db, seeded.jobId, {
      comfyClient,
      gpuMutex,
      leaseMs: 60_000,
      now: now(),
    });

    assert.equal(result.status, 'succeeded');
    assert.equal(getJob(db, seeded.jobId).status, 'succeeded');
    assert.equal(getJob(db, seeded.jobId).lease_expires_at, null);
    assert.equal(getCandidate(db, seeded.candidateId).status, 'review');
    assert.equal(getCandidate(db, seeded.candidateId).error_code, null);
    assert.equal(getGroup(db, seeded.groupId).status, 'review');
    assert.equal(getJob(db, seeded.jobId).artifact_path, artifactPath);
    assert.equal(getCandidate(db, seeded.candidateId).artifact_id, getJob(db, seeded.jobId).artifact_id);
    assert.equal(getArtifact(db, seeded.jobId).status, 'ready');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].workflowId, 'h3-continuity-v1');
    assert.deepEqual(calls[0].prompt, { '5': { class_type: 'MiniMaxH3Director', inputs: { global_prompt: 'a rainy street' } } });
    assert.deepEqual(calls[0].inputs, { seed: 42, prompt: 'a rainy street' });
    assert.equal(gpuMutex.inspect(), null);
  });

  it('records COMFYUI_TIMEOUT on failure and releases both job and GPU leases', async () => {
    const seeded = seedPendingJob(db);
    const gpuMutex = createGpuMutex();
    const comfyClient = {
      async runWorkflow() {
        const runningJob = getJob(db, seeded.jobId);
        assert.equal(runningJob.status, 'running');
        assert.equal(runningJob.attempt_number, 1);
        assert.ok(runningJob.started_at);
        const error = new Error('poll timed out');
        error.code = 'COMFYUI_TIMEOUT';
        throw error;
      },
    };

    await assert.rejects(
      () => runDirectorJob(db, seeded.jobId, { comfyClient, gpuMutex, leaseMs: 60_000, now: now() }),
      /poll timed out/
    );

    const job = getJob(db, seeded.jobId);
    const candidate = getCandidate(db, seeded.candidateId);
    assert.equal(job.status, 'failed');
    assert.equal(job.error_code, 'COMFYUI_TIMEOUT');
    assert.equal(job.error_message, 'poll timed out');
    assert.equal(job.lease_expires_at, null);
    assert.equal(candidate.status, 'failed');
    assert.equal(candidate.error_code, 'COMFYUI_TIMEOUT');
    assert.equal(candidate.error_message, 'poll timed out');
    assert.equal(getGroup(db, seeded.groupId).status, 'failed');
    assert.equal(gpuMutex.inspect(), null);
  });

  it('preserves a successful sibling when another candidate job fails', async () => {
    const successful = seedPendingJob(db, { shotId: 'shot-mixed', groupId: id() });
    const failed = seedPendingJob(db, { shotId: 'shot-mixed', groupId: successful.groupId });
    const successfulPath = path.join(outputDir, 'sibling-success.mp4');
    fs.writeFileSync(successfulPath, 'successful sibling output');
    const comfyClient = {
      async runWorkflow(input) {
        if (input.groupId === failed.groupId && input.candidateId === failed.candidateId) {
          const runningJob = getJob(db, failed.jobId);
          assert.equal(runningJob.status, 'running');
          assert.equal(runningJob.attempt_number, 1);
          assert.ok(runningJob.started_at);
          const error = new Error('poll timed out');
          error.code = 'COMFYUI_TIMEOUT';
          throw error;
        }
        const runningJob = getJob(db, successful.jobId);
        assert.equal(runningJob.status, 'running');
        assert.equal(runningJob.attempt_number, 1);
        assert.ok(runningJob.started_at);
        return {
          artifactPath: successfulPath,
          ffprobe: { streams: [{ codec_type: 'video' }] },
          promptId: 'prompt-sibling-success',
          queue: { number: 8 },
          history: { status: { completed: true, status_str: 'success' } },
          pollTimestamps: ['2026-08-23T00:00:02.000Z'],
          workflowId: 'h3-continuity-v1',
          workflowSha256: 'sha256:sibling-test',
        };
      },
    };
    const gpuMutex = createGpuMutex();

    const successfulResult = await runDirectorJob(db, successful.jobId, {
      comfyClient, gpuMutex, leaseMs: 60_000, now: now(),
    });
    const failedResult = await Promise.allSettled([
      runDirectorJob(db, failed.jobId, { comfyClient, gpuMutex, leaseMs: 60_000, now: now() }),
    ]);

    assert.equal(successfulResult.status, 'succeeded');
    assert.equal(failedResult[0].status, 'rejected');
    assert.equal(getJob(db, successful.jobId).status, 'succeeded');
    assert.equal(getCandidate(db, successful.candidateId).status, 'review');
    assert.equal(getCandidate(db, successful.candidateId).artifact_id, getJob(db, successful.jobId).artifact_id);
    assert.equal(getJob(db, failed.jobId).status, 'failed');
    assert.equal(getCandidate(db, failed.candidateId).status, 'failed');
    assert.equal(getCandidate(db, failed.candidateId).error_code, 'COMFYUI_TIMEOUT');
    assert.equal(getArtifact(db, successful.jobId).status, 'ready');
    assert.equal(getGroup(db, successful.groupId).status, 'review');
    assert.equal(gpuMutex.inspect(), null);
  });

  it('queues GPU jobs in FIFO order and drain waits for all queued work', async () => {
    const first = seedPendingJob(db, { shotId: 'shot-queue', groupId: id() });
    const second = seedPendingJob(db, { shotId: 'shot-queue', groupId: first.groupId });
    const events = [];
    let active = 0;
    const comfyClient = {
      async runWorkflow(input) {
        active += 1;
        assert.equal(active, 1);
        events.push(`start:${input.candidateId}`);
        await new Promise((resolve) => setImmediate(resolve));
        const artifactPath = path.join(outputDir, `${input.candidateId}.mp4`);
        fs.writeFileSync(artifactPath, input.candidateId);
        events.push(`finish:${input.candidateId}`);
        active -= 1;
        return { artifactPath, workflowId: 'h3-continuity-v1', workflowSha256: 'sha256:test' };
      },
    };
    const runner = createDirectorJobRunner({ db, comfyClient, gpuMutex: createGpuMutex(), now: now(), logger: { error() {} } });

    assert.equal(runner.enqueue(first.jobId), first.jobId);
    assert.equal(runner.enqueue(second.jobId), second.jobId);
    await runner.drain();

    assert.deepEqual(events, [
      `start:${first.candidateId}`,
      `finish:${first.candidateId}`,
      `start:${second.candidateId}`,
      `finish:${second.candidateId}`,
    ]);
    assert.equal(getJob(db, first.jobId).status, 'succeeded');
    assert.equal(getJob(db, second.jobId).status, 'succeeded');
  });

  it('fails only the current job when the GPU is busy and preserves the existing lease', async () => {
    const seeded = seedPendingJob(db);
    const gpuMutex = createGpuMutex();
    const existingLease = gpuMutex.acquire('other-job');

    await assert.rejects(
      () => runDirectorJob(db, seeded.jobId, {
        comfyClient: { async runWorkflow() { throw new Error('must not run'); } },
        gpuMutex,
        now: now(),
      }),
      /GPU_BUSY/
    );

    assert.equal(getJob(db, seeded.jobId).status, 'failed');
    assert.equal(getCandidate(db, seeded.candidateId).status, 'failed');
    assert.equal(gpuMutex.inspect().token, existingLease.token);
    gpuMutex.release(existingLease);
  });
});
