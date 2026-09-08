function validateGenerationCapabilities(context = {}) {
  const errors = [];
  const warnings = [];
  const capabilities = context.capabilities || {};
  const references = context.references?.entries || context.references || [];
  const referenceCount = references.length;
  const maxReferences = Number.isFinite(Number(capabilities.maxReferences)) ? Number(capabilities.maxReferences) : Infinity;
  const minReferences = Number.isFinite(Number(capabilities.minReferences)) ? Number(capabilities.minReferences) : 0;

  if (referenceCount > maxReferences) errors.push({ code: 'REFERENCE_LIMIT_EXCEEDED', message: `模型最多支持 ${maxReferences} 张参考图` });
  if (referenceCount < minReferences) errors.push({ code: 'REFERENCE_COUNT_INSUFFICIENT', message: `模型至少需要 ${minReferences} 张参考图` });
  if (references.some((item) => item.realPerson) && capabilities.allowRealPerson === false) {
    errors.push({ code: 'REAL_PERSON_REFERENCE_FORBIDDEN', message: '当前模型不允许真人参考图' });
  }
  if (context.mediaType === 'video' && capabilities.supportsVideo === false) errors.push({ code: 'MODEL_VIDEO_UNSUPPORTED', message: '当前模型不支持视频生成' });
  if (context.mediaType === 'image' && capabilities.supportsImage === false) errors.push({ code: 'MODEL_IMAGE_UNSUPPORTED', message: '当前模型不支持图片生成' });
  if (context.style?.recommendedCapabilities?.renderType && capabilities.renderTypes
    && !capabilities.renderTypes.includes(context.style.recommendedCapabilities.renderType)) {
    warnings.push({ code: 'STYLE_RENDER_TYPE_NOT_RECOMMENDED', message: '所选模型并非该风格的推荐渲染类型' });
  }
  return { status: errors.length ? 'blocked' : warnings.length ? 'warning' : 'ok', errors, warnings };
}

module.exports = { validateGenerationCapabilities };
