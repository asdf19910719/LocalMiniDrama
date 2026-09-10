const express = require('express');
const path = require('node:path');
const response = require('../response');
const dramaRoutes = require('./drama');
const taskRoutes = require('./task');
const settingsRoutes = require('./settings');
const aiConfigRoutes = require('./aiConfig');
const propRoutes = require('./prop');
const stubRoutes = require('./stub');
const characterLibraryRoutes = require('./characterLibrary');
const sceneLibraryRoutes = require('./sceneLibrary');
const propLibraryRoutes = require('./propLibrary');
const characterRoutes = require('./characters');
const uploadModule = require('./upload');
const sceneRoutes = require('./scenes');
const storyboardRoutes = require('./storyboards');
const tailFrameLinkRoutes = require('./storyboards_tail_link');
const imageRoutes = require('./images');
const videoRoutes = require('./videos');
const videoMergeRoutes = require('./videoMerges');
const assetRoutes = require('./assets');
const audioRoutes = require('./audio');
const promptOverridesRoutes = require('./promptOverrides');
const sceneModelMapRoutes = require('./sceneModelMap');
const directorRoutes = require('./director');
const externalGenerationRoutes = require('./externalGeneration');
const imageGenerationTaskRoutes = require('./imageGenerationTasks');
const episodeGenerationProgressRoutes = require('./episodeGenerationProgress');
const episodePackageRoutes = require('./episodePackage');
const videoUpscaleRoutes = require('./videoUpscale');
const styleRoutes = require('./styles');
const { createVideoUpscaleRuntime } = require('../services/videoUpscale/videoUpscaleRuntime');
const { loadRegistry } = require('../director/workflowRegistry');
const { createComfyUIClient } = require('../director/comfyuiClient');
const { createGpuMutex } = require('../director/gpuMutex');
const { createDirectorJobRunner } = require('../director/directorJobRunner');
const { reconcileRunningJobs } = require('../director/directorJobService');
const {
  createComfyUIVideoProvider,
  createVideoProviderRegistry,
} = require('../services/videoProviders');
const { createUnifiedVideoGenerationService } = require('../services/unifiedVideoGenerationService');
const { createPreparedVideoGenerationService } = require('../services/preparedVideoGenerationService');
const { getFfmpegPath } = require('../utils/ffmpegPath');
const { stageReferenceAssets, cleanupReferenceAssets } = require('../services/videoProviders/referenceAssetStaging');

