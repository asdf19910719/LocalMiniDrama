const MODE_CONFIG = Object.freeze({
  character: Object.freeze({ defaultMode: 'TURNAROUND', allowed: Object.freeze(['SINGLE', 'TURNAROUND']) }),
  character_variant: Object.freeze({ defaultMode: 'SINGLE', allowed: Object.freeze(['SINGLE', 'TURNAROUND']) }),
  scene: Object.freeze({ defaultMode: 'NORMAL', allowed: Object.freeze(['NORMAL', 'QUAD_GRID']) }),
});

const TURNAROUND_INSTRUCTION = [
  '【角色三/四视图版式】生成横版角色转面设定图，完整展示同一人物的正面、正侧面、背面视图。',
  '所有视图必须保持五官、脸型、年龄感、体型比例、发型状态和服装完全一致，脚底同一水平线、头顶同高。',
  '使用干净中性背景，不要文字、标识、分镜格说明或额外人物。',
].join('\n');

function configFor(targetType) {
  const config = MODE_CONFIG[String(targetType || '').trim().toLowerCase()];
  if (!config) throw new Error(`Unsupported asset generation target type: ${targetType}`);
  return config;
}

function allowedAssetModes(targetType) {
  return [...configFor(targetType).allowed];
}

function defaultAssetMode(targetType) {
  return configFor(targetType).defaultMode;
}

function normalizeAssetMode(targetType, value) {
  const config = configFor(targetType);
  const normalized = value == null || String(value).trim() === ''
    ? config.defaultMode
    : String(value).trim().toUpperCase();
  if (!config.allowed.includes(normalized)) {
    throw new Error(`Unsupported asset generation mode for ${targetType}: ${normalized}`);
  }
  return normalized;
}

function buildModePrompt(targetType, mode, prompt) {
  const normalizedType = String(targetType || '').trim().toLowerCase();
  const normalizedMode = normalizeAssetMode(normalizedType, mode);
  const base = String(prompt || '').trim();
  if ((normalizedType === 'character' || normalizedType === 'character_variant') && normalizedMode === 'TURNAROUND') {
    return [TURNAROUND_INSTRUCTION, base].filter(Boolean).join('\n\n');
  }
  return base;
}

module.exports = {
  allowedAssetModes,
  defaultAssetMode,
  normalizeAssetMode,
  buildModePrompt,
};
