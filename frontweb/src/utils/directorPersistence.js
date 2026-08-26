function parseJsonObject(text, fieldName) {
  try {
    const value = JSON.parse(String(text || '{}'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value
  } catch {
    throw new Error(`${fieldName} must be valid JSON object`)
  }
}

const DEFAULT_DIRECTOR_WORKFLOW_ID = 'h3-continuity-v1'

function normalizeWorkflowId(value) {
  return String(value ?? '').trim() || DEFAULT_DIRECTOR_WORKFLOW_ID
}

export function buildDirectorGenerationRequest({
  workflowId = 'h3-continuity-v1',
  candidateCount = 2,
  promptText = '{}',
  inputsText = '{}',
} = {}) {
  if (!Number.isInteger(Number(candidateCount)) || Number(candidateCount) < 1 || Number(candidateCount) > 3) {
    throw new Error('candidateCount must be an integer from 1 through 3')
  }
  return {
    workflowId: normalizeWorkflowId(workflowId),
    candidateCount: Number(candidateCount),
    prompt: parseJsonObject(promptText, 'prompt'),
    inputs: parseJsonObject(inputsText, 'inputs'),
  }
}

export function buildStructuredDirectorGenerationRequest({
  workflowId = 'h3-continuity-v1',
  candidateCount = 2,
  promptText = '',
  continuityMode = 'motion_overlap',
  sourceArtifactId = '',
  sourceCandidateId = '',
  anchorId = '',
  seed = 42,
  width = 1280,
  height = 704,
  durationSeconds = 5,
  frameRate = 24,
  overlapFrames = 22,
  negativePrompt = '',
} = {}) {
  if (!String(promptText).trim()) throw new Error('shot prompt is required')
  const base = {
    workflowId: normalizeWorkflowId(workflowId),
    candidateCount: Number(candidateCount),
    structured: {
      prompt: String(promptText).trim(),
      continuityMode,
      seed: Number(seed),
      width: Number(width),
      height: Number(height),
      durationSeconds: Number(durationSeconds),
      frameRate: Number(frameRate),
      overlapFrames: Number(overlapFrames),
      negativePrompt: String(negativePrompt || ''),
    },
  }
  if (sourceArtifactId) base.structured.sourceArtifactId = String(sourceArtifactId)
  if (sourceCandidateId) base.structured.sourceCandidateId = String(sourceCandidateId)
  if (anchorId) base.structured.anchorId = String(anchorId)
  if (!['none', 'motion_overlap', 'state_anchor', 'composition_only'].includes(continuityMode)) {
    throw new Error('continuity mode is invalid')
  }
  if (!Number.isInteger(base.candidateCount) || base.candidateCount < 1 || base.candidateCount > 3) {
    throw new Error('candidateCount must be an integer from 1 through 3')
  }
  return base
}

export function buildDirectorPostproductionRequest({
  enabled = false,
  subtitlePath = '',
  ttsPath = '',
  musicPath = '',
  brightness = 0,
  contrast = 1,
  saturation = 1,
  width = 864,
  height = 480,
  fps = 24,
} = {}) {
  if (!enabled) return null
  const color = { brightness: Number(brightness), contrast: Number(contrast), saturation: Number(saturation) }
  if (!Object.values(color).every(Number.isFinite) || color.contrast <= 0 || color.saturation <= 0) {
    throw new Error('color correction values are invalid')
  }
  const request = {
    color,
    upscale: { mode: 'ffmpeg-lanczos', width: Number(width), height: Number(height) },
    fps: Number(fps),
  }
  if (String(subtitlePath).trim()) request.subtitlePath = String(subtitlePath).trim()
  if (String(ttsPath).trim()) request.ttsPath = String(ttsPath).trim()
  if (String(musicPath).trim()) request.musicPath = String(musicPath).trim()
  return request
}

export function normalizeDirectorShotState(payload = {}, createdGroup = null) {
  const groups = Array.isArray(payload.groups) ? [...payload.groups] : []
  if (createdGroup) {
    const existingIndex = groups.findIndex((group) => group.id === createdGroup.id)
    if (existingIndex >= 0) groups.splice(existingIndex, 1)
    groups.unshift(createdGroup)
  }
  const latest = createdGroup || payload.latest || groups[0] || null
  return { groups, latest }
}

export function formatArtifactMedia(artifact = {}) {
  const media = artifact.media || {}
  const parts = [media.width && media.height ? `${media.width}x${media.height}` : '尺寸未知']
  if (media.codec) parts.push(media.codec)
  if (media.frame_rate) parts.push(`${media.frame_rate} fps`)
  if (media.duration) parts.push(`${Number(media.duration).toFixed(1)}s`)
  if (artifact.file_size) parts.push(`${(Number(artifact.file_size) / 1048576).toFixed(1)} MB`)
  return parts.join(' · ')
}

export function createLatestRequestGuard() {
  let currentRequest = 0
  return {
    begin() {
      currentRequest += 1
      return currentRequest
    },
    isCurrent(requestId) {
      return requestId === currentRequest
    },
  }
}

export function createDirectorStateGuard() {
  const refreshGuard = createLatestRequestGuard()
  const writeGuard = createLatestRequestGuard()

  return {
    beginRefresh() {
      return refreshGuard.begin()
    },
    isCurrentRefresh(requestId) {
      return refreshGuard.isCurrent(requestId)
    },
    beginWrite() {
      refreshGuard.begin()
      return writeGuard.begin()
    },
    isCurrentWrite(requestId) {
      return writeGuard.isCurrent(requestId)
    },
    commitWrite(requestId) {
      if (!writeGuard.isCurrent(requestId)) return false
      refreshGuard.begin()
      return true
    },
    invalidateAll() {
      refreshGuard.begin()
      writeGuard.begin()
    },
  }
}

export function isSameDirectorShot(activeShotId, requestShotId) {
  return String(activeShotId) === String(requestShotId)
}
