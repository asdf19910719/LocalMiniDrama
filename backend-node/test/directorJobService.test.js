const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  createDirectorJob,
  getDirectorJob,
  startDirectorJob,
  succeedDirectorJob,
  failDirectorJob,
  retryDirectorJob,
  reconcileRunningJobs,
} = require('../src/director/directorJobService');

describe('Director durable job service', () => {
  let db;
  let tempDir;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE director_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
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
      CREATE TABLE director_artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
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
    `);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'director-job-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('transitions pending to running to succeeded and persists a hashed artifact manifest', () => {
    const job = createDirectorJob(db, {
      input: { prompt: 'a rainy street' },
      workflowId: 'h3-continuity-v1',
      workflowVersion: '1',
      maxAttempts: 2,
    });
    assert.equal(job.status, 'pending');

    const running = startDirectorJob(db, job.id, { leaseMs: 60_000, now: '2026-08-23T00:00:00.000Z' });
    assert.equal(running.status, 'running');
    assert.equal(running.attempt_number, 1);

    const outputPath = path.join(tempDir, 'shot.mp4');
    fs.writeFileSync(outputPath, 'director-output');
    const completed = succeedDirectorJob(db, job.id, {
      artifactPath: outputPath,
      ffprobe: { format: { duration: '1.5' }, streams: [{ codec_type: 'video' }] },
      now: '2026-08-23T00:01:00.000Z',
    });

    assert.equal(completed.status, 'succeeded');
    assert.ok(completed.artifact_id);
    const artifact = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(completed.artifact_id);
    assert.equal(artifact.status, 'ready');
    assert.equal(artifact.sha256.length, 64);
    assert.equal(artifact.file_size, Buffer.byteLength('director-output'));
    assert.deepEqual(JSON.parse(artifact.ffprobe_json), { format: { duration: '1.5' }, streams: [{ codec_type: 'video' }] });
    assert.equal(JSON.parse(artifact.manifest_json).sha256, artifact.sha256);
  });

  it('allows retrying failed jobs but never retries or overwrites a succeeded artifact', () => {
    const failedJob = createDirectorJob(db, { input: { shotId: 7 }, maxAttempts: 2 });
    startDirectorJob(db, failedJob.id, { leaseMs: 60_000 });
    const failed = failDirectorJob(db, failedJob.id, { code: 'COMFYUI_TIMEOUT', message: 'poll timed out' });
    assert.equal(failed.status, 'failed');

    const retry = retryDirectorJob(db, failedJob.id);
    assert.equal(retry.status, 'pending');
    assert.equal(retry.attempt_number, 1);
    const restarted = startDirectorJob(db, failedJob.id, { leaseMs: 60_000 });
    assert.equal(restarted.attempt_number, 2);

    const outputPath = path.join(tempDir, 'retry.mp4');
    fs.writeFileSync(outputPath, 'retry-output');
    const succeeded = succeedDirectorJob(db, failedJob.id, { artifactPath: outputPath });
    assert.equal(succeeded.status, 'succeeded');
    assert.throws(() => retryDirectorJob(db, failedJob.id), /succeeded job cannot be retried/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_artifacts WHERE job_id = ?').get(failedJob.id).count, 1);
  });

  it('marks expired running jobs interrupted during restart reconciliation and recovers them once', () => {
    const job = createDirectorJob(db, { maxAttempts: 2 });
    startDirectorJob(db, job.id, { leaseMs: 1, now: '2026-08-23T00:00:00.000Z' });

    const reconciled = reconcileRunningJobs(db, { now: '2026-08-23T00:01:00.000Z' });
    assert.equal(reconciled, 1);
    assert.equal(getDirectorJob(db, job.id).status, 'interrupted');

    const recovered = retryDirectorJob(db, job.id);
    assert.equal(recovered.status, 'pending');
    assert.equal(startDirectorJob(db, job.id, { leaseMs: 60_000 }).attempt_number, 2);
  });

  it('uses a deterministic retry-limit error and rejects invalid transitions', () => {
    const job = createDirectorJob(db, { maxAttempts: 1 });
    startDirectorJob(db, job.id, { leaseMs: 60_000 });
    failDirectorJob(db, job.id, { code: 'WORKFLOW_FAILED', message: 'bad output' });
    assert.throws(() => retryDirectorJob(db, job.id), /DIRECTOR_RETRY_LIMIT/);
    assert.equal(getDirectorJob(db, job.id).status, 'failed');
    assert.throws(() => succeedDirectorJob(db, job.id, { artifactPath: path.join(tempDir, 'missing') }), /cannot succeed/i);
  });
});
