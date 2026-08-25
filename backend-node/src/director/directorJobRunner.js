const {
  getDirectorJob,
  startDirectorJob,
  cancelDirectorJob,
  failDirectorJob,
  succeedDirectorJob,
} = require('./directorJobService');
const {
  finalizeCandidateGroup,
  markCandidateFailed,
} = require('./candidateGroupService');
const { createGovernanceSnapshot } = require('./directorGovernance');

function candidateForJob(db, jobId) {
  return db.prepare('SELECT * FROM director_candidates WHERE job_id = ?').get(jobId) || null;
}

async function runDirectorJob(db, jobId, {
  comfyClient,
  gpuMutex,
  registry,
  leaseMs,
  now,
  onPromptSubmitted,
  isCancelled = () => false,
} = {}) {
  if (!comfyClient || typeof comfyClient.runWorkflow !== 'function') throw new Error('Director runner requires a ComfyUI client');
  if (!gpuMutex) throw new Error('Director runner requires a GPU mutex');

  const job = startDirectorJob(db, jobId, { leaseMs, now });
  const candidate = candidateForJob(db, jobId);
  if (!candidate) {
    const error = new Error(`Director candidate not found for job: ${jobId}`);
    failDirectorJob(db, jobId, { code: 'DIRECTOR_CANDIDATE_NOT_FOUND', message: error.message }, now);
    throw error;
  }
  if (candidate.video_generation_id != null) {
    const error = new Error('Unified video candidates cannot run through the legacy Director runner');
    error.code = 'DIRECTOR_UNIFIED_VIDEO_REQUIRED';
    failDirectorJob(db, jobId, { code: error.code, message: error.message }, now);
    throw error;
  }

  db.prepare("UPDATE director_candidate_groups SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(job.updated_at, candidate.group_id);
  db.prepare("UPDATE director_candidates SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(job.updated_at, candidate.id);

  let lease;
  try {
    lease = gpuMutex.acquire(jobId, { leaseMs });
    const result = await comfyClient.runWorkflow({
      registry,
      ...job.input,
      workflowId: job.workflow_id,
      outputFileName: `${jobId}.mp4`,
      onSubmitted: (promptId) => {
        onPromptSubmitted?.(jobId, promptId);
        if (isCancelled()) {
          Promise.resolve(comfyClient.cancel?.(promptId)).catch(() => {});
          const error = new Error('Cancelled before ComfyUI submission completed');
          error.code = 'DIRECTOR_CANCELLED';
          throw error;
        }
      },
    });
    const workflow = registry?.workflows?.find((entry) => entry.id === job.workflow_id);
    const governance = workflow ? createGovernanceSnapshot(workflow) : null;
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
        ...(governance && { governance }),
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
  const cancelled = new Set();
  const queuedJobIds = [];
  const activePromptIds = new Map();
  let activeJobId = null;

  function enqueue(jobId) {
    cancelled.delete(jobId);
    queuedJobIds.push(jobId);
    tail = tail.then(async () => {
      const index = queuedJobIds.indexOf(jobId);
      if (index >= 0) queuedJobIds.splice(index, 1);
      if (cancelled.has(jobId)) return null;
      activeJobId = jobId;
      try {
        return await runDirectorJob(db, jobId, {
          ...dependencies,
          onPromptSubmitted: (submittedJobId, promptId) => activePromptIds.set(submittedJobId, promptId),
          isCancelled: () => cancelled.has(jobId),
        });
      } finally {
        activePromptIds.delete(jobId);
        activeJobId = null;
      }
    }).catch((error) => {
      logger.error?.('director job failed', { jobId, error: error.message });
    });
    return jobId;
  }

  async function cancel(jobId) {
    cancelled.add(jobId);
    const index = queuedJobIds.indexOf(jobId);
    if (index >= 0) queuedJobIds.splice(index, 1);
    cancelDirectorJob(db, jobId, dependencies.now);
    const promptId = activePromptIds.get(jobId);
    if (promptId && typeof dependencies.comfyClient?.cancel === 'function') {
      await dependencies.comfyClient.cancel(promptId);
    }
    return jobId;
  }

  function snapshot() {
    return { activeJobId, queuedJobIds: [...queuedJobIds], queueLength: queuedJobIds.length };
  }

  function drain() {
    return tail;
  }

  return { enqueue, cancel, drain, snapshot };
}

module.exports = { createDirectorJobRunner, runDirectorJob };
