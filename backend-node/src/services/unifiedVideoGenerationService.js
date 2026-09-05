const path = require('node:path');
const crypto = require('node:crypto');
const taskService = require('./taskService');
const videoClient = require('./videoClient');
const videoService = require('./videoService');
const candidateService = require('../director/candidateGroupService');
const { resolveDefaultVideoConfig } = require('./videoConfigResolver');
const { buildVideoConfigSnapshot } = require('./videoGenerationSnapshot');
const { createH3PromptCompiler } = require('./h3PromptCompiler');
const { createH3PromptDraftService } = require('./h3PromptDraftService');
const { buildVideoGenerationPlan } = require('./videoGenerationPlan');
const { readWorkflowTemplate } = require('../director/workflowRegistry');
const { resolveRequestedWorkflow } = require('./videoWorkflowSelection');
const { listWorkflowCatalog } = require('../director/workflowCatalog');
const {
  workflowRequiresDraft,
  resolveWorkflowParameters,
  validateWorkflowReferences,
} = require('../director/workflowExecutionPolicy');

const ACTIVE_STATUSES = new Set(['waiting', 'queued', 'running']);
const RETRYABLE_STATUSES = new Set(['failed', 'interrupted']);
const TERMINAL_STATUSES = new Set(['review', 'selected', 'failed', 'cancelled', 'interrupted']);

class VideoLifecycleError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message || code);
    this.name = 'VideoLifecycleError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function parseModelList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch (_) {
    return [String(value)];
  }
}

function normalizeProviderStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'waiting' || status === 'pending') return 'waiting';
  if (status === 'queued' || status === 'queue' || status === 'submitted') return 'queued';
  if (status === 'running' || status === 'processing' || status === 'in_progress') return 'running';
  if (status === 'review' || status === 'completed' || status === 'complete'
    || status === 'succeeded' || status === 'success' || status === 'done') return 'review';
  if (status === 'selected') return 'selected';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'interrupted') return 'interrupted';
  if (status === 'failed' || status === 'failure' || status === 'error') return 'failed';
  return 'failed';
}

function normalizeProgress(value, fallback = 0) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return fallback;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function errorCode(error, fallback) {
  const explicit = String(error?.code || '').trim();
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(explicit)) return explicit;
  const message = String(error?.message || error || '').trim();
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(message)) return message;
  return fallback;
}

function structuredError(error, stage, fallbackCode = 'VIDEO_PROVIDER_ERROR', extraDetails = {}) {
  const message = String(error?.message || error || fallbackCode).trim() || fallbackCode;
  const sourceDetails = error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details
    : {};
  const redactPrivateDetails = (value) => {
    if (Array.isArray(value)) return value.map(redactPrivateDetails);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['providertaskid', 'provider_task_id'].includes(String(key).toLowerCase()))
      .map(([key, detail]) => [key, redactPrivateDetails(detail)]));
  };
  return {
    code: errorCode(error, fallbackCode),
    message,
    stage,
    details: redactPrivateDetails({ ...sourceDetails, ...extraDetails }),
  };
}

function referenceImages(value) {
  // 不再截断：上限由 H3(plan 构建)统一校验；非 H3 配置保持不设新上限。
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function appendStyle(prompt, style) {
  const cleanStyle = String(style || '').trim();
  if (!cleanStyle) return String(prompt || '');
  const base = String(prompt || '');
  if (base.toLowerCase().includes(cleanStyle.toLowerCase())) return base;
  return base ? `${base}. Style: ${cleanStyle}` : `Style: ${cleanStyle}`;
}

// H3 配置判定(comfyui + H3 模型命名,或 minimax_h3 协议)。
// 模块级导出:草稿 compile 路由入口用同一判定把关非 H3 配置(Task 16 交接③)。
function isH3VideoConfig(resolved) {
  const provider = String(resolved?.provider || resolved?.config?.provider || '').toLowerCase();
  const protocol = String(resolved?.protocol || resolved?.config?.api_protocol || '').toLowerCase();
  const model = String(resolved?.model || resolved?.config?.default_model || '').toLowerCase();
  return provider === 'comfyui' && (model === 'h3-continuity-v1' || model === 'minimax_h3_director_r2v' || model.includes('minimaxh3') || model.includes('minimax-h3'))
    || protocol === 'minimax_h3';
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text ?? '')).digest('hex');
}

