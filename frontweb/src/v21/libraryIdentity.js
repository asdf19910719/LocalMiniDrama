// 资产库来源指纹（与后端 src/services/libraryDedup.js 的 refKey/identityKeys 对齐）：
// 任意一键相同即视为"同来源"，前端在入库前先据此检测冲突，呈现「使用已有 / 另存副本」选择。

export function refKey(value) {
  let s = String(value || '').trim()
  if (!s) return ''
  if (s.startsWith('data:')) return 'data:' + s
  if (/^https?:\/\//i.test(s)) return 'url:' + s
  s = s.replace(/\\/g, '/')
  s = s.replace(/^\/?static\//i, '')
  s = s.replace(/^\/+/, '')
  return s ? 'path:' + s : ''
}

export function identityKeys(row) {
  const keys = new Set()
  const sourceId = String((row && row.source_id) || '').trim()
  const sourceType = (row && row.source_type) || ''
  if (sourceId && sourceType) keys.add(`source:${sourceType}:${sourceId}`)
  const imageKey = refKey(row && row.image_url)
  const pathKey = refKey(row && row.local_path)
  if (imageKey) keys.add(imageKey)
  if (pathKey) keys.add(pathKey)
  return keys
}

/** 在既有库条目中找与 pending 同来源的条目（任一指纹键重合即命中），无则返回 null */
export function findConflictingItem(items, pending) {
  const wanted = identityKeys(pending)
  if (wanted.size === 0) return null
  const list = Array.isArray(items) ? items : []
  return list.find((row) => {
    const existing = identityKeys(row)
    for (const key of wanted) {
      if (existing.has(key)) return true
    }
    return false
  }) || null
}
