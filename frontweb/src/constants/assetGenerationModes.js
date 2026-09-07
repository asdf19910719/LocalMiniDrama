const MODE_OPTIONS = Object.freeze({
  character: Object.freeze([
    Object.freeze({ value: 'SINGLE', label: '单张角色图', shortLabel: '单图', description: '生成一张完整角色设定图' }),
    Object.freeze({ value: 'TURNAROUND', label: '角色转面图', shortLabel: '转面图', description: '同图展示正面、正侧面和背面' }),
  ]),
  character_variant: Object.freeze([
    Object.freeze({ value: 'SINGLE', label: '单张状态图', shortLabel: '单图', description: '生成当前造型的一张状态图' }),
    Object.freeze({ value: 'TURNAROUND', label: '状态转面图', shortLabel: '转面图', description: '同图展示当前状态的正面、正侧面和背面' }),
  ]),
  scene: Object.freeze([
    Object.freeze({ value: 'NORMAL', label: '普通场景图', shortLabel: '普通图', description: '生成一个主视角的场景参考图' }),
    Object.freeze({ value: 'QUAD_GRID', label: '四宫格场景', shortLabel: '四宫格', description: '同图展示场景的四个互补视角' }),
  ]),
})

const DEFAULT_MODES = Object.freeze({
  character: 'TURNAROUND',
  character_variant: 'SINGLE',
  scene: 'NORMAL',
})

export function assetGenerationModeOptions(targetType) {
  return [...(MODE_OPTIONS[String(targetType || '').toLowerCase()] || [])]
}

export function defaultAssetGenerationMode(targetType) {
  return DEFAULT_MODES[String(targetType || '').toLowerCase()] || ''
}

export function normalizeAssetGenerationMode(targetType, value) {
  const options = assetGenerationModeOptions(targetType)
  const normalized = String(value || '').trim().toUpperCase()
  return options.some((item) => item.value === normalized)
    ? normalized
    : defaultAssetGenerationMode(targetType)
}

export function assetGenerationModeLabel(targetType, value) {
  const normalized = normalizeAssetGenerationMode(targetType, value)
  return assetGenerationModeOptions(targetType).find((item) => item.value === normalized)?.label || normalized
}
