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

/**
 * 参考图槽位接口失败时的回退策略:
 * - H3 配置 → 'abort':H3 参考图必须与草稿 reference_snapshot 同源(槽位口径),
 *   legacy 本地收集取角色主图而非状态图,静默降级会给 H3 发错参考图,必须中止提交;
 * - 非 H3 → 'legacy_fallback':可用性优先,保留 legacy 本地收集兜底。
 */
export function slotReferenceFallbackPolicy(cfg) {
  return isH3ComfyUiConfig(cfg) ? 'abort' : 'legacy_fallback'
}
