import { assetImageUrl } from './mediaUrl.js'
import { parseDramaMetadata } from './canvasLayout.js'
import { isPlayableVideoGenerationStatus } from './videoLifecycleStatus.js'

export function dramaUsesFirstLastFrame(drama) {
  const meta = parseDramaMetadata(drama?.metadata)
  return !!meta.storyboard_use_first_last_frame
}

function isHttpVideoUrl(url) {
  if (!url || typeof url !== 'string') return false
  const t = url.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}

function isCompletedImage(i) {
  return i?.status === 'completed'
    && !isGridSourceType(i.frame_type)
    && (i.image_url || i.local_path)
}

function isGridSourceType(frameType) {
  return frameType === 'quad_grid' || frameType === 'nine_grid'
}

function isGridPanelType(frameType) {
  return /^(?:quad|nine)_panel_\d+$/.test(String(frameType || ''))
}

function isFrameReferenceType(frameType) {
  return new Set(['first', 'last', 'tail', 'last_frame', 'storyboard_first', 'storyboard_last']).has(String(frameType || '').toLowerCase())
}

function sameImageReference(record, value) {
  if (!record || value == null) return false
  return String(record.id) === String(value)
    || (record.image_url && String(record.image_url) === String(value))
    || (record.local_path && String(record.local_path) === String(value))
}

function panelIndex(frameType) {
  const match = String(frameType || '').match(/_panel_(\d+)$/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

export function getSbImagesList(imagesBySbId, storyboardId) {
  const list = imagesBySbId?.[storyboardId]
  return Array.isArray(list) ? list.filter(isCompletedImage) : []
}

export function getSbVideosList(videosBySbId, storyboardId) {
  const list = videosBySbId?.[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((v) => isPlayableVideoGenerationStatus(v.status) && ((v.local_path && String(v.local_path).trim()) || isHttpVideoUrl(v.video_url)))
}

/** 首帧图记录（与 FilmCreate.getSbFirstImage 一致） */
export function resolveSbFirstImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  if (sb.first_frame_image_id != null) {
    const bound = images.find((i) => i.id === sb.first_frame_image_id)
    if (bound) return bound
  }
  const typed = images.find((i) => i.frame_type === 'storyboard_first')
  if (typed) return typed
  if (sb.local_path || sb.image_url) {
    return {
      id: sb.first_frame_image_id,
      image_url: sb.image_url,
      local_path: sb.local_path,
      frame_type: 'storyboard_first',
    }
  }
  return null
}

/** 尾帧图记录（与 FilmCreate.getSbLastImage 一致） */
export function resolveSbLastImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  if (sb.last_frame_image_id != null) {
    const bound = images.find((i) => i.id === sb.last_frame_image_id)
    if (bound) return bound
  }
  const typed = images.find((i) => i.frame_type === 'storyboard_last')
  if (typed) return typed
  if (sb.last_frame_image_url || sb.last_frame_local_path) {
    return {
      id: sb.last_frame_image_id,
      image_url: sb.last_frame_image_url,
      local_path: sb.last_frame_local_path,
      frame_type: 'storyboard_last',
    }
  }
  return null
}

/** 经典单图模式主图 */
export function resolveSbMainImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  // Keep an explicitly bound main image authoritative, even when newer history
  // rows (for example split grid panels) were inserted after it.
  const bound = images.find((image) => sameImageReference(image, sb.first_frame_image_id))
    || images.find((image) => sameImageReference(image, sb.image_url))
    || images.find((image) => sameImageReference(image, sb.local_path))
  if (bound && !isFrameReferenceType(bound.frame_type) && !isGridPanelType(bound.frame_type)) return bound

  const normal = images.filter((image) => !isFrameReferenceType(image.frame_type) && !isGridPanelType(image.frame_type))
  if (normal.length) return normal[0]

  const panels = images
    .filter((image) => isGridPanelType(image.frame_type))
    .sort((a, b) => {
      const aSelected = Number(sb.main_panel_idx) === panelIndex(a.frame_type)
      const bSelected = Number(sb.main_panel_idx) === panelIndex(b.frame_type)
      if (aSelected !== bSelected) return aSelected ? -1 : 1
      return panelIndex(a.frame_type) - panelIndex(b.frame_type)
    })
  if (panels.length) return panels[0]
  if (sb.local_path || sb.image_url) {
    return { image_url: sb.image_url, local_path: sb.local_path }
  }
  return null
}

