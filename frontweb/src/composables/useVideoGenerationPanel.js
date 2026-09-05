import { computed, getCurrentInstance, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  absoluteAssetUrl,
  checkImageRefDrift,
  collectAvailableSlotUrls,
  deriveH3DraftUiState,
  formatH3ValidationErrors,
  mapFreshnessReasons,
} from '../utils/h3DraftState.js'
import { assetImageUrl } from '../utils/mediaUrl.js'
import { requiresH3Draft, slotReferenceFallbackPolicy } from '../utils/videoModeCompatibility.js'

// H3 草稿文本防抖自动保存间隔(spec §11.3,Task 17)
const H3_DRAFT_SAVE_DEBOUNCE_MS = 800
// 候选生成 409 门禁错误码(Task 16):命中时刷新草稿 + freshness 后再由 chip 呈现原因
const H3_DRAFT_GATE_ERROR_CODES = new Set([
  'H3_DRAFT_STALE',
  'H3_DRAFT_INVALID',
  'H3_DRAFT_HASH_MISMATCH',
  'H3_DRAFT_CONFIG_MISMATCH',
  'H3_DRAFT_WORKFLOW_MISMATCH',
])

const VIDEO_ACTIONS = Object.freeze([
  '刷新',
  '生成候选',
  '取消生成',
  '重试生成',
  '质量检查',
  '选用候选',
  '创建连续性锚点',
])

const VIDEO_DIMENSION_PRESETS = Object.freeze([
  Object.freeze({ width: 864, height: 480 }),
  Object.freeze({ width: 1312, height: 736 }),
])

const STATUS_LABELS = Object.freeze({
  waiting: '等待中',
  pending: '等待中',
  queued: '排队中',
  processing: '生成中',
  running: '生成中',
  completed: '待审核',
  review: '待审核',
  selected: '已选用',
  rejected: '未选用',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
})

const ERROR_SUMMARIES = Object.freeze({
  H3_SKILL_TOOL_CALL_UNSUPPORTED: '当前文本模型不支持技能工具调用，请为 H3 提示词编译选择支持 tool calling 的模型。',
  H3_CONFIG_REQUIRED: '当前视频配置不可用或不是 H3 工作流，无法生成 H3 提示词。',
  UNIVERSAL_PROMPT_EMPTY: '全能模式片段描述为空，请先填写分镜的片段描述再生成 H3 提示词。',
  MISSING_REFERENCE_IMAGE: '存在缺少参考图的槽位，请先补齐场景/角色/道具参考图。',
  REFERENCE_COUNT_OVERFLOW: '参考图槽位超过上限（9 张），请减少关联资产后重试。',
  H3_PROMPT_FORMAT_INVALID: 'H3 提示词结构校验未通过，请重新生成或修正文本。',
  H3_DRAFT_REQUIRED: 'H3 配置需先生成提示词草稿，再提交候选生成。',
  H3_DRAFT_SAVE_FAILED: 'H3 提示词保存失败，请重试后再生成候选。',
  H3_DRAFT_STALE: '提示词草稿的来源已变化，请重新生成 H3 提示词。',
  H3_DRAFT_INVALID: '提示词草稿未通过结构校验，请修正文本后再生成候选。',
  H3_DRAFT_HASH_MISMATCH: '提示词草稿哈希校验失败，请重新生成 H3 提示词。',
  H3_DRAFT_CONFIG_MISMATCH: '提示词草稿与当前视频配置不一致，请重新生成 H3 提示词。',
  H3_DRAFT_STORYBOARD_MISMATCH: '提示词草稿属于其他分镜，请重新生成 H3 提示词。',
  VIDEO_CONFIG_DEFAULT_MISSING: '尚未设置默认视频服务，请先前往 API 配置完成设置。',
  VIDEO_CONFIG_DEFAULT_MULTIPLE: '检测到多个默认视频服务，请在 API 配置中仅保留一个。',
  VIDEO_CONFIG_MISSING: '尚未设置默认视频服务，请先前往 API 配置完成设置。',
  VIDEO_CONFIG_AMBIGUOUS: '检测到多个默认视频服务，请在 API 配置中仅保留一个。',
  VIDEO_CONFIG_DISABLED: '默认视频服务已停用，请先在 API 配置中启用。',
  VIDEO_CONFIG_CREDENTIALS_MISSING: '原视频服务配置或凭据已不存在，无法继续当前任务。',
  VIDEO_DIMENSIONS_INVALID: '视频宽度或高度不符合当前服务要求。',
  VIDEO_PROVIDER_UNAVAILABLE: '默认视频服务暂时不可用。',
  VIDEO_WORKFLOW_INVALID: '默认工作流校验失败，请检查视频服务配置。',
  VIDEO_MODEL_MISSING: '默认视频服务缺少所需模型。',
  VIDEO_MODEL_NOT_ALLOWED: '所选模型不属于当前默认视频服务，请检查 API 配置。',
  VIDEO_OUT_OF_MEMORY: '视频服务显存不足，请降低尺寸或候选数量。',
  VIDEO_QUERY_TIMEOUT: '查询视频任务超时，可稍后刷新或重试。',
  VIDEO_REFERENCE_COUNT_INVALID: '参考图数量超出上限（1-9 张），请移除部分参考图后重试。',
  VIDEO_CANCELLED: '视频生成已取消。',
  VIDEO_NOT_CANCELLABLE: '当前任务状态不能取消。',
  VIDEO_NOT_RETRYABLE: '仅失败或中断的任务可以重试。',
  VIDEO_NOT_SELECTABLE: '仅待审核的视频候选可以选用。',
})

const ACTIVE_STATUSES = new Set(['waiting', 'pending', 'queued', 'processing', 'running'])
const ENGLISH_GENERATION_COPY = [
  /AI DIRECTOR/i,
  /Creator mode/i,
  /Advanced JSON/i,
  /Generate candidates/i,
  /Refresh candidates/i,
  /Cancel generation/i,
  /Retry generation/i,
  /Run quality checks/i,
  /Select candidate/i,
  /Selection reason/i,
  /Continuity anchor/i,
  /Motion overlap/i,
  /State anchor/i,
  /Composition only/i,
  /No continuity/i,
  /Create anchor/i,
  /Use for next shot/i,
  /GPU\s+(?:ready|busy)/i,
]

