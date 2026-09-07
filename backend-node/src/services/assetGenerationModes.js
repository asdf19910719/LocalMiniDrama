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

const QUAD_GRID_INSTRUCTION = [
  '【场景四宫格版式】在一张图片中生成同一场景的四宫格视角设定图。',
  '四格必须保持空间结构、建筑材质、陈设位置、时间、天气和光照连续一致，并提供主视角、反向视角、俯视角和补充视角。',
  '每格只改变观察机位，不得变成四个不同地点；不要文字、边框标题、水印或人物特写。',
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
    if (base.includes('【角色三/四视图版式】')) return base;
    return [TURNAROUND_INSTRUCTION, base].filter(Boolean).join('\n\n');
  }
  if (normalizedType === 'scene' && normalizedMode === 'QUAD_GRID') {
    if (base.includes('【场景四宫格版式】')) return base;
    return [QUAD_GRID_INSTRUCTION, base].filter(Boolean).join('\n\n');
  }
  return base;
}

module.exports = {
  allowedAssetModes,
  defaultAssetMode,
  normalizeAssetMode,
  buildModePrompt,
};
