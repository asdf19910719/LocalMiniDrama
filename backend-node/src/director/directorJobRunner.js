const {
  getDirectorJob,
  startDirectorJob,
  failDirectorJob,
  succeedDirectorJob,
} = require('./directorJobService');
const {
  finalizeCandidateGroup,
  markCandidateFailed,
} = require('./candidateGroupService');

function candidateForJob(db, jobId) {
  return db.prepare('SELECT * FROM director_candidates WHERE job_id = ?').get(jobId) || null;
}

async function runDirectorJob(db, jobId, {
  service,
  comfyClient,
  gpuMutex,
  registry,
  leaseMs,
  now,
} = {}) {
  const client = service || comfyClient;
  if (!client || typeof client.runWorkflow !== 'function') throw new Error('Director runner requires a ComfyUI client');
  if (!gpuMutex) throw new Error('Director runner requires a GPU mutex');

  const job = startDirectorJob(db, jobId, { leaseMs, now });
  const candidate = candidateForJob(db, jobId);
  if (!candidate) {
    const error = new Error(`Director candidate not found for job: ${jobId}`);
    failDirectorJob(db, jobId, { code: 'DIRECTOR_CANDIDATE_NOT_FOUND', message: error.message }, now);
    throw error;
  }

  db.prepare("UPDATE director_candidate_groups SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(job.updated_at, candidate.group_id);
  db.prepare("UPDATE director_candidates SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(job.updated_at, candidate.id);

  let lease;
  try {
    lease = gpuMutex.acquire(jobId, { leaseMs });
    const result = await client.runWorkflow({
      registry,
      ...job.input,
      workflowId: job.workflow_id,
      outputFileName: `${jobId}.mp4`,
    });
    const completed = succeedDirectorJob(db, jobId, {
      artifactPath: result.artifactPath,
      kind: 'video',
      ffprobe: result.ffprobe || null,
      metadata: {
        promptId: result.promptId,
        queue: result.queue,
        history: result.history,
        pollTimestamps: result.pollTimestamps,
        workflowId: result.workflowId,
        workflowSha256: result.workflowSha256,
      },
      now,
    });
    db.prepare(`UPDATE director_candidates
      SET artifact_id = ?, status = 'succeeded', error_code = NULL, error_message = NULL, updated_at = ?
      WHERE id = ?`).run(completed.artifact_id, completed.updated_at, candidate.id);
    finalizeCandidateGroup(db, candidate.group_id, now);
    return completed;
  } catch (error) {
    const current = getDirectorJob(db, jobId);
    if (current?.status === 'running') {
      failDirectorJob(db, jobId, {
        code: error.code || 'DIRECTOR_JOB_FAILED',
        message: error.message || String(error),
      }, now);
    }
    markCandidateFailed(db, jobId, error, now);
    finalizeCandidateGroup(db, candidate.group_id, now);
    throw error;
  } finally {
    if (lease) gpuMutex.release(lease);
  }
}

function createDirectorJobRunner(dependencies = {}) {
  const { db, logger = console } = dependencies;
  if (!db) throw new Error('Director runner requires a database');
  let tail = Promise.resolve();

  function enqueue(jobId) {
    tail = tail.then(() => runDirectorJob(db, jobId, dependencies)).catch((error) => {
      logger.error?.('director job failed', { jobId, error: error.message });
    });
    return jobId;
  }

  function drain() {
    return tail;
  }

  return { enqueue, drain };
}

module.exports = { createDirectorJobRunner, runDirectorJob };