function setupRouter(cfg, db, log) {
  const r = express.Router();
  const drama = dramaRoutes(db, cfg, log);
  const task = taskRoutes(db, log);
  const settings = settingsRoutes(db, cfg, log);
  const prop = propRoutes(db, log, cfg);
  const stub = stubRoutes(db, cfg, log);
  const sceneModelMap = sceneModelMapRoutes(db, log);
  const episodePackage = episodePackageRoutes(db, cfg, log);
  const styles = styleRoutes(db, log);
  
  const uploadService = require('../services/uploadService');
  const charLibrary = characterLibraryRoutes(db, cfg, log);
  const sceneLibrary = sceneLibraryRoutes(db, cfg, log);
  const propLibrary = propLibraryRoutes(db, cfg, log);
  const characters = characterRoutes(db, cfg, log, uploadService);
  const uploadHandlers = uploadModule.routes(cfg, log, db);
  const scenes = sceneRoutes(db, log, cfg);
  const tailFrameLink = tailFrameLinkRoutes(db, cfg, log);
  const images = imageRoutes(db, cfg, log);
  const episodeGenerationProgress = episodeGenerationProgressRoutes(db, log);
  const videoMerges = videoMergeRoutes(db, log);
  const videoUpscaleRuntime = createVideoUpscaleRuntime({ db, appConfig: cfg, log });
  const videoUpscale = videoUpscaleRoutes(db, log, videoUpscaleRuntime);
  const videoMergeService = require('../services/videoMergeService');
  videoMergeService.configureVideoUpscaleRuntime(videoUpscaleRuntime);
  videoUpscaleRuntime.setCompletionHandler((job) =>
    videoMergeService.resumeVideoMergeAfterUpscale(db, log, job.video_merge_id));
  setImmediate(() => {
    videoUpscaleRuntime.recoverDueJobs().catch((error) => {
      log.error('recoverVideoUpscaleJobs', { error: error.message });
    });
  });
  const upscaleRecoveryTimer = setInterval(() => {
    videoUpscaleRuntime.recoverDueJobs().catch((error) => {
      log.error('recoverVideoUpscaleJobs', { error: error.message });
    });
  }, 60_000);
  upscaleRecoveryTimer.unref?.();
  const assets = assetRoutes(db, log);
  const audio = audioRoutes(db, log, cfg);
  const promptOverrides = promptOverridesRoutes.routes(db, log);
  const directorRegistry = loadRegistry(cfg.director.workflow_registry_path);
  // H3 提示词草稿路由与 unified 服务共用同一注册表实例(Task 16 交接①),
  // 保证草稿快照/指纹与候选生成的解析形状一致,否则门禁恒判 stale。
  const storyboards = storyboardRoutes(db, log, {
    workflowRegistry: directorRegistry,
    allowExperimental: cfg.director.allow_experimental,
  });
  const directorArtifactRoot = path.join(process.cwd(), 'data', 'director-artifacts');
  const directorAllowedRoots = cfg.director.allowed_local_roots.map((root) => path.resolve(root));
  const createDirectorComfyClient = (baseUrl) => createComfyUIClient({
    baseUrl,
    outputDir: directorArtifactRoot,
    allowExperimental: cfg.director.allow_experimental,
  });
  const directorComfyClient = createDirectorComfyClient(
    process.env.DIRECTOR_COMFYUI_URL || 'http://127.0.0.1:8188',
  );
  const comfyInputDir = process.env.DIRECTOR_COMFYUI_INPUT_DIR || null;
  const videoGpuMutex = createGpuMutex();
  const videoProviderRegistry = createVideoProviderRegistry({
    comfyui: createComfyUIVideoProvider({
      registry: directorRegistry,
      comfyClient: directorComfyClient,
      createComfyClient: createDirectorComfyClient,
      gpuMutex: videoGpuMutex,
      referenceStager: (refs, context) => stageReferenceAssets(refs, {
        allowedRoots: directorAllowedRoots,
        inputDir: comfyInputDir,
        minReferences: context?.referenceLimits?.min ?? 0,
        maxReferences: context?.referenceLimits?.max ?? 9,
        remoteKey: String(context?.snapshot?.baseUrl || context?.config?.base_url || '').trim(),
        client: createDirectorComfyClient(String(context?.snapshot?.baseUrl || context?.config?.base_url || '').trim()),
        remote: !comfyInputDir,
      }),
      referenceCleanup: (staged, context) => cleanupReferenceAssets(staged, {
        inputDir: comfyInputDir,
        remote: !comfyInputDir,
        remoteKey: String(context?.snapshot?.baseUrl || context?.config?.base_url || '').trim(),
        client: createDirectorComfyClient(String(context?.snapshot?.baseUrl || context?.config?.base_url || '').trim()),
        log,
      }),
      allowExperimental: cfg.director.allow_experimental,
    }),
  });
  const aiConfig = aiConfigRoutes(db, log, cfg, {
    providerRegistry: videoProviderRegistry,
    workflowRegistry: directorRegistry,
    allowExperimental: cfg.director.allow_experimental,
  });
  const unifiedVideoGenerationService = createUnifiedVideoGenerationService({
    db,
    log,
    providerRegistry: videoProviderRegistry,
    workflowRegistry: directorRegistry,
    allowExperimental: cfg.director.allow_experimental,
  });
  const preparedVideoGenerationService = createPreparedVideoGenerationService({
    db,
    log,
    workflowRegistry: directorRegistry,
    lifecycleService: unifiedVideoGenerationService,
  });
  require('../services/videoService').configureUnifiedVideoGenerationService(
    db,
    unifiedVideoGenerationService,
  );
  const videos = videoRoutes(db, log, {
    providerRegistry: videoProviderRegistry,
    lifecycleService: unifiedVideoGenerationService,
    preparedService: preparedVideoGenerationService,
  });
  setImmediate(() => {
    unifiedVideoGenerationService.recoverVideoGenerations().catch((error) => {
      log.error('recoverVideoGenerations', { error: error.message });
    });
  });
  reconcileRunningJobs(db);
  const directorRunner = createDirectorJobRunner({
    db,
    comfyClient: directorComfyClient,
    gpuMutex: videoGpuMutex,
    registry: directorRegistry,
    logger: log,
  });
  const director = directorRoutes(db, log, {
    runner: directorRunner,
    videoGenerationService: {
      ...unifiedVideoGenerationService,
      createVideoGeneration: (input) => preparedVideoGenerationService.prepareAndCreateVideoGeneration(input)
        .then((result) => result.generation),
    },
    registry: directorRegistry,
    allowExperimental: cfg.director.allow_experimental,
    artifactRoot: directorArtifactRoot,
    storageRoot: path.resolve(cfg.storage?.local_path || './data/storage'),
    allowedLocalRoots: directorAllowedRoots,
    ffmpegPath: getFfmpegPath(),
  });
  const externalGeneration = externalGenerationRoutes(db, cfg, log);
  r.use(externalGeneration);
  r.use(imageGenerationTaskRoutes(db, log));
  // 单集制作包导入:精确路径,必须先于各 '/:id' 形参路由注册
  r.use(episodePackage);

  // ---------- canonical styles ----------
  r.get('/styles', styles.list);
  r.get('/styles/:id', styles.get);
  r.post('/styles/custom', styles.create);
  r.put('/styles/custom/:id', styles.update);
  r.delete('/styles/custom/:id', styles.remove);

  // ---------- dramas ----------
  r.get('/dramas', drama.listDramas);
  r.post('/dramas', drama.createDrama);
  r.get('/dramas/stats', drama.getDramaStats);
  // 导出/导入（放在 :id 路由前，避免被 :id 捕获）
  r.get('/dramas/:id/export', drama.exportDrama);
  const multer = require('multer');
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
  r.post('/dramas/import', importUpload.single('file'), drama.importDrama);
  r.post('/dramas/import-novel', importUpload.single('file'), async (req, res) => {
    try {
      const novelImportService = require('../services/novelImportService');
      let text = '';
      if (req.file && req.file.buffer) {
        text = req.file.buffer.toString('utf8');
      } else if (req.body && req.body.text) {
        text = req.body.text;
      }
      if (!text.trim()) return response.badRequest(res, '请上传小说文本文件或提供 text 参数');
      const title = req.body?.title || '';
      const maxChapters = Number(req.body?.max_chapters) || 20;
      const aiSummarize = req.body?.ai_summarize === 'true' || req.body?.ai_summarize === true;
      const result = await novelImportService.importNovel(db, log, { text, title, maxChapters, aiSummarize });
      response.success(res, result);
    } catch (err) {
      log.error('dramas import-novel', { error: err.message });
      response.internalError(res, err.message);
    }
  });
  r.get('/dramas/examples', drama.listExamples);
  r.post('/dramas/import-example', drama.importExample);
  r.put('/dramas/:id/outline', drama.saveOutline);
  r.get('/dramas/:id/characters', drama.getCharacters);
  r.put('/dramas/:id/characters', drama.saveCharacters);
  r.put('/dramas/:id/episodes', drama.saveEpisodes);
  r.put('/dramas/:id/progress', drama.saveProgress);
  r.put('/dramas/:id/canvas-layout', drama.saveCanvasLayout);
  r.get('/dramas/:id/props', drama.listProps);
  r.get('/dramas/:id', drama.getDrama);
  r.put('/dramas/:id', drama.updateDrama);
  r.delete('/dramas/:id', drama.deleteDrama);
  r.delete('/episodes/:id', drama.deleteEpisode);

  // ---------- ai-configs ----------
  r.get('/ai-configs', aiConfig.list);
  r.post('/ai-configs', aiConfig.create);
  r.post('/ai-configs/test', aiConfig.testConnection);
  r.post('/ai-configs/jimeng2-list-assets', aiConfig.listJimeng2MaterialAssets);
  r.post('/ai-configs/model-ark-asset', aiConfig.modelArkAsset);
  r.get('/ai-configs/vendor-lock', aiConfig.vendorLock);  // 必须在 /:id 之前
  r.put('/ai-configs/bulk-update-key', aiConfig.bulkUpdateKey);  // 必须在 /:id 之前
  r.get('/ai-configs/:id', aiConfig.get);
  r.put('/ai-configs/:id', aiConfig.update);
  r.delete('/ai-configs/:id', aiConfig.delete);

  // ---------- generation (角色生成：AI + 入库 + 任务结果) ----------
  r.post('/generation/characters', (req, res) => {
    const characterGenerationService = require('../services/characterGenerationService');
    try {
      const body = req.body || {};
      if (!body.drama_id) {
        return response.badRequest(res, 'drama_id 必填');
      }
      const taskId = characterGenerationService.generateCharacters(db, cfg, log, body);
      response.success(res, { task_id: taskId, status: 'pending' });
    } catch (err) {
      log.error('generation/characters', { error: err.message });
      response.internalError(res, err.message || '创建任务失败');
    }
  });

  // 故事生成：带 drama_id 时异步生成并入库；否则同步返回 episodes（兼容旧调用）
  r.post('/generation/story', async (req, res) => {
    const storyGenerationService = require('../services/storyGenerationService');
    try {
      const body = req.body || {};
      if (body.drama_id) {
        const taskId = storyGenerationService.startStoryGeneration(db, log, body);
        return response.success(res, { task_id: taskId, status: 'pending' });
      }
      const result = await storyGenerationService.generateStory(db, log, body);
      response.success(res, result);
    } catch (err) {
      log.error('generation/story', { error: err.message });
      if (err.message && (err.message.includes('未配置') || err.message.includes('必填') || err.message.includes('不存在'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '故事生成失败');
    }
  });

  // ---------- character-library ----------
  r.get('/character-library', charLibrary.list);
  r.post('/character-library', charLibrary.create);
  r.get('/character-library/:id', charLibrary.get);
  r.put('/character-library/:id', charLibrary.update);
  r.delete('/character-library/:id', charLibrary.delete);

  // ---------- scene-library ----------
  r.get('/scene-library', sceneLibrary.list);
  r.post('/scene-library', sceneLibrary.create);
  r.get('/scene-library/:id', sceneLibrary.get);
  r.put('/scene-library/:id', sceneLibrary.update);
  r.delete('/scene-library/:id', sceneLibrary.delete);

  // ---------- prop-library ----------
  r.get('/prop-library', propLibrary.list);
  r.post('/prop-library', propLibrary.create);
  r.get('/prop-library/:id', propLibrary.get);
  r.put('/prop-library/:id', propLibrary.update);
  r.delete('/prop-library/:id', propLibrary.delete);

  // ---------- characters ----------
  r.get('/characters/:id', characters.getOne);
  r.put('/characters/:id', characters.update);
  r.delete('/characters/:id', characters.delete);
  r.post('/characters/batch-generate-images', characters.batchGenerateImages);
  r.post('/characters/:id/generate-image', characters.generateImage);
  r.post('/characters/:id/generate-four-view-image', characters.generateFourViewImage);
  r.post('/characters/:id/generate-prompt', characters.generatePrompt);
  r.post('/characters/:id/upload-image', uploadModule.multerSingle, characters.uploadImage);
  r.put('/characters/:id/image', characters.putImage);
  r.put('/characters/:id/image-from-library', characters.imageFromLibrary);
  r.post('/characters/:id/add-to-library', characters.addToLibrary);
  r.post('/characters/:id/add-to-material-library', characters.addToMaterialLibrary);
  r.post('/characters/:id/sd2-certify', characters.sd2Certify);
  r.post('/characters/:id/sd2-certify/refresh', characters.sd2CertifyRefresh);
  r.post('/characters/:id/sd2-voice-upload', uploadModule.multerAudioSingle, characters.sd2VoiceUpload);
  r.post('/characters/:id/sd2-voice-refresh', characters.sd2VoiceRefresh);
  r.post('/characters/:id/extract-from-image', characters.extractFromImage);
  r.post('/characters/:id/extract-anchors', characters.extractAnchors);
  // ---------- character variants（人物状态） ----------
  r.get('/characters/:characterId/variants', characters.listVariants);
  r.post('/characters/:characterId/variants', characters.createVariant);
  r.put('/character-variants/:variantId', characters.updateVariant);
  r.delete('/character-variants/:variantId', characters.deleteVariant);
  r.post('/character-variants/:variantId/generate-image', characters.generateVariantImage);

  // ---------- props ----------
  r.get('/props/:id', prop.getPropById);
  r.post('/props', prop.createProp);
  r.put('/props/:id', prop.updateProp);
  r.delete('/props/:id', prop.deleteProp);
  r.post('/props/:id/generate', prop.generateImage);
  r.post('/props/:id/generate-prompt', prop.generatePropPrompt);
  r.post('/props/:id/add-to-library', prop.addToLibrary);
  r.post('/props/:id/add-to-material-library', prop.addToMaterialLibrary);
  r.post('/props/:id/extract-from-image', prop.extractPropFromImage);

  // ---------- vision: 从图片提取描述（不依赖已有实体 ID）----------
  r.post('/extract-description-from-image', async (req, res) => {
    const { image_url, entity_type, entity_name } = req.body || {};
    if (!image_url) return response.badRequest(res, '缺少 image_url');
    if (!['character', 'scene', 'prop'].includes(entity_type)) return response.badRequest(res, 'entity_type 需为 character/scene/prop');
    try {
      const { extractDescriptionFromImage } = require('../services/aiClient');
      const out = await extractDescriptionFromImage(db, log, entity_type, image_url, entity_name);
      if (!out.ok) return response.badRequest(res, out.error);
      response.success(res, { description: out.description });
    } catch (err) {
      log.error('extract-description-from-image', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- upload ----------
  r.post('/upload/image', uploadModule.multerSingle, uploadHandlers.uploadImage);

  // ---------- episodes ----------
  // 注意：drama.generateStoryboard 已处理所有逻辑（包括参数解析），这里统一使用 drama 模块的实现
  // 之前可能有部分路由指向了 storyboards.episodeStoryboardsGenerate，这可能导致参数解析不一致
  r.post('/episodes/:episode_id/storyboards', drama.generateStoryboard);
  r.post('/episodes/:episode_id/props/extract', prop.extractProps);
  r.post('/episodes/:episode_id/characters/extract', stub.episodeCharactersExtract);
  r.get('/episodes/:episode_id/storyboards', storyboards.episodeStoryboardsGet);
  r.post('/episodes/:episode_id/finalize', drama.finalizeEpisode);
  r.get('/episodes/:episode_id/download', drama.downloadEpisodeVideo);
  r.patch('/episodes/:id/audio-plan', drama.updateEpisodeAudioPlan);
  r.post('/episodes/:id/audio-plan/plan', drama.planEpisodeAudio);

  // ---------- tasks ----------
  r.get('/tasks/:task_id', task.getTaskStatus);
  r.post('/tasks/:task_id/cancel', task.cancelTaskStatus);
  r.get('/tasks', task.getResourceTasks);

  // ---------- scenes ----------
  r.get('/scenes/:scene_id', scenes.getOne);
  r.post('/scenes/:scene_id/generate-prompt', scenes.generatePrompt);
  r.put('/scenes/:scene_id', scenes.update);
  r.put('/scenes/:scene_id/prompt', scenes.updatePrompt);
  r.delete('/scenes/:scene_id', scenes.delete);
  r.post('/scenes/generate-image', scenes.generateImage);
  r.post('/scenes', scenes.create);
  r.post('/scenes/:scene_id/generate-four-view-image', scenes.generateFourViewImage);
  r.post('/scenes/:scene_id/add-to-library', scenes.addToLibrary);
  r.post('/scenes/:scene_id/add-to-material-library', scenes.addToMaterialLibrary);
  r.post('/scenes/:scene_id/extract-from-image', scenes.extractFromImage);

  // ---------- images ----------
  r.get('/images', images.list);
  r.post('/images', images.create);
  r.get('/images/episode/:episode_id/backgrounds', images.episodeBackgrounds);
  r.post('/images/episode/:episode_id/backgrounds/extract', images.episodeBackgroundsExtract);
  r.post('/images/episode/:episode_id/batch', images.episodeBatch);
  r.post('/images/scene/:scene_id', images.scene);
  r.post('/images/upload', images.upload);
  r.get('/images/:id', images.get);
  r.delete('/images/:id', images.delete);

  // ---------- episode generation progress ----------
  r.get('/episodes/:episodeId/generation-progress', episodeGenerationProgress.get);

  // ---------- videos ----------
  r.get('/videos', videos.list);
  r.get('/videos/capabilities', videos.capabilities);
  r.get('/videos/workflows', videos.workflows);
  r.post('/videos', videos.create);
  r.post('/videos/prepared', videos.preparedCreate);
  r.post('/videos/prepared/batch', videos.preparedBatch);
  r.post('/videos/h3-preview', videos.h3Preview);
  r.post('/videos/image/:image_gen_id', videos.fromImage);
  r.post('/videos/episode/:episode_id/batch', videos.episodeBatch);
  r.post('/videos/:id/cancel', videos.cancel);
  r.post('/videos/:id/retry', videos.retry);
  r.post('/videos/:id/resume-poll', videos.resumePoll);
  r.get('/videos/:id', videos.get);
  r.delete('/videos/:id', videos.delete);

  // ---------- video-merges ----------
  r.get('/video-merges', videoMerges.list);
  r.post('/video-merges', videoMerges.create);
  r.get('/video-merges/:merge_id', videoMerges.get);
  r.delete('/video-merges/:merge_id', videoMerges.delete);

  // ---------- cloud video upscale ----------
  r.get('/video-upscale/capabilities', videoUpscale.capabilities);
  r.get('/video-upscale/jobs/:id', videoUpscale.get);
  r.post('/video-upscale/jobs/:id/retry', videoUpscale.retry);
  r.post('/video-upscale/jobs/:id/skip', videoUpscale.skip);
  r.post('/video-upscale/jobs/:id/cancel', videoUpscale.cancel);

  // ---------- assets ----------
  r.get('/assets', assets.list);
  r.post('/assets', assets.create);
  r.post('/assets/import/image/:image_gen_id', assets.importImage);
  r.post('/assets/import/video/:video_gen_id', assets.importVideo);
  r.get('/assets/:id', assets.get);
  r.put('/assets/:id', assets.update);
  r.delete('/assets/:id', assets.delete);

  // ---------- storyboards ----------
  r.get('/storyboards/episode/:episode_id/generate', storyboards.episodeStoryboardsGenerate);
  r.post('/storyboards', storyboards.create);
  r.post('/storyboards/:id/insert-before', storyboards.insertBefore);
  // 统一参考图槽位(spec §7);须在 GET /storyboards/:id 之前注册
  r.get('/storyboards/:id/reference-slots', storyboards.referenceSlots);
  // H3 提示词草稿(spec §11);须在 GET/PUT /storyboards/:id 之前注册
  r.get('/storyboards/:id/h3-prompt-draft', storyboards.h3PromptDraftGet);
  r.post('/storyboards/:id/h3-prompt-draft/compile', storyboards.h3PromptDraftCompile);
  r.put('/storyboards/:id/h3-prompt-draft', storyboards.h3PromptDraftSave);
  r.post('/storyboards/:id/h3-prompt-draft/confirm-semantic-review', storyboards.h3PromptDraftConfirmSemanticReview);
  r.get('/storyboards/:id', storyboards.getOne);
  r.put('/storyboards/:id', storyboards.update);
  r.delete('/storyboards/:id', storyboards.delete);
  r.post('/storyboards/:id/props', prop.associateProps);
  r.post('/storyboards/:id/frame-prompt', storyboards.framePrompt);
  r.get('/storyboards/:id/frame-prompts', storyboards.framePromptsGet);
  r.put('/storyboards/:id/frame-prompts/:frame_type', storyboards.framePromptSave);
  r.post('/storyboards/:id/link-tail-frame', tailFrameLink.linkTailFrame);
  r.post('/storyboards/:id/polish-prompt', storyboards.polishPrompt);
  r.post('/storyboards/:id/universal-segment-polish-stream', storyboards.polishUniversalSegmentStream);
  r.post('/storyboards/:id/classic-video-prompt-polish-stream', storyboards.polishClassicVideoPromptStream);
  r.post('/storyboards/:id/universal-segment-prompt-stream', storyboards.generateUniversalSegmentStream);
  r.post('/storyboards/:id/universal-segment-prompt', storyboards.generateUniversalSegmentPrompt);
  r.post('/storyboards/batch-infer-params', storyboards.batchInferParams);
  r.post('/storyboards/:id/upscale', storyboards.upscale);
  r.post('/storyboards/:id/regenerate-layout-description', storyboards.regenerateLayoutDescription);
  r.post('/storyboards/:id/rebuild-video-prompt', storyboards.rebuildVideoPrompt);
  r.post('/storyboards/:id/split-by-audio', storyboards.splitByAudio);

  // ---------- audio ----------
  r.post('/audio/extract', audio.extract);
  r.post('/audio/extract/batch', audio.extractBatch);

  // ---------- settings ----------
  r.get('/settings/language', settings.getLanguage);
  r.put('/settings/language', settings.updateLanguage);
  r.get('/settings/generation', settings.getGenerationSettings);
  r.put('/settings/generation', settings.updateGenerationSettings);
  r.get('/settings/image-generation', settings.getImageGenerationSettings);
  r.put('/settings/image-generation', settings.updateImageGenerationSettings);

  // ---------- prompt overrides ----------
  r.get('/settings/prompts', promptOverrides.list);
  r.put('/settings/prompts/:key', promptOverrides.update);
  r.delete('/settings/prompts/:key', promptOverrides.reset);

  // ---------- AI Director candidate review ----------
  r.post('/director/shots/:shotId/generate', director.generateCandidates);
  r.get('/director/queue', director.getQueue);
  r.get('/director/storage', director.getStorage);
  r.post('/director/storage/cleanup', director.cleanupStorage);
  r.post('/director/bundles', director.createBundle);
  r.post('/director/bundles/restore', director.restoreBundle);
  r.get('/director/shots/:shotId/candidates', director.getShotCandidates);
  r.post('/director/shots/:shotId/candidates', director.createCandidates);
  r.get('/director/artifacts/:artifactId/content', director.getArtifactContent);
  r.get('/director/jobs/:jobId', director.getJob);
  r.post('/director/jobs/:jobId/cancel', director.cancelJob);
  r.post('/director/jobs/:jobId/retry', director.retryJob);
  r.get('/director/candidates/:groupId', director.getCandidates);
  r.post('/director/candidates/:groupId/review', director.reviewCandidates);
  r.post('/director/candidates/:groupId/select', director.selectCandidate);
  r.get('/director/timelines/:timelineId', director.getTimeline);
  r.post('/director/timelines', director.createTimeline);
  r.post('/director/timelines/:timelineId/render', director.renderTimeline);
  r.post('/director/anchors', director.createAnchor);
  r.get('/director/artifacts/:artifactId/anchors', director.listAnchors);
  r.post('/director/artifacts/:artifactId/analyze', director.analyzeArtifact);

  // ---------- scene model map ----------
  r.get('/scene-model-map', sceneModelMap.list);
  r.post('/scene-model-map', sceneModelMap.create);
  r.get('/scene-model-map/:key', sceneModelMap.get);
  r.put('/scene-model-map/:key', sceneModelMap.update);
  r.delete('/scene-model-map/:key', sceneModelMap.delete);

  // 启动时将已有的覆盖加载到 promptI18n 内存缓存
  try {
    const promptI18n = require('../services/promptI18n');
    const promptOverridesService = require('../services/promptOverridesService');
    const saved = promptOverridesService.listOverrides(db);
    promptI18n.loadOverridesIntoCache(saved);
  } catch (e) {
    console.warn('Failed to load prompt overrides:', e.message);
  }

  // V2.1 Production Studio 影子路由在 app.js 挂载于 /api/v2（Phase 1–5 不接管正式路由）

  return r;
}

module.exports = { setupRouter };
