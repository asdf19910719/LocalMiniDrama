function basename(value) {
  const cleaned = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '')
  return cleaned.split(/[\\/]/).pop().trim() || 'episode-package.json'
}

export function formatJsonText(text) {
  const source = text == null ? '' : String(text)
  if (!source) return ''
  try {
    return JSON.stringify(JSON.parse(source), null, 2)
  } catch {
    return source
  }
}

export function importSourceDownloadName(filename) {
  const safe = basename(filename).replace(/\.json$/i, '') || 'episode-package'
  return `${safe}-raw.json`
}

export function importReportSections(report, parseWarnings = [], matchDecisions = null, generatorMetadata = null) {
  const value = report && typeof report === 'object' ? report : {}
  return [
    { key: 'created', label: '已创建', items: Array.isArray(value.created) ? value.created : [] },
    { key: 'reused', label: '已复用', items: Array.isArray(value.reused) ? value.reused : [] },
    { key: 'match_decisions', label: '原始匹配决策', items: matchDecisions && typeof matchDecisions === 'object' ? [matchDecisions] : [] },
    { key: 'generator_metadata', label: '生成器元数据', items: generatorMetadata && typeof generatorMetadata === 'object' ? [generatorMetadata] : [] },
    { key: 'derived_fields', label: '兼容补齐', items: Array.isArray(value.derived_fields) ? value.derived_fields : [] },
    { key: 'missing_fields', label: '源数据缺失', items: Array.isArray(value.missing_fields) ? value.missing_fields : [] },
    { key: 'audit_only_fields', label: '仅审计字段', items: Array.isArray(value.audit_only_fields) ? value.audit_only_fields : [] },
    {
      key: 'warnings',
      label: '警告',
      items: [...(Array.isArray(value.warnings) ? value.warnings : []), ...(Array.isArray(parseWarnings) ? parseWarnings : [])],
    },
  ]
}

export function hasImportSource(episode) {
  return !!(episode && episode.import_source && typeof episode.import_source === 'object')
}
