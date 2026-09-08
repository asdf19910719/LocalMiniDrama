const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateStyleSpec } = require('../schemas/styleSpec');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', 'catalog', 'stylePresets.v1.json');

function styleError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function readCatalog(catalogPath) {
  const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const styles = Array.isArray(parsed) ? parsed : parsed.styles;
  if (!Array.isArray(styles)) throw styleError('STYLE_SCHEMA_INVALID', '风格目录必须包含 styles 数组');
  const ids = new Set();
  const keys = new Set();
  const runningHubIds = new Set();
  for (const style of styles) {
    const validation = validateStyleSpec(style);
    if (!validation.valid) throw styleError('STYLE_SCHEMA_INVALID', `风格 ${style?.id || '(unknown)'} 无效`, validation.errors);
    if (ids.has(style.id) || keys.has(style.key) || (style.runningHubId && runningHubIds.has(style.runningHubId))) {
      throw styleError('STYLE_SCHEMA_INVALID', `风格目录存在重复标识: ${style.id}`);
    }
    ids.add(style.id);
    keys.add(style.key);
    if (style.runningHubId) runningHubIds.add(style.runningHubId);
  }
  return styles.map((style) => Object.freeze({ ...style }));
}

function createStyleRegistryService({ db = null, catalogPath = DEFAULT_CATALOG_PATH } = {}) {
  const systemStyles = readCatalog(catalogPath);

  function listCustomStyles() {
    if (!db) return [];
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_styles'").get();
    if (!table) return [];
    return db.prepare('SELECT spec_json FROM custom_styles WHERE deleted_at IS NULL ORDER BY created_at, id').all()
      .map((row) => JSON.parse(row.spec_json));
  }

  function allStyles() {
    return [...systemStyles, ...listCustomStyles()];
  }

  function listStyles(filters = {}) {
    const query = String(filters.query || '').trim().toLocaleLowerCase();
    return allStyles().filter((style) => {
      if (!filters.includeDisabled && style.enabled === false) return false;
      if (filters.category && style.category !== filters.category) return false;
      if (filters.type && style.type !== filters.type) return false;
      if (query && ![style.labelZh, style.labelEn, style.descriptionZh, style.key].some((item) => String(item || '').toLocaleLowerCase().includes(query))) return false;
      return true;
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  function getStyle(id) {
    const target = String(id || '').trim();
    return allStyles().find((style) => style.id === target) || null;
  }

  function requireStyle(id) {
    const style = getStyle(id);
    if (!style) throw styleError('STYLE_NOT_FOUND', '指定风格不存在', { style_id: id || null });
    if (!style.enabled) throw styleError('STYLE_DISABLED', '指定风格已停用', { style_id: id });
    return style;
  }

  function requireDatabase() {
    if (!db) throw styleError('STYLE_DATABASE_REQUIRED', '自定义风格操作需要数据库');
  }

  function normalizeCustomSpec(input, existing = null) {
    const id = existing?.id || `custom:${crypto.randomUUID()}`;
    const version = existing ? Number(existing.version) + 1 : 1;
    const labelZh = String(input.labelZh ?? existing?.labelZh ?? '').trim();
    const labelEn = String(input.labelEn ?? existing?.labelEn ?? '').trim();
    const descriptionZh = String(input.descriptionZh ?? existing?.descriptionZh ?? '').trim();
    const promptZh = String(input.promptZh ?? existing?.promptZh ?? '').trim();
    const promptEn = String(input.promptEn ?? existing?.promptEn ?? '').trim();
    const spec = {
      ...(existing || {}),
      ...input,
      id,
      key: existing?.key || `custom-${id.slice(7, 15)}`,
      type: 'custom',
      version,
      enabled: input.enabled ?? existing?.enabled ?? true,
      source: 'local-custom',
      runningHubId: null,
      category: 'custom',
      sortOrder: existing?.sortOrder ?? Date.now(),
      labelZh,
      labelEn,
      descriptionZh,
      promptZh,
      promptEn,
      keywords: input.keywords ?? existing?.keywords ?? { color: [], lighting: [], material: [], camera: [], environment: [], quality: [], negative: [] },
      suitableAssetTypes: input.suitableAssetTypes ?? existing?.suitableAssetTypes ?? ['character', 'character_variant', 'scene', 'prop', 'storyboard', 'video'],
      recommendedCapabilities: input.recommendedCapabilities ?? existing?.recommendedCapabilities ?? {
        renderType: 'custom', supportsTextToImage: true, supportsImageToImage: true,
        characterConsistency: 'recommended', multiReference: 'recommended', preferredPromptLanguage: 'auto',
      },
      preview: input.preview ?? existing?.preview ?? {
        localPath: '/style-thumbs/runninghub/custom-style.svg',
        fallbackColor: 'linear-gradient(135deg,#5f4b8b,#23324a)',
      },
    };
    const validation = validateStyleSpec(spec);
    if (!validation.valid) throw styleError('STYLE_SCHEMA_INVALID', '自定义风格不符合 StyleSpec', validation.errors);
    return spec;
  }

  function createCustomStyle(input = {}, ownerId = null) {
    requireDatabase();
    const spec = normalizeCustomSpec(input);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO custom_styles (id, owner_id, version, spec_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(spec.id, ownerId, spec.version, JSON.stringify(spec), now, now);
    return spec;
  }

  function updateCustomStyle(id, input = {}) {
    requireDatabase();
    const existing = getStyle(id);
    if (!existing || existing.type !== 'custom') throw styleError('STYLE_NOT_FOUND', '自定义风格不存在');
    const spec = normalizeCustomSpec(input, existing);
    const result = db.prepare('UPDATE custom_styles SET version = ?, spec_json = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(spec.version, JSON.stringify(spec), new Date().toISOString(), id);
    if (!result.changes) throw styleError('STYLE_NOT_FOUND', '自定义风格不存在');
    return spec;
  }

  function deleteCustomStyle(id) {
    requireDatabase();
    const existing = getStyle(id);
    if (!existing || existing.type !== 'custom') throw styleError('STYLE_NOT_FOUND', '自定义风格不存在');
    const inUse = db.prepare('SELECT id FROM dramas WHERE style_id = ? AND deleted_at IS NULL LIMIT 1').get(id);
    if (inUse) throw styleError('CUSTOM_STYLE_IN_USE', '该自定义风格仍被项目使用', { drama_id: inUse.id });
    db.prepare('UPDATE custom_styles SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), id);
    return true;
  }

  return { listStyles, getStyle, requireStyle, createCustomStyle, updateCustomStyle, deleteCustomStyle };
}

module.exports = { createStyleRegistryService, styleError, DEFAULT_CATALOG_PATH };
