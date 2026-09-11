'use strict';
const express = require('express');
const response = require('../response');

/**
 * V2.1 Production Studio 路由（挂载于 /api/v2，Phase 1–5 为影子交付）。
 * 各领域服务在此薄封装为 HTTP handler；业务规则一律在 service 层并有其测试。
 */
function createV21Router({ db, cfg, log }) {
  const r = express.Router();
  const { createProjectService } = require('./projects/projectService.js');
  const projects = createProjectService(db, { log });

  const wrap = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err && err.code && err.status) {
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
      } else {
        log.error?.('v2 route error', { path: req.path, error: err.message });
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    }
  };

  // ---- 项目 ----
  r.get('/projects', wrap((req, res) => {
    response.success(res, projects.listProjects(req.query || {}));
  }));
  r.post('/projects', wrap((req, res) => {
    response.created(res, projects.createProject(req.body || {}));
  }));
  r.get('/projects/:id/overview', wrap((req, res) => {
    response.success(res, projects.getOverview(req.params.id));
  }));
  r.patch('/projects/:id', wrap((req, res) => {
    response.success(res, projects.updateProfile(req.params.id, req.body || {}));
  }));
  r.put('/projects/:id/style', wrap((req, res) => {
    response.success(res, projects.applyStyle(req.params.id, req.body || {}));
  }));
  r.delete('/projects/:id', wrap((req, res) => {
    response.success(res, projects.softDeleteProject(req.params.id));
  }));
  r.post('/projects/:id/restore', wrap((req, res) => {
    response.success(res, projects.restoreProject(req.params.id));
  }));

  // ---- 剧集中心（Task 2.2 起逐步注册） ----
  const { createEpisodeCenterService } = require('./episodes/episodeCenterService.js');
  const episodes = createEpisodeCenterService(db, { log });
  r.get('/projects/:id/episodes', wrap((req, res) => {
    response.success(res, episodes.listEpisodes(req.params.id, req.query || {}));
  }));
  r.post('/projects/:id/episodes', wrap((req, res) => {
    response.created(res, episodes.createEpisode(req.params.id, req.body || {}));
  }));
  r.get('/projects/:id/episodes/blank', wrap((req, res) => {
    response.success(res, episodes.listBlankEpisodes(req.params.id));
  }));
  r.patch('/episodes/:episodeId', wrap((req, res) => {
    response.success(res, episodes.renameEpisode(req.params.episodeId, req.body || {}));
  }));
  r.post('/episodes/:episodeId/copy-draft', wrap((req, res) => {
    response.created(res, episodes.copyDraftEpisode(req.params.episodeId));
  }));
  r.put('/projects/:id/episodes/order', wrap((req, res) => {
    response.success(res, episodes.reorderEpisodes(req.params.id, req.body || {}));
  }));
  r.get('/episodes/:episodeId', wrap((req, res) => {
    response.success(res, episodes.getEpisode(req.params.episodeId));
  }));
  r.get('/episodes/:episodeId/delete-impact', wrap((req, res) => {
    response.success(res, episodes.getDeleteImpact(req.params.episodeId));
  }));
  r.delete('/episodes/:episodeId', wrap((req, res) => {
    response.success(res, episodes.softDeleteEpisode(req.params.episodeId));
  }));
  r.post('/episodes/:episodeId/restore', wrap((req, res) => {
    response.success(res, episodes.restoreEpisode(req.params.episodeId));
  }));
  r.get('/episodes/:episodeId/import-source', wrap((req, res) => {
    response.success(res, episodes.getImportSource(req.params.episodeId));
  }));
  r.get('/episodes/:episodeId/blank-status', wrap((req, res) => {
    response.success(res, episodes.getBlankStatus(req.params.episodeId));
  }));

  // ---- 导入 / 协作（Task 2.3）----
  // 直接 V2.1 JSON 制作包导入（外部 AI 结果走 /external-ai/tasks/:id/*，同一五步引擎）
  const { createEpisodeImportV21 } = require('./import/episodeImportV21.js');
  const importV21 = createEpisodeImportV21(db, { log });
  r.post('/projects/:id/episodes/import-v21/preview', wrap((req, res) => {
    const { pkg, dramaId, targetEpisodeId, sourceFilename, sourceSha256 } = req.body || {};
    response.success(res, importV21.buildImportPlan(db, pkg, {
      dramaId: dramaId || req.params.id,
      targetEpisodeId: targetEpisodeId || null,
      sourceFilename,
      sourceSha256,
    }));
  }));
  r.post('/projects/:id/episodes/import-v21/confirm', wrap((req, res) => {
    const { pkg, targetEpisodeId, sourceFilename, sourceSha256, decisions } = req.body || {};
    response.created(res, importV21.confirmImport(db, {
      pkg,
      dramaId: req.params.id,
      targetEpisodeId: targetEpisodeId || null,
      sourceFilename,
      sourceSha256,
      decisions,
    }));
  }));

  // 小说/长文本拆集（B2）：预览（建议集号+冲突标注）→ 确认逐集创建草稿（零媒体任务）
  const { createNovelSplitService } = require('./import/novelSplitService.js');
  const novelSplit = createNovelSplitService({ db, log });
  r.post('/projects/:id/episodes/import-novel/preview', wrap((req, res) => {
    const text = String(req.body?.text || '');
    if (!text.trim()) throw Object.assign(new Error('请提供小说文本'), { status: 400, code: 'VALIDATION_ERROR' });
    response.success(res, novelSplit.preview(text, {
      maxChapters: Number(req.body?.maxChapters) || 20,
      startNumber: req.body?.startNumber,
      dramaId: req.params.id,
    }));
  }));
  r.post('/projects/:id/episodes/import-novel/confirm', wrap((req, res) => {
    const text = String(req.body?.text || '');
    if (!text.trim()) throw Object.assign(new Error('请提供小说文本'), { status: 400, code: 'VALIDATION_ERROR' });
    response.created(res, novelSplit.confirm(text, {
      title: req.body?.title || '',
      maxChapters: Number(req.body?.maxChapters) || 20,
      startNumber: req.body?.startNumber,
      dramaId: req.params.id,
    }));
  }));

  // 从已有视频开始剪辑：登记来源媒体（零生成、零费用）。
  // episodeId 必传且服务端校验（存在 / 属于该项目 / 未软删）；可选 sha256（64 位十六进制）、
  // fileSize（正整数，字节）、mediaInfo 写入 assets：file_size 列 + source_meta JSON（Task 4.7）。
  r.post('/projects/:id/episodes/source-video', wrap((req, res) => {
    const { episodeId, name, url, localPath, fileSize, mimeType, sha256, mediaInfo } = req.body || {};
    if (!name || (!url && !localPath)) {
      throw Object.assign(new Error('需要提供媒体名称与文件路径或 URL'), { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (episodeId === undefined || episodeId === null || episodeId === '') {
      throw Object.assign(new Error('需要提供目标剧集 episodeId'), { status: 400, code: 'VALIDATION_ERROR' });
    }
    const targetEpisodeId = Number(episodeId);
    if (!Number.isInteger(targetEpisodeId) || targetEpisodeId <= 0) {
      throw Object.assign(new Error('episodeId 需为正整数'), { status: 400, code: 'VALIDATION_ERROR' });
    }
    const episode = db
      .prepare('SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL')
      .get(targetEpisodeId);
    if (!episode) {
      throw Object.assign(new Error('目标剧集不存在或已删除'), { status: 404, code: 'NOT_FOUND' });
    }
    if (episode.drama_id !== Number(req.params.id)) {
      throw Object.assign(new Error('目标剧集不属于该项目'), { status: 400, code: 'VALIDATION_ERROR' });
    }
    let sha256Norm = null;
    if (sha256 !== undefined && sha256 !== null && String(sha256).trim() !== '') {
      sha256Norm = String(sha256).trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha256Norm)) {
        throw Object.assign(new Error('sha256 需为 64 位十六进制字符串'), { status: 400, code: 'VALIDATION_ERROR' });
      }
    }
    let fileSizeNorm = null;
    if (fileSize !== undefined && fileSize !== null && fileSize !== '') {
      fileSizeNorm = Number(fileSize);
      if (!Number.isInteger(fileSizeNorm) || fileSizeNorm <= 0) {
        throw Object.assign(new Error('fileSize 需为正整数'), { status: 400, code: 'VALIDATION_ERROR' });
      }
    }
    const mediaInfoNorm =
      mediaInfo === undefined || mediaInfo === null || String(mediaInfo).trim() === ''
        ? null
        : String(mediaInfo).trim();
    const now = new Date().toISOString();
    const sourceMeta = JSON.stringify({ sha256: sha256Norm, mediaInfo: mediaInfoNorm, episodeId: targetEpisodeId });
    const info = db
      .prepare(
        `INSERT INTO assets (drama_id, name, type, category, url, local_path, file_size, mime_type, source_meta, created_at, updated_at)
         VALUES (?, ?, 'video', 'source-video', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.params.id, name, url || null, localPath || null, fileSizeNorm, mimeType || null, sourceMeta, now, now);
    response.created(res, {
      assetId: Number(info.lastInsertRowid),
      episodeId: targetEpisodeId,
      sha256: sha256Norm,
      fileSize: fileSizeNorm,
      mediaInfo: mediaInfoNorm,
      note: '来源媒体已登记；默认只读引用原文件，可进入短片时间线，不自动生成镜头。',
    });
  }));

  // ---- 剧本阶段（Task 3.1） ----
  const { createScriptService } = require('./script/scriptService.js');
  const script = createScriptService(db, { log });
  r.get('/episodes/:episodeId/script', wrap((req, res) => {
    response.success(res, script.getStageModel(req.params.episodeId));
  }));
  r.put('/episodes/:episodeId/script/draft', wrap((req, res) => {
    response.success(res, script.saveDraft(req.params.episodeId, req.body || {}));
  }));
  r.post('/episodes/:episodeId/script/parse-scenes', wrap((req, res) => {
    response.success(res, { scenes: script.parseScenes(req.params.episodeId) });
  }));
  r.post('/episodes/:episodeId/script/ai-candidate', wrap((req, res) => {
    response.created(res, script.generateAiCandidate(req.params.episodeId, req.body || {}));
  }));
  r.post('/episodes/:episodeId/script/ai-candidate/apply', wrap((req, res) => {
    response.success(res, script.applyAiCandidate(req.params.episodeId, req.body?.candidate || null));
  }));
  r.post('/episodes/:episodeId/script/confirm', wrap((req, res) => {
    response.success(res, script.confirmScript(req.params.episodeId, req.body || {}));
  }));
  r.get('/episodes/:episodeId/script/stage-nav', wrap((req, res) => {
    response.success(res, script.getStageNav(req.params.episodeId));
  }));
  r.get('/episodes/:episodeId/script/scene-stats', wrap((req, res) => {
    response.success(res, script.getSceneStats(req.params.episodeId));
  }));
  r.get('/episodes/:episodeId/script/confirm-preview', wrap((req, res) => {
    response.success(res, script.getConfirmPreview(req.params.episodeId));
  }));
  r.get('/episodes/:episodeId/script/diff', wrap((req, res) => {
    response.success(res, script.getDiff(
      req.params.episodeId,
      Number(req.query.from),
      Number(req.query.to)
    ));
  }));
  r.get('/episodes/:episodeId/script/history', wrap((req, res) => {
    response.success(res, { items: script.listHistory(req.params.episodeId) });
  }));
  r.post('/episodes/:episodeId/script/history/:revision/copy', wrap((req, res) => {
    response.created(res, script.copyFromHistory(req.params.episodeId, req.params.revision));
  }));

  // ---- 项目素材（Task 3.2） ----
  const { createMockProvider } = require('./mockProvider.js');
  const { createAssetQueryService } = require('./assets/assetQueryService.js');
  const nodePath = require('node:path');
  const assetStorage = nodePath.resolve(cfg.storage?.local_path || nodePath.join(process.cwd(), 'data', 'storage'));
  const v21MockProvider = createMockProvider({ db, log, storageDir: assetStorage });
  const assets = createAssetQueryService(db, {
    log,
    mockProvider: v21MockProvider,
  });
  r.get('/projects/:id/assets', wrap((req, res) => {
    response.success(res, assets.listAssets(req.params.id, req.query || {}));
  }));
  r.post('/projects/:id/assets', wrap((req, res) => {
    response.created(res, assets.createAsset(req.params.id, req.body || {}));
  }));
  r.get('/assets/:type/:assetId', wrap((req, res) => {
    response.success(res, assets.getDetail(req.params.type, req.params.assetId));
  }));
  // PATCH 素材资料（name/description 等白名单字段；软删 404、空名 400）
  r.patch('/assets/:type/:assetId', wrap((req, res) => {
    response.success(res, assets.updateAsset(req.params.type, req.params.assetId, req.body || {}));
  }));
  // 人物状态图设置：只改该状态当前图（仅 character 类型）
  r.post('/assets/:type/:assetId/states/:stateId/image', wrap((req, res) => {
    response.success(res, assets.setStateImage({
      type: req.params.type,
      assetId: req.params.assetId,
      stateId: req.params.stateId,
      imageUrl: (req.body || {}).imageUrl,
    }));
  }));
  r.post('/projects/:id/assets/generate-candidate', wrap((req, res) => {
    assets.generateCandidate(req.params.id, req.body || {}).then((result) => {
      response.created(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/assets/use-candidate', wrap((req, res) => {
    response.success(res, assets.useCandidate(req.body || {}));
  }));
  // URL 上传候选：仅入候选不改当前图（Task 1.2 / B6）
  r.post('/assets/:type/:assetId/candidates/upload', wrap((req, res) => {
    response.created(res, assets.uploadCandidate({
      type: req.params.type,
      assetId: req.params.assetId,
      imageUrl: (req.body || {}).imageUrl,
    }));
  }));
  r.delete('/assets/:type/:assetId', wrap((req, res) => {
    response.success(res, assets.deleteAsset({ type: req.params.type, assetId: req.params.assetId }));
  }));
  r.post('/assets/:type/:assetId/restore', wrap((req, res) => {
    response.success(res, assets.restoreAsset({ type: req.params.type, assetId: req.params.assetId }));
  }));

  // ---- 本集设定（Task 3.3） ----
  const { createEpisodeAssetsService } = require('./assets/episodeAssetsService.js');
  const episodeAssets = createEpisodeAssetsService(db, { log });
  r.get('/episodes/:episodeId/assets', wrap((req, res) => {
    response.success(res, {
      referenced: episodeAssets.getReferencedAssets(req.params.episodeId),
      readiness: episodeAssets.resolveMediaReadiness(req.params.episodeId),
    });
  }));
  r.put('/episodes/:episodeId/assets/selection', wrap((req, res) => {
    response.success(res, episodeAssets.updateSelection(req.params.episodeId, req.body || {}));
  }));
  r.post('/episodes/:episodeId/enter-storyboard', wrap((req, res) => {
    response.success(res, episodeAssets.enterStoryboard(req.params.episodeId));
  }));
  r.get('/episodes/:episodeId/media-guard', wrap((req, res) => {
    response.success(res, episodeAssets.getMediaGenerationGuard({
      episodeId: req.params.episodeId,
      shotId: req.query.shot || null,
    }));
  }));

  // ---- 分镜阶段（Task 4.x） ----
  // A1：真实 Provider 执行器与通道解析（无 Key 时自动回落 mock，铁律 6）
  const { createProviderRouter } = require('./providerRouter.js');
  const { createRealImageExecutor } = require('./realImageExecutor.js');
  const { createRealVideoExecutor } = require('./realVideoExecutor.js');
  const { createH3PromptDraftService } = require('../services/h3PromptDraftService.js');
  const realImageExecutor = createRealImageExecutor({ db, log });
  const realVideoExecutor = createRealVideoExecutor({ db, cfg, log, storageRoot: assetStorage });
  const legacyH3Drafts = createH3PromptDraftService();
  const v21ProviderRouter = createProviderRouter({
    db,
    log,
    imageExecutor: realImageExecutor,
    videoExecutor: realVideoExecutor,
    h3Executor: {
      compile: ({ shotId, resolved }) => {
        // legacy compileDraft：真实 H3 结构编译，写入 storyboard_h3_prompt_drafts（video_config_id = 真实配置 id）
        return legacyH3Drafts.compileDraft(db, cfg, log, {
          storyboardId: Number(shotId),
          videoConfigId: resolved.config.id,
          workflowId: resolved.model,
        });
      },
      saveText: ({ draftId, text }) => legacyH3Drafts.saveDraftText(db, { draftId: Number(draftId), finalText: String(text || ''), manuallyEdited: true }),
    },
  });
  const { createStoryboardService } = require('./storyboard/storyboardService.js');
  const storyboard = createStoryboardService(db, { log, mockProvider: v21MockProvider, providerRouter: v21ProviderRouter, cfg });
  r.post('/episodes/:episodeId/storyboard/create-from-script', wrap((req, res) => {
    response.created(res, storyboard.createFromScript(req.params.episodeId));
  }));
  // B1 更新分镜结构 diff 向导
  r.get('/episodes/:episodeId/storyboard/structure-diff', wrap((req, res) => {
    response.success(res, storyboard.previewStructureDiff(req.params.episodeId));
  }));
  r.post('/episodes/:episodeId/storyboard/apply-structure-diff', wrap((req, res) => {
    response.success(res, storyboard.applyStructureDiff(req.params.episodeId, req.body?.diff || {}, req.body || {}));
  }));
  r.get('/episodes/:episodeId/storyboard', wrap((req, res) => {
    const shots = storyboard.listShots(req.params.episodeId).map((s) => ({
      ...s,
      completion: storyboard.getCompletion(req.params.episodeId),
    }));
    response.success(res, { shots, completion: storyboard.getCompletion(req.params.episodeId) });
  }));
  r.get('/storyboards/:shotId', wrap((req, res) => {
    response.success(res, {
      shot: storyboard.getShotDetail(req.params.shotId),
      references: storyboard.getReferenceManager(req.params.shotId),
      imagePrompt: storyboard.getImagePrompt(req.params.shotId),
      imageCandidates: storyboard.imageCandidates(req.params.shotId),
      h3Draft: storyboard.getH3Draft(req.params.shotId),
      video: storyboard.videoCandidates(req.params.shotId),
      frameChaining: storyboard.getFrameChaining(req.params.shotId),
    });
  }));
  r.patch('/storyboards/:shotId/segments/:segmentId', wrap((req, res) => {
    response.success(res, storyboard.editSegment(req.params.shotId, req.params.segmentId, req.body || {}));
  }));
  r.post('/storyboards/:shotId/segments/:segmentId/split', wrap((req, res) => {
    response.success(res, storyboard.splitSegment(req.params.shotId, req.params.segmentId, Number(req.body?.atSeconds)));
  }));
  r.post('/storyboards/:shotId/segments/:segmentId/merge', wrap((req, res) => {
    response.success(res, storyboard.mergeSegment(req.params.shotId, req.params.segmentId));
  }));
  r.post('/storyboards/:shotId/segments/:segmentId/move', wrap((req, res) => {
    response.success(res, storyboard.moveSegment(req.params.shotId, req.params.segmentId, req.body?.direction || 'up'));
  }));
  r.get('/storyboards/:shotId/references', wrap((req, res) => {
    response.success(res, storyboard.getReferenceManager(req.params.shotId));
  }));
  r.post('/storyboards/:shotId/references', wrap((req, res) => {
    response.created(res, storyboard.addReference(req.params.shotId, req.body || {}));
  }));
  r.delete('/storyboards/:shotId/references/:referenceId', wrap((req, res) => {
    response.success(res, storyboard.removeReference(req.params.shotId, req.params.referenceId));
  }));
  r.get('/storyboards/:shotId/image-prompt', wrap((req, res) => {
    response.success(res, storyboard.getImagePrompt(req.params.shotId));
  }));
  r.put('/storyboards/:shotId/image-prompt', wrap((req, res) => {
    response.success(res, storyboard.editImagePrompt(req.params.shotId, req.body || {}));
  }));
  r.delete('/storyboards/:shotId/image-prompt', wrap((req, res) => {
    response.success(res, storyboard.resetImagePrompt(req.params.shotId));
  }));
  r.post('/storyboards/:shotId/image/generate', wrap((req, res) => {
    storyboard.generateImage(req.params.shotId, req.body || {}).then((result) => {
      response.created(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/storyboards/:shotId/image/upload', wrap((req, res) => {
    response.created(res, storyboard.uploadImage(req.params.shotId, req.body || {}));
  }));
  r.post('/storyboards/:shotId/image/set-current', wrap((req, res) => {
    response.success(res, storyboard.setImageCurrent(req.params.shotId, req.body || {}));
  }));
  r.post('/storyboards/:shotId/h3/generate', wrap((req, res) => {
    Promise.resolve(storyboard.generateH3(req.params.shotId, req.body || {})).then((result) => {
      response.created(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/storyboards/:shotId/h3/save', wrap((req, res) => {
    Promise.resolve(storyboard.saveH3(req.params.shotId, req.body || {})).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.get('/storyboards/:shotId/video/quote', wrap((req, res) => {
    response.success(res, storyboard.getVideoQuote(req.params.shotId, Number(req.query.count || 1)));
  }));
  r.get('/storyboards/:shotId/video/guard', wrap((req, res) => {
    response.success(res, storyboard.jointGuard(req.params.shotId));
  }));
  r.post('/storyboards/:shotId/video/submit', wrap((req, res) => {
    storyboard.submitVideo(req.params.shotId, req.body || {}).then((result) => {
      response.created(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/video-tasks/:taskId/complete', wrap((req, res) => {
    storyboard.completeVideoTask(req.params.taskId).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/storyboards/:shotId/video/adopt', wrap((req, res) => {
    response.success(res, storyboard.adoptVideo(req.params.shotId, req.body?.candidateId, req.body || {}));
  }));
  r.post('/storyboards/:shotId/video/undo-adopt', wrap((req, res) => {
    response.success(res, storyboard.undoAdoptVideo(req.params.shotId));
  }));
  r.get('/episodes/:episodeId/storyboard/batch-precheck', wrap((req, res) => {
    response.success(res, storyboard.batchPrecheck(req.params.episodeId));
  }));
  // C4 schema 化 Shot Package 导出
  const { createShotPackageService } = require('./storyboard/shotPackageService.js');
  const shotPackages = createShotPackageService({ db, log });
  r.get('/episodes/:episodeId/storyboard/shot-package', wrap((req, res) => {
    response.success(res, shotPackages.buildEpisodePackage(req.params.episodeId));
  }));
  r.post('/episodes/:episodeId/storyboard/batch/missing-images', wrap((req, res) => {
    storyboard.batchGenerateMissingImages(req.params.episodeId).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/episodes/:episodeId/storyboard/batch/missing-videos', wrap((req, res) => {
    storyboard.batchGenerateMissingVideos(req.params.episodeId, req.body || {}).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/episodes/:episodeId/storyboard/batch/retry-failed', wrap((req, res) => {
    storyboard.batchRetryFailed(req.params.episodeId).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.get('/storyboards/:shotId/video/history', wrap((req, res) => {
    response.success(res, storyboard.getVideoHistory(req.params.shotId));
  }));
  r.post('/video-tasks/:taskId/retry', wrap((req, res) => {
    Promise.resolve(storyboard.retryTask(req.params.taskId)).then((result) => {
      response.created(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  // C3：生成 Sheet 异步轮询与取消
  r.get('/video-tasks/:taskId/status', wrap((req, res) => {
    response.success(res, storyboard.getVideoTaskStatus(req.params.taskId));
  }));
  r.post('/video-tasks/:taskId/cancel', wrap((req, res) => {
    storyboard.cancelVideoTask(req.params.taskId, req.body?.reason || '').then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/storyboards/:shotId/frame-link/confirm', wrap((req, res) => {
    response.success(res, storyboard.confirmFrameLink(req.params.shotId));
  }));
  r.delete('/storyboards/:shotId/frame-link', wrap((req, res) => {
    response.success(res, storyboard.unlinkFrameLink(req.params.shotId));
  }));

  // ---- 外部 AI 向导（Task 2.4） ----
  const { createExternalAiWizardService } = require('./wizard/externalAiWizardService.js');
  const wizard = createExternalAiWizardService(db, { log });
  r.get('/projects/:id/external-ai/wizard', wrap((req, res) => {
    response.success(res, wizard.getWizardModel(req.params.id, req.query || {}));
  }));
  r.get('/projects/:id/external-ai/tasks', wrap((req, res) => {
    response.success(res, wizard.listProjectTasks(req.params.id));
  }));
  r.post('/projects/:id/external-ai/target', wrap((req, res) => {
    response.created(res, wizard.selectTarget(req.params.id, req.body || {}));
  }));
  r.post('/external-ai/tasks/:taskId/task-note', wrap((req, res) => {
    response.success(res, wizard.saveTaskNote(req.params.taskId, req.body || {}));
  }));
  r.post('/projects/:id/external-ai/package', wrap((req, res) => {
    response.created(res, wizard.createPackage(req.params.id, req.body || {}));
  }));
  r.get('/external-ai/tasks/:taskId', wrap((req, res) => {
    response.success(res, wizard.getTask(req.params.taskId));
  }));
  r.get('/external-ai/tasks/:taskId/download', wrap((req, res) => {
    const result = wizard.buildDownload(req.params.taskId, req.query || {});
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', result.contentDisposition);
    res.send(result.body);
  }));
  r.post('/external-ai/tasks/:taskId/cancel', wrap((req, res) => {
    response.success(res, wizard.cancelTask(req.params.taskId));
  }));
  r.post('/external-ai/tasks/:taskId/result/validate', wrap((req, res) => {
    response.success(res, wizard.validateResult(req.params.taskId, req.body?.resultJson || ""));
  }));
  r.post('/external-ai/tasks/:taskId/import/preview', wrap((req, res) => {
    response.success(res, wizard.previewImport(req.params.taskId, req.body?.resultJson || "", req.body || {}));
  }));
  r.post('/external-ai/tasks/:taskId/import/confirm', wrap((req, res) => {
    response.created(res, wizard.confirmImport(req.params.taskId, req.body?.resultJson || "", req.body || {}));
  }));

  // ---- 成片阶段（Task 5.x） ----
  const { createCutService } = require('./cut/cutService.js');
  const cut = createCutService(db, {
    log,
    exportDir: nodePath.join(assetStorage, 'v21-exports'),
  });
  r.get('/episodes/:episodeId/cut', wrap((req, res) => {
    const review = cut.getReviewModel(req.params.episodeId);
    response.success(res, { ...review, versions: cut.listVersions(req.params.episodeId) });
  }));
  r.post('/cut/waivers', wrap((req, res) => {
    response.created(res, cut.createWaiver(req.body || {}));
  }));
  r.post('/episodes/:episodeId/cut/compose', wrap((req, res) => {
    cut.composeEpisode(req.params.episodeId, req.body || {}).then((result) => {
      response.created(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/episodes/:episodeId/cut/cancel', wrap((req, res) => {
    response.success(res, cut.cancelCompose(req.params.episodeId));
  }));
  r.post('/episodes/:episodeId/cut/export', wrap((req, res) => {
    cut.exportCut(req.params.episodeId, req.body || {}).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));

  // ---- 自由创作（快速图片/视频，mock 通道；不参与四阶段 Gate） ----
  const quickProvider = createMockProvider({ db, log, storageDir: assetStorage });
  r.post('/quick-create/generate', wrap((req, res) => {
    const { kind, prompt } = req.body || {};
    response.created(res, quickProvider.submit({
      kind: kind === 'video' ? 'video' : 'image',
      ownerType: 'quick_create',
      ownerId: 'free',
      input: { prompt, durationSeconds: 1 },
      idempotencyKey: null,
    }));
  }));
  r.post('/quick-create/complete', wrap((req, res) => {
    quickProvider.run(req.body?.taskId).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));

  // ---- 任务中心聚合列表（Task 1.6 / P0-2） ----
  const { createTaskCenterService } = require('./tasks/taskCenterService.js');
  const taskCenter = createTaskCenterService(db, { log });
  r.get('/tasks', wrap((req, res) => {
    response.success(res, taskCenter.listTasks(req.query || {}));
  }));

  // ---- 数据工具（A2/A3/A5） ----
  const { createIntegrityService } = require('./datatools/integrityService.js');
  const integrity = createIntegrityService({ db, log, storageRoot: assetStorage });
  r.post('/datatools/integrity/run', wrap((req, res) => {
    response.success(res, integrity.run());
  }));
  const { createCleanupService } = require('./datatools/cleanupService.js');
  const cleanup = createCleanupService({ db, log, storageRoot: assetStorage });
  r.post('/datatools/cleanup/dry-run', wrap((req, res) => {
    response.success(res, cleanup.dryRun());
  }));
  r.post('/datatools/cleanup/execute', wrap((req, res) => {
    cleanup.execute(req.body?.items || [], req.body?.confirmText).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  const { createRelocationService } = require('./datatools/relocationService.js');
  const relocation = createRelocationService({ db, log, storageRoot: assetStorage });
  r.post('/datatools/relocation/scan', wrap((req, res) => {
    response.success(res, relocation.scan(req.body?.dir));
  }));
  r.post('/datatools/relocation/confirm', wrap((req, res) => {
    response.success(res, relocation.confirm(req.body?.items || []));
  }));
  // A4 工作区迁移执行器
  const { createWorkspaceMigrationService } = require('./datatools/workspaceMigrationService.js');
  const workspaceMigration = createWorkspaceMigrationService({ db, log });
  r.post('/datatools/workspace/check', wrap((req, res) => {
    workspaceMigration.check(req.body?.dir).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/datatools/workspace/preview', wrap((req, res) => {
    workspaceMigration.preview(req.body?.dir).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));
  r.post('/datatools/workspace/migrate', wrap((req, res) => {
    workspaceMigration.migrate(req.body?.dir, req.body?.confirmText).then((result) => {
      response.success(res, result);
    }).catch((err) => {
      if (err && err.code && err.status) res.status(err.status).json({ error: { code: err.code, message: err.message } });
      else res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  }));

  return r;
}

module.exports = { createV21Router };