function createUnifiedVideoGenerationService({
  db,
  log,
  providerRegistry,
  schedule = (job, delay = 0) => (delay > 0 ? setTimeout(job, delay) : setImmediate(job)),
  pollIntervalMs = 1000,
  gpuBusyRetryDelayMs = 2000,
  transientRetryDelayMs = 90000,
  transientRetryLimit = 1,
  transientRetryCount = new Map(),
  legacyPollMaxAttempts = 300,
  legacyPollIntervalMs = 10000,
  prepareVideoOutput = videoService.prepareSuccessfulVideoOutput,
  importVideoArtifact = videoService.importSuccessfulVideoArtifact,
  h3PromptCompiler = createH3PromptCompiler(),
  h3PromptDraftService = null,
  workflowRegistry = null,
  allowExperimental = false,
} = {}) {
  if (!db) throw new Error('Unified video generation service requires a database');
  if (!log) throw new Error('Unified video generation service requires a logger');
  if (!providerRegistry) throw new Error('Unified video generation service requires a provider registry');

  const activeOperations = new Set();

  // H3 草稿门禁依赖:按 id 取草稿 + 失效评估(不编译,无 AI 依赖)。
  // workflowRegistry 与本服务收到的是同一实例,保证草稿快照/指纹与生成解析同形状。
  const h3Drafts = h3PromptDraftService || createH3PromptDraftService({ workflowRegistry, allowExperimental });

  function tableHasColumn(table, column) {
    try { return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column); } catch (_) { return false; }
  }

  function rawRow(id) {
    return db.prepare(
      'SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL'
    ).get(Number(id));
  }

  function requireRow(id) {
    const row = rawRow(id);
    if (!row) throw new VideoLifecycleError('VIDEO_GENERATION_NOT_FOUND', '视频生成任务不存在', 404);
    return row;
  }

  function snapshotFor(row) {
    const snapshot = parseJsonObject(row.config_snapshot);
    if (!snapshot || snapshot.configId == null || !snapshot.provider || !snapshot.model) {
      throw new VideoLifecycleError(
        'VIDEO_CONFIG_SNAPSHOT_INVALID',
        '原始视频配置快照缺失或无效，无法安全继续任务',
        409,
        { videoGenerationId: row.id },
      );
    }
    return snapshot;
  }

  function assertSafeComfyuiSubmissionSnapshot(row, snapshot = snapshotFor(row)) {
    if (String(snapshot.provider || row.provider || '').trim().toLowerCase() !== 'comfyui') return snapshot;
    if (Number(snapshot.workflowSnapshotVersion) === 1) return snapshot;
    throw new VideoLifecycleError(
      'VIDEO_WORKFLOW_SNAPSHOT_LEGACY_UNSAFE',
      '历史 ComfyUI 任务缺少不可变工作流快照，无法安全重新提交',
      409,
      { videoGenerationId: row.id },
    );
  }

  function configFor(row, snapshot) {
    const config = db.prepare(
      'SELECT * FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL AND is_active = 1'
    ).get(Number(snapshot.configId));
    const base = config || {};
    return {
      originalConfigFound: Boolean(config),
      config: {
        ...base,
        id: snapshot.configId,
        provider: snapshot.provider,
        api_protocol: snapshot.protocol,
        base_url: snapshot.baseUrl,
        endpoint: snapshot.endpoint,
        query_endpoint: snapshot.queryEndpoint,
        model: [snapshot.model],
        default_model: snapshot.model,
        settings: snapshot.settings || {},
      },
    };
  }

  function parseReferenceAudios(value) {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
}

