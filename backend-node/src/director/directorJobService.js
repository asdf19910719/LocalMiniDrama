const crypto = require('node:crypto');
const { createArtifactManifest } = require('./artifactManifest');

const TERMINAL_STATUSES = new Set(['succeeded', 'failed']);

function id() {
  return crypto.randomUUID();
}

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function rowToJob(row) {
  if (!row) return null;
  return {
    ...row,
    input: JSON.parse(row.input_json || '{}'),
    attempt_number: Number(row.attempt_number),
    max_attempts: Number(row.max_attempts),
  };
}

function getDirectorJob(db, jobId) {
  return rowToJob(db.prepare('SELECT * FROM director_jobs WHERE id = ?').get(jobId));
}

function requireJob(db, jobId) {
  const job = getDirectorJob(db, jobId);
  if (!job) throw new Error(`Director job not found: ${jobId}`);
  return job;
}

function createDirectorJob(db, {
  input = {},
  workflowId = null,
  workflowVersion = null,
  maxAttempts = 3,
  now,
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');
  const timestamp = iso(now);
  const jobId = id();
  db.prepare(`
    INSERT INTO director_jobs
      (id, status, attempt_number, max_attempts, input_json, workflow_id, workflow_version, created_at, updated_at)
    VALUES (?, 'pending', 0, ?, ?, ?, ?, ?, ?)
  `).run(jobId, maxAttempts, JSON.stringify(input), workflowId, workflowVersion, timestamp, timestamp);
  return getDirectorJob(db, jobId);
}

function startDirectorJob(db, jobId, { leaseMs = 15 * 60 * 1000, now } = {}) {
  const job = requireJob(db, jobId);
  if (job.status !== 'pending') throw new Error(`Director job cannot start from ${job.status}`);
  if (job.attempt_number >= job.max_attempts) throw new Error('DIRECTOR_RETRY_LIMIT');
  const startedAt = iso(now);
  const leaseExpiresAt = new Date(new Date(startedAt).getTime() + leaseMs).toISOString();
  db.prepare(`
    UPDATE director_jobs
    SET status = 'running', attempt_number = attempt_number + 1,
        lease_expires_at = ?, started_at = COALESCE(started_at, ?),
        error_code = NULL, error_message = NULL, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(leaseExpiresAt, startedAt, startedAt, jobId);
  return getDirectorJob(db, jobId);
}

function failDirectorJob(db, jobId, { code = 'DIRECTOR_JOB_FAILED', message = '' } = {}, now) {
  const job = requireJob(db, jobId);
  if (job.status !== 'running') throw new Error(`Director job cannot fail from ${job.status}`);
  const timestamp = iso(now);
  db.prepare(`
    UPDATE director_jobs
    SET status = 'failed', error_code = ?, error_message = ?, lease_expires_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(code, message, timestamp, jobId);
  return getDirectorJob(db, jobId);
}

function retryDirectorJob(db, jobId, now) {
  const job = requireJob(db, jobId);
  if (TERMINAL_STATUSES.has(job.status) && job.status !== 'failed') {
    throw new Error('Succeeded job cannot be retried');
  }
  if (!['failed', 'interrupted'].includes(job.status)) {
    throw new Error(`Director job cannot be retried from ${job.status}`);
  }
  if (job.attempt_number >= job.max_attempts) {
    throw new Error('DIRECTOR_RETRY_LIMIT');
  }
  const timestamp = iso(now);
  db.prepare(`
    UPDATE director_jobs
    SET status = 'pending', lease_expires_at = NULL, error_code = NULL, error_message = NULL, updated_at = ?
    WHERE id = ?
  `).run(timestamp, jobId);
  return getDirectorJob(db, jobId);
}

function succeedDirectorJob(db, jobId, {
  artifactPath,
  parentArtifactId = null,
  kind = 'video',
  ffprobe = null,
  metadata = {},
  now,
} = {}) {
  const job = requireJob(db, jobId);
  if (job.status !== 'running') throw new Error(`Director job cannot succeed from ${job.status}`);
  const timestamp = iso(now);
  const manifest = createArtifactManifest({ artifactPath, parentArtifactId, kind, ffprobe, metadata, now: timestamp });
  const versionRow = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM director_artifacts WHERE job_id = ?').get(jobId);
  const version = Number(versionRow.version) + 1;
  const artifactId = id();
  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO director_artifacts
        (id, job_id, attempt_number, version, status, artifact_path, parent_artifact_id,
         sha256, file_size, ffprobe_json, manifest_json, created_at, ready_at)
      VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifactId, jobId, job.attempt_number, version, artifactPath, parentArtifactId,
      manifest.sha256, manifest.fileSize, JSON.stringify(ffprobe), manifest.manifestJson, timestamp, timestamp
    );
    db.prepare(`
      UPDATE director_jobs
      SET status = 'succeeded', artifact_path = ?, artifact_id = ?, lease_expires_at = NULL,
          error_code = NULL, error_message = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(artifactPath, artifactId, timestamp, timestamp, jobId);
  });
  insert();
  return getDirectorJob(db, jobId);
}

function reconcileRunningJobs(db, { now } = {}) {
  const timestamp = iso(now);
  const rows = db.prepare(`
    SELECT id FROM director_jobs
    WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
  `).all(timestamp);
  if (!rows.length) return 0;
  const update = db.prepare(`
    UPDATE director_jobs
    SET status = 'interrupted', error_code = 'DIRECTOR_INTERRUPTED',
        error_message = 'Job was running when the service restarted', lease_expires_at = NULL, updated_at = ?
    WHERE id = ? AND status = 'running'
  `);
  const transaction = db.transaction(() => rows.forEach((row) => update.run(timestamp, row.id)));
  transaction();
  return rows.length;
}

module.exports = {
  createDirectorJob,
  getDirectorJob,
  startDirectorJob,
  failDirectorJob,
  retryDirectorJob,
  succeedDirectorJob,
  reconcileRunningJobs,
};
