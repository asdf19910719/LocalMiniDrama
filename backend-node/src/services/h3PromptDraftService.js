// H3 提示词草稿服务(单集制作包导入 Task 15):分镜 H3 提示词的指纹、编译、保存与失效评估。
// 草稿 = 某分镜在某视频配置下的可复用 H3 提示词缓存:
//   source_fingerprint 覆盖 [业务提示词, 槽位, 生成参数, 配置快照/工作流, 技能版本],
//   任一维度变化 → evaluateDraftFreshness 判 stale,由调用方决定重编译。
// 槽位唯一来源是 referenceSlotService(缺图判据只用 image_available 布尔);
// 配置解析复用 videoConfigResolver/videoGenerationSnapshot/workflowRegistry 的公开入口,
// 与 unifiedVideoGenerationService 的候选生成保持同形状(该文件本任务不改,见 task-15 报告差异说明)。

const crypto = require('node:crypto');

const { resolveStoryboardSlots, slotsFingerprint } = require('./referenceSlotService');
const { COMPILER_VERSION, validateH3Prompt, createH3PromptCompiler } = require('./h3PromptCompiler');
const { resolveVideoProtocol } = require('./videoConfigResolver');
const { buildVideoConfigSnapshot } = require('./videoGenerationSnapshot');
const { selectWorkflow } = require('../director/workflowRegistry');

// H3 参考图上限(方舟侧 1-9 张),与 unifiedVideoGenerationService 的统一校验一致。
const H3_MAX_SLOTS = 9;
// H3 直出含音频;settings.audio_enabled 可显式覆盖(当前无 UI 入口,留扩展位)。
const DEFAULT_AUDIO_ENABLED = true;
// 与 createVideoGeneration 的 plan 默认一致(input 未传时 settings.width ?? 864 / settings.height ?? 480)。
const DEFAULT_WIDTH = 864;
const DEFAULT_HEIGHT = 480;
const DEFAULT_DURATION_SECONDS = 5;

function draftError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details;
  return error;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalJson(value[key]);
    return out;
  }
  return value;
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
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

function normalizeModelList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch (_) {
    return [String(value)];
  }
}

function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 源指纹:sha256(canonical JSON,键排序)。任一维度变化 → 指纹变化。
 * videoConfigSnapshot 形状取自 unifiedVideoGenerationService 的 config_snapshot
 * (buildVideoConfigSnapshot 输出),workflowSha 取 workflow.workflowSha256('sha256:...' 或 null)。
 */
function computeSourceFingerprint(input = {}) {
  const payload = {
    sourcePrompt: String(input.sourcePrompt ?? ''),
    slotsFingerprint: String(input.slotsFingerprint ?? ''),
    durationSeconds: finiteNumber(input.durationSeconds, DEFAULT_DURATION_SECONDS) || DEFAULT_DURATION_SECONDS,
    width: finiteNumber(input.width),
    height: finiteNumber(input.height),
    audioEnabled: Boolean(input.audioEnabled),
    videoConfigSnapshot: input.videoConfigSnapshot ?? null,
    workflowSha: input.workflowSha == null ? null : String(input.workflowSha),
    skillVersion: String(input.skillVersion ?? ''),
  };
  return sha256Hex(JSON.stringify(canonicalJson(payload)));
}

function storyboardRow(db, storyboardId) {
  const sid = Number(storyboardId);
  if (!Number.isFinite(sid)) return null;
  return db.prepare(
    'SELECT id, universal_segment_text, video_prompt, duration FROM storyboards WHERE id = ? AND deleted_at IS NULL'
  ).get(sid) || null;
}

function businessPromptOf(storyboard) {
  if (!storyboard) return '';
  return String(storyboard.universal_segment_text ?? '').trim()
    || String(storyboard.video_prompt ?? '').trim();
}

function durationSecondsOf(storyboard) {
  const duration = finiteNumber(storyboard?.duration);
  return duration != null && duration > 0 ? duration : DEFAULT_DURATION_SECONDS;
}

