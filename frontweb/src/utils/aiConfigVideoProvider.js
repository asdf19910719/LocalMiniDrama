export const COMFYUI_DEFAULT_BASE_URL = 'http://127.0.0.1:8188'

export function isComfyuiVideoConfig({ service_type, provider } = {}) {
  return service_type === 'video' && String(provider || '').trim().toLowerCase() === 'comfyui'
}

export function isApiKeyRequired(config) {
  return !isComfyuiVideoConfig(config)
}

export function comfyuiConfigDefaults(workflows = []) {
  const workflow = String(workflows[0] || '').trim()
  return {
    base_url: COMFYUI_DEFAULT_BASE_URL,
    modelText: workflow,
    default_model: workflow,
    width: 1312,
    height: 736,
  }
}

export function comfyuiWorkflowReasonLabel(reason) {
  return ({
    WORKFLOW_EXPERIMENTAL_REQUIRED: '需要启用实验工作流',
    WORKFLOW_INVALID: '注册表标记为无效',
    WORKFLOW_NOT_FOUND: '注册表中不存在',
    WORKFLOW_NOT_IN_CATALOG: '当前目录中不存在',
    WORKFLOW_CATALOG_UNAVAILABLE: '工作流目录加载失败',
  })[String(reason || '').trim()] || String(reason || '').trim()
}

export function comfyuiWorkflowOptionsFromCatalog(catalog, existingIds = []) {
  const rows = Array.isArray(catalog) ? catalog : (Array.isArray(catalog?.workflows) ? catalog.workflows : [])
  const catalogAvailable = Array.isArray(catalog) || Array.isArray(catalog?.workflows)
  const options = rows
    .filter((workflow) => workflow && String(workflow.id || '').trim())
    .map((workflow) => {
      const id = String(workflow.id).trim()
      const unavailableReason = workflow.unavailableReason || null
      const selectable = workflow.selectable === true
      const variant = String(workflow.variant || '').trim()
      const reasonLabel = comfyuiWorkflowReasonLabel(unavailableReason)
      return {
        ...workflow,
        id,
        selectable,
        disabled: !selectable,
        unavailableReason,
        preserved: false,
        label: `${variant || id}${selectable ? '' : `（不可用${reasonLabel ? `：${reasonLabel}` : ''}）`}`,
      }
    })
  const known = new Set(options.map((option) => option.id))
  for (const value of existingIds || []) {
    const id = String(value || '').trim()
    if (!id || known.has(id)) continue
    const unavailableReason = catalogAvailable ? 'WORKFLOW_NOT_IN_CATALOG' : 'WORKFLOW_CATALOG_UNAVAILABLE'
    options.push({
      id,
      status: 'unknown',
      selectable: false,
      disabled: true,
      unavailableReason,
      preserved: true,
      label: `${id}（不可用：${comfyuiWorkflowReasonLabel(unavailableReason)}）`,
    })
    known.add(id)
  }
  return options
}

export function normalizeComfyuiModelSelection({ selected = [], defaultModel = '', options = [] } = {}) {
  const models = [...new Set((selected || []).map((value) => String(value || '').trim()).filter(Boolean))]
  const optionById = new Map((options || []).map((option) => [String(option?.id || '').trim(), option]))
  const selectableModels = models.filter((id) => optionById.get(id)?.selectable === true)
  const currentDefault = String(defaultModel || '').trim()
  const normalizedDefault = selectableModels.includes(currentDefault) ? currentDefault : (selectableModels[0] || '')
  const invalidSelected = models.filter((id) => optionById.get(id)?.selectable !== true)
  return {
    models,
    defaultModel: normalizedDefault,
    invalidSelected,
    canSave: models.length > 0 && invalidSelected.length === 0 && Boolean(normalizedDefault),
  }
}

export function buildComfyuiWorkflowCheckPlan(workflows = [], catalog = null) {
  const options = comfyuiWorkflowOptionsFromCatalog(catalog, workflows)
  const byId = new Map(options.map((option) => [option.id, option]))
  return [...new Set((workflows || []).map((value) => String(value || '').trim()).filter(Boolean))].map((workflow) => {
    const option = byId.get(workflow)
    if (option?.selectable) return { workflow, status: 'pending', error: '' }
    const status = option?.unavailableReason === 'WORKFLOW_EXPERIMENTAL_REQUIRED'
      ? 'experimental_disabled'
      : 'failed'
    return {
      workflow,
      status,
      error: comfyuiWorkflowReasonLabel(option?.unavailableReason || 'WORKFLOW_NOT_IN_CATALOG'),
    }
  })
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
