import { computed, getCurrentInstance, onBeforeUnmount, reactive, ref, watch } from 'vue'

const VIDEO_ACTIONS = Object.freeze([
  '刷新',
  '生成候选',
  '取消生成',
  '重试生成',
  '质量检查',
  '选用候选',
  '创建连续性锚点',
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

export function buildVideoCandidateRequest(form = {}) {
  const prompt = trimmed(form.prompt)
  if (!prompt) throw new Error('请先填写视频提示词')
  const candidateCount = positiveInteger(form.candidateCount ?? 1, '候选数量')
  if (candidateCount > 3) throw new Error('候选数量不能超过 3 个')

  const structured = {
    prompt,
    negativePrompt: trimmed(form.negativePrompt),
    width: positiveInteger(form.width ?? 1280, '宽度'),
    height: positiveInteger(form.height ?? 704, '高度'),
    durationSeconds: positiveNumber(form.duration ?? 5, '时长'),
    frameRate: positiveNumber(form.frameRate ?? 24, '帧率'),
    seed: nonNegativeInteger(form.seed ?? 42, '随机种子'),
    continuityMode: trimmed(form.continuityMode) || 'none',
  }
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
  if (Array.isArray(form.referenceImageUrls) && form.referenceImageUrls.length) {
    structured.referenceImageUrls = form.referenceImageUrls.map(trimmed).filter(Boolean)
  }

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
    width: 1280,
    height: 704,
    duration: 5,
    frameRate: 24,
    seed: 42,
    candidateCount: 2,
    continuityMode: 'motion_overlap',
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
  const configLoading = ref(false)
  const loading = ref(false)
  const creating = ref(false)
  const groups = ref([])
  const activeGroupId = ref('')
  const selectionReason = ref('')
  const error = ref(null)
  const qualityReviews = ref({})
  const analyzingCandidateId = ref('')
  const anchors = ref([])
  const anchorTime = ref(0)
  const selectedDuration = ref(5)
  const selectedFps = ref(24)
  const anchorRole = ref('state')
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
    trimmed(defaultConfig.value?.default_model)
      || trimmed(Array.isArray(defaultConfig.value?.model) ? defaultConfig.value.model[0] : defaultConfig.value?.model)
      || '由默认配置决定'
  ))

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
      : trimmed(storyboard?.continuity_mode) || 'motion_overlap'
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
    form.width = positiveDefault(settings.width, 1280)
    form.height = positiveDefault(settings.height, 704)
    form.frameRate = positiveDefault(settings.frame_rate ?? settings.frameRate, 24)
    form.seed = nonNegativeDefault(settings.seed, 42)
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

  async function refreshHistory({ quiet = false } = {}) {
    const requestVersion = ++refreshVersion
    const requestStoryboardId = props.storyboardId
    if (!quiet) loading.value = true
    if (!quiet) setError(null)
    try {
      const state = await videosAPI.getCandidateHistory(props.storyboardId)
      if (requestVersion !== refreshVersion) return
      groups.value = Array.isArray(state?.groups) ? state.groups : []
      if (!activeGroupId.value || !groups.value.some((item) => item.id === activeGroupId.value)) {
        activeGroupId.value = state?.latest?.id || groups.value[0]?.id || ''
      }
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
  }

  async function generateCandidates() {
    const requestStoryboardId = props.storyboardId
    const storyboardKey = String(requestStoryboardId)
    if (creating.value || inFlightCreates.has(storyboardKey)) return
    const requestVersion = mutationVersion
    const requestCreateVersion = ++createVersion
    const request = { version: requestVersion, createVersion: requestCreateVersion }
    inFlightCreates.set(storyboardKey, request)
    creating.value = true
    setError(null)
    try {
      const generated = await videosAPI.generateCandidates(
        requestStoryboardId,
        buildVideoCandidateRequest(form),
      )
      if (requestCreateVersion !== createVersion || !requestIsCurrent(requestStoryboardId, requestVersion)) return
      const group = generated?.group
      if (group) {
        groups.value = [group, ...groups.value.filter((item) => item.id !== group.id)]
        activeGroupId.value = group.id
      }
      syncPolling()
      await refreshHistory({ quiet: true })
    } catch (caught) {
      if (requestCreateVersion === createVersion && requestIsCurrent(requestStoryboardId, requestVersion)) setError(caught)
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
    creating.value = false
    analyzingCandidateId.value = ''
    creatingAnchor.value = false
    groups.value = []
    activeGroupId.value = ''
    anchors.value = []
    qualityReviews.value = {}
    selectionReason.value = ''
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
      form.continuityMode = anchor.reference_role === 'composition' ? 'composition_only' : 'state_anchor'
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

  if (getCurrentInstance()) onBeforeUnmount(stopPolling)

  return {
    form,
    displayMode,
    generationMode,
    defaultConfig,
    configLoading,
    configStatus,
    providerName,
    modelName,
    loading,
    creating,
    groups,
    activeGroupId,
    currentGroup,
    candidates,
    queueLabel,
    selectionReason,
    error,
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
    refresh,
    generateCandidates,
    cancelCandidate,
    retryCandidate,
    analyzeCandidate,
    selectCandidate,
    captureVideoTime,
    createAnchor,
    useAnchor,
    close,
    candidateStatus,
    candidatePreviewUrl,
    candidateMediaId,
    videoStatusLabel,
    anchorRoleLabel,
  }
}
