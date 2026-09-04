const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const response = require('../response');
const candidateService = require('../director/candidateGroupService');
const jobService = require('../director/directorJobService');
const timelineService = require('../director/timelineService');
const { validateSourceDependency } = require('../director/sourceDependency');
const { resolveVoiceReferenceAudios } = require('../director/voiceReference');
const { createContinuityAnchor } = require('../director/continuityAnchorService');
const { analyzeArtifact } = require('../director/directorQualityService');
const { archiveUnreferencedArtifacts, createArtifactBundle, getArtifactUsage, restoreArtifactBundle } = require('../director/directorArtifactLifecycle');
const { assertAllowedLocalPath } = require('../director/directorGovernance');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// H3 草稿门禁错误码:候选接口需把 409 语义(stale/invalid/hash/config)与 code、details
// 原样映射给前端,而不是笼统 400(Task 16 交接④;H3_DRAFT_REQUIRED 等其余走 400)。
const H3_DRAFT_GATE_CODES = new Set([
  'H3_DRAFT_REQUIRED',
  'DRAFT_NOT_FOUND',
  'H3_DRAFT_STORYBOARD_MISMATCH',
  'H3_DRAFT_CONFIG_MISMATCH',
  'H3_DRAFT_WORKFLOW_MISMATCH',
  'H3_DRAFT_STALE',
  'H3_DRAFT_INVALID',
  'H3_DRAFT_HASH_MISMATCH',
]);

function sendH3DraftGateError(res, error) {
  if (!error || !H3_DRAFT_GATE_CODES.has(error.code)) return false;
  response.error(res, Number(error.status) || 400, error.code, error.message, error.details);
  return true;
}

function sendVideoLifecycleError(res, error) {
  if (!error?.code || !/^(?:VIDEO_|WORKFLOW_)/.test(String(error.code))) return false;
  response.error(res, Number(error.status) || 400, error.code, error.message, error.details);
  return true;
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

function resolveReferencePath(value, storageRoot) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let relative = raw;
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/static/')) relative = decodeURIComponent(parsed.pathname.slice('/static/'.length));
  } catch (_) {
    if (relative.startsWith('/static/')) relative = relative.slice('/static/'.length);
  }
  if (relative !== raw || !/^https?:\/\//i.test(raw)) {
    const root = path.resolve(storageRoot);
    const absolute = path.resolve(root, relative.replace(/^[/\\]+/, '').replace(/[\\/]+/g, path.sep));
    const rel = path.relative(root, absolute);
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
  }
  return raw;
}

function collectStoryboardReferenceImages(db, shot, { storageRoot = path.join(process.cwd(), 'data', 'storage') } = {}) {
  if (!shot || !db) return [];
  const refs = [];
  const seen = new Set();
  const resolve = (row) => {
    if (!row) return '';
    const local = String(row.local_path || '').trim();
    if (local) {
      const absolute = path.isAbsolute(local) ? local : path.resolve(storageRoot, local);
      if (fs.existsSync(absolute)) return absolute;
    }
    return resolveReferencePath(row.image_url, storageRoot);
  };
  const add = (row, role) => {
    const imageFile = resolve(row);
    if (!imageFile || seen.has(imageFile)) return;
    seen.add(imageFile);
    refs.push({ imageFile, role });
  };

  try {
    if (shot.scene_id != null) {
      add(db.prepare('SELECT image_url, local_path FROM scenes WHERE id = ? AND deleted_at IS NULL').get(shot.scene_id), 'environment');
    }
  } catch (_) {}

  const characterIds = [];
  try {
    const parsed = shot.characters ? JSON.parse(shot.characters) : [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const id = Number(typeof item === 'object' ? item?.id : item);
        if (Number.isFinite(id)) characterIds.push(id);
      }
    }
  } catch (_) {}
  if (!characterIds.length) {
    try {
      characterIds.push(...db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ? ORDER BY id ASC').all(shot.id).map((r) => Number(r.character_id)).filter(Number.isFinite));
    } catch (_) {}
  }
  for (const id of characterIds) {
    let row = null;
    try { row = db.prepare('SELECT image_url, local_path FROM characters WHERE id = ? AND deleted_at IS NULL').get(id); } catch (_) {}
    if (!row) {
      try { row = db.prepare('SELECT image_url, local_path FROM character_libraries WHERE id = ? AND deleted_at IS NULL').get(id); } catch (_) {}
    }
    add(row, 'subject');
    if (refs.length >= 10) return refs;
  }
  try {
    const props = db.prepare(`SELECT p.image_url, p.local_path FROM storyboard_props sp
      JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
      WHERE sp.storyboard_id = ? ORDER BY sp.prop_id ASC`).all(shot.id);
    for (const row of props) {
      add(row, 'prop');
      if (refs.length >= 10) break;
    }
  } catch (_) {}
  return refs;
}

