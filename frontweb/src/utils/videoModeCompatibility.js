export function videoModelNameFromConfig(cfg) {
  if (!cfg) return ''
  const defaultModel = String(cfg.default_model || '').trim()
  if (defaultModel) return defaultModel
  if (Array.isArray(cfg.model) && cfg.model.length) return String(cfg.model[0] || '').trim()
  return String(cfg.model || '').trim()
}

export function isH3ComfyUiConfig(cfg) {
  const provider = String(cfg?.provider || '').trim().toLowerCase()
  const model = videoModelNameFromConfig(cfg).toLowerCase()
  return provider === 'comfyui' && (model === 'h3-continuity-v1' || model.includes('minimaxh3') || model.includes('minimax-h3'))
}

export function universalVideoCompatibility(cfg) {
  if (isH3ComfyUiConfig(cfg)) return { compatible: true, mode: 'h3_director', supportsOmniReferences: false }
  const protocol = String(cfg?.api_protocol || '').trim().toLowerCase()
  const provider = String(cfg?.provider || '').trim().toLowerCase()
  const model = videoModelNameFromConfig(cfg).toLowerCase()
  if (protocol === 'kling_omni' || protocol === 'volcengine_omni' || protocol === 'agnes'
    || provider === 'agnes' || /agnes-video/.test(model)) {
    return { compatible: true, mode: 'omni', supportsOmniReferences: true }
  }
  return { compatible: false, mode: 'fallback', supportsOmniReferences: false }
}

export function canUseUniversalOmniVideoApi(cfg) {
  return universalVideoCompatibility(cfg).compatible
}