function inputFor(row) {
    const refs = referenceImages(row.reference_image_urls);
    return {
      dramaId: row.drama_id,
      drama_id: row.drama_id,
      storyboardId: row.storyboard_id,
      storyboard_id: row.storyboard_id,
      prompt: row.prompt,
      negativePrompt: row.negative_prompt,
      negative_prompt: row.negative_prompt,
      duration: row.duration,
      durationSeconds: row.duration,
      aspectRatio: row.aspect_ratio,
      aspect_ratio: row.aspect_ratio,
      resolution: row.resolution,
      width: row.width,
      height: row.height,
      frameRate: row.frame_rate,
      frame_rate: row.frame_rate,
      seed: row.seed,
      cameraFixed: row.camera_fixed,
      camera_fixed: row.camera_fixed,
      watermark: row.watermark,
      continuityMode: row.continuity_mode,
      continuity_mode: row.continuity_mode,
      anchorId: row.anchor_id,
      anchor_id: row.anchor_id,
      candidateGroupId: row.candidate_group_id,
      candidate_group_id: row.candidate_group_id,
      imageUrl: row.image_url,
      image_url: row.image_url,
      firstFrameUrl: row.first_frame_url,
      first_frame_url: row.first_frame_url,
      lastFrameUrl: row.last_frame_url,
      last_frame_url: row.last_frame_url,
      referenceUrls: refs,
      reference_urls: refs,
      referenceAudios: parseReferenceAudios(row.reference_audios),
      reference_audios: row.reference_audios || null,
    };
  }

  function contextFor(row) {
    const snapshot = snapshotFor(row);
    const original = configFor(row, snapshot);
    return {
      videoGenerationId: row.id,
      taskId: row.task_id,
      providerTaskId: row.provider_task_id || null,
      model: snapshot.model,
      snapshot,
      config: original.config,
      originalConfigFound: original.originalConfigFound,
      input: inputFor(row),
      promptFormat: row.prompt_format || null,
      promptCompilerVersion: row.prompt_compiler_version || null,
      skillName: row.h3_skill_name || null,
      skillSha256: row.h3_skill_sha256 || null,
      skillProvenance: parseJsonObject(row.h3_skill_provenance),
    };
  }

  function updateAsyncTask(row, status, progress, message) {
    if (!row.task_id) return;
    if (status === 'review' || status === 'selected') return;
    if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return;
    const taskStatus = status === 'waiting' ? 'pending' : 'processing';
    taskService.updateTaskStatus(db, row.task_id, taskStatus, progress, message);
    db.prepare('UPDATE async_tasks SET error = NULL, result = NULL WHERE id = ?').run(row.task_id);
  }

  function setState(row, status, progress, message, fields = {}) {
    const now = new Date().toISOString();
    const assignments = ['status = ?', 'updated_at = ?'];
    const params = [status, now];
    if (status === 'queued' && tableHasColumn('video_generations', 'started_at') && !row.started_at) {
      assignments.push('started_at = ?');
      params.push(now);
    }
    for (const [column, value] of Object.entries(fields)) {
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    params.push(row.id);
    db.prepare(`UPDATE video_generations SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    updateAsyncTask({ ...row, ...fields }, status, progress, message);
  }

  function persistFailure(row, error, stage, status = 'failed', fallbackCode = 'VIDEO_PROVIDER_ERROR') {
    const normalized = structuredError(error, stage, fallbackCode, {
      provider: row.provider || null,
    });
    const serialized = JSON.stringify(normalized);
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE video_generations SET status = ?, error_msg = ?, updated_at = ?, completed_at = ? WHERE id = ?'
    ).run(status, serialized, now, now, row.id);
    if (row.task_id) {
      taskService.updateTaskError(db, row.task_id, serialized);
      if (status === 'cancelled') {
        db.prepare('UPDATE async_tasks SET progress = 100 WHERE id = ?').run(row.task_id);
      }
    }
    log.error('Unified video generation failed', {
      videoGenerationId: row.id,
      code: normalized.code,
      stage,
    });
    return normalized;
  }

  function isGpuBusyError(error) {
    const code = String(error?.code || '').trim().toUpperCase();
    const message = String(error?.message || error || '').trim().toUpperCase();
    return code === 'GPU_BUSY' || message === 'GPU_BUSY';
  }

  function isTransientComfyExecutionError(row, error) {
    if (String(row?.provider || '').trim().toLowerCase() !== 'comfyui') return false;
    const code = String(error?.code || '').trim();
    const message = String(error?.message || error || '').trim();
    const details = error?.details && typeof error.details === 'object' ? JSON.stringify(error.details) : '';
    return /fault failed|out[ _-]?of[ _-]?memory|outofmemoryerror|\boom\b|cuda(?: error| out of memory)?|inference failed|comfyui execution failed/i.test(`${code} ${message} ${details}`);
  }

  function transientRetryMarker(retryCount, retryAt) {
    return JSON.stringify({
      code: 'COMFYUI_TRANSIENT_RETRY_PENDING',
      message: 'ComfyUI 瞬时失败，等待自动重新提交',
      retryCount,
      retryAt,
    });
  }

  function parseTransientRetryMarker(value) {
    const parsed = parseJsonObject(value);
    if (parsed?.code !== 'COMFYUI_TRANSIENT_RETRY_PENDING') return null;
    const retryCount = Number(parsed.retryCount);
    const retryAtMs = Date.parse(parsed.retryAt);
    if (!Number.isInteger(retryCount) || retryCount < 1) return null;
    return {
      retryCount,
      retryAtMs: Number.isFinite(retryAtMs) ? retryAtMs : Date.now(),
    };
  }

  function requeueTransientComfyFailure(row, error, stage) {
    const count = transientRetryCount.get(row.id) || 0;
    if (!isTransientComfyExecutionError(row, error) || count >= transientRetryLimit) return false;
    const retryCount = count + 1;
    const retryAt = new Date(Date.now() + transientRetryDelayMs).toISOString();
    transientRetryCount.set(row.id, retryCount);
    setState(row, 'queued', 1, 'ComfyUI 执行瞬时失败（显存/内存波动），90 秒后自动重新提交', {
      error_msg: transientRetryMarker(retryCount, retryAt),
      completed_at: null,
      provider_task_id: null,
    });
    log.warn('Transient ComfyUI execution failure, requeued', {
      videoGenerationId: row.id,
      stage,
      retry: retryCount,
      message: error?.message || String(error),
    });
    enqueueOperation(row.id, 'submit', transientRetryDelayMs);
    return true;
  }

  function legacyProvider(context) {
    return {
      async submit() {
        const input = context.input;
        const appConfig = require('../config').loadConfig();
        const filesBaseUrl = appConfig.storage?.base_url
          ? String(appConfig.storage.base_url).replace(/\/$/, '')
          : '';
        const configuredStoragePath = appConfig.storage?.local_path || './data/storage';
        const storageLocalPath = path.isAbsolute(configuredStoragePath)
          ? configuredStoragePath
          : path.join(process.cwd(), configuredStoragePath);
        const result = await videoClient.callVideoApi(db, log, {
          prompt: input.prompt,
          negative_prompt: input.negative_prompt,
          model: context.snapshot.model,
          duration: input.duration,
          aspect_ratio: input.aspect_ratio,
          resolution: input.resolution,
          width: input.width,
          height: input.height,
          frame_rate: input.frame_rate,
          seed: input.seed,
          camera_fixed: input.camera_fixed,
          watermark: input.watermark,
          provider: context.snapshot.provider,
          drama_id: input.drama_id,
          storyboard_id: input.storyboard_id || undefined,
          image_url: input.reference_urls.length ? undefined : input.image_url,
          first_frame_url: input.reference_urls.length ? undefined : input.first_frame_url,
          last_frame_url: input.reference_urls.length ? undefined : input.last_frame_url,
          reference_urls: input.reference_urls,
          files_base_url: filesBaseUrl,
          storage_local_path: storageLocalPath,
          video_gen_id: context.videoGenerationId,
        }, context.config);
        if (result?.error) throw new Error(result.error);
        if (result?.video_url) {
          return { providerTaskId: null, status: 'completed', progress: 100, output: { videoUrl: result.video_url } };
        }
        if (result?.task_id) {
          return { providerTaskId: String(result.task_id), status: 'queued', progress: 5, output: null };
        }
        throw new Error('VIDEO_PROVIDER_RESULT_INVALID');
      },
      async query() {
        const result = await videoClient.pollVideoTask(
          db,
          log,
          context.videoGenerationId,
          context.providerTaskId,
          context.config,
          legacyPollMaxAttempts,
          legacyPollIntervalMs,
        );
        if (result?.error) throw new Error(result.error);
        return {
          providerTaskId: context.providerTaskId,
          status: 'completed',
          progress: 100,
          output: { videoUrl: result.video_url },
        };
      },
      async recover() {
        return this.query();
      },
      async cancel() {
        return { providerTaskId: context.providerTaskId, status: 'cancelled', progress: 100, output: null };
      },
    };
  }

  function providerFor(context) {
    const providerName = String(context.snapshot.provider || '').trim().toLowerCase();
    if (!context.originalConfigFound && providerName !== 'comfyui') {
      throw new VideoLifecycleError(
        'VIDEO_CONFIG_CREDENTIALS_MISSING',
        '原始视频配置已不存在，无法取得任务所需凭据',
        409,
        { configId: context.snapshot.configId, provider: providerName },
      );
    }
    if (providerRegistry.has(providerName)) return providerRegistry.get(providerName);
    return legacyProvider(context);
  }

  function providerErrorFromResult(result, fallback) {
    const outputError = result?.output?.error;
    if (outputError instanceof Error) return outputError;
    if (outputError && typeof outputError === 'object') {
      return Object.assign(new Error(outputError.message || fallback), outputError);
    }
    return new Error(String(outputError || fallback));
  }

  async function persistReview(row, result, { status = 'review' } = {}) {
    const output = result?.output && typeof result.output === 'object' ? result.output : {};
    const videoUrl = output.videoUrl || output.video_url || output.url || null;
    const artifactPath = output.artifactPath || output.artifact_path || null;
    const localCandidate = output.localPath || output.local_path || artifactPath || null;
    let localPath = localCandidate;
    if (localCandidate && path.isAbsolute(String(localCandidate))) {
      localPath = typeof importVideoArtifact === 'function'
        ? await importVideoArtifact(db, log, row, String(localCandidate))
        : null;
      if (!localPath) {
        throw new VideoLifecycleError(
          'VIDEO_ARTIFACT_IMPORT_FAILED',
          'Video artifact could not be imported into configured storage',
          500,
          { videoGenerationId: row.id },
        );
      }
    }
    if (videoUrl && !localPath && typeof prepareVideoOutput === 'function') {
      localPath = await prepareVideoOutput(db, log, row, videoUrl);
    }
    const latest = rawRow(row.id);
    if (!latest || latest.status === 'cancelled') {
      log.info('Ignored late video provider result after local cancellation', { videoGenerationId: row.id });
      return;
    }
    const finalStatus = status === 'selected' || latest.status === 'selected' ? 'selected' : 'review';
    const now = new Date().toISOString();
    const executionTiming = output.executionTiming && typeof output.executionTiming === 'object'
      ? output.executionTiming : {};
    const providerStartedAt = Number.isFinite(Date.parse(executionTiming.startedAt))
      ? new Date(executionTiming.startedAt).toISOString() : null;
    const providerCompletedAt = Number.isFinite(Date.parse(executionTiming.completedAt))
      ? new Date(executionTiming.completedAt).toISOString() : null;
    const timingAssignment = tableHasColumn('video_generations', 'started_at') ? ', started_at = ?' : '';
    const timingParams = timingAssignment ? [providerStartedAt || latest.started_at || now] : [];
    db.prepare(
      `UPDATE video_generations
       SET status = ?, video_url = ?, local_path = ?, error_msg = NULL,
           completed_at = ?, updated_at = ?${timingAssignment} WHERE id = ?`
    ).run(finalStatus, videoUrl, localPath, providerCompletedAt || now, now, ...timingParams, row.id);
    transientRetryCount.delete(row.id);
    if (latest.candidate_group_id) {
      try {
        const artifact = candidateService.linkUnifiedCandidateArtifact(db, row.id, { ffprobe: output.ffprobe });
        if (!artifact) {
          throw new VideoLifecycleError(
            'VIDEO_ARTIFACT_IMPORT_FAILED',
            '候选视频未能建立可检查的本地产物',
            500,
            { videoGenerationId: row.id },
          );
        }
      } catch (error) {
        // A review candidate without a real local artifact cannot be QC'd or anchored.
        persistFailure({ ...latest, status: finalStatus }, error, 'artifact');
        throw error;
      }
    }
    if (latest.task_id) {
      taskService.updateTaskResult(db, latest.task_id, {
        video_generation_id: row.id,
        video_url: videoUrl,
        local_path: localPath,
        status: 'completed',
        lifecycle_status: finalStatus,
      });
    }
    log.info('Unified video generation completed', { videoGenerationId: row.id, status: finalStatus });
  }

  function enqueueOperation(id, operation, delay = 0) {
    schedule(() => processVideoGeneration(id, { operation }).catch((error) => {
      const row = rawRow(id);
      if (row && !TERMINAL_STATUSES.has(row.status)) persistFailure(row, error, operation);
    }), delay);
  }

  async function applyProviderResult(row, result, stage) {
    const latest = rawRow(row.id);
    if (!latest || latest.status === 'cancelled') {
      log.info('Ignored late video provider result', { videoGenerationId: row.id, stage });
      return;
    }
    if (!result || typeof result !== 'object') {
      persistFailure(latest, new Error('VIDEO_PROVIDER_RESULT_INVALID'), stage, 'failed', 'VIDEO_PROVIDER_RESULT_INVALID');
      return;
    }
    const status = normalizeProviderStatus(result.status);
    const providerTaskId = result.providerTaskId || latest.provider_task_id || null;
    const progress = normalizeProgress(result.progress, status === 'review' ? 100 : 0);

    if (status === 'failed') {
      const providerError = providerErrorFromResult(result, '视频生成服务返回失败');
      if (requeueTransientComfyFailure({ ...latest, provider_task_id: providerTaskId }, providerError, stage)) return;
      transientRetryCount.delete(latest.id);
      persistFailure(
        { ...latest, provider_task_id: providerTaskId },
        providerError,
        stage,
      );
      if (providerTaskId && providerTaskId !== latest.provider_task_id) {
        db.prepare('UPDATE video_generations SET provider_task_id = ? WHERE id = ?').run(providerTaskId, latest.id);
      }
      return;
    }
    if (status === 'cancelled') {
      transientRetryCount.delete(latest.id);
      persistFailure(latest, new Error('视频生成已取消'), stage, 'cancelled', 'VIDEO_CANCELLED');
      return;
    }
    if (status === 'interrupted') {
      transientRetryCount.delete(latest.id);
      persistFailure(latest, new Error('视频生成执行中断'), stage, 'interrupted', 'VIDEO_EXECUTION_INTERRUPTED');
      return;
    }
    if (status === 'review' || status === 'selected') {
      if (providerTaskId && providerTaskId !== latest.provider_task_id) {
        db.prepare('UPDATE video_generations SET provider_task_id = ? WHERE id = ?').run(providerTaskId, latest.id);
      }
      await persistReview({ ...latest, provider_task_id: providerTaskId }, result, { status });
      return;
    }

    const message = status === 'queued' ? '视频生成已排队' : status === 'running' ? '视频生成中' : '等待视频生成';
    setState(latest, status, progress, message, {
      provider_task_id: providerTaskId,
      error_msg: null,
      completed_at: null,
    });
    if ((status === 'waiting' || status === 'queued' || status === 'running') && providerTaskId) {
      enqueueOperation(latest.id, 'query', pollIntervalMs);
    }
  }

  async function processVideoGeneration(id, { operation } = {}) {
    const numericId = Number(id);
    if (activeOperations.has(numericId)) return;
    activeOperations.add(numericId);
    let row;
    let stage = operation || 'submit';
    try {
      row = requireRow(numericId);
      if (row.status === 'cancelled') return;
      const context = contextFor(row);
      const provider = providerFor(context);
      if (!operation) {
        stage = row.provider_task_id ? 'query' : 'submit';
      }
      let result;
      if (stage === 'submit') {
        if (row.provider_task_id) stage = 'query';
        else {
          assertSafeComfyuiSubmissionSnapshot(row, context.snapshot);
          setState(row, 'queued', 1, '正在提交视频生成任务', { error_msg: null, completed_at: null });
          result = await provider.submit(context);
        }
      }
      if (stage === 'query') result = await provider.query(context);
      if (stage === 'recover') {
        result = typeof provider.recover === 'function'
          ? await provider.recover(context)
          : await provider.query(context);
      }
      await applyProviderResult(row, result, stage);
    } catch (error) {
      const latest = row && rawRow(row.id);
      if (latest && latest.status !== 'cancelled' && stage === 'submit' && isGpuBusyError(error)) {
        setState(latest, 'queued', 1, 'ComfyUI GPU 正忙，等待上一个视频任务完成后重试', {
          error_msg: null,
          completed_at: null,
        });
        enqueueOperation(latest.id, 'submit', gpuBusyRetryDelayMs);
      } else if (latest && latest.status !== 'cancelled' && requeueTransientComfyFailure(latest, error, stage)) {
        // Delayed fresh submission scheduled above.
      } else if (latest && latest.status !== 'cancelled') {
        transientRetryCount.delete(latest.id);
        persistFailure(latest, error, stage);
      }
      else if (!latest) throw error;
    } finally {
      activeOperations.delete(numericId);
    }
  }

  /**
   * H3 候选生成草稿门禁(spec §11.4):候选接口不得调用 H3 技能、不得重新编译,
   * 只消费草稿——重算指纹、读取 final_compiled_prompt、验证哈希后原样提交。
   * 错误语义:H3_DRAFT_REQUIRED / DRAFT_NOT_FOUND / H3_DRAFT_STORYBOARD_MISMATCH → 400;
   * H3_DRAFT_CONFIG_MISMATCH / H3_DRAFT_STALE / H3_DRAFT_INVALID / H3_DRAFT_HASH_MISMATCH → 409。
   */
  function requireH3PromptDraft(input, resolved, storyboardId, workflow = null) {
    const draftId = input.h3_prompt_draft_id ?? input.h3PromptDraftId;
    if (draftId == null || String(draftId).trim() === '') {
      throw new VideoLifecycleError(
        'H3_DRAFT_REQUIRED',
        'H3 配置需先生成提示词草稿,再提交候选生成',
        400,
      );
    }
    let draft = h3Drafts.getDraftById(db, draftId);
    if (!draft) {
      throw new VideoLifecycleError('DRAFT_NOT_FOUND', 'H3 提示词草稿不存在,请重新生成', 400, { draftId });
    }
    if (Number.isFinite(storyboardId) && Number(draft.storyboard_id) !== Number(storyboardId)) {
      throw new VideoLifecycleError(
        'H3_DRAFT_STORYBOARD_MISMATCH',
        '提示词草稿属于其他分镜,请重新生成',
        400,
        { draftId, storyboardId },
      );
    }
    if (String(draft.video_config_id ?? '') !== String(resolved.config.id)) {
      throw new VideoLifecycleError(
        'H3_DRAFT_CONFIG_MISMATCH',
        '提示词草稿与当前视频配置不一致,请重新生成 H3 提示词',
        409,
        { draft_video_config_id: draft.video_config_id ?? null, video_config_id: resolved.config.id },
      );
    }
    if (workflow && !String(draft.workflow_id || '').trim() && typeof h3Drafts.resolveDraftWorkflow === 'function') {
      draft = h3Drafts.resolveDraftWorkflow(db, draft, workflow.id);
    }
    if (workflow && String(draft.workflow_id || '') !== String(workflow.id)) {
      throw new VideoLifecycleError(
        'H3_DRAFT_WORKFLOW_MISMATCH',
        '提示词草稿属于其他工作流，请重新生成',
        409,
        { draft_workflow_id: draft.workflow_id || null, workflow_id: workflow.id },
      );
    }
    // 时长一致性门禁:草稿按分镜行时长编译并固化在 generation_params.durationSeconds,
    // 候选请求的时长若被面板改动(1-60),提交的视频会与提示词节奏矛盾 → 409。
    // request duration 取值口径与 createVideoGeneration 一致(input.duration,可能由
    // director 路由从 structured.durationSeconds 映射而来);缺省时走分镜行时长,与草稿一致,不拦。
    const draftParams = parseJsonObject(draft.generation_params);
    const draftDuration = Number(draftParams?.durationSeconds);
    const requestDuration = Number(input.duration);
    if (Number.isFinite(draftDuration) && draftDuration > 0
      && Number.isFinite(requestDuration) && requestDuration > 0
      && Math.abs(draftDuration - requestDuration) > 1e-6) {
      throw new VideoLifecycleError(
        'H3_DRAFT_STALE',
        `候选时长(${requestDuration}秒)与草稿编译时长(${draftDuration}秒)不一致,请重新生成 H3 提示词或改回时长`,
        409,
        { draft_duration: draftDuration, request_duration: requestDuration },
      );
    }
    const freshness = h3Drafts.evaluateDraftFreshness(db, draft);
    if (freshness.stale) {
      throw new VideoLifecycleError(
        'H3_DRAFT_STALE',
        '提示词草稿的来源已变化,请重新生成 H3 提示词',
        409,
        { reasons: freshness.reasons },
      );
    }
    if (draft.status !== 'valid') {
      throw new VideoLifecycleError(
        'H3_DRAFT_INVALID',
        '提示词草稿未通过结构校验,请修正文本后再生成',
        409,
        { validation_errors: parseJsonObject(draft.validation_errors) },
      );
    }
    if (String(draft.compiled_prompt_hash ?? '') !== sha256Hex(draft.final_compiled_prompt)) {
      throw new VideoLifecycleError(
        'H3_DRAFT_HASH_MISMATCH',
        '提示词草稿哈希校验失败,请重新生成 H3 提示词',
        409,
      );
    }
    // 沿用草稿的 prompt_format / skill 列写 video_generations(现有列继续写)。
    return {
      prompt: String(draft.final_compiled_prompt ?? ''),
      compiled: {
        sourcePrompt: draft.source_prompt ?? null,
        compiledPrompt: draft.final_compiled_prompt,
        promptFormat: draft.prompt_format ?? null,
        compilerVersion: draft.skill_version ?? null,
        skillProvenance: parseJsonObject(draft.skill_provenance),
      },
    };
  }

  async function createVideoGeneration(input = {}) {
    const baseResolved = resolveDefaultVideoConfig(db);
    const selection = workflowRegistry
      ? resolveRequestedWorkflow({ input, resolved: baseResolved, registry: workflowRegistry, allowExperimental })
      : {
        selectedWorkflowId: null,
        workflow: null,
        resolved: resolveDefaultVideoConfig(db, { requestedModel: input.model }),
      };
    const { resolved, workflow } = selection;
    const settings = resolved.config?.settings || {};
    const now = new Date().toISOString();
    const dramaId = Number(input.drama_id ?? input.dramaId) || 0;
    const storyboardValue = input.storyboard_id ?? input.storyboardId;
    const storyboardId = storyboardValue == null ? null : Number(storyboardValue);
    const refs = referenceImages(input.reference_image_urls ?? input.referenceUrls);
    let aspectRatio = videoClient.normalizeAspectRatioForApi(input.aspect_ratio ?? input.aspectRatio);
    if (!aspectRatio && dramaId) {
      try {
        const drama = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
        const metadata = parseJsonObject(drama?.metadata);
        aspectRatio = videoClient.normalizeAspectRatioForApi(metadata?.aspect_ratio);
      } catch (_) {}
    }
    let duration = input.duration ?? null;
    if (duration == null && Number.isFinite(storyboardId)) {
      try {
        const storyboard = db.prepare('SELECT duration FROM storyboards WHERE id = ?').get(storyboardId);
        if (Number(storyboard?.duration) > 0) duration = Number(storyboard.duration);
      } catch (_) {}
    }
    if (workflow?.adapter && !(Number(duration) > 0)) duration = 5;
    const sourcePrompt = appendStyle(input.prompt, input.style);
    let prompt = sourcePrompt;
    let compiled = null;
    const requiresDraft = workflow ? workflowRequiresDraft(workflow) : isH3VideoConfig(resolved);
    if (requiresDraft) {
      // H3 分支不再内部编译:消费草稿(spec §11.4)。非 H3 配置完全走旧路径(忽略 h3_prompt_draft_id)。
      const gate = requireH3PromptDraft(input, resolved, storyboardId, workflow);
      prompt = gate.prompt;
      compiled = gate.compiled;
    }
    let planResult = null;
    let resolvedParameters = null;
    if (workflow) {
      validateWorkflowReferences(workflow, refs);
      resolvedParameters = resolveWorkflowParameters(workflow, { ...input, duration }, resolved.config);
      duration = resolvedParameters.durationSeconds;
    }
    if (workflow?.adapter && workflow.execution?.promptContract === 'h3_director_v1') {
      planResult = buildVideoGenerationPlan({
        prompt,
        negativePrompt: input.negativePrompt ?? input.negative_prompt,
        reference_image_urls: refs,
        workflow_id: workflow.id,
        generation_mode: input.generation_mode ?? input.generationMode,
        storyboard_id: storyboardId,
        continuity_enabled: false,
        width: resolvedParameters.width,
        height: resolvedParameters.height,
        durationSeconds: resolvedParameters.durationSeconds,
        frameRate: resolvedParameters.frameRate,
        seed: resolvedParameters.seed,
      }, { workflowId: workflow.id });
    }
    const planCommon = planResult?.plan?.common || resolvedParameters;
    if (planCommon) {
      duration = planCommon.durationSeconds;
    }
    const snapshot = buildVideoConfigSnapshot({
      ...resolved,
      workflow,
      workflowId: workflow?.id || resolved.model,
      generationMode: planResult?.plan.mode || input.generation_mode || 'single_reference',
      planHash: planResult?.planHash || null,
      effectiveParameters: planCommon,
    });
    const snapshotSettings = snapshot.settings || {};
    let createdId;

    db.transaction(() => {
      const task = taskService.createTask(db, log, 'video_generation', String(dramaId || ''));
      const columns = [
        'drama_id', 'storyboard_id', 'provider', 'protocol', 'prompt', 'negative_prompt', 'model',
        'config_id', 'config_snapshot', 'duration', 'aspect_ratio', 'resolution', 'width', 'height',
        'frame_rate', 'seed', 'camera_fixed', 'watermark', 'continuity_mode', 'anchor_id',
        'candidate_group_id', 'image_url', 'first_frame_url', 'last_frame_url',
        'reference_image_urls',
      ];
      const values = [
        dramaId,
        Number.isFinite(storyboardId) ? storyboardId : null,
        snapshot.provider,
        snapshot.protocol,
        prompt,
        input.negative_prompt ?? input.negativePrompt ?? null,
        snapshot.model,
        snapshot.configId,
        JSON.stringify(snapshot),
        duration,
        aspectRatio,
        input.resolution ?? null,
        planCommon?.width ?? input.width ?? snapshotSettings.width ?? null,
        planCommon?.height ?? input.height ?? snapshotSettings.height ?? null,
        planCommon?.frameRate ?? input.frame_rate ?? input.frameRate ?? snapshotSettings.frame_rate ?? null,
        planCommon?.seed ?? input.seed ?? snapshotSettings.seed ?? null,
        input.camera_fixed != null ? (input.camera_fixed ? 1 : 0) : null,
        input.watermark != null ? (input.watermark ? 1 : 0) : 0,
        workflow?.capabilities?.supportsContinuity === false ? 'none' : (input.continuity_mode ?? input.continuityMode ?? snapshotSettings.continuity_mode ?? null),
        input.anchor_id ?? input.anchorId ?? null,
        input.candidate_group_id ?? input.candidateGroupId ?? null,
        input.image_url ?? input.imageUrl ?? null,
        input.first_frame_url ?? input.firstFrameUrl ?? input.first_frame_local_path ?? null,
        input.last_frame_url ?? input.lastFrameUrl ?? input.last_frame_local_path ?? null,
        refs.length ? JSON.stringify(refs) : null,
      ];
      if (tableHasColumn('video_generations', 'source_prompt')) { columns.push('source_prompt'); values.push(compiled?.sourcePrompt || null); }
      if (tableHasColumn('video_generations', 'compiled_prompt')) { columns.push('compiled_prompt'); values.push(compiled?.compiledPrompt || null); }
      if (tableHasColumn('video_generations', 'prompt_format')) { columns.push('prompt_format'); values.push(compiled?.promptFormat || null); }
      if (tableHasColumn('video_generations', 'prompt_compiler_version')) { columns.push('prompt_compiler_version'); values.push(compiled?.compilerVersion || null); }
      if (tableHasColumn('video_generations', 'prompt_compile_status')) { columns.push('prompt_compile_status'); values.push(compiled ? 'compiled' : null); }
      if (tableHasColumn('video_generations', 'h3_skill_name')) { columns.push('h3_skill_name'); values.push(compiled?.skillProvenance?.skillName || null); }
      if (tableHasColumn('video_generations', 'h3_skill_sha256')) { columns.push('h3_skill_sha256'); values.push(compiled?.skillProvenance?.skillSha256 || null); }
      if (tableHasColumn('video_generations', 'h3_skill_provenance')) {
        const provenance = compiled?.skillProvenance;
        columns.push('h3_skill_provenance');
        values.push(provenance ? JSON.stringify(provenance) : null);
      }
      if (tableHasColumn('video_generations', 'reference_audios')) {
        const refAudios = Array.isArray(input.reference_audios) ? input.reference_audios : [];
        columns.push('reference_audios');
        values.push(refAudios.length ? JSON.stringify(refAudios) : null);
      }
      columns.push('status', 'task_id', 'created_at', 'updated_at');
      values.push('waiting', task.id, now, now);
      const result = db.prepare(`INSERT INTO video_generations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values);
      createdId = Number(result.lastInsertRowid);
    })();

    enqueueOperation(createdId, 'submit');
    return getVideoGeneration(createdId);
  }

  async function previewH3Prompt(input = {}) {
    const baseResolved = resolveDefaultVideoConfig(db);
    const selection = workflowRegistry
      ? resolveRequestedWorkflow({ input, resolved: baseResolved, registry: workflowRegistry, allowExperimental })
      : null;
    const workflow = selection?.workflow || null;
    if (!workflow || workflow.execution?.promptContract !== 'h3_director_v1' || !workflowRequiresDraft(workflow)) {
      throw new VideoLifecycleError('H3_PREVIEW_UNSUPPORTED', '当前视频配置不是 ComfyUI H3 工作流', 409);
    }
    return h3PromptCompiler.compile(db, log, { ...input, prompt: appendStyle(input.prompt, input.style) });
  }

  async function cancelVideoGeneration(id) {
    const row = requireRow(id);
    if (!ACTIVE_STATUSES.has(row.status) && row.status !== 'processing') {
      throw new VideoLifecycleError('VIDEO_NOT_CANCELLABLE', '当前视频任务状态不可取消', 409, { status: row.status });
    }
    const cancellation = structuredError(
      new Error('用户已取消视频生成'),
      'cancel',
      'VIDEO_CANCELLED',
      { provider: row.provider || null },
    );
    const serialized = JSON.stringify(cancellation);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE video_generations
       SET status = 'cancelled', error_msg = ?, completed_at = ?, updated_at = ? WHERE id = ?`
    ).run(serialized, now, now, row.id);
    if (row.task_id) {
      taskService.updateTaskError(db, row.task_id, serialized);
      db.prepare('UPDATE async_tasks SET progress = 100 WHERE id = ?').run(row.task_id);
    }

    if (row.provider_task_id) {
      try {
        const context = contextFor(row);
        const provider = providerFor(context);
        if (typeof provider.cancel === 'function') await provider.cancel(context);
      } catch (error) {
        log.warn('Provider cancellation failed after local cancellation', {
          videoGenerationId: row.id,
          error: error.message,
        });
      }
    }
    return getVideoGeneration(row.id);
  }

  async function retryVideoGeneration(id) {
    const row = requireRow(id);
    if (!RETRYABLE_STATUSES.has(row.status)) {
      throw new VideoLifecycleError('VIDEO_NOT_RETRYABLE', '仅失败或中断的视频任务可以重试', 409, { status: row.status });
    }
    const snapshot = snapshotFor(row);
    if (!row.provider_task_id) assertSafeComfyuiSubmissionSnapshot(row, snapshot);
    const task = taskService.createTask(db, log, 'video_generation', String(row.drama_id || ''));
    const status = row.provider_task_id ? 'queued' : 'waiting';
    const now = new Date().toISOString();
    const startedReset = tableHasColumn('video_generations', 'started_at') ? ', started_at = NULL' : '';
    db.prepare(
      `UPDATE video_generations
       SET status = ?, task_id = ?, error_msg = NULL, completed_at = NULL, updated_at = ?${startedReset} WHERE id = ?`
    ).run(status, task.id, now, row.id);
    if (status === 'queued') taskService.updateTaskStatus(db, task.id, 'processing', 1, '正在继续查询原视频任务');
    enqueueOperation(row.id, row.provider_task_id ? 'recover' : 'submit');
    return getVideoGeneration(row.id);
  }

  async function selectVideoGeneration(id) {
    const row = requireRow(id);
    if (row.status === 'selected') return getVideoGeneration(row.id);
    if (!['review', 'completed'].includes(row.status)) {
      throw new VideoLifecycleError('VIDEO_NOT_SELECTABLE', '仅待审核的视频可以选用', 409, { status: row.status });
    }
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("UPDATE video_generations SET status = 'selected', updated_at = ? WHERE id = ?")
        .run(now, row.id);
      if (row.storyboard_id != null) {
        db.prepare(`UPDATE storyboards SET video_url = ?, local_path = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`)
          .run(row.video_url || null, row.local_path || null, now, row.storyboard_id);
      }
    })();
    return getVideoGeneration(row.id);
  }

  async function recoverVideoGenerations() {
    const rows = db.prepare(
      `SELECT * FROM video_generations
       WHERE status IN ('waiting', 'queued', 'running')
         AND config_snapshot IS NOT NULL AND TRIM(config_snapshot) != ''
         AND deleted_at IS NULL`
    ).all();
    for (const row of rows) {
      if (row.provider_task_id && String(row.provider_task_id).trim()) {
        updateAsyncTask(row, 'queued', 1, '正在恢复原视频任务');
        enqueueOperation(row.id, 'recover');
      } else if (row.status === 'waiting') {
        try {
          assertSafeComfyuiSubmissionSnapshot(row);
        } catch (error) {
          persistFailure(row, error, 'recover');
          continue;
        }
        updateAsyncTask(row, 'waiting', 0, '等待恢复视频生成');
        enqueueOperation(row.id, 'submit');
      } else if (row.status === 'queued') {
        const marker = parseTransientRetryMarker(row.error_msg);
        if (marker && marker.retryCount <= transientRetryLimit) {
          try {
            assertSafeComfyuiSubmissionSnapshot(row);
          } catch (error) {
            persistFailure(row, error, 'recover');
            continue;
          }
          transientRetryCount.set(row.id, marker.retryCount);
          updateAsyncTask(row, 'queued', 1, '正在恢复 ComfyUI 自动重试');
          enqueueOperation(row.id, 'submit', Math.max(0, marker.retryAtMs - Date.now()));
        } else {
          persistFailure(row, new Error('服务重启后缺少上游任务 ID，无法恢复'), 'recover', 'interrupted', 'VIDEO_EXECUTION_INTERRUPTED');
        }
      } else {
        persistFailure(row, new Error('服务重启后缺少上游任务 ID，无法恢复'), 'recover', 'interrupted', 'VIDEO_EXECUTION_INTERRUPTED');
      }
    }
    return rows.length;
  }

  function getVideoGeneration(id) {
    return videoService.getById(db, id);
  }

  function getVideoCapabilities() {
    const resolved = resolveDefaultVideoConfig(db);
    if (resolved.provider !== 'comfyui' || !workflowRegistry) {
      return {
        provider: resolved.provider,
        protocol: resolved.protocol,
        model: resolved.model,
        workflow: null,
        defaultWorkflowStatus: 'not_applicable',
        workflows: [],
        capabilities: null,
        connection: { status: 'unknown', inferenceStarted: false },
      };
    }
    const catalog = listWorkflowCatalog(workflowRegistry, { allowExperimental });
    const byId = new Map(catalog.map((item) => [item.id, item]));
    const configuredIds = parseModelList(resolved.config.model);
    const workflows = configuredIds.map((id) => {
      const item = byId.get(id);
      if (!item) {
        return {
          id,
          status: 'missing',
          selectable: false,
          unavailableReason: 'WORKFLOW_NOT_FOUND',
          default: id === resolved.model,
          variant: null,
          family: null,
          adapter: null,
          adapterVersion: null,
          workflowSha256: null,
          execution: null,
          capabilities: null,
        };
      }
      return { ...item, default: id === resolved.model };
    });
    const defaultItem = workflows.find((item) => item.default) || null;
    const workflow = defaultItem?.selectable
      ? workflowRegistry.workflows.find((entry) => entry.id === defaultItem.id) || null
      : null;
    const capabilities = workflow?.capabilities ? { ...workflow.capabilities } : {};
    if (workflow?.adapter) {
      const adapter = require('../director/workflowRegistry').getWorkflowAdapter(workflow);
      const template = readWorkflowTemplate(workflow.workflowPath);
      Object.assign(capabilities, adapter.describeCapabilities(template));
    }
    return {
      provider: resolved.provider,
      protocol: resolved.protocol,
      model: resolved.model,
      workflow: workflow ? {
        id: workflow.id,
        status: workflow.status,
        variant: workflow.variant,
        sha256: workflow.workflowSha256,
        execution: workflow.execution || null,
      } : null,
      defaultWorkflowStatus: workflow ? 'available' : 'unavailable',
      workflows,
      capabilities: Object.keys(capabilities).length ? capabilities : null,
      connection: { status: 'unknown', inferenceStarted: false },
    };
  }

  function getWorkflowCatalog() {
    return { workflows: listWorkflowCatalog(workflowRegistry, { allowExperimental }) };
  }

  return {
    createVideoGeneration,
    previewH3Prompt,
    cancelVideoGeneration,
    retryVideoGeneration,
    selectVideoGeneration,
    recoverVideoGenerations,
    processVideoGeneration,
    getVideoGeneration,
    getVideoCapabilities,
    getWorkflowCatalog,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  VideoLifecycleError,
  createUnifiedVideoGenerationService,
  normalizeProviderStatus,
  structuredError,
  isH3VideoConfig,
};