/**
 * 工厂:compileDraft 的编译函数与工作流注册表可注入。
 * - deps.compileFn:默认懒构造真实 h3PromptCompiler.compile(内部走技能代理);
 *   测试或调用方可注入替身,签名 (db, log, input) => { sourcePrompt, compiledPrompt, promptFormat, compilerVersion, skillProvenance }。
 * - deps.workflowRegistry:与 routes/index.js 传入 unifiedVideoGenerationService 的
 *   loadRegistry(...) 结果同源;缺省 null(不选工作流,快照 workflowSha256 为 null)。
 */
function createH3PromptDraftService({ compileFn, workflowRegistry = null } = {}) {
  let defaultCompiler = null;
  const resolveCompileFn = () => {
    if (typeof compileFn === 'function') return compileFn;
    if (!defaultCompiler) defaultCompiler = createH3PromptCompiler();
    return (db, log, input) => defaultCompiler.compile(db, log, input);
  };

  /**
   * 给定配置 id 解析 H3 运行时:{ config, model, provider, protocol, settings,
   * workflow, configSnapshot, workflowSha }。与 createVideoGeneration 的解析路径同形状:
   * 工作流按 settings.workflow_id(无则 model)在注册表中选取;注册表缺省时不选工作流。
   */
  function resolveVideoRuntime(db, videoConfigId) {
    const numericId = finiteNumber(videoConfigId);
    const raw = numericId != null
      ? db.prepare('SELECT * FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL').get(numericId)
      : null;
    if (!raw) {
      throw draftError('VIDEO_CONFIG_NOT_FOUND', '视频配置不存在或已删除', { videoConfigId: videoConfigId ?? null });
    }
    const models = normalizeModelList(raw.model);
    const config = { ...raw, model: models };
    const model = raw.default_model != null && models.includes(String(raw.default_model))
      ? String(raw.default_model)
      : (models[0] || '');
    const provider = String(raw.provider || '').toLowerCase();
    const protocol = resolveVideoProtocol(config, model);
    const settings = parseJsonObject(raw.settings) || {};
    let workflow = null;
    const requestedWorkflowId = String(settings.workflow_id ?? '').trim() || model;
    if (workflowRegistry && requestedWorkflowId) {
      // 与 createVideoGeneration 相同:selectWorkflow 错误(WORKFLOW_NOT_FOUND 等)原样抛出。
      workflow = selectWorkflow(workflowRegistry, requestedWorkflowId, { allowExperimental: false });
    }
    const configSnapshot = buildVideoConfigSnapshot({
      config,
      model,
      provider,
      protocol,
      workflow,
      workflowId: workflow?.id || requestedWorkflowId || null,
    });
    const workflowSha = workflow?.workflowSha256 || configSnapshot.workflowSha256 || null;
    return { config, model, provider, protocol, settings, workflow, configSnapshot, workflowSha };
  }

  // 生成参数(指纹与 generation_params 的 params 维度):时长取分镜,分辨率/音频取配置 settings。
  function deriveGenerationParams(storyboard, runtime) {
    const settings = runtime?.settings || {};
    return {
      durationSeconds: durationSecondsOf(storyboard),
      width: settings.width != null && Number.isFinite(Number(settings.width)) ? Number(settings.width) : DEFAULT_WIDTH,
      height: settings.height != null && Number.isFinite(Number(settings.height)) ? Number(settings.height) : DEFAULT_HEIGHT,
      audioEnabled: settings.audio_enabled != null ? Boolean(settings.audio_enabled) : DEFAULT_AUDIO_ENABLED,
    };
  }

  function getLatestDraft(db, storyboardId, videoConfigId) {
    const sid = Number(storyboardId);
    if (!Number.isFinite(sid)) return null;
    const row = videoConfigId == null || String(videoConfigId).trim() === ''
      ? db.prepare(
        `SELECT * FROM storyboard_h3_prompt_drafts
         WHERE storyboard_id = ? AND video_config_id IS NULL
         ORDER BY updated_at DESC, id DESC LIMIT 1`
      ).get(sid)
      : db.prepare(
        `SELECT * FROM storyboard_h3_prompt_drafts
         WHERE storyboard_id = ? AND video_config_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT 1`
      ).get(sid, String(videoConfigId));
    return row || null;
  }

  function getDraftRow(db, draftId) {
    const id = Number(draftId);
    if (!Number.isFinite(id)) return null;
    return db.prepare('SELECT * FROM storyboard_h3_prompt_drafts WHERE id = ?').get(id) || null;
  }

  /**
   * 编译并落一条 status='valid' 的草稿。流程(spec §11.1):
   * 业务提示词(universal_segment_text 优先,空则 video_prompt)→ 槽位解析
   * (缺图/0 张/超限校验)→ H3 编译(复用 h3PromptCompiler 的 bundle 与技能代理)→
   * 确定性校验 → 固化快照/参数/指纹 → INSERT。
   */
  async function compileDraft(db, cfg, log, { storyboardId, videoConfigId } = {}) {
    const compile = resolveCompileFn();
    const storyboard = storyboardRow(db, storyboardId);
    if (!storyboard) {
      throw draftError('STORYBOARD_NOT_FOUND', '分镜不存在或已删除', { storyboardId: storyboardId ?? null });
    }
    const sourcePrompt = businessPromptOf(storyboard);
    if (!sourcePrompt) {
      throw draftError('UNIVERSAL_PROMPT_EMPTY', '业务提示词为空(万能提示词与视频提示词均为空),无法编译 H3 提示词');
    }

    const { slots, total } = resolveStoryboardSlots(db, storyboard.id, { maxSlots: H3_MAX_SLOTS });
    const missing = slots.filter((slot) => !slot.image_available);
    if (missing.length > 0) {
      const labels = missing.map((slot) => `#${slot.index} ${slot.name || slot.type}`).join('、');
      throw draftError(
        'MISSING_REFERENCE_IMAGE',
        `参考图槽位缺图,无法编译 H3 提示词:${labels}`,
        { slots: missing.map((slot) => ({ index: slot.index, type: slot.type, name: slot.name, asset_id: slot.asset_id, variant_id: slot.variant_id })) },
      );
    }
    const available = slots.filter((slot) => slot.image_available);
    if (available.length === 0) {
      throw draftError('REFERENCE_COUNT_INVALID', '无可用参考图(至少需要 1 张有图槽位),无法编译 H3 提示词');
    }
    if (total > H3_MAX_SLOTS) {
      throw draftError('REFERENCE_COUNT_OVERFLOW', `参考图槽位共 ${total} 个,超出上限 ${H3_MAX_SLOTS} 张,请减少绑定后重试`, { total, maxSlots: H3_MAX_SLOTS });
    }

    const runtime = resolveVideoRuntime(db, videoConfigId);
    const params = deriveGenerationParams(storyboard, runtime);
    const sourceSlotsFingerprint = slotsFingerprint(slots);
    const skillVersion = COMPILER_VERSION;
    const fingerprint = computeSourceFingerprint({
      sourcePrompt,
      slotsFingerprint: sourceSlotsFingerprint,
      durationSeconds: params.durationSeconds,
      width: params.width,
      height: params.height,
      audioEnabled: params.audioEnabled,
      videoConfigSnapshot: runtime.configSnapshot,
      workflowSha: runtime.workflowSha,
      skillVersion,
    });

    const compiled = await compile(db, log, {
      prompt: sourcePrompt,
      durationSeconds: params.durationSeconds,
      referenceUrls: available.map((slot) => slot.image_url),
    });

    // 编译结果再过一遍确定性校验(真实编译器内部已校验;替身/降级路径靠这里兜底)。
    let finalPrompt;
    try {
      finalPrompt = validateH3Prompt(compiled?.compiledPrompt, { durationSeconds: params.durationSeconds, mode: compiled?.promptFormat });
    } catch (error) {
      throw draftError('H3_PROMPT_FORMAT_INVALID', `H3 提示词校验失败:${error.message}`, {
        missing: error.details?.missing || [],
        empty: error.details?.empty || [],
        code: error.code || null,
      });
    }

    const now = new Date().toISOString();
    const info = db.prepare(
      `INSERT INTO storyboard_h3_prompt_drafts (
         storyboard_id, video_config_id, source_prompt, source_fingerprint,
         ai_compiled_prompt, final_compiled_prompt, compiled_prompt_hash,
         prompt_format, skill_version, skill_provenance,
         reference_snapshot, generation_params, manually_edited, status,
         validation_errors, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'valid', NULL, ?, ?)`
    ).run(
      storyboard.id,
      videoConfigId == null ? String(runtime.config.id) : String(videoConfigId),
      sourcePrompt,
      fingerprint,
      String(compiled?.compiledPrompt ?? ''),
      finalPrompt,
      sha256Hex(finalPrompt),
      compiled?.promptFormat || null,
      compiled?.compilerVersion || skillVersion,
      compiled?.skillProvenance == null ? null : JSON.stringify(compiled.skillProvenance),
      JSON.stringify({ slots }),
      JSON.stringify({ ...params, videoConfigSnapshot: runtime.configSnapshot, workflowSha: runtime.workflowSha }),
      now,
      now,
    );
    return getDraftRow(db, info.lastInsertRowid);
  }

  /**
   * 保存人工修改后的 H3 提示词:只做确定性校验(validateH3Prompt),
   * 通过 → status='valid';失败 → status='invalid' 且 validation_errors 记录。
   * 不改 source_prompt / source_fingerprint(指纹只描述"源是否过期",与人工文本无关)。
   */
  function saveDraftText(db, { draftId, finalText, manuallyEdited } = {}) {
    const draft = getDraftRow(db, draftId);
    if (!draft) {
      throw draftError('DRAFT_NOT_FOUND', 'H3 提示词草稿不存在', { draftId: draftId ?? null });
    }
    const storedParams = parseJsonObject(draft.generation_params) || {};
    const durationSeconds = finiteNumber(storedParams.durationSeconds, DEFAULT_DURATION_SECONDS) || DEFAULT_DURATION_SECONDS;
    let updated;
    try {
      const validated = validateH3Prompt(finalText, { durationSeconds, mode: draft.prompt_format || undefined });
      updated = {
        status: 'valid',
        validationErrors: null,
        finalText: validated,
        hash: sha256Hex(validated),
      };
    } catch (error) {
      updated = {
        status: 'invalid',
        validationErrors: JSON.stringify({
          code: error.code || 'H3_PROMPT_FORMAT_INVALID',
          message: error.message,
          missing: error.details?.missing || [],
          empty: error.details?.empty || [],
        }),
      };
    }
    const nextManuallyEdited = manuallyEdited == null ? draft.manually_edited : (manuallyEdited ? 1 : 0);
    if (updated.status === 'valid') {
      db.prepare(
        `UPDATE storyboard_h3_prompt_drafts
         SET final_compiled_prompt = ?, compiled_prompt_hash = ?, manually_edited = ?,
             status = 'valid', validation_errors = NULL, updated_at = ?
         WHERE id = ?`
      ).run(updated.finalText, updated.hash, nextManuallyEdited, new Date().toISOString(), draft.id);
    } else {
      db.prepare(
        `UPDATE storyboard_h3_prompt_drafts
         SET manually_edited = ?, status = 'invalid', validation_errors = ?, updated_at = ?
         WHERE id = ?`
      ).run(nextManuallyEdited, updated.validationErrors, new Date().toISOString(), draft.id);
    }
    return getDraftRow(db, draft.id);
  }

  /**
   * 失效评估:重算当前源指纹与行内 source_fingerprint 比较;reasons 逐维度给出
   * 变化点('prompt'/'slots'/'params'/'config'/'skill')。
   * 各维度分别与行内固化数据(source_prompt / reference_snapshot / generation_params /
   * skill_version)比较;若重算指纹不同但拆解未发现差异(历史快照形状漂移),按 'config' 处理。
   */
  function evaluateDraftFreshness(db, draft) {
    if (!draft || draft.id == null) {
      throw draftError('DRAFT_NOT_FOUND', 'H3 提示词草稿不存在', { draftId: draft?.id ?? null });
    }
    const reasons = [];
    const storyboard = storyboardRow(db, draft.storyboard_id);
    const currentSourcePrompt = businessPromptOf(storyboard);
    if (currentSourcePrompt !== String(draft.source_prompt ?? '')) reasons.push('prompt');

    if (String(draft.skill_version ?? '') !== COMPILER_VERSION) reasons.push('skill');

    const storedSnapshot = parseJsonObject(draft.reference_snapshot);
    const storedSlotsFingerprint = slotsFingerprint(storedSnapshot?.slots || []);
    let currentSlots = null;
    try {
      currentSlots = resolveStoryboardSlots(db, draft.storyboard_id, { maxSlots: H3_MAX_SLOTS }).slots;
    } catch (_) {
      currentSlots = null;
    }
    if (!currentSlots || slotsFingerprint(currentSlots) !== storedSlotsFingerprint) reasons.push('slots');

    const storedParams = parseJsonObject(draft.generation_params) || {};
    let runtime = null;
    try {
      runtime = resolveVideoRuntime(db, draft.video_config_id);
    } catch (_) {
      runtime = null;
    }
    if (runtime) {
      const currentParams = deriveGenerationParams(storyboard, runtime);
      if (currentParams.durationSeconds !== storedParams.durationSeconds
        || currentParams.width !== storedParams.width
        || currentParams.height !== storedParams.height
        || currentParams.audioEnabled !== storedParams.audioEnabled) {
        reasons.push('params');
      }
      const storedSnapshotParams = storedParams.videoConfigSnapshot ?? null;
      if (storedSnapshotParams == null
        || JSON.stringify(canonicalJson(runtime.configSnapshot)) !== JSON.stringify(canonicalJson(storedSnapshotParams))
        || String(runtime.workflowSha ?? '') !== String(storedParams.workflowSha ?? '')) {
        reasons.push('config');
      }
    } else {
      reasons.push('config');
    }

    // 兜底:重算整体指纹与行内指纹比较。拆解应与整体一致;不一致(如历史
    // 快照缺字段导致逐维比较通过)也判过期,归入 'config'。
    const currentFingerprint = computeSourceFingerprint({
      sourcePrompt: currentSourcePrompt,
      slotsFingerprint: currentSlots ? slotsFingerprint(currentSlots) : storedSlotsFingerprint,
      durationSeconds: runtime ? deriveGenerationParams(storyboard, runtime).durationSeconds : storedParams.durationSeconds,
      width: runtime ? deriveGenerationParams(storyboard, runtime).width : storedParams.width,
      height: runtime ? deriveGenerationParams(storyboard, runtime).height : storedParams.height,
      audioEnabled: runtime ? deriveGenerationParams(storyboard, runtime).audioEnabled : storedParams.audioEnabled,
      videoConfigSnapshot: runtime ? runtime.configSnapshot : storedParams.videoConfigSnapshot,
      workflowSha: runtime ? runtime.workflowSha : storedParams.workflowSha,
      skillVersion: COMPILER_VERSION,
    });
    if (currentFingerprint !== String(draft.source_fingerprint ?? '') && reasons.length === 0) {
      reasons.push('config');
    }

    return { stale: reasons.length > 0, reasons };
  }

  return {
    resolveVideoRuntime,
    getLatestDraft,
    compileDraft,
    saveDraftText,
    evaluateDraftFreshness,
  };
}

// 模块级便捷导出(签名与 brief 一致);compileDraft/evaluateDraftFreshness 走默认依赖。
let defaultService = null;
function sharedService() {
  if (!defaultService) defaultService = createH3PromptDraftService();
  return defaultService;
}

module.exports = {
  H3_MAX_SLOTS,
  computeSourceFingerprint,
  createH3PromptDraftService,
  compileDraft: (db, cfg, log, options) => sharedService().compileDraft(db, cfg, log, options),
  getLatestDraft: (db, storyboardId, videoConfigId) => sharedService().getLatestDraft(db, storyboardId, videoConfigId),
  saveDraftText: (db, options) => sharedService().saveDraftText(db, options),
  evaluateDraftFreshness: (db, draft) => sharedService().evaluateDraftFreshness(db, draft),
  resolveVideoRuntime: (db, videoConfigId) => sharedService().resolveVideoRuntime(db, videoConfigId),
};
