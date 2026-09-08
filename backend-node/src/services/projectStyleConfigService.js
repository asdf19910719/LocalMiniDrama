'use strict';

const { createStyleRegistryService } = require('./styleRegistryService');

function parseProjectMetadata(project) {
  if (!project?.metadata) return {};
  try {
    return typeof project.metadata === 'string' ? JSON.parse(project.metadata) : project.metadata;
  } catch (_) {
    return {};
  }
}

function resolveProjectStyleSpec(db, project) {
  const styleId = String(project?.style_id || '').trim();
  return styleId ? createStyleRegistryService({ db }).requireStyle(styleId) : null;
}

function applyProjectStyleToConfig(config, project, db) {
  const style = resolveProjectStyleSpec(db, project);
  if (!style) return { ...config, style: { ...(config?.style || {}) } };
  return {
    ...config,
    style: {
      ...(config?.style || {}),
      style_id: style.id,
      style_version: style.version,
      default_style: style.promptEn || style.promptZh,
      default_style_zh: style.promptZh,
      default_style_en: style.promptEn,
    },
  };
}

function resolveProjectStreamStyle(_requestStyle, project, db) {
  const style = resolveProjectStyleSpec(db, project);
  return style?.promptEn || style?.promptZh || '';
}

module.exports = {
  parseProjectMetadata,
  resolveProjectStyleSpec,
  applyProjectStyleToConfig,
  resolveProjectStreamStyle,
};
