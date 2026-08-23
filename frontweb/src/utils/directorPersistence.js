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
