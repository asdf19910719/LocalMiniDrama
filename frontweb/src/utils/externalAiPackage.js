function safePart(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*：\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^[._ ]+|[._ ]+$/g, '')
  return cleaned || fallback
}

export function externalAiDownloadName(label, kind, extension) {
  const safeLabel = safePart(label, 'external-ai')
  const safeKind = safePart(kind, 'file')
  const safeExtension = String(extension || 'txt').replace(/^\.+/, '') || 'txt'
  return `${safeLabel}-${safeKind}.${safeExtension}`
}

export function saveBlob(blob, filename) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return filename
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
  return filename
}

export function saveTextFile(text, filename, mimeType = 'text/plain;charset=utf-8') {
  if (typeof Blob === 'undefined') return filename
  return saveBlob(new Blob([text || ''], { type: mimeType }), filename)
}
