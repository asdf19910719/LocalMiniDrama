/** 统一媒体 URL：优先 local_path，其次 image_url / video_url */
const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/
const EXTERNAL_RESULT_PATH_RE = /(?:^|\/)external-web\/[^/]+\/[^/]+\/([^/]+)\/[^/]+$/i

function externalResultIdFromPath(localPath) {
  const normalized = String(localPath || '').trim().replace(/\\/g, '/')
  return normalized.match(EXTERNAL_RESULT_PATH_RE)?.[1] || ''
}

function externalResultContentUrl(item, localPath) {
  const resultId = item?.external_result_id || externalResultIdFromPath(localPath)
  return resultId
    ? `/api/v1/external-generation/results/${encodeURIComponent(resultId)}/content`
    : ''
}

export function assetImageUrl(item) {
  if (!item) return ''
  if (typeof item === 'string') {
    const value = item.trim()
    if (!value) return ''
    if (value.startsWith('/static/') || value.startsWith('/api/') || /^https?:\/\//i.test(value)) return value
    if (ABSOLUTE_PATH_RE.test(value)) return externalResultContentUrl({}, value)
    return `/static/${value.replace(/^\//, '')}`
  }
  const lp = item.local_path && String(item.local_path).trim()
  if (lp) {
    if (ABSOLUTE_PATH_RE.test(lp)) return externalResultContentUrl(item, lp) || item.image_url || ''
    return '/static/' + lp.replace(/^\//, '')
  }
  return item.image_url || ''
}

export function storyboardImageUrl(sb) {
  if (!sb) return ''
  return assetImageUrl(sb)
}

export function storyboardVideoUrl(sb) {
  if (!sb) return ''
  const lp = sb.video_local_path && String(sb.video_local_path).trim()
  if (lp) return '/static/' + lp.replace(/^\//, '')
  return sb.video_url || ''
}

export function audioUrl(localPath) {
  if (!localPath) return ''
  const p = String(localPath).trim()
  if (!p) return ''
  return '/static/' + p.replace(/^\//, '')
}
