const PLAYABLE_VIDEO_STATUSES = new Set(['completed', 'review', 'selected'])
const ACTIVE_VIDEO_STATUSES = new Set(['pending', 'processing', 'waiting', 'queued', 'running'])

export function isPlayableVideoGenerationStatus(status) {
  return PLAYABLE_VIDEO_STATUSES.has(String(status || '').trim().toLowerCase())
}

export function isActiveVideoGenerationStatus(status) {
  return ACTIVE_VIDEO_STATUSES.has(String(status || '').trim().toLowerCase())
}
