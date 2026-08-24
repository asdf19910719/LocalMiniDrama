function parseJsonObject(text, fieldName) {
  try {
    const value = JSON.parse(String(text || '{}'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value
  } catch {
    throw new Error(`${fieldName} must be valid JSON object`)
  }
}

export function buildDirectorGenerationRequest({
  workflowId = 'h3-continuity-v1',
  candidateCount = 2,
  promptText = '{}',
  inputsText = '{}',
} = {}) {
  if (!String(workflowId).trim()) throw new Error('workflowId is required')
  if (!Number.isInteger(Number(candidateCount)) || Number(candidateCount) < 1 || Number(candidateCount) > 3) {
    throw new Error('candidateCount must be an integer from 1 through 3')
  }
  return {
    workflowId: String(workflowId).trim(),
    candidateCount: Number(candidateCount),
    prompt: parseJsonObject(promptText, 'prompt'),
    inputs: parseJsonObject(inputsText, 'inputs'),
  }
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
