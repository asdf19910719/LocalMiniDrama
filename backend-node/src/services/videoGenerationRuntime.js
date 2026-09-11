'use strict';
/**
 * 统一视频生成运行时（A1 抽取）：把 director 工作流注册表、ComfyUI Provider、GPU 互斥锁与
 * 统一视频服务收敛为按 db 实例记忆的单例工厂，供 /api/v1 与 /api/v2 共享同一把 GPU 锁与
 * 同一套任务恢复逻辑。装配与原 routes/index.js 完全一致；测试可用 build 注入替身。
 */
const path = require('node:path');

function createVideoGenerationRuntime({ db, cfg = {}, log = console, build = null } = {}) {
  const directorCfg = cfg.director || {};
  const directorArtifactRoot = path.join(process.cwd(), 'data', 'director-artifacts');
  const directorAllowedRoots = (directorCfg.allowed_local_roots || []).map((root) => path.resolve(root));

  if (typeof build === 'function') {
    return build({ db, cfg, log, directorCfg, directorArtifactRoot, directorAllowedRoots });
  }

  const { loadRegistry } = require('../director/workflowRegistry');
  const { createComfyUIClient } = require('../director/comfyuiClient');
  const { createGpuMutex } = require('../director/gpuMutex');
  const {
    createComfyUIVideoProvider,
    createVideoProviderRegistry,
  } = require('./videoProviders');
  const { createUnifiedVideoGenerationService } = require('./unifiedVideoGenerationService');

  const workflowRegistry = loadRegistry(directorCfg.workflow_registry_path);
  const allowExperimental = !!directorCfg.allow_experimental;
  const createComfyClient = (baseUrl) => createComfyUIClient({
    baseUrl,
    outputDir: directorArtifactRoot,
    allowExperimental,
  });
  const comfyClient = createComfyClient(process.env.DIRECTOR_COMFYUI_URL || 'http://127.0.0.1:8188');
  const comfyInputDir = process.env.DIRECTOR_COMFYUI_INPUT_DIR || null;
  const gpuMutex = createGpuMutex();
  const providerRegistry = createVideoProviderRegistry({
    comfyui: createComfyUIVideoProvider({
      registry: workflowRegistry,
      comfyClient,
      createComfyClient,
      gpuMutex,
      referenceStager: (refs, context) => require('./videoProviders/referenceAssetStaging').stageReferenceAssets(refs, {
        allowedRoots: directorAllowedRoots,
        inputDir: comfyInputDir,
        minReferences: context?.referenceLimits?.min ?? 0,
        maxReferences: context?.referenceLimits?.max ?? 9,
        remoteKey: String(context?.snapshot?.baseUrl || context?.config?.base_url || '').trim(),
        client: createComfyClient(String(context?.snapshot?.baseUrl || context?.config?.base_url || '').trim()),
        remote: !comfyInputDir,
      }),
      referenceCleanup: (staged, context) => require('./videoProviders/referenceAssetStaging').cleanupReferenceAssets(staged, {
        inputDir: comfyInputDir,
        remote: !comfyInputDir,
        remoteKey: String(context?.snapshot?.baseUrl || context?.config?.base_url || '').trim(),
        client: createComfyClient(String(context?.snapshot?.baseUrl || context?.config?.base_url || '').trim()),
        log,
      }),
      allowExperimental,
    }),
  });
  const unifiedService = createUnifiedVideoGenerationService({
    db,
    log,
    providerRegistry,
    workflowRegistry,
    allowExperimental,
  });
  return {
    workflowRegistry,
    providerRegistry,
    unifiedService,
    gpuMutex,
    comfyClient,
    createComfyClient,
    artifactRoot: directorArtifactRoot,
    allowedLocalRoots: directorAllowedRoots,
  };
}

const cache = new WeakMap();

function getSharedVideoRuntime(options = {}) {
  const { db } = options;
  if (!db) throw new Error('getSharedVideoRuntime requires a database');
  if (cache.has(db)) return cache.get(db);
  const runtime = createVideoGenerationRuntime(options);
  cache.set(db, runtime);
  return runtime;
}

module.exports = { createVideoGenerationRuntime, getSharedVideoRuntime };
