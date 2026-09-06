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
const { isSwitchableH3WorkflowPair } = require('./h3WorkflowSelection');
const { validateH3Dimensions } = require('../director/directorGenerationPolicy');
const { selectWorkflow } = require('../director/workflowRegistry');
const {
  buildStoryboardGenerationContext,
  generationContextFingerprint,
} = require('./storyboardGenerationContextService');
const { validateH3PromptSemantics } = require('./h3PromptSemanticValidator');
const { reviewH3AudioCoverage } = require('./h3PromptSemanticReviewService');
const { resolveWorkflowParameters } = require('../director/workflowExecutionPolicy');

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

const LEGACY_VIDEO_CONFIG_SNAPSHOT_KEYS = [
  'configId', 'provider', 'protocol', 'model', 'workflowId', 'workflowSha256',
  'workflowVariant', 'adapter', 'adapterVersion', 'generationMode', 'sage',
  'acceleration', 'planHash', 'baseUrl', 'endpoint', 'queryEndpoint', 'settings',
];

function comparableConfigSnapshot(current, stored) {
  if (!stored || Object.prototype.hasOwnProperty.call(stored, 'workflowSnapshotVersion')) return current;
  return LEGACY_VIDEO_CONFIG_SNAPSHOT_KEYS.reduce((result, key) => {
    result[key] = current?.[key];
    return result;
  }, {});
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
    contextFingerprint: String(input.contextFingerprint ?? ''),
  };
  return sha256Hex(JSON.stringify(canonicalJson(payload)));
}

function tableHasColumn(db, table, column) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column); } catch (_) { return false; }
}