function generationInput(body, { db, shot, groupId, structured, inputs, storageRoot }) {
  const source = { ...inputs, ...(structured || {}) };
  const prompt = String(structured?.prompt || legacyPromptText(body.prompt) || '').trim();
  if (!prompt) throw new Error('prompt or structured input is required');
  const explicitRefs = source.referenceImageUrls || source.referenceUrls || source.reference_image_urls || source.reference_urls
    || (source.referenceImagePath ? [source.referenceImagePath] : undefined);
  const explicitList = Array.isArray(explicitRefs) ? explicitRefs : (explicitRefs ? [explicitRefs] : []);
  const collectedRefs = explicitList.length ? explicitList : collectStoryboardReferenceImages(db, shot, { storageRoot });
  const referenceUrls = Array.isArray(collectedRefs)
    ? collectedRefs.map((ref) => resolveReferencePath(typeof ref === 'object' ? ref.imageFile : ref, storageRoot)).filter(Boolean)
    : collectedRefs;
  const model = structured?.model ?? inputs?.model ?? body.model;
  const workflowId = structured?.workflowId ?? inputs?.workflowId ?? body.workflowId;
  const workflowIdSnake = structured?.workflow_id ?? inputs?.workflow_id ?? body.workflow_id;
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
    ...(structured && structured.useVoiceReference ? { reference_audios: resolveVoiceReferenceAudios(db, Number(shot.id), storageRoot) } : {}),
    ...(model != null && String(model).trim() ? { model } : {}),
    ...(workflowId != null && String(workflowId).trim() ? { workflowId } : {}),
    ...(workflowIdSnake != null && String(workflowIdSnake).trim() ? { workflow_id: workflowIdSnake } : {}),
    ...(source.generationMode || source.generation_mode ? { generation_mode: source.generationMode ?? source.generation_mode } : {}),
    // H3 草稿门禁(spec §11.4):候选接口只提交草稿 id,由 unified 服务重算指纹后消费草稿文本。
    ...(source.h3PromptDraftId || source.h3_prompt_draft_id
      ? { h3_prompt_draft_id: source.h3PromptDraftId ?? source.h3_prompt_draft_id }
      : {}),
    style: source.style,
  };
}

function ensureBatchVideoTerminal(db, videoGenerationId) {
  const row = db.prepare('SELECT id, status, task_id FROM video_generations WHERE id = ?')
    .get(Number(videoGenerationId));
  if (!row || !['waiting', 'queued', 'running', 'processing'].includes(row.status)) return;
  const now = new Date().toISOString();
  const error = JSON.stringify({
    code: 'DIRECTOR_BATCH_COMPENSATED',
    message: 'Director candidate batch creation was rolled back',
    stage: 'cancel',
    details: { reason: 'candidate_batch_failed' },
  });
  db.transaction(() => {
    db.prepare(`UPDATE video_generations SET status = 'cancelled', error_msg = ?,
      completed_at = ?, updated_at = ? WHERE id = ?
      AND status IN ('waiting', 'queued', 'running', 'processing')`)
      .run(error, now, now, row.id);
    if (row.task_id) {
      db.prepare(`UPDATE async_tasks SET status = 'failed', progress = 100, error = ?,
        completed_at = ?, updated_at = ? WHERE id = ?`)
        .run(error, now, now, row.task_id);
    }
  })();
}

async function createGenerationBatch(db, videoGenerationService, {
  shot,
  candidateCount,
  body,
  structured,
  inputs,
  storageRoot,
}) {
  const initial = candidateService.createVideoCandidateGroup(db, {
    shotId: String(shot.id),
    candidateCount,
  });
  const videoGenerations = [];
  try {
    for (const candidate of initial.candidates) {
      const generation = await videoGenerationService.createVideoGeneration(
        generationInput(body, { db, shot, groupId: initial.id, structured, inputs, storageRoot }),
      );
      videoGenerations.push(generation);
      candidateService.linkCandidateVideoGeneration(db, initial.id, candidate.id, generation.id);
    }
  } catch (error) {
    await Promise.allSettled(videoGenerations.map((generation) => (
      videoGenerationService.cancelVideoGeneration(generation.id)
    )));
    for (const generation of videoGenerations) ensureBatchVideoTerminal(db, generation.id);
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
  const roots = Array.isArray(rootPath) ? rootPath : [rootPath];
  if (!roots.length) return false;
  try {
    const realFile = fs.realpathSync(filePath);
    if (!fs.statSync(realFile).isFile()) return false;
    return roots.some((root) => {
      const realRoot = fs.realpathSync(root);
      const relative = path.relative(realRoot, realFile);
      return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
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
  storageRoot = path.join(process.cwd(), 'data', 'storage'),
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
          storageRoot,
        });
        response.accepted(res, { ...batch, cacheHit: false, resource: null });
      } catch (error) {
        log.error('director candidate generation create', { error: error.message });
        if (sendH3DraftGateError(res, error)) return;
        if (sendVideoLifecycleError(res, error)) return;
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
        if (!artifact || artifact.status !== 'ready' || !isFileWithin([artifactRoot, storageRoot], artifact.artifact_path)) {
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
        const selection = candidateService.getCandidateSelectionState(db, req.params.groupId, candidateId);
        const candidate = selection?.candidate;
        if (candidate?.video_generation_id != null && !videoGenerationService?.selectVideoGeneration) {
          throw new Error('Director video selection is not configured');
        }
        if (candidate?.video_generation_id != null) {
          if (selection.group_status !== 'review') {
            throw new Error(`Candidate group cannot select from ${selection.group_status}`);
          }
          if (!['review', 'selected'].includes(selection.candidate_status)) throw new Error('Candidate is not selectable');
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
module.exports.collectStoryboardReferenceImages = collectStoryboardReferenceImages;
module.exports.generationInput = generationInput;
