const CATEGORY_VALUES = new Set(['realistic', '3d-special', '2d', 'custom']);
const TYPE_VALUES = new Set(['system', 'custom']);
const LANGUAGE_VALUES = new Set(['auto', 'zh', 'en', 'mixed']);
const ASSET_TYPES = new Set(['character', 'character_variant', 'scene', 'prop', 'storyboard', 'video']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    errors.push(`${path} must be an array of non-empty strings`);
  }
}

function validateStyleSpec(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['style must be an object'] };
  }

  for (const key of ['id', 'key', 'source', 'category', 'labelZh', 'labelEn', 'descriptionZh', 'promptZh', 'promptEn']) {
    if (!isNonEmptyString(value[key])) errors.push(`${key} is required`);
  }
  if (!TYPE_VALUES.has(value.type)) errors.push('type is invalid');
  if (!Number.isInteger(value.version) || value.version < 1) errors.push('version must be a positive integer');
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be boolean');
  if (!CATEGORY_VALUES.has(value.category)) errors.push('category is invalid');
  if (!Number.isFinite(value.sortOrder)) errors.push('sortOrder must be numeric');
  if (!/[A-Za-z]{4}/.test(String(value.promptEn || ''))) errors.push('promptEn must contain a genuine English instruction');
  if (String(value.promptEn || '').trim() === String(value.promptZh || '').trim()) errors.push('promptEn must differ from promptZh');
  if (value.type === 'system' && !isNonEmptyString(value.runningHubId)) errors.push('runningHubId is required for system styles');

  const keywordKeys = ['color', 'lighting', 'material', 'camera', 'environment', 'quality', 'negative'];
  if (!value.keywords || typeof value.keywords !== 'object') errors.push('keywords is required');
  else keywordKeys.forEach((key) => validateStringArray(value.keywords[key], `keywords.${key}`, errors));

  validateStringArray(value.suitableAssetTypes, 'suitableAssetTypes', errors);
  if (Array.isArray(value.suitableAssetTypes)) {
    value.suitableAssetTypes.forEach((item) => {
      if (!ASSET_TYPES.has(item)) errors.push(`suitableAssetTypes contains invalid value: ${item}`);
    });
  }

  const capabilities = value.recommendedCapabilities;
  if (!capabilities || typeof capabilities !== 'object') errors.push('recommendedCapabilities is required');
  else if (!LANGUAGE_VALUES.has(capabilities.preferredPromptLanguage)) errors.push('preferredPromptLanguage is invalid');

  const preview = value.preview;
  if (!preview || typeof preview !== 'object') errors.push('preview is required');
  else {
    if (!isNonEmptyString(preview.localPath)) errors.push('preview.localPath is required');
    if (!isNonEmptyString(preview.fallbackColor)) errors.push('preview.fallbackColor is required');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateStyleSpec };
