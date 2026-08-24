const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const response = require('../response');
const candidateService = require('../director/candidateGroupService');
const jobService = require('../director/directorJobService');
const timelineService = require('../director/timelineService');
const { selectWorkflow, readWorkflowTemplate, buildStructuredWorkflowPrompt } = require('../director/workflowRegistry');
const { validateSourceDependency } = require('../director/sourceDependency');
const { createContinuityAnchor } = require('../director/continuityAnchorService');
const { analyzeArtifact } = require('../director/directorQualityService');
const { createGenerationCacheKey, validateVramBudget } = require('../director/directorGenerationPolicy');
const { archiveUnreferencedArtifacts, createArtifactBundle, getArtifactUsage, restoreArtifactBundle } = require('../director/directorArtifactLifecycle');
const { assertAllowedLocalPath } = require('../director/directorGovernance');

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
  cacheKey,
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
        input: { shotId: String(shotId), groupId, candidateId, candidateIndex, prompt, inputs, cacheKey },
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

function findCachedGenerationBatch(db, cacheKey) {
  const rows = db.prepare(`SELECT job.id, job.input_json, job.created_at, candidate.group_id
    FROM director_jobs job
    JOIN director_candidates candidate ON candidate.job_id = job.id
    JOIN director_candidate_groups group_row ON group_row.id = candidate.group_id
    WHERE group_row.status IN ('pending', 'running', 'review', 'selected')
    ORDER BY job.created_at DESC`).all();
  const match = rows.find((row) => {
    try { return JSON.parse(row.input_json || '{}').cacheKey === cacheKey; } catch { return false; }
  });
  if (!match) return null;
  return {
    group: candidateService.getCandidateGroup(db, match.group_id),
    jobs: rows.filter((row) => row.group_id === match.group_id).map((row) => jobService.getDirectorJob(db, row.id)),
    cacheHit: true,
  };
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
  allowedLocalRoots = [artifactRoot],
  ffmpegPath = 'ffmpeg',
  timelineRenderer = null,
  anchorCreator = createContinuityAnchor,
  qualityAnalyzer = analyzeArtifact,
} = {}) {
  return {
    getQueue: (_req, res) => {
      const snapshot = runner?.snapshot ? runner.snapshot() : { activeJobId: null, queuedJobIds: [], queueLength: 0 };
      response.success(res, snapshot);
    },
    getStorage: (_req, res) => response.success(res, getArtifactUsage(db)),
    cleanupStorage: (req, res) => {
      try {
        const usage = getArtifactUsage(db);
        const targetBytes = Number(req.body?.targetBytes ?? Math.floor(usage.quotaBytes * 0.8));
        response.success(res, archiveUnreferencedArtifacts(db, {
          artifactRoot, targetBytes, dryRun: Boolean(req.body?.dryRun),
        }));
      } catch (error) {
        log.error('director storage cleanup', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    createBundle: (req, res) => {
      try {
        const bundleName = `director-bundle-${Date.now()}.zip`;
        const result = createArtifactBundle(db, {
          artifactIds: req.body?.artifactIds || [],
          artifactRoot,
          outputPath: path.join(artifactRoot, 'bundles', bundleName),
        });
        response.created(res, { ...result, outputPath: undefined, bundleName });
      } catch (error) {
        log.error('director bundle create', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    restoreBundle: (req, res) => {
      try {
        const bundleName = path.basename(String(req.body?.bundleName || ''));
        if (!bundleName || bundleName !== req.body?.bundleName) throw new Error('bundleName is invalid');
        const result = restoreArtifactBundle({
          db,
          bundlePath: path.join(artifactRoot, 'bundles', bundleName),
          restoreRoot: path.join(artifactRoot, 'restored', path.basename(bundleName, '.zip')),
        });
        response.success(res, result);
      } catch (error) {
        log.error('director bundle restore', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
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
        if (body.prompt !== undefined && !isPlainObject(body.prompt)) throw new Error('prompt must be an object');
        if (body.structured !== undefined && !isPlainObject(body.structured)) throw new Error('structured must be an object');
        if (body.inputs !== undefined && !isPlainObject(body.inputs)) throw new Error('inputs must be an object');
        const maxAttempts = body.maxAttempts === undefined ? 3 : body.maxAttempts;
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');

        const inputs = { ...(body.inputs || {}) };
        if (body.structured?.continuityMode) inputs.continuityMode = body.structured.continuityMode;
        if (body.structured?.sourceArtifactId) inputs.sourceArtifactId = body.structured.sourceArtifactId;
        if (body.structured?.anchorId) inputs.anchorId = body.structured.anchorId;
        if (body.sourceArtifactId) inputs.sourceArtifactId = body.sourceArtifactId;
        if (body.sourceCandidateId) inputs.sourceCandidateId = body.sourceCandidateId;
        validateSourceDependency(db, inputs);

        const workflow = selectWorkflow(registry, body.workflowId, { allowExperimental });
        let structured = body.structured;
        if (structured?.anchorId) {
          const anchor = db.prepare(`SELECT anchor.*, artifact.artifact_path, artifact.status AS artifact_status
            FROM director_anchors anchor JOIN director_artifacts artifact ON artifact.id = anchor.derived_artifact_id
            WHERE anchor.id = ?`).get(structured.anchorId);
          if (!anchor || anchor.artifact_status !== 'ready') throw new Error('continuity anchor is not ready');
          if (inputs.sourceArtifactId && String(anchor.source_artifact_id) !== String(inputs.sourceArtifactId)) {
            throw new Error('continuity anchor does not belong to the selected source artifact');
          }
          structured = {
            ...structured,
            referenceImagePath: anchor.artifact_path,
            referenceRole: anchor.reference_role,
          };
        }
        const prompt = body.prompt || (body.structured
          ? buildStructuredWorkflowPrompt(readWorkflowTemplate(workflow.workflowPath), structured)
          : null);
        if (!isPlainObject(prompt)) throw new Error('prompt or structured input is required');
        const shot = db.prepare('SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(shotId);
        if (!shot) throw new Error(`Storyboard not found: ${shotId}`);
        const resource = body.structured
          ? validateVramBudget({ width: body.structured.width, height: body.structured.height })
          : null;
        const cacheKey = createGenerationCacheKey({
          shotId: String(shotId), workflowId: workflow.id, workflowSha256: workflow.workflowSha256,
          candidateCount: body.candidateCount, prompt, inputs,
        });
        const cached = findCachedGenerationBatch(db, cacheKey);
        if (cached) return response.accepted(res, { ...cached, resource });

        const batch = createGenerationBatch(db, {
          shotId,
          workflowId: workflow.id,
          workflowVersion: String(registry.version),
          candidateCount: body.candidateCount,
          prompt,
          inputs,
          maxAttempts,
          cacheKey,
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
        response.accepted(res, { ...batch, cacheHit: false, resource });
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
        const shot = db.prepare('SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(req.params.shotId);
        if (!shot) return response.notFound(res, 'storyboard not found');
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
    createTimeline: (req, res) => {
      try {
        const body = req.body || {};
        const timeline = timelineService.validateTimeline(db, {
          version: body.version || 'timeline_v1',
          output: body.output || {},
          clips: body.clips || [],
          audioSources: body.audioSources || [],
          audioPolicy: body.audioPolicy || 'mix',
          allowedLocalRoots,
        });
        const requestedPath = body.outputPath || path.join(artifactRoot, `timeline-${Date.now()}.mp4`);
        const unresolvedOutputPath = path.isAbsolute(requestedPath) ? requestedPath : path.join(artifactRoot, requestedPath);
        const outputPath = assertAllowedLocalPath(unresolvedOutputPath, allowedLocalRoots, { mustExist: false });
        let postproduction = null;
        if (body.postproduction) {
          postproduction = { ...body.postproduction };
          for (const key of ['inputPath', 'subtitlePath', 'musicPath', 'ttsPath']) {
            if (postproduction[key]) {
              postproduction[key] = assertAllowedLocalPath(postproduction[key], allowedLocalRoots, { mustExist: true });
            }
          }
          if (postproduction.outputPath) {
            postproduction.outputPath = assertAllowedLocalPath(postproduction.outputPath, allowedLocalRoots, { mustExist: false });
          }
        }
        const row = timelineService.createTimeline(db, timeline, {
          outputPath,
          ffmpegPath,
          postproduction,
        });
        response.created(res, row);
      } catch (error) {
        log.error('director timeline create', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    renderTimeline: async (req, res) => {
      try {
        const renderer = timelineRenderer || (async (timelineId) => {
          const videoMergeService = require('../services/videoMergeService');
          return videoMergeService.processDirectorTimeline(db, log, timelineId);
        });
        const result = await renderer(req.params.timelineId);
        if (!result) return response.notFound(res, 'timeline not found');
        response.accepted(res, result);
      } catch (error) {
        log.error('director timeline render', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    createAnchor: async (req, res) => {
      try {
        const body = req.body || {};
        const anchor = await anchorCreator(db, {
          artifactId: body.artifactId,
          frameNumber: Number(body.frameNumber),
          referenceRole: body.referenceRole,
          referenceUse: body.referenceUse || 'state_anchor',
          promptLabel: body.promptLabel || null,
          isFirstFrame: Boolean(body.isFirstFrame),
          operation: body.operation || 'extract_frame',
          parameters: body.parameters || {},
          outputDir: artifactRoot,
        });
        response.created(res, anchor);
      } catch (error) {
        log.error('director anchor create', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    listAnchors: (req, res) => {
      try {
        const rows = db.prepare(`SELECT anchor.*, artifact.status AS derived_status,
          artifact.sha256 AS derived_sha256, artifact.file_size AS derived_file_size
          FROM director_anchors anchor
          LEFT JOIN director_artifacts artifact ON artifact.id = anchor.derived_artifact_id
          WHERE anchor.source_artifact_id = ? ORDER BY anchor.created_at DESC`).all(req.params.artifactId);
        response.success(res, rows.map((row) => ({
          ...row,
          preview_url: row.derived_status === 'ready'
            ? `/api/v1/director/artifacts/${row.derived_artifact_id}/content`
            : null,
        })));
      } catch (error) {
        log.error('director anchors list', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    analyzeArtifact: async (req, res) => {
      try {
        const artifact = candidateService.getCandidateArtifact(db, req.params.artifactId);
        if (!artifact || artifact.status !== 'ready') return response.notFound(res, 'director artifact not found');
        assertAllowedLocalPath(artifact.artifact_path, allowedLocalRoots, { mustExist: true, kind: 'file' });
        const actualHash = crypto.createHash('sha256').update(fs.readFileSync(artifact.artifact_path)).digest('hex');
        if (!artifact.sha256 || actualHash !== artifact.sha256) throw new Error('Director artifact hash does not match persisted evidence');
        const quality = await qualityAnalyzer({ artifactPath: artifact.artifact_path, ffprobe: artifact.ffprobe || {} });
        const manifest = artifact.manifest || {};
        manifest.qualityReview = { ...quality, artifactSha256: actualHash, analyzedAt: new Date().toISOString() };
        db.prepare('UPDATE director_artifacts SET manifest_json = ? WHERE id = ?')
          .run(JSON.stringify(manifest), req.params.artifactId);
        response.success(res, quality);
      } catch (error) {
        log.error('director artifact quality analyze', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    cancelJob: async (req, res) => {
      try {
        const job = jobService.cancelDirectorJob(db, req.params.jobId);
        if (runner?.cancel) await runner.cancel(req.params.jobId);
        const candidate = db.prepare('SELECT group_id FROM director_candidates WHERE job_id = ?').get(req.params.jobId);
        if (candidate) {
          candidateService.markCandidateFailed(db, req.params.jobId, {
            code: 'DIRECTOR_CANCELLED', message: 'Cancelled by user',
          });
          candidateService.finalizeCandidateGroup(db, candidate.group_id);
        }
        response.success(res, jobService.getDirectorJobDetails(db, req.params.jobId));
      } catch (error) {
        log.error('director job cancel', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    retryJob: (req, res) => {
      try {
        const job = jobService.retryDirectorJob(db, req.params.jobId);
        const candidate = db.prepare('SELECT group_id, id FROM director_candidates WHERE job_id = ?').get(req.params.jobId);
        if (candidate) {
          const now = new Date().toISOString();
          db.prepare(`UPDATE director_candidates SET status = 'pending', error_code = NULL,
            error_message = NULL, updated_at = ? WHERE id = ?`).run(now, candidate.id);
          db.prepare(`UPDATE director_candidate_groups SET status = 'pending', updated_at = ?
            WHERE id = ? AND status IN ('failed', 'review')`).run(now, candidate.group_id);
        }
        try {
          if (runner?.enqueue) runner.enqueue(req.params.jobId);
        } catch (enqueueError) {
          const updatedAt = new Date().toISOString();
          db.prepare(`UPDATE director_jobs SET status = 'failed', error_code = 'DIRECTOR_QUEUE_ERROR',
            error_message = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
            .run(enqueueError.message, updatedAt, req.params.jobId);
          candidateService.markCandidateFailed(db, req.params.jobId, {
            code: 'DIRECTOR_QUEUE_ERROR', message: enqueueError.message,
          }, updatedAt);
          candidateService.finalizeCandidateGroup(db, candidate.group_id, updatedAt);
        }
        response.accepted(res, jobService.getDirectorJobDetails(db, req.params.jobId));
      } catch (error) {
        log.error('director job retry', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
  };
}

module.exports = routes;
