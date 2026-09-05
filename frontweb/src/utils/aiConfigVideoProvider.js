export const COMFYUI_DEFAULT_BASE_URL = 'http://127.0.0.1:8188'
export const DEFAULT_H3_TE_SPEED_WORKFLOW_ID = 'minimax_h3_director_r2v_te_speed'

export function isComfyuiVideoConfig({ service_type, provider } = {}) {
  return service_type === 'video' && String(provider || '').trim().toLowerCase() === 'comfyui'
}

export function isApiKeyRequired(config) {
  return !isComfyuiVideoConfig(config)
}

export function comfyuiConfigDefaults(workflows = []) {
  const normalized = workflows.map((value) => String(value || '').trim()).filter(Boolean)
  const workflow = normalized.includes(DEFAULT_H3_TE_SPEED_WORKFLOW_ID)
    ? DEFAULT_H3_TE_SPEED_WORKFLOW_ID
    : String(normalized[0] || '')
  return {
    base_url: COMFYUI_DEFAULT_BASE_URL,
    modelText: workflow,
    default_model: workflow,
    width: 1312,
    height: 736,
  }
}

function normalizeDimension(value, label) {
  const dimension = Number(value)
  if (!Number.isInteger(dimension) || dimension <= 0 || dimension % 32 !== 0) {
    throw new Error(`${label}必须为大于 0 的 32 的倍数`)
  }
  return dimension
}

export function serializeVideoProviderSettings({ provider, width, height, settings } = {}) {
  if (String(provider || '').trim().toLowerCase() !== 'comfyui') return undefined
  let existing = {}
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    existing = settings
  } else if (typeof settings === 'string' && settings.trim()) {
    try {
      const parsed = JSON.parse(settings)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed
    } catch (_) {}
  }
  return JSON.stringify({
    ...existing,
    width: normalizeDimension(width, '宽度'),
    height: normalizeDimension(height, '高度'),
  })
}