export function imageRecordUrl(record) {
  return assetImageUrl(record)
}

/** 当前分镜视频（优先匹配 storyboard.video_url） */
export function resolveSbVideoRecord(sb, videosBySbId) {
  if (!sb) return null
  const list = getSbVideosList(videosBySbId, sb.id)
  if (list.length) {
    if (sb.local_path) {
      const matched = list.find((v) => v.local_path && String(v.local_path) === String(sb.local_path))
      if (matched) return matched
    }
    if (sb.video_url) {
      const matched = list.find((v) => v.video_url === sb.video_url)
      if (matched) return matched
      const lp = sb.video_url.replace(/^\/static\//, '')
      const byPath = list.find((v) => v.local_path && (v.local_path === lp || sb.video_url.includes(v.local_path)))
      if (byPath) return byPath
    }
    // The bound row may be older than the paginated history. Preserve the
    // storyboard's authoritative path instead of silently showing list[0].
    if (sb.video_url || sb.local_path) {
      return { video_url: sb.video_url, local_path: sb.local_path }
    }
    return list[0]
  }
  if (sb.video_url || sb.local_path) {
    return { video_url: sb.video_url, local_path: sb.local_path }
  }
  return null
}

export function videoCandidateLabel(video) {
  const group = Number(video?.candidate_group_number)
  const candidate = Number(video?.candidate_number)
  if (Number.isInteger(group) && group > 0 && Number.isInteger(candidate) && candidate > 0) {
    return `第 ${group} 组 · 候选 ${candidate}`
  }
  return video?.id == null ? '' : `视频 #${video.id}`
}

export function videoRecordUrl(record) {
  if (!record) return ''
  const localPath = record.local_path && String(record.local_path).trim()
  if (localPath) return '/static/' + localPath.replace(/^\//, '')
  if (record.video_url && isHttpVideoUrl(record.video_url)) return record.video_url
  if (record.video_url) {
    const p = String(record.video_url).trim()
    if (p.startsWith('/static/')) return p
    if (!p.startsWith('http')) return '/static/' + p.replace(/^\//, '')
    return p
  }
  return ''
}

export function sbVideoFirstLastUrls(sb, imagesBySbId, useFirstLast) {
  const universal = sb?.creation_mode === 'universal'
  let first = ''
  let last = undefined
  if (!universal) {
    const firstRec = useFirstLast ? resolveSbFirstImageRecord(sb, imagesBySbId) : resolveSbMainImageRecord(sb, imagesBySbId)
    first = imageRecordUrl(firstRec)
  }
  if (useFirstLast && !universal) {
    const lastRec = resolveSbLastImageRecord(sb, imagesBySbId)
    const lu = imageRecordUrl(lastRec)
    if (lu) last = lu
  }
  return { first: first || undefined, last }
}

/** 分镜是否已有可用图片（与列表模式 hasSbImage 逻辑对齐） */
export function hasStoryboardImage(sb, imagesBySbId, drama) {
  if (!sb) return false
  if (dramaUsesFirstLastFrame(drama) && sb.creation_mode !== 'universal') {
    return !!(resolveSbFirstImageRecord(sb, imagesBySbId) || sb.image_url || sb.local_path || sb.composed_image)
  }
  return !!(resolveSbMainImageRecord(sb, imagesBySbId) || sb.image_url || sb.local_path || sb.composed_image)
}

/** 分镜是否已有可用视频 */
export function hasStoryboardVideo(sb, videosBySbId) {
  if (!sb) return false
  const rec = resolveSbVideoRecord(sb, videosBySbId)
  return !!(rec?.video_url || rec?.local_path || sb.video_url)
}