function trimmed(value) {
  return value == null ? '' : String(value).trim()
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function positiveNumber(value, fieldName) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${fieldName}必须是大于 0 的数字`)
  return number
}

function positiveInteger(value, fieldName) {
  const number = positiveNumber(value, fieldName)
  if (!Number.isInteger(number)) throw new Error(`${fieldName}必须是整数`)
  return number
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new Error(`${fieldName}必须是大于或等于 0 的整数`)
  return number
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (!trimmed(value)) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (_) {
    return {}
  }
}

function normalizedSourceAnchor(storyboard) {
  const anchor = storyboard?._videoSourceAnchor || storyboard?.source_anchor || null
  if (!anchor) return null
  return {
    ...anchor,
    sourceArtifactId: anchor.sourceArtifactId || anchor.source_artifact_id || '',
  }
}

export function resolveStoryboardVideoPrompt(storyboard) {
  if (!storyboard) return ''
  const candidates = [
    storyboard.universal_segment_text,
    storyboard.video_prompt,
    storyboard.polished_prompt,
    storyboard.image_prompt,
    storyboard.description,
    storyboard.action,
    storyboard.title,
  ]
  return candidates.map(trimmed).find(Boolean) || ''
}

export function restoreLastUsedPrompt(groups = []) {
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const candidate of Array.isArray(group?.candidates) ? group.candidates : []) {
      const unifiedPrompt = trimmed(candidate?.video_generation?.prompt_snapshot)
      if (unifiedPrompt) return unifiedPrompt
      try {
        const parsed = parseObject(candidate?.job_input_json)
        const h3Prompt = trimmed(parsed.prompt)
        if (h3Prompt) return h3Prompt
      } catch (_) {}
    }
  }
  return ''
}

export function resolveVideoPromptPresentation(storyboard = {}, context = {}, groups = []) {
  const businessPrompt = trimmed(context?.prompt) || resolveStoryboardVideoPrompt(storyboard)
  let lastCompiledPrompt = ''
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const candidate of Array.isArray(group?.candidates) ? group.candidates : []) {
      const video = candidate?.video_generation || {}
      const compiled = trimmed(video.compiled_prompt)
      if (compiled) return { businessPrompt, lastCompiledPrompt: compiled }
      const input = parseObject(candidate?.job_input_json)
      const inputCompiled = trimmed(input.compiled_prompt)
      if (inputCompiled) return { businessPrompt, lastCompiledPrompt: inputCompiled }
      if (!lastCompiledPrompt && trimmed(video.prompt_format).toLowerCase().includes('h3')) {
        lastCompiledPrompt = trimmed(video.prompt_snapshot)
      }
    }
  }
  return { businessPrompt, lastCompiledPrompt }
}

export function candidateStartTime(candidate) {
  return trimmed(candidate?.job_started_at)
    || trimmed(candidate?.video_generation?.started_at)
    || trimmed(candidate?.video_generation?.created_at)
}

export function formatCandidateStartTime(candidate) {
  const value = candidateStartTime(candidate)
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function candidateDuration(candidate) {
  const started = Date.parse(candidateStartTime(candidate))
  const completed = Date.parse(trimmed(candidate?.job_completed_at) || trimmed(candidate?.video_generation?.completed_at))
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed <= started) return ''
  const totalSeconds = Math.round((completed - started) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

export function normalizeVideoGenerationContext(context = {}) {
  const referenceImageUrls = Array.isArray(context.referenceImageUrls ?? context.reference_image_urls)
    ? (context.referenceImageUrls ?? context.reference_image_urls).map(trimmed).filter(Boolean)
    : []
  return {
    mode: trimmed(context.mode) || 'default',
    prompt: trimmed(context.prompt),
    negativePrompt: trimmed(context.negativePrompt ?? context.negative_prompt),
    imageUrl: trimmed(context.imageUrl ?? context.image_url),
    firstFrameUrl: trimmed(context.firstFrameUrl ?? context.first_frame_url),
    lastFrameUrl: trimmed(context.lastFrameUrl ?? context.last_frame_url),
    referenceImageUrls,
    style: trimmed(context.style),
    aspectRatio: trimmed(context.aspectRatio ?? context.aspect_ratio),
    resolution: trimmed(context.resolution),
    duration: context.duration == null ? null : finiteNumber(context.duration, null),
  }
}

export function listVideoActions(_displayMode) {
  return [...VIDEO_ACTIONS]
}

export function anchorRoleLabel(role) {
  return {
    state: '状态',
    composition: '构图',
    identity: '角色一致性',
    motion: '动作',
  }[trimmed(role).toLowerCase()] || '连续性'
}

export function hasEnglishGenerationActions(source) {
  return ENGLISH_GENERATION_COPY.some((pattern) => pattern.test(String(source || '')))
}

export function videoStatusLabel(status) {
  return STATUS_LABELS[trimmed(status).toLowerCase()] || '状态未知'
}

export function buildVideoCandidateRequest(form = {}, overrides = {}) {
  // H3 候选门禁(Task 16)要求 prompt 非空且携带 h3_prompt_draft_id;prompt 以草稿终文回传,
  // 后端按草稿 final_compiled_prompt 覆盖并校验哈希。
  const prompt = trimmed(overrides.prompt ?? form.prompt)
  if (!prompt) throw new Error('请先填写视频提示词')
  const candidateCount = positiveInteger(form.candidateCount ?? 1, '候选数量')
  if (candidateCount > 3) throw new Error('候选数量不能超过 3 个')

  const structured = {
    prompt,
    negativePrompt: trimmed(form.negativePrompt),
    width: positiveInteger(form.width ?? 1312, '宽度'),
    height: positiveInteger(form.height ?? 736, '高度'),
    durationSeconds: positiveNumber(form.duration ?? 5, '时长'),
    frameRate: positiveNumber(form.frameRate ?? 24, '帧率'),
    seed: nonNegativeInteger(form.seed ?? 42, '随机种子'),
    continuityMode: trimmed(form.continuityMode) || 'none',
    generationMode: trimmed(form.generationMode) || 'single_reference',
  }
  const workflowId = trimmed(form.workflowId)
  if (workflowId) structured.workflowId = workflowId
  const optional = {
    anchorId: trimmed(form.anchorId),
    sourceArtifactId: trimmed(form.sourceArtifactId),
    imageUrl: trimmed(form.imageUrl),
    firstFrameUrl: trimmed(form.firstFrameUrl),
    lastFrameUrl: trimmed(form.lastFrameUrl),
    style: trimmed(form.style),
    aspectRatio: trimmed(form.aspectRatio),
    resolution: trimmed(form.resolution),
  }
  for (const [key, value] of Object.entries(optional)) {
    if (value) structured[key] = value
  }
  if (overrides.h3PromptDraftId != null && String(overrides.h3PromptDraftId).trim() !== '') {
    structured.h3PromptDraftId = overrides.h3PromptDraftId
  }
  const referenceImageUrls = Array.isArray(overrides.referenceImageUrls)
    ? overrides.referenceImageUrls
    : form.referenceImageUrls
  if (Array.isArray(referenceImageUrls) && referenceImageUrls.length) {
    structured.referenceImageUrls = referenceImageUrls.map(trimmed).filter(Boolean)
  }
  if (form.useVoiceReference) structured.useVoiceReference = true

  return { candidateCount, structured }
}

export function videoErrorCopy(error) {
  const responseError = error?.response?.data?.error || null
  const code = trimmed(error?.code || responseError?.code)
  const message = trimmed(error?.message || responseError?.message || error)
  const details = error?.details || responseError?.details
  let summary = ERROR_SUMMARIES[code]
  if (!summary) {
    const lower = message.toLowerCase()
    if (lower.includes('default') && lower.includes('config')) summary = ERROR_SUMMARIES.VIDEO_CONFIG_DEFAULT_MISSING
    else if (lower.includes('dimension') || lower.includes('width') || lower.includes('height')) summary = ERROR_SUMMARIES.VIDEO_DIMENSIONS_INVALID
    else if (lower.includes('timeout')) summary = ERROR_SUMMARIES.VIDEO_QUERY_TIMEOUT
    else if (/^[\u3400-\u9fff]/u.test(message)) summary = message
    else summary = '视频生成操作失败，请展开查看技术详情。'
  }
  const detailParts = [code, message]
  if (details) {
    try {
      detailParts.push(typeof details === 'string' ? details : JSON.stringify(details))
    } catch (_) {}
  }
  return { summary, detail: detailParts.filter(Boolean).join(' · ') || summary }
}

export function candidateStatus(candidate) {
  const directorStatus = trimmed(candidate?.status).toLowerCase()
  if (['selected', 'rejected'].includes(directorStatus)) return directorStatus
  return trimmed(candidate?.video_generation?.status || candidate?.job_status || directorStatus).toLowerCase()
}

export function candidatePreviewUrl(candidate) {
  return trimmed(candidate?.video_generation?.preview_url || candidate?.artifact?.preview_url)
}

export function candidateMediaId(candidate) {
  return candidate?.video_generation_id || candidate?.video_generation?.id || candidate?.artifact_id || ''
}

export function useVideoGenerationPanel(props, emit, videosAPI) {
  if (!videosAPI) throw new Error('视频生成接口不可用')

  const form = reactive({
    prompt: '',
    negativePrompt: '',
    width: 1312,
    height: 736,
    duration: 5,
    frameRate: 24,
    seed: 42,
    candidateCount: 1,
    continuityMode: 'none',
    useVoiceReference: false,
    workflowId: '',
    generationMode: 'single_reference',
    anchorId: '',
    sourceArtifactId: '',
    imageUrl: '',
    firstFrameUrl: '',
    lastFrameUrl: '',
    referenceImageUrls: [],
    style: '',
    aspectRatio: '',
    resolution: '',
  })
  const generationMode = ref('default')
  const defaultConfig = ref(null)
  const capabilities = ref(null)
  const configLoading = ref(false)
  const loading = ref(false)
  const creating = ref(false)
  const groups = ref([])
  const activeGroupId = ref('')
  const selectionReason = ref('')
  const error = ref(null)
  const promptRestored = ref(false)
  const lastCompiledPrompt = ref('')
  const qualityReviews = ref({})
  const analyzingCandidateId = ref('')
  const anchors = ref([])
  const anchorTime = ref(0)
  const selectedDuration = ref(5)
  const selectedFps = ref(24)
  const anchorRole = ref('state')

  function setDimensions(preset) {
    form.width = preset.width
    form.height = preset.height
  }
  const anchorOperation = ref('extract_frame')
  const creatingAnchor = ref(false)
  let refreshVersion = 0
  let mutationVersion = 0
  let createVersion = 0
  let cancelVersion = 0
  let retryVersion = 0
  let analyzeVersion = 0
  let anchorVersion = 0
  const inFlightCreates = new Map()
  let pollTimer = null

  // ---------- H3 提示词草稿状态(Task 17) ----------
  const h3Draft = ref(null)
  const h3Freshness = ref({ stale: false, reasons: [] })
  const h3DraftText = ref('')
  const h3Saving = ref(false)
  const h3Compiling = ref(false)
  const h3DraftLoading = ref(false)
  const h3UserEdited = ref(false)
  const h3Slots = ref([])
  const h3SlotsLoaded = ref(false)
  let h3SaveTimer = null
  let h3Dirty = false
  let h3DraftVersion = 0
  let appliedWorkflowId = ''

  function requestIsCurrent(storyboardId, version, token = null, currentToken = null) {
    return version === mutationVersion
      && String(props.storyboardId) === String(storyboardId)
      && (token == null || token === currentToken)
  }

  const currentGroup = computed(() => (
    groups.value.find((item) => item.id === activeGroupId.value) || groups.value[0] || null
  ))
  const displayMode = computed(() => props.displayMode || 'drawer')
  const candidates = computed(() => currentGroup.value?.candidates || [])
  const activeCandidates = computed(() => candidates.value.filter((item) => ACTIVE_STATUSES.has(candidateStatus(item))))
  const queueLabel = computed(() => {
    const running = candidates.value.filter((item) => ['processing', 'running'].includes(candidateStatus(item))).length
    const queued = candidates.value.filter((item) => ['waiting', 'pending', 'queued'].includes(candidateStatus(item))).length
    if (running) return `正在生成 ${running} 个，排队 ${queued} 个`
    if (queued) return `排队中 ${queued} 个`
    return '队列空闲'
  })
  const selectedCandidate = computed(() => candidates.value.find((candidate) => (
    candidate.status === 'selected'
      || candidate.video_generation?.status === 'selected'
      || candidate.id === currentGroup.value?.selected_candidate_id
  )) || null)
  const selectedArtifactId = computed(() => (
    currentGroup.value?.selected_artifact_id || selectedCandidate.value?.artifact?.id || ''
  ))
  const sourceAnchor = computed(() => normalizedSourceAnchor(props.storyboard))
  const workflowOptions = computed(() => (
    Array.isArray(capabilities.value?.workflows) ? capabilities.value.workflows : []
  ))
  const currentWorkflow = computed(() => (
    workflowOptions.value.find((workflow) => workflow.id === form.workflowId) || null
  ))
  const workflowSelectable = computed(() => (
    trimmed(defaultConfig.value?.provider).toLowerCase() !== 'comfyui'
      || currentWorkflow.value?.selectable === true
  ))
  const workflowDimensionRules = computed(() => ({
    minWidth: positiveDefault(currentWorkflow.value?.execution?.dimensions?.minWidth, 32),
    maxWidth: positiveDefault(currentWorkflow.value?.execution?.dimensions?.maxWidth, 8192),
    minHeight: positiveDefault(currentWorkflow.value?.execution?.dimensions?.minHeight, 32),
    maxHeight: positiveDefault(currentWorkflow.value?.execution?.dimensions?.maxHeight, 8192),
    multipleOf: positiveDefault(currentWorkflow.value?.execution?.dimensions?.multipleOf, 32),
  }))
  const configStatus = computed(() => defaultConfig.value ? '服务已配置' : '未配置默认服务')
  const providerName = computed(() => {
    const config = defaultConfig.value
    if (!config) return '—'
    const labels = {
      comfyui: '本地 ComfyUI',
      dashscope: '通义万相',
      volces: '火山引擎',
      volcengine: '火山引擎',
      agnes: 'Agnes 视频',
      kling: '可灵',
      google: '谷歌',
      gemini: '谷歌',
      openai: 'OpenAI',
    }
    return config.name || labels[trimmed(config.provider).toLowerCase()] || trimmed(config.provider) || '默认视频服务'
  })
  const modelName = computed(() => (
    (trimmed(defaultConfig.value?.provider).toLowerCase() === 'comfyui' && trimmed(form.workflowId))
      || trimmed(defaultConfig.value?.default_model)
      || trimmed(Array.isArray(defaultConfig.value?.model) ? defaultConfig.value.model[0] : defaultConfig.value?.model)
      || '由默认配置决定'
  ))
  const isH3Config = computed(() => (
    trimmed(defaultConfig.value?.provider).toLowerCase() === 'comfyui'
      && requiresH3Draft(currentWorkflow.value)
  ))
  const h3UiState = computed(() => deriveH3DraftUiState({
    draft: h3Draft.value,
    freshness: h3Freshness.value,
    saving: h3Saving.value,
    structureValid: true,
  }))
  const h3FreshnessLabels = computed(() => mapFreshnessReasons(h3Freshness.value?.reasons))
  const h3ValidationLines = computed(() => formatH3ValidationErrors(h3Draft.value?.validation_errors))
  // spec §12.2:@图片N 与当前槽位语义不符时只警告不阻塞(简化口径:引用编号 > 槽位总数)
  const h3RefDrift = computed(() => checkImageRefDrift(h3DraftText.value, h3Slots.value))

  function applyH3Draft(draft, freshness, { replaceText = false } = {}) {
    h3Draft.value = draft ?? null
    h3Freshness.value = freshness || { stale: false, reasons: [] }
    if (replaceText) {
      h3DraftText.value = String(h3Draft.value?.final_compiled_prompt ?? '')
      h3UserEdited.value = Boolean(h3Draft.value?.manually_edited)
      h3Dirty = false
    }
  }

  function resetH3DraftState() {
    h3DraftVersion += 1
    if (h3SaveTimer) {
      clearTimeout(h3SaveTimer)
      h3SaveTimer = null
    }
    h3Dirty = false
    h3UserEdited.value = false
    h3Draft.value = null
    h3Freshness.value = { stale: false, reasons: [] }
    h3DraftText.value = ''
    h3Saving.value = false
    h3Compiling.value = false
    h3DraftLoading.value = false
    h3Slots.value = []
    h3SlotsLoaded.value = false
  }

  async function loadH3Draft() {
    const configId = defaultConfig.value?.id
    const requestWorkflowId = form.workflowId
    if (!isH3Config.value || configId == null || !requestWorkflowId || typeof videosAPI.getH3Draft !== 'function') return
    const requestStoryboardId = props.storyboardId
    const requestVersion = ++h3DraftVersion
    h3DraftLoading.value = true
    try {
      const result = await videosAPI.getH3Draft(requestStoryboardId, configId, requestWorkflowId)
      if (requestVersion !== h3DraftVersion || String(props.storyboardId) !== String(requestStoryboardId)
        || form.workflowId !== requestWorkflowId) return
      applyH3Draft(result?.draft ?? null, result?.freshness, { replaceText: true })
    } catch (caught) {
      if (requestVersion !== h3DraftVersion || String(props.storyboardId) !== String(requestStoryboardId)
        || form.workflowId !== requestWorkflowId) return
      applyH3Draft(null, null)
      setError(caught)
    } finally {
      if (requestVersion === h3DraftVersion && String(props.storyboardId) === String(requestStoryboardId)
        && form.workflowId === requestWorkflowId) {
        h3DraftLoading.value = false
      }
    }
  }

  /** 「生成 H3 提示词」:调用 compile 草稿接口(替代旧 POST /videos/h3-preview 预览) */
  async function compileH3Draft() {
    const configId = defaultConfig.value?.id
    const requestWorkflowId = form.workflowId
    if (!isH3Config.value || configId == null || !requestWorkflowId || creating.value || h3Compiling.value) return
    if (typeof videosAPI.compileH3Draft !== 'function') return
    // 编译前先补存本地未保存文本:编译结果会 replaceText,不补存会静默覆盖未落库的编辑。
    // 补存失败则中止编译(与 generateCandidates 的门禁同款模式),错误保留展示。
    if (h3Dirty && h3Draft.value) {
      await flushH3DraftSave()
      if (h3Dirty) {
        if (!error.value) {
          setError(Object.assign(new Error('H3 提示词保存失败，请重试后再编译。'), { code: 'H3_DRAFT_SAVE_FAILED' }))
        }
        return
      }
    }
    const requestStoryboardId = props.storyboardId
    const requestVersion = ++h3DraftVersion
    h3Compiling.value = true
    setError(null)
    try {
      const result = await videosAPI.compileH3Draft(requestStoryboardId, configId, requestWorkflowId)
      if (requestVersion !== h3DraftVersion || String(props.storyboardId) !== String(requestStoryboardId)
        || form.workflowId !== requestWorkflowId) return
      applyH3Draft(result?.draft ?? null, result?.freshness, { replaceText: true })
      await loadReferenceSlots()
    } catch (caught) {
      if (requestVersion === h3DraftVersion && String(props.storyboardId) === String(requestStoryboardId)
        && form.workflowId === requestWorkflowId) setError(caught)
    } finally {
      if (requestVersion === h3DraftVersion && String(props.storyboardId) === String(requestStoryboardId)
        && form.workflowId === requestWorkflowId) {
        h3Compiling.value = false
      }
    }
  }

  function scheduleH3DraftSave() {
    if (typeof videosAPI.saveH3Draft !== 'function') return
    if (h3SaveTimer) clearTimeout(h3SaveTimer)
    h3SaveTimer = setTimeout(() => {
      h3SaveTimer = null
      saveH3DraftText()
    }, H3_DRAFT_SAVE_DEBOUNCE_MS)
  }

  /** 文本区输入回调:与已存草稿终文不同则标记人工修改并安排防抖保存 */
  function onH3DraftTextInput() {
    const draft = h3Draft.value
    if (!draft) return
    if (h3DraftText.value === String(draft.final_compiled_prompt ?? '')) {
      h3UserEdited.value = false
      return
    }
    h3UserEdited.value = true
    h3Dirty = true
    scheduleH3DraftSave()
  }

  /** 立即补存(离开抽屉/切换分镜/提交候选前调用);无待存内容时为空操作 */
  async function flushH3DraftSave() {
    if (h3SaveTimer) {
      clearTimeout(h3SaveTimer)
      h3SaveTimer = null
    }
    if (h3Dirty && h3Draft.value) await saveH3DraftText()
  }

  async function saveH3DraftText() {
    const draft = h3Draft.value
    if (!draft || draft.id == null || typeof videosAPI.saveH3Draft !== 'function') return
    // 以草稿归属分镜为准,切换分镜后的响应由版本/分镜校验丢弃,但 PUT 已按旧分镜发出
    const requestStoryboardId = draft.storyboard_id ?? props.storyboardId
    const requestVersion = ++h3DraftVersion
    h3Saving.value = true
    try {
      const result = await videosAPI.saveH3Draft(requestStoryboardId, {
        draft_id: draft.id,
        final_text: h3DraftText.value,
        manually_edited: h3UserEdited.value,
      })
      if (requestVersion !== h3DraftVersion || String(props.storyboardId) !== String(requestStoryboardId)) return
      h3Dirty = false
      // 保存失败/非法文本时后端返回 status='invalid',这里保留本地输入并展示 validation_errors
      applyH3Draft(result?.draft ?? draft, result?.freshness, { replaceText: false })
      h3UserEdited.value = Boolean((result?.draft ?? draft)?.manually_edited)
    } catch (caught) {
      if (requestVersion === h3DraftVersion) {
        h3Dirty = true
        setError(caught)
      }
    } finally {
      if (requestVersion === h3DraftVersion) h3Saving.value = false
    }
  }

  async function loadReferenceSlots() {
    if (typeof videosAPI.getReferenceSlots !== 'function') return
    const requestStoryboardId = props.storyboardId
    try {
      const result = await videosAPI.getReferenceSlots(requestStoryboardId)
      if (String(props.storyboardId) !== String(requestStoryboardId)) return
      h3Slots.value = Array.isArray(result?.slots) ? result.slots : []
      h3SlotsLoaded.value = true
    } catch (_) {
      if (String(props.storyboardId) === String(requestStoryboardId)) {
        h3Slots.value = []
        h3SlotsLoaded.value = false
      }
    }
  }

  /** 全能模式/H3 分镜的候选请求参考图改用槽位口径(Task 14 收口) */
  function shouldUseSlotReferences() {
    return String(generationMode.value).startsWith('universal')
      || isH3Config.value
      || props.storyboard?.creation_mode === 'universal'
  }

  function slotReferenceUrls() {
    return collectAvailableSlotUrls(h3Slots.value).map((url) => {
      const raw = String(url || '').trim()
      // 网页生图下载件是本地盘符路径：ComfyUI 暂存要求本地文件，不做 http 绝对化
      if (/^[a-zA-Z]:[\\/]/.test(raw)) return raw
      return absoluteAssetUrl(assetImageUrl(raw))
    })
  }

  function setError(caught) {
    error.value = caught ? videoErrorCopy(caught) : null
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }

  function syncPolling() {
    if (!activeCandidates.value.length) {
      stopPolling()
      return
    }
    if (!pollTimer) pollTimer = setInterval(() => refreshHistory({ quiet: true }), 2500)
  }

  function applyStoryboard(storyboard, rawContext = props.generationContext) {
    const context = normalizeVideoGenerationContext(rawContext)
    generationMode.value = context.mode
    form.prompt = context.prompt || resolveStoryboardVideoPrompt(storyboard)
    form.negativePrompt = context.negativePrompt || trimmed(storyboard?.negative_prompt)
    form.duration = context.duration ?? (finiteNumber(storyboard?.duration, 5) || 5)
    const anchor = normalizedSourceAnchor(storyboard)
    form.anchorId = anchor?.id || ''
    form.sourceArtifactId = anchor?.sourceArtifactId || ''
    form.continuityMode = anchor
      ? (anchor.reference_role === 'composition' ? 'composition_only' : 'state_anchor')
      : (trimmed(defaultConfig.value?.provider).toLowerCase() === 'comfyui'
        ? 'none'
        : (trimmed(storyboard?.continuity_mode) || 'motion_overlap'))
    const localPath = trimmed(storyboard?.local_path)
    form.imageUrl = context.imageUrl || trimmed(storyboard?.image_url) || (localPath ? `/static/${localPath.replace(/^\/+/, '')}` : '')
    form.firstFrameUrl = context.firstFrameUrl || trimmed(storyboard?.first_frame_image_url) || form.imageUrl
    form.lastFrameUrl = context.lastFrameUrl || trimmed(storyboard?.last_frame_image_url)
    form.referenceImageUrls = context.referenceImageUrls.length
      ? context.referenceImageUrls
      : Array.isArray(storyboard?.reference_image_urls)
        ? storyboard.reference_image_urls.map(trimmed).filter(Boolean)
        : []
    form.style = context.style
    form.aspectRatio = context.aspectRatio
    form.resolution = context.resolution
  }

  function applyConfigDefaults(config) {
    const settings = parseObject(config?.settings)
    form.width = positiveDefault(settings.width, 1312)
    form.height = positiveDefault(settings.height, 736)
    form.frameRate = positiveDefault(settings.frame_rate ?? settings.frameRate, 24)
    form.seed = nonNegativeDefault(settings.seed, 42)
  }

  function applyWorkflowDefaults(workflow) {
    if (!workflow) return
    const settings = parseObject(defaultConfig.value?.settings)
    const overrides = parseObject(settings.workflow_overrides?.[workflow.id])
    const legacy = trimmed(defaultConfig.value?.default_model) === trimmed(workflow.id) ? settings : {}
    const defaults = workflow.execution?.defaults || {}
    const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '')
    form.width = positiveDefault(firstDefined(overrides.width, legacy.width, defaults.width), form.width)
    form.height = positiveDefault(firstDefined(overrides.height, legacy.height, defaults.height), form.height)
    form.duration = positiveDefault(firstDefined(
      overrides.durationSeconds,
      overrides.duration,
      legacy.durationSeconds,
      legacy.duration,
      defaults.durationSeconds,
    ), form.duration)
    form.frameRate = positiveDefault(firstDefined(
      overrides.frameRate,
      overrides.frame_rate,
      legacy.frameRate,
      legacy.frame_rate,
      defaults.frameRate,
    ), form.frameRate)
    form.seed = nonNegativeDefault(firstDefined(overrides.seed, legacy.seed, defaults.seed), form.seed)
    const mode = workflow.capabilities?.modes?.[0]
    if (mode) form.generationMode = mode
    if (workflow.capabilities?.supportsContinuity === false) form.continuityMode = 'none'
  }

  async function onWorkflowChange(workflowId) {
    const nextWorkflowId = trimmed(workflowId)
    const previousWorkflowId = appliedWorkflowId || form.workflowId
    if (nextWorkflowId === previousWorkflowId) return
    // el-select 会先更新 v-model；保存旧草稿期间临时恢复已应用的工作流，失败时保持原选择和编辑内容。
    form.workflowId = previousWorkflowId
    await flushH3DraftSave()
    if (h3Dirty) return
    form.workflowId = nextWorkflowId
    appliedWorkflowId = nextWorkflowId
    resetH3DraftState()
    applyWorkflowDefaults(currentWorkflow.value)
    setError(null)
    if (isH3Config.value) {
      await Promise.all([loadH3Draft(), loadReferenceSlots()])
    } else if (shouldUseSlotReferences()) {
      await loadReferenceSlots()
    }
  }

  function positiveDefault(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }

  function nonNegativeDefault(value, fallback) {
    const number = Number(value)
    return Number.isInteger(number) && number >= 0 ? number : fallback
  }

  async function loadDefaultConfig() {
    configLoading.value = true
    try {
      defaultConfig.value = await videosAPI.getDefaultConfig()
      applyConfigDefaults(defaultConfig.value)
      if (typeof videosAPI.capabilities === 'function' && trimmed(defaultConfig.value?.provider).toLowerCase() === 'comfyui') {
        capabilities.value = await videosAPI.capabilities()
        const workflows = Array.isArray(capabilities.value?.workflows) ? capabilities.value.workflows : []
        const workflow = workflows.find((item) => item.default)
          || workflows.find((item) => item.id === capabilities.value?.workflow?.id)
          || workflows.find((item) => item.selectable)
          || null
        form.workflowId = workflow?.id || ''
        appliedWorkflowId = form.workflowId
        applyWorkflowDefaults(workflow)
      } else {
        capabilities.value = null
        form.workflowId = ''
        appliedWorkflowId = ''
      }
    } catch (caught) {
      defaultConfig.value = null
      setError(caught)
    } finally {
      configLoading.value = false
    }
  }

  async function loadAnchors() {
    if (!selectedArtifactId.value) {
      anchors.value = []
      return
    }
    const requestVersion = refreshVersion
    const requestStoryboardId = props.storyboardId
    const requestArtifactId = selectedArtifactId.value
    try {
      const result = await videosAPI.listAnchors(requestArtifactId)
      if (requestVersion !== refreshVersion || String(props.storyboardId) !== String(requestStoryboardId)
        || String(selectedArtifactId.value) !== String(requestArtifactId)) return
      anchors.value = result
    } catch (caught) {
      if (requestVersion !== refreshVersion || String(props.storyboardId) !== String(requestStoryboardId)) return
      anchors.value = []
      setError(caught)
    }
  }

  function mergeProtectedGroup(fetchedGroups, protectedGroup) {
    if (!protectedGroup?.id) return fetchedGroups
    const existing = fetchedGroups.find((item) => item.id === protectedGroup.id)
    if (!existing) return [protectedGroup, ...fetchedGroups]
    const fetchedCandidates = Array.isArray(existing.candidates) ? existing.candidates : []
    const protectedCandidates = Array.isArray(protectedGroup.candidates) ? protectedGroup.candidates : []
    const byId = new Map(protectedCandidates.map((candidate) => [candidate.id, candidate]))
    for (const candidate of fetchedCandidates) byId.set(candidate.id, candidate)
    return fetchedGroups.map((item) => item.id === protectedGroup.id
      ? { ...protectedGroup, ...item, candidates: [...byId.values()] }
      : item)
  }

  async function refreshHistory({ quiet = false, preserveGroup = null } = {}) {
    const requestVersion = ++refreshVersion
    const requestStoryboardId = props.storyboardId
    if (!quiet) loading.value = true
    if (!quiet) setError(null)
    try {
      const state = await videosAPI.getCandidateHistory(props.storyboardId)
      if (requestVersion !== refreshVersion) return
      const fetchedGroups = Array.isArray(state?.groups) ? state.groups : []
      groups.value = mergeProtectedGroup(fetchedGroups, preserveGroup)
      if (!activeGroupId.value || !groups.value.some((item) => item.id === activeGroupId.value)) {
        activeGroupId.value = state?.latest?.id || groups.value[0]?.id || ''
      }
      const presentation = resolveVideoPromptPresentation(
        props.storyboard,
        props.generationContext,
        groups.value,
      )
      const lastUsedPrompt = restoreLastUsedPrompt(groups.value)
      // Legacy records may have no storyboard prompt. Use their source prompt
      // only as an empty-form fallback; never replace an existing business prompt.
      if (!trimmed(form.prompt) && lastUsedPrompt) form.prompt = lastUsedPrompt
      lastCompiledPrompt.value = presentation.lastCompiledPrompt
      promptRestored.value = Boolean(presentation.lastCompiledPrompt)
      if (currentGroup.value?.status === 'selected'
        && requestVersion === refreshVersion
        && String(props.storyboardId) === String(requestStoryboardId)) await loadAnchors()
      else anchors.value = []
      syncPolling()
    } catch (caught) {
      if (requestVersion === refreshVersion) setError(caught)
      stopPolling()
    } finally {
      if (!quiet && requestVersion === refreshVersion) loading.value = false
    }
  }

  async function refresh() {
    setError(null)
    await Promise.all([loadDefaultConfig(), refreshHistory()])
    // 打开/刷新后重算草稿与 freshness(GET 返回已带),并同步槽位用于 @图片N 漂移检查
    if (isH3Config.value || shouldUseSlotReferences()) {
      await Promise.all([loadH3Draft(), loadReferenceSlots()])
    }
  }

  async function generateCandidates() {
    const requestStoryboardId = props.storyboardId
    const storyboardKey = String(requestStoryboardId)
    if (creating.value || inFlightCreates.has(storyboardKey)) return
    if (!workflowSelectable.value) {
      setError(Object.assign(new Error(currentWorkflow.value?.unavailableReason || '所选工作流当前不可用。'), { code: 'VIDEO_WORKFLOW_INVALID' }))
      return
    }
    // H3 门禁(Task 16):先补存待保存文本,再按 valid+未 stale+未保存中放行
    if (isH3Config.value) {
      await flushH3DraftSave()
      // 补存失败时本地编辑未落库:放行会提交 DB 里的旧 final_compiled_prompt。
      // 保存错误由 saveH3DraftText 设置并保持原样展示(不清除),此处仅中止提交;
      // 无错误可展示的边缘态(如草稿已被清空)兜底给出可读的保存失败提示。
      if (h3Dirty) {
        if (!error.value) {
          setError(Object.assign(new Error('H3 提示词保存失败，请重试后再生成候选。'), { code: 'H3_DRAFT_SAVE_FAILED' }))
        }
        return
      }
      if (!h3UiState.value.canGenerate) {
        setError(Object.assign(new Error('请先生成有效的 H3 提示词草稿，再提交候选生成。'), { code: 'H3_DRAFT_NOT_READY' }))
        return
      }
    }
    const requestVersion = mutationVersion
    const requestCreateVersion = ++createVersion
    const request = { version: requestVersion, createVersion: requestCreateVersion }
    inFlightCreates.set(storyboardKey, request)
    creating.value = true
    setError(null)
    try {
      const overrides = {}
      if (isH3Config.value && h3Draft.value) {
        overrides.prompt = String(h3Draft.value.final_compiled_prompt ?? '')
        overrides.h3PromptDraftId = h3Draft.value.id
      }
      if (shouldUseSlotReferences() && !h3SlotsLoaded.value) {
        // 抽屉刚打开就点生成时槽位可能仍在途：等待完成，避免回退到陈旧远程 URL
        await loadReferenceSlots()
      }
      if (!h3SlotsLoaded.value
        && slotReferenceFallbackPolicy(defaultConfig.value, currentWorkflow.value) === 'abort') {
        setError(Object.assign(new Error('参考图槽位加载失败，请重试。'), { code: 'VIDEO_REFERENCE_SLOTS_UNAVAILABLE' }))
        return
      }
      if (h3SlotsLoaded.value && shouldUseSlotReferences()) {
        overrides.referenceImageUrls = slotReferenceUrls()
      }
      const generated = await videosAPI.generateCandidates(
        requestStoryboardId,
        buildVideoCandidateRequest(form, overrides),
      )
      if (requestCreateVersion !== createVersion || !requestIsCurrent(requestStoryboardId, requestVersion)) return
      const group = generated?.group
      if (group) {
        groups.value = [group, ...groups.value.filter((item) => item.id !== group.id)]
        activeGroupId.value = group.id
      }
      syncPolling()
      await refreshHistory({ quiet: true, preserveGroup: group })
    } catch (caught) {
      if (requestCreateVersion === createVersion && requestIsCurrent(requestStoryboardId, requestVersion)) {
        setError(caught)
        // 409 门禁语义:刷新草稿 + freshness,让 stale/invalid chip 与原因即时呈现
        const code = String(caught?.code || caught?.response?.data?.error?.code || '').trim().toUpperCase()
        if (H3_DRAFT_GATE_ERROR_CODES.has(code)) await loadH3Draft()
      }
    } finally {
      if (inFlightCreates.get(storyboardKey) === request) inFlightCreates.delete(storyboardKey)
      if (requestCreateVersion === createVersion && requestIsCurrent(requestStoryboardId, requestVersion)) creating.value = false
    }
  }

  async function cancelCandidate(candidate) {
    const requestStoryboardId = props.storyboardId
    const requestVersion = mutationVersion
    const requestToken = ++cancelVersion
    if (!requestIsCurrent(requestStoryboardId, requestVersion, requestToken, cancelVersion)) return
    setError(null)
    try {
      await videosAPI.cancelCandidate(candidate)
      if (requestIsCurrent(requestStoryboardId, requestVersion, requestToken, cancelVersion)) await refreshHistory({ quiet: true })
    } catch (caught) {
      if (requestIsCurrent(requestStoryboardId, requestVersion, requestToken, cancelVersion)) setError(caught)
    }
  }

  async function retryCandidate(candidate) {
    const requestStoryboardId = props.storyboardId
    const requestVersion = mutationVersion
    const requestToken = ++retryVersion
    setError(null)
    try {
      await videosAPI.retryCandidate(candidate)
      if (requestIsCurrent(requestStoryboardId, requestVersion, requestToken, retryVersion)) {
        await refreshHistory({ quiet: true })
        syncPolling()
      }
    } catch (caught) {
      if (requestIsCurrent(requestStoryboardId, requestVersion, requestToken, retryVersion)) setError(caught)
    }
  }

  async function analyzeCandidate(candidate) {
    const requestStoryboardId = props.storyboardId
    const requestVersion = mutationVersion
    const requestToken = ++analyzeVersion
    analyzingCandidateId.value = candidate.id
    setError(null)
    try {
      const review = await videosAPI.analyzeCandidate(candidate)
      if (requestIsCurrent(requestStoryboardId, requestVersion, requestToken, analyzeVersion)) {
        qualityReviews.value = { ...qualityReviews.value, [candidate.id]: review }
      }
    } catch (caught) {
      if (requestIsCurrent(requestStoryboardId, requestVersion, requestToken, analyzeVersion)) setError(caught)
    } finally {
      if (requestIsCurrent(requestStoryboardId, requestVersion, requestToken, analyzeVersion)) analyzingCandidateId.value = ''
    }
  }

  async function selectCandidate(candidate) {
    if (!currentGroup.value) return
    const requestStoryboardId = props.storyboardId
    const requestVersion = mutationVersion
    const requestGroupId = currentGroup.value.id
    setError(null)
    try {
      const selected = await videosAPI.selectCandidate(
        requestGroupId,
        candidate.id,
        selectionReason.value,
      )
      if (requestVersion !== mutationVersion || String(props.storyboardId) !== String(requestStoryboardId)) return
      groups.value = groups.value.map((item) => item.id === selected.id ? selected : item)
      activeGroupId.value = selected.id
      await loadAnchors()
      if (!requestIsCurrent(requestStoryboardId, requestVersion)) return
      emit?.('selected', { group: selected, candidate })
    } catch (caught) {
      if (requestIsCurrent(requestStoryboardId, requestVersion)) setError(caught)
    }
  }

  function captureVideoTime(event) {
    anchorTime.value = finiteNumber(event?.target?.currentTime, 0)
    selectedDuration.value = positiveDefault(event?.target?.duration, selectedDuration.value || 5)
    const media = selectedCandidate.value?.artifact?.media || {}
    const rawFps = media.frame_rate || media.fps || selectedCandidate.value?.video_generation?.frame_rate
    if (rawFps) {
      const [numerator, denominator] = String(rawFps).split('/').map(Number)
      selectedFps.value = denominator ? numerator / denominator : positiveDefault(numerator, 24)
    }
  }

  async function createAnchor() {
    if (!selectedArtifactId.value) return
    const requestStoryboardId = props.storyboardId
    const requestVersion = mutationVersion
    const requestToken = ++anchorVersion
    const requestArtifactId = selectedArtifactId.value
    creatingAnchor.value = true
    setError(null)
    try {
      const anchor = await videosAPI.createAnchor({
        artifactId: requestArtifactId,
        frameNumber: Math.max(0, Math.round(anchorTime.value * selectedFps.value)),
        referenceRole: anchorRole.value,
        referenceUse: anchorRole.value === 'composition' ? 'composition_only' : 'state_anchor',
        operation: anchorOperation.value,
      })
      if (requestVersion === mutationVersion && requestToken === anchorVersion
        && String(props.storyboardId) === String(requestStoryboardId)
        && String(selectedArtifactId.value) === String(requestArtifactId)) {
        await loadAnchors()
        useAnchor(anchor)
      }
    } catch (caught) {
      if (requestVersion === mutationVersion && requestToken === anchorVersion
        && String(props.storyboardId) === String(requestStoryboardId)) setError(caught)
    } finally {
      if (requestVersion === mutationVersion && requestToken === anchorVersion
        && String(props.storyboardId) === String(requestStoryboardId)) creatingAnchor.value = false
    }
  }

  function useAnchor(anchor) {
    const payload = { ...anchor, sourceArtifactId: selectedArtifactId.value }
    form.anchorId = payload.id || ''
    form.sourceArtifactId = payload.sourceArtifactId || ''
    form.continuityMode = payload.reference_role === 'composition' ? 'composition_only' : 'state_anchor'
    emit?.('anchor-created', payload)
  }

  function close() {
    // 离开抽屉前立即补存待保存的草稿文本(不阻塞关闭)
    flushH3DraftSave()
    emit?.('close')
  }

  watch(() => props.storyboardId, async () => {
    refreshVersion += 1
    mutationVersion += 1
    createVersion += 1
    cancelVersion += 1
    retryVersion += 1
    analyzeVersion += 1
    anchorVersion += 1
    stopPolling()
    // 切换分镜前立即补存旧分镜的草稿文本,随后清空全部草稿状态
    flushH3DraftSave()
    resetH3DraftState()
    creating.value = false
    analyzingCandidateId.value = ''
    creatingAnchor.value = false
    groups.value = []
    activeGroupId.value = ''
    anchors.value = []
    qualityReviews.value = {}
    selectionReason.value = ''
    promptRestored.value = false
    lastCompiledPrompt.value = ''
    setError(null)
    applyStoryboard(props.storyboard, props.generationContext)
    await refresh()
  }, { immediate: true })

  watch(() => props.storyboard, (storyboard) => {
    if (props.generationContext) {
      applyStoryboard(storyboard, props.generationContext)
      return
    }
    const nextPrompt = resolveStoryboardVideoPrompt(storyboard)
    if (!trimmed(form.prompt) || form.prompt === resolveStoryboardVideoPrompt(null)) form.prompt = nextPrompt
    const anchor = normalizedSourceAnchor(storyboard)
    if (anchor) {
      form.anchorId = anchor.id || ''
      form.sourceArtifactId = anchor.sourceArtifactId || ''
      form.continuityMode = trimmed(defaultConfig.value?.provider).toLowerCase() === 'comfyui'
        ? 'none'
        : (anchor.reference_role === 'composition' ? 'composition_only' : 'state_anchor')
    }
  })

  watch(() => props.generationContext, (context) => {
    if (context) applyStoryboard(props.storyboard, context)
  }, { deep: true })

  watch(activeGroupId, () => {
    if (currentGroup.value?.status === 'selected') loadAnchors()
    else anchors.value = []
    syncPolling()
  })

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      stopPolling()
      // 抽屉 destroy-on-close 卸载前补存草稿文本
      flushH3DraftSave()
    })
  }

  return {
    form,
    dimensionPresets: VIDEO_DIMENSION_PRESETS,
    setDimensions,
    displayMode,
    generationMode,
    defaultConfig,
    capabilities,
    workflowOptions,
    currentWorkflow,
    workflowSelectable,
    workflowDimensionRules,
    configLoading,
    configStatus,
    providerName,
    modelName,
    isH3Config,
    loading,
    creating,
    groups,
    activeGroupId,
    currentGroup,
    candidates,
    queueLabel,
    selectionReason,
    error,
    promptRestored,
    lastCompiledPrompt,
    qualityReviews,
    analyzingCandidateId,
    anchors,
    anchorTime,
    selectedDuration,
    anchorRole,
    anchorOperation,
    creatingAnchor,
    selectedArtifactId,
    sourceAnchor,
    h3Draft,
    h3DraftText,
    h3Freshness,
    h3FreshnessLabels,
    h3ValidationLines,
    h3RefDrift,
    h3Saving,
    h3Compiling,
    h3DraftLoading,
    h3UiState,
    h3Slots,
    refresh,
    generateCandidates,
    compileH3Draft,
    loadH3Draft,
    loadReferenceSlots,
    onWorkflowChange,
    onH3DraftTextInput,
    scheduleH3DraftSave,
    flushH3DraftSave,
    cancelCandidate,
    retryCandidate,
    analyzeCandidate,
    selectCandidate,
    captureVideoTime,
    createAnchor,
    useAnchor,
    close,
    candidateStatus,
    candidateDuration,
    candidateStartTime,
    formatCandidateStartTime,
    candidatePreviewUrl,
    candidateMediaId,
    restoreLastUsedPrompt,
    resolveVideoPromptPresentation,
    videoStatusLabel,
    anchorRoleLabel,
  }
}
