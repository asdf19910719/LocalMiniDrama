const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const response = require('../response');
const candidateService = require('../director/candidateGroupService');
const jobService = require('../director/directorJobService');
const timelineService = require('../director/timelineService');
const { validateSourceDependency } = require('../director/sourceDependency');
const { createContinuityAnchor } = require('../director/continuityAnchorService');
const { analyzeArtifact } = require('../director/directorQualityService');
const { archiveUnreferencedArtifacts, createArtifactBundle, getArtifactUsage, restoreArtifactBundle } = require('../director/directorArtifactLifecycle');
const { assertAllowedLocalPath } = require('../director/directorGovernance');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function legacyPromptText(prompt) {
  if (typeof prompt === 'string') return prompt.trim();
  if (!isPlainObject(prompt)) return '';
  const directorNode = Object.values(prompt).find((node) => node?.class_type === 'MiniMaxH3Director');
  const nodePrompt = String(directorNode?.inputs?.global_prompt || '').trim();
  if (nodePrompt) return nodePrompt;
  return JSON.stringify(prompt);
}

function storyboardContext(db, shotId) {
  try {
    return db.prepare(`SELECT storyboard.*, episode.drama_id
      FROM storyboards storyboard
      LEFT JOIN episodes episode ON episode.id = storyboard.episode_id
      WHERE storyboard.id = ? AND storyboard.deleted_at IS NULL`).get(shotId);
  } catch (_) {
    return db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(shotId);
  }
}

function generationInput(body, { shot, groupId, structured, inputs }) {
  const source = { ...inputs, ...(structured || {}) };
  const prompt = String(structured?.prompt || legacyPromptText(body.prompt) || '').trim();
  if (!prompt) throw new Error('prompt or structured input is required');
  const referenceUrls = source.referenceImageUrls || source.referenceUrls
    || (source.referenceImagePath ? [source.referenceImagePath] : undefined);
  return {
    drama_id: Number(shot.drama_id) || 0,
    storyboard_id: Number(shot.id),
    candidate_group_id: groupId,
    prompt,
    negative_prompt: source.negativePrompt ?? source.negative_prompt ?? null,
    duration: source.durationSeconds ?? source.duration,
    aspect_ratio: source.aspectRatio ?? source.aspect_ratio,
    resolution: source.resolution,
    width: source.width,
    height: source.height,
    frame_rate: source.frameRate ?? source.frame_rate,
    seed: source.seed,
    camera_fixed: source.cameraFixed ?? source.camera_fixed,
    watermark: source.watermark,
    continuity_mode: source.continuityMode ?? source.continuity_mode,
    anchor_id: source.anchorId ?? source.anchor_id,
    image_url: source.imageUrl ?? source.image_url,
    first_frame_url: source.firstFrameUrl ?? source.first_frame_url ?? source.referenceImagePath,
    last_frame_url: source.lastFrameUrl ?? source.last_frame_url,
    reference_image_urls: referenceUrls,
    style: source.style,
  };
}

async function createGenerationBatch(db, videoGenerationService, {
  shot,
  candidateCount,
  body,
  structured,
  inputs,
}) {
  const initial = candidateService.createVideoCandidateGroup(db, {
    shotId: String(shot.id),
    candidateCount,
  });
  const videoGenerations = [];
  try {
    for (const candidate of initial.candidates) {
      const generation = await videoGenerationService.createVideoGeneration(
        generationInput(body, { shot, groupId: initial.id, structured, inputs }),
      );
      videoGenerations.push(generation);
      candidateService.linkCandidateVideoGeneration(db, initial.id, candidate.id, generation.id);
    }
  } catch (error) {
    await Promise.allSettled(videoGenerations.map((generation) => (
      videoGenerationService.cancelVideoGeneration(generation.id)
    )));
    db.transaction(() => {
      db.prepare('DELETE FROM director_candidates WHERE group_id = ?').run(initial.id);
      db.prepare('DELETE FROM director_candidate_groups WHERE id = ?').run(initial.id);
    })();
    throw error;
  }
  return {
    group: candidateService.getCandidateGroup(db, initial.id),
    video_generations: videoGenerations,
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
  videoGenerationService = null,
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
    generateCandidates: async (req, res) => {
      try {
        if (!videoGenerationService?.createVideoGeneration || !videoGenerationService?.cancelVideoGeneration) {
          throw new Error('Director video generation is not configured');
        }
        const shotId = req.params.shotId;
        const body = req.body || {};
        if (!shotId) throw new Error('shotId is required');
        if (!Number.isInteger(body.candidateCount) || body.candidateCount < 1 || body.candidateCount > 3) {
          throw new Error('candidateCount must be an integer from 1 through 3');
        }
        if (body.prompt !== undefined && typeof body.prompt !== 'string' && !isPlainObject(body.prompt)) {
          throw new Error('prompt must be text or an object');
        }
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
        const shot = storyboardContext(db, shotId);
        if (!shot) throw new Error(`Storyboard not found: ${shotId}`);
        const batch = await createGenerationBatch(db, videoGenerationService, {
          shot,
          candidateCount: body.candidateCount,
          body,
          structured,
          inputs,
        });
        response.accepted(res, { ...batch, cacheHit: false, resource: null });
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
    selectCandidate: async (req, res) => {
      try {
        const candidateId = req.body?.candidateId || req.body?.candidate_id;
        const before = candidateService.getCandidateGroup(db, req.params.groupId);
        const candidate = before?.candidates.find((entry) => entry.id === candidateId);
        if (candidate?.video_generation_id != null && !videoGenerationService?.selectVideoGeneration) {
          throw new Error('Director video selection is not configured');
        }
        if (candidate?.video_generation_id != null) {
          if (before.status !== 'review') throw new Error(`Candidate group cannot select from ${before.status}`);
          if (!['review', 'selected'].includes(candidate.status)) throw new Error('Candidate is not selectable');
          await videoGenerationService.selectVideoGeneration(candidate.video_generation_id);
        }
        const group = candidateService.selectCandidate(db, req.params.groupId, candidateId, {
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
        const unifiedCandidate = candidateService.getCandidateByVideoGenerationId(db, req.params.jobId);
        if (unifiedCandidate) {
          if (!videoGenerationService?.cancelVideoGeneration) throw new Error('Director video cancellation is not configured');
          const video = await videoGenerationService.cancelVideoGeneration(unifiedCandidate.video_generation_id);
          candidateService.finalizeCandidateGroup(db, unifiedCandidate.group_id);
          return response.success(res, video);
        }
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
    retryJob: async (req, res) => {
      try {
        const unifiedCandidate = candidateService.getCandidateByVideoGenerationId(db, req.params.jobId);
        if (unifiedCandidate) {
          if (!videoGenerationService?.retryVideoGeneration) throw new Error('Director video retry is not configured');
          const video = await videoGenerationService.retryVideoGeneration(unifiedCandidate.video_generation_id);
          candidateService.getCandidateGroup(db, unifiedCandidate.group_id);
          return response.accepted(res, video);
        }
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
