const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const response = require('../response');
const candidateService = require('../director/candidateGroupService');
const jobService = require('../director/directorJobService');
const timelineService = require('../director/timelineService');
const { selectWorkflow } = require('../director/workflowRegistry');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createGenerationBatch(db, {
  shotId,
  workflowId,
  workflowVersion,
  candidateCount,
  prompt,
  inputs,
  maxAttempts,
}) {
  const timestamp = new Date().toISOString();
  const groupId = crypto.randomUUID();
  const jobs = [];
  const create = db.transaction(() => {
    db.prepare(`INSERT INTO director_candidate_groups
      (id, shot_id, status, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)`).run(groupId, String(shotId), timestamp, timestamp);
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const candidateId = crypto.randomUUID();
      const job = jobService.createDirectorJob(db, {
        input: { shotId: String(shotId), groupId, candidateId, candidateIndex, prompt, inputs },
        workflowId,
        workflowVersion,
        maxAttempts,
        now: timestamp,
      });
      db.prepare(`INSERT INTO director_candidates
        (id, group_id, artifact_id, job_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
        .run(candidateId, groupId, `pending-artifact-${job.id}`, job.id, timestamp, timestamp);
      jobs.push(job);
    }
  });
  create();
  return { group: candidateService.getCandidateGroup(db, groupId), jobs };
}

function isFileWithin(rootPath, filePath) {
  try {
    const realRoot = fs.realpathSync(rootPath);
    const realFile = fs.realpathSync(filePath);
    const relative = path.relative(realRoot, realFile);
    return Boolean(relative)
      && !relative.startsWith('..')
      && !path.isAbsolute(relative)
      && fs.statSync(realFile).isFile();
  } catch {
    return false;
  }
}

function routes(db, log, {
  runner = null,
  registry = null,
  allowExperimental = false,
  artifactRoot = path.join(process.cwd(), 'data', 'director-artifacts'),
} = {}) {
  return {
    generateCandidates: (req, res) => {
      try {
        if (!runner || !registry) throw new Error('Director generation is not configured');
        const shotId = req.params.shotId;
        const body = req.body || {};
        if (!shotId) throw new Error('shotId is required');
        if (!body.workflowId) throw new Error('workflowId is required');
        if (!Number.isInteger(body.candidateCount) || body.candidateCount < 1 || body.candidateCount > 3) {
          throw new Error('candidateCount must be an integer from 1 through 3');
        }
        if (!isPlainObject(body.prompt)) throw new Error('prompt must be an object');
        if (body.inputs !== undefined && !isPlainObject(body.inputs)) throw new Error('inputs must be an object');
        const maxAttempts = body.maxAttempts === undefined ? 3 : body.maxAttempts;
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');

        const workflow = selectWorkflow(registry, body.workflowId, { allowExperimental });
        const shot = db.prepare('SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(shotId);
        if (!shot) throw new Error(`Storyboard not found: ${shotId}`);

        const batch = createGenerationBatch(db, {
          shotId,
          workflowId: workflow.id,
          workflowVersion: String(registry.version),
          candidateCount: body.candidateCount,
          prompt: body.prompt,
          inputs: body.inputs || {},
          maxAttempts,
        });
        for (const job of batch.jobs) {
          try {
            runner.enqueue(job.id);
          } catch (error) {
            const updatedAt = new Date().toISOString();
            db.prepare(`UPDATE director_jobs SET status = 'failed', error_code = 'DIRECTOR_QUEUE_ERROR',
              error_message = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
              .run(error.message, updatedAt, job.id);
            candidateService.markCandidateFailed(db, job.id, {
              code: 'DIRECTOR_QUEUE_ERROR', message: error.message,
            }, updatedAt);
          }
        }
        batch.jobs = batch.jobs.map((job) => jobService.getDirectorJob(db, job.id));
        candidateService.finalizeCandidateGroup(db, batch.group.id);
        batch.group = candidateService.getCandidateGroup(db, batch.group.id);
        response.accepted(res, batch);
      } catch (error) {
        log.error('director candidate generation create', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    createCandidates: (req, res) => {
      try {
        const group = candidateService.createCandidateGroup(db, {
          shotId: req.params.shotId,
          candidates: req.body?.candidates || [],
        });
        response.created(res, group);
      } catch (error) {
        log.error('director candidate group create', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    getCandidates: (req, res) => {
      try {
        const group = candidateService.getCandidateGroup(db, req.params.groupId);
        if (!group) return response.notFound(res, 'candidate group not found');
        response.success(res, group);
      } catch (error) {
        log.error('director candidate group get', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    getShotCandidates: (req, res) => {
      try {
        const groups = candidateService.getCandidateGroupsByShot(db, req.params.shotId);
        response.success(res, { groups, latest: groups[0] || null });
      } catch (error) {
        log.error('director shot candidate groups get', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    getArtifactContent: (req, res) => {
      try {
        const artifact = candidateService.getCandidateArtifact(db, req.params.artifactId);
        if (!artifact || artifact.status !== 'ready' || !isFileWithin(artifactRoot, artifact.artifact_path)) {
          return response.notFound(res, 'director artifact not found');
        }
        res.sendFile(artifact.artifact_path);
      } catch (error) {
        log.error('director artifact content get', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    reviewCandidates: (req, res) => {
      try {
        let group = candidateService.getCandidateGroup(db, req.params.groupId);
        if (!group) return response.notFound(res, 'candidate group not found');
        if (group.status === 'pending') {
          group = candidateService.startCandidateGroup(db, group.id);
        }
        if (group.status === 'running') {
          group = candidateService.moveCandidateGroupToReview(db, group.id);
        }
        if (group.status !== 'review') {
          throw new Error(`Candidate group cannot enter review from ${group.status}`);
        }
        response.success(res, group);
      } catch (error) {
        log.error('director candidate group review', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    selectCandidate: (req, res) => {
      try {
        const group = candidateService.selectCandidate(db, req.params.groupId, req.body?.candidateId || req.body?.candidate_id, {
          selectedBy: req.body?.selectedBy || req.body?.selected_by || 'user',
          reason: req.body?.reason || '',
        });
        response.success(res, group);
      } catch (error) {
        log.error('director candidate select', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    getTimeline: (req, res) => {
      try {
        const timeline = timelineService.getTimeline(db, req.params.timelineId);
        if (!timeline) return response.notFound(res, 'timeline not found');
        response.success(res, timeline);
      } catch (error) {
        log.error('director timeline get', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    getJob: (req, res) => {
      try {
        const job = jobService.getDirectorJobDetails(db, req.params.jobId);
        if (!job) return response.notFound(res, 'director job not found');
        response.success(res, job);
      } catch (error) {
        log.error('director job get', { error: error.message });
        response.internalError(res, error.message);
      }
    },
  };
}

module.exports = routes;