function tryBuildGenerationContext(db, storyboardId) {
  try { return buildStoryboardGenerationContext(db, storyboardId); } catch (_) { return null; }
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
function createH3PromptDraftService({
  compileFn,
  workflowRegistry = null,
  semanticReviewFn = reviewH3AudioCoverage,
  allowExperimental = false,
} = {}) {
  let defaultCompiler = null;
  const resolveCompileFn = () => {
    if (typeof compileFn === 'function') return compileFn;
    if (!defaultCompiler) defaultCompiler = createH3PromptCompiler();
    return (db, log, input) => defaultCompiler.compile(db, log, input);
  };

  /**
   * 给定配置 id 解析 H3 运行时:{ config, model, provider, protocol, settings,
   * workflow, configSnapshot, workflowSha }。语义与 createVideoGeneration 的解析路径对齐
   * (消除双实现,Task 16 交接②):
   * - 配置行要求 service_type='video'、未删除且激活(与 resolveDefaultVideoConfig 同口径);
   * - 工作流按显式 workflowId(opts.workflowId,来自 input.workflow_id)或 model 选取,
   *   不再读取 settings.workflow_id 前缀(unified 的 requestedWorkflowId = explicit || model);
   * - 注册表缺省时不选工作流,快照 workflowSha256 为 null。
   */
  function resolveVideoRuntime(db, videoConfigId, { workflowId = null } = {}) {
    const numericId = finiteNumber(videoConfigId);
    const raw = numericId != null
      ? db.prepare(
        `SELECT * FROM ai_service_configs
         WHERE id = ? AND service_type = 'video' AND deleted_at IS NULL AND (is_active = 1 OR is_active IS NULL)`
      ).get(numericId)
      : null;
    if (!raw) {
      throw draftError('VIDEO_CONFIG_NOT_FOUND', '视频配置不存在或已删除', { videoConfigId: videoConfigId ?? null });
    }
    const models = normalizeModelList(raw.model);
    const config = { ...raw, model: models };
    const defaultModel = raw.default_model != null && models.includes(String(raw.default_model))
      ? String(raw.default_model)
      : (models[0] || '');
    const requestedWorkflowId = String(workflowId ?? '').trim() || defaultModel;
    if (requestedWorkflowId
      && !models.includes(requestedWorkflowId)
      && !isSwitchableH3WorkflowPair(defaultModel, requestedWorkflowId)) {
      throw draftError('VIDEO_WORKFLOW_NOT_ALLOWED', '工作流不在当前视频通道白名单中', { workflowId: requestedWorkflowId });
    }
    const model = requestedWorkflowId;
    const provider = String(raw.provider || '').toLowerCase();
    const protocol = resolveVideoProtocol(config, model);
    const settings = parseJsonObject(raw.settings) || {};
    let workflow = null;
    if (workflowRegistry && requestedWorkflowId) {
      // 与 createVideoGeneration 相同:selectWorkflow 错误(WORKFLOW_NOT_FOUND 等)原样抛出。
      workflow = selectWorkflow(workflowRegistry, requestedWorkflowId, { allowExperimental });
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

  // 生成参数(指纹与 generation_params 的 params 维度)。与 createVideoGeneration 的
  // plan 路径同语义(交接②):时长 = 显式 input.duration 回退分镜行(>0 否则 5);
  // 宽高 = 显式 input 回退配置 settings(缺省 864/480);workflow 带 adapter 时
  // 宽高按 validateH3Dimensions 归一(即 plan.common 的归一结果,unified 中
  // planCommon.width/height 才是落库值)。草稿编译/失效评估不传 input 覆盖项,
  // 此时与"无 input 的候选生成"逐值一致。
  function deriveGenerationParams(storyboard, runtime, { inputDuration = null, inputWidth = null, inputHeight = null } = {}) {
    if (runtime?.workflow) {
      const parameters = resolveWorkflowParameters(runtime.workflow, {
        duration: inputDuration ?? durationSecondsOf(storyboard),
        width: inputWidth,
        height: inputHeight,
      }, runtime.config);
      return {
        durationSeconds: parameters.durationSeconds,
        width: parameters.width,
        height: parameters.height,
        audioEnabled: runtime.settings.audio_enabled != null ? Boolean(runtime.settings.audio_enabled) : DEFAULT_AUDIO_ENABLED,
      };
    }
    const settings = runtime?.settings || {};
    const settingsWidth = settings.width != null && Number.isFinite(Number(settings.width)) ? Number(settings.width) : DEFAULT_WIDTH;
    const settingsHeight = settings.height != null && Number.isFinite(Number(settings.height)) ? Number(settings.height) : DEFAULT_HEIGHT;
    // 注意 finiteNumber(null) === 0(Number(null) 为 0),先判 nullish 再取数。
    const durationOverride = inputDuration == null ? null : finiteNumber(inputDuration);
    const widthOverride = inputWidth == null ? null : finiteNumber(inputWidth);
    const heightOverride = inputHeight == null ? null : finiteNumber(inputHeight);
    let width = widthOverride ?? settingsWidth;
    let height = heightOverride ?? settingsHeight;
    if (runtime?.workflow?.adapter) {
      const normalized = validateH3Dimensions({ width, height });
      width = normalized.width;
      height = normalized.height;
    }
    return {
      durationSeconds: durationOverride != null && durationOverride > 0 ? durationOverride : durationSecondsOf(storyboard),
      width,
      height,
      audioEnabled: settings.audio_enabled != null ? Boolean(settings.audio_enabled) : DEFAULT_AUDIO_ENABLED,
    };
  }

  function getLatestDraft(db, storyboardId, videoConfigId, workflowId = null) {
    const sid = Number(storyboardId);
    if (!Number.isFinite(sid)) return null;
    const selectedWorkflowId = String(workflowId || '').trim();
    if (selectedWorkflowId) {
      return db.prepare(
        `SELECT * FROM storyboard_h3_prompt_drafts
         WHERE storyboard_id = ? AND video_config_id IS ? AND workflow_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT 1`
      ).get(sid, videoConfigId == null ? null : String(videoConfigId), selectedWorkflowId) || null;
    }
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

  function getLatestDraftResult(db, storyboardId, videoConfigId, workflowId) {
    const selectedWorkflowId = String(workflowId || '').trim();
    if (!selectedWorkflowId) {
      return { draft: getLatestDraft(db, storyboardId, videoConfigId), freshness: { stale: false, reasons: [] } };
    }
    const exact = getLatestDraft(db, storyboardId, videoConfigId, selectedWorkflowId);
    if (exact) return { draft: exact, freshness: { stale: false, reasons: [] } };

    const legacy = db.prepare(
      `SELECT * FROM storyboard_h3_prompt_drafts
       WHERE storyboard_id = ? AND video_config_id IS ? AND workflow_id IS NULL
       ORDER BY updated_at DESC, id DESC`
    ).all(Number(storyboardId), videoConfigId == null ? null : String(videoConfigId));
    for (const row of legacy) {
      const bound = resolveDraftWorkflow(db, row, selectedWorkflowId);
      if (String(bound?.workflow_id || '') === selectedWorkflowId) {
        return { draft: bound, freshness: { stale: false, reasons: [] } };
      }
    }
    return {
      draft: null,
      freshness: legacy.length
        ? { stale: true, reasons: ['legacy_workflow_unknown'] }
        : { stale: false, reasons: [] },
    };
  }

  function getDraftRow(db, draftId) {
    const id = Number(draftId);
    if (!Number.isFinite(id)) return null;
    return db.prepare('SELECT * FROM storyboard_h3_prompt_drafts WHERE id = ?').get(id) || null;
  }

  function resolveDraftWorkflow(db, draft, workflowId) {
    if (!draft || draft.workflow_id != null && String(draft.workflow_id).trim() !== '') return draft;
    const selectedWorkflowId = String(workflowId || '').trim();
    if (!selectedWorkflowId) return draft;
    const selected = workflowRegistry?.workflows?.find((item) => item.id === selectedWorkflowId);
    const sha = String(selected?.workflowSha256 || '');
    const shaOwners = workflowRegistry?.workflows?.filter((item) => String(item.workflowSha256 || '') === sha) || [];
    const storedSha = String((parseJsonObject(draft.generation_params) || {}).workflowSha || '');
    if (!sha || shaOwners.length !== 1 || storedSha !== sha) return draft;

    const updated = db.prepare(
      'UPDATE storyboard_h3_prompt_drafts SET workflow_id = ? WHERE id = ? AND workflow_id IS NULL'
    ).run(selectedWorkflowId, draft.id);
    if (updated.changes) return { ...draft, workflow_id: selectedWorkflowId };
    return getDraftRow(db, draft.id) || draft;
  }

  /**
   * 编译并落一条 status='valid' 的草稿。流程(spec §11.1):
   * 业务提示词(universal_segment_text 优先,空则 video_prompt)→ 工作流执行契约→ 槽位解析
   * (缺图/数量边界校验)→ H3 编译(复用 h3PromptCompiler 的 bundle 与技能代理)→
   * 确定性校验 → 固化快照/参数/指纹 → INSERT。
   */
  async function compileDraft(db, cfg, log, { storyboardId, videoConfigId, workflowId } = {}) {
    const compile = resolveCompileFn();
    const storyboard = storyboardRow(db, storyboardId);
    if (!storyboard) {
      throw draftError('STORYBOARD_NOT_FOUND', '分镜不存在或已删除', { storyboardId: storyboardId ?? null });
    }
    const baseContext = tryBuildGenerationContext(db, storyboard.id);
    const sourcePrompt = baseContext?.storyboard?.visual_prompt || businessPromptOf(storyboard);
    if (!sourcePrompt) {
      throw draftError('UNIVERSAL_PROMPT_EMPTY', '业务提示词为空(万能提示词与视频提示词均为空),无法编译 H3 提示词');
    }

    const runtime = resolveVideoRuntime(db, videoConfigId, { workflowId });
    const referenceLimits = runtime.workflow?.execution?.references || { min: 1, max: H3_MAX_SLOTS };
    const { slots, total } = resolveStoryboardSlots(db, storyboard.id, { maxSlots: referenceLimits.max });
    if (total > referenceLimits.max) {
      throw draftError(
        'REFERENCE_COUNT_OVERFLOW',
        `参考图槽位共 ${total} 个,超出上限 ${referenceLimits.max} 张,请减少绑定后重试`,
        { total, minSlots: referenceLimits.min, maxSlots: referenceLimits.max },
      );
    }
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
    if (available.length < referenceLimits.min) {
      throw draftError(
        'REFERENCE_COUNT_INVALID',
        `可用参考图共 ${available.length} 张,少于工作流要求的 ${referenceLimits.min} 张`,
        { total: available.length, minSlots: referenceLimits.min, maxSlots: referenceLimits.max },
      );
    }

    const workflowIdValue = runtime.workflow?.id || runtime.configSnapshot?.workflowId || runtime.model || null;
    const params = deriveGenerationParams(storyboard, runtime);
    const context = baseContext ? { ...baseContext, audio_enabled: params.audioEnabled } : null;
    const contextFingerprint = context ? generationContextFingerprint(context) : '';
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
      contextFingerprint,
    });

    const compiled = await compile(db, log, {
      prompt: sourcePrompt,
      durationSeconds: params.durationSeconds,
      referenceUrls: available.map((slot) => slot.image_url),
      referenceAudios: context
        ? context.references.filter((item) => item.audio_url).map((item) => ({
            label: item.audio_label,
            audio_url: item.audio_url,
            entity_name: item.entity_name,
          }))
        : [],
      audioEnabled: params.audioEnabled,
      context,
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

    let semanticStatus = 'covered';
    let coverageManifest = { version: 1, events: [] };
    let draftStatus = 'valid';
    let validationErrors = null;
    if (context) {
      const semantic = validateH3PromptSemantics(finalPrompt, context, {
        durationSeconds: params.durationSeconds,
        audioEnabled: params.audioEnabled,
      });
      if (!semantic.ok) {
        semanticStatus = 'missing';
        draftStatus = 'invalid';
        validationErrors = JSON.stringify({ code: semantic.errors[0]?.code || 'H3_AUDIO_POLICY_MISMATCH', errors: semantic.errors });
      } else {
        const review = await semanticReviewFn(db, log, { compiledPrompt: finalPrompt, context });
        semanticStatus = review?.status || 'uncertain';
        coverageManifest = review?.manifest || coverageManifest;
        if (semanticStatus === 'missing') {
          draftStatus = 'invalid';
          validationErrors = JSON.stringify({ code: 'H3_AUDIO_POLICY_MISMATCH', coverage_manifest: coverageManifest });
        } else if (semanticStatus === 'uncertain') {
          draftStatus = 'needs_review';
          validationErrors = JSON.stringify({ code: 'H3_SEMANTIC_REVIEW_REQUIRED', coverage_manifest: coverageManifest });
        }
      }
    }

    const now = new Date().toISOString();
    const configIdValue = videoConfigId == null ? String(runtime.config.id) : String(videoConfigId);
    // INSERT 与"只保留最新 10 条"的清理包在事务里:每次编译都 INSERT 新行,
    // 不清理则表持续增长;按 (storyboard_id, video_config_id, workflow_id) 保留最新 10 条
    // (updated_at DESC, id DESC),更旧的删除。workflow_id NULL 用 IS 匹配。
    const info = db.transaction(() => {
      const insertInfo = db.prepare(
        `INSERT INTO storyboard_h3_prompt_drafts (
           storyboard_id, video_config_id, workflow_id, source_prompt, source_fingerprint,
           ai_compiled_prompt, final_compiled_prompt, compiled_prompt_hash,
           prompt_format, skill_version, skill_provenance,
           reference_snapshot, generation_params, manually_edited, status,
           validation_errors, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      ).run(
        storyboard.id,
        configIdValue,
        workflowIdValue,
        sourcePrompt,
        fingerprint,
        String(compiled?.compiledPrompt ?? ''),
        finalPrompt,
        sha256Hex(finalPrompt),
        compiled?.promptFormat || null,
        compiled?.compilerVersion || skillVersion,
        compiled?.skillProvenance == null ? null : JSON.stringify(compiled.skillProvenance),
        JSON.stringify({
          slots,
          references: context?.references || [],
          audio: context ? context.references.filter((item) => item.audio_url).map((item) => ({
            label: item.audio_label,
            audio_url: item.audio_url,
            entity_name: item.entity_name,
            audio_version: item.audio_version,
          })) : [],
          context,
          context_fingerprint: contextFingerprint,
        }),
        JSON.stringify({ ...params, videoConfigSnapshot: runtime.configSnapshot, workflowSha: runtime.workflowSha, contextFingerprint }),
        draftStatus,
        validationErrors,
        now,
        now,
      );
      db.prepare(
        `DELETE FROM storyboard_h3_prompt_drafts
         WHERE storyboard_id = ? AND video_config_id IS ? AND workflow_id IS ?
           AND id NOT IN (
             SELECT id FROM storyboard_h3_prompt_drafts
             WHERE storyboard_id = ? AND video_config_id IS ? AND workflow_id IS ?
             ORDER BY updated_at DESC, id DESC
             LIMIT 10
           )`
      ).run(storyboard.id, configIdValue, workflowIdValue, storyboard.id, configIdValue, workflowIdValue);
      if (tableHasColumn(db, 'storyboard_h3_prompt_drafts', 'coverage_manifest')) {
        db.prepare(
          `UPDATE storyboard_h3_prompt_drafts
           SET coverage_manifest = ?, semantic_review_status = ?, semantic_review_confirmed = 0
           WHERE id = ?`,
        ).run(JSON.stringify(coverageManifest), semanticStatus, insertInfo.lastInsertRowid);
      }
      return insertInfo;
    })();
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
      const storedReferenceSnapshot = parseJsonObject(draft.reference_snapshot) || {};
      const context = storedReferenceSnapshot.context || null;
      const semantic = context ? validateH3PromptSemantics(validated, context, {
        durationSeconds,
        audioEnabled: context.audio_enabled,
      }) : { ok: true, errors: [] };
      const hasReviewEvents = Boolean(parseJsonObject(draft.coverage_manifest)?.events?.length);
      updated = semantic.ok ? {
        status: context && hasReviewEvents ? 'needs_review' : 'valid',
        validationErrors: context && hasReviewEvents
          ? JSON.stringify({ code: 'H3_SEMANTIC_REVIEW_REQUIRED', message: '人工修改后需要重新确认音频语义覆盖' })
          : null,
        semanticStatus: context && hasReviewEvents ? 'uncertain' : 'covered',
        finalText: validated,
        hash: sha256Hex(validated),
      } : {
        status: 'invalid',
        validationErrors: JSON.stringify({ code: semantic.errors[0]?.code || 'H3_AUDIO_POLICY_MISMATCH', errors: semantic.errors }),
        semanticStatus: 'missing',
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
    if (updated.status === 'valid' || updated.status === 'needs_review') {
      db.prepare(
        `UPDATE storyboard_h3_prompt_drafts
         SET final_compiled_prompt = ?, compiled_prompt_hash = ?, manually_edited = ?,
             status = ?, validation_errors = ?, updated_at = ?
         WHERE id = ?`
      ).run(updated.finalText, updated.hash, nextManuallyEdited, updated.status, updated.validationErrors, new Date().toISOString(), draft.id);
    } else {
      db.prepare(
        `UPDATE storyboard_h3_prompt_drafts
         SET manually_edited = ?, status = 'invalid', validation_errors = ?, updated_at = ?
         WHERE id = ?`
      ).run(nextManuallyEdited, updated.validationErrors, new Date().toISOString(), draft.id);
    }
    if (tableHasColumn(db, 'storyboard_h3_prompt_drafts', 'semantic_review_confirmed')) {
      db.prepare(
        `UPDATE storyboard_h3_prompt_drafts
         SET semantic_review_status = ?, semantic_review_confirmed = 0
         WHERE id = ?`,
      ).run(updated.semanticStatus || (updated.status === 'valid' ? 'covered' : 'missing'), draft.id);
    }
    return getDraftRow(db, draft.id);
  }

  function confirmSemanticReview(db, { draftId, promptHash } = {}) {
    const draft = getDraftRow(db, draftId);
    if (!draft || draft.status !== 'needs_review'
      || !promptHash
      || String(promptHash) !== String(draft.compiled_prompt_hash)
      || String(draft.compiled_prompt_hash) !== sha256Hex(draft.final_compiled_prompt)) {
      throw draftError('H3_SEMANTIC_REVIEW_REQUIRED', '语义复核确认已失效，请重新检查当前 H3 提示词', { draftId: draftId ?? null });
    }
    if (!tableHasColumn(db, 'storyboard_h3_prompt_drafts', 'semantic_review_confirmed')) {
      throw draftError('H3_SEMANTIC_REVIEW_REQUIRED', '当前数据库尚未启用语义复核字段');
    }
    db.prepare(
      'UPDATE storyboard_h3_prompt_drafts SET semantic_review_confirmed = 1, updated_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), draft.id);
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
    const currentGenerationContext = tryBuildGenerationContext(db, draft.storyboard_id);
    const currentSourcePrompt = currentGenerationContext?.storyboard?.visual_prompt || businessPromptOf(storyboard);
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

    let currentContextFingerprint = '';
    const currentContext = currentGenerationContext;
    if (currentContext) {
      const storedAudioEnabled = parseJsonObject(draft.generation_params)?.audioEnabled;
      currentContext.audio_enabled = storedAudioEnabled == null ? DEFAULT_AUDIO_ENABLED : Boolean(storedAudioEnabled);
      currentContextFingerprint = generationContextFingerprint(currentContext);
      const storedContextFingerprint = String(storedSnapshot?.context_fingerprint || '');
      if (!storedContextFingerprint || storedContextFingerprint !== currentContextFingerprint) reasons.push('context');
    }

    const storedParams = parseJsonObject(draft.generation_params) || {};
    let runtime = null;
    try {
      runtime = resolveVideoRuntime(db, draft.video_config_id, {
        workflowId: draft.workflow_id,
      });
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
      const comparableCurrentSnapshot = comparableConfigSnapshot(runtime.configSnapshot, storedSnapshotParams);
      if (storedSnapshotParams == null
        || JSON.stringify(canonicalJson(comparableCurrentSnapshot)) !== JSON.stringify(canonicalJson(storedSnapshotParams))
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
      videoConfigSnapshot: runtime
        ? comparableConfigSnapshot(runtime.configSnapshot, storedParams.videoConfigSnapshot)
        : storedParams.videoConfigSnapshot,
      workflowSha: runtime ? runtime.workflowSha : storedParams.workflowSha,
      skillVersion: COMPILER_VERSION,
      contextFingerprint: currentContextFingerprint || storedParams.contextFingerprint || '',
    });
    if (currentFingerprint !== String(draft.source_fingerprint ?? '') && reasons.length === 0) {
      reasons.push('config');
    }

    return { stale: reasons.length > 0, reasons };
  }

  return {
    resolveVideoRuntime,
    getLatestDraft,
    getLatestDraftResult,
    getDraftById: getDraftRow,
    resolveDraftWorkflow,
    compileDraft,
    saveDraftText,
    confirmSemanticReview,
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
  getLatestDraft: (db, storyboardId, videoConfigId, workflowId) => sharedService().getLatestDraft(db, storyboardId, videoConfigId, workflowId),
  getLatestDraftResult: (db, storyboardId, videoConfigId, workflowId) => sharedService().getLatestDraftResult(db, storyboardId, videoConfigId, workflowId),
  getDraftById: (db, draftId) => sharedService().getDraftById(db, draftId),
  resolveDraftWorkflow: (db, draft, workflowId) => sharedService().resolveDraftWorkflow(db, draft, workflowId),
  saveDraftText: (db, options) => sharedService().saveDraftText(db, options),
  confirmSemanticReview: (db, options) => sharedService().confirmSemanticReview(db, options),
  evaluateDraftFreshness: (db, draft) => sharedService().evaluateDraftFreshness(db, draft),
  resolveVideoRuntime: (db, videoConfigId, options) => sharedService().resolveVideoRuntime(db, videoConfigId, options),
};
