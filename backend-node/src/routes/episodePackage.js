// 单集制作包导入 + 分镜人物状态关联路由
// 挂载要求:在 index.js 中先于各 '/:id' 形参路由 use,避免精确路径被吞。
const express = require('express');
const response = require('../response');
const {
  previewPackageImport,
  importEpisodePackage,
} = require('../services/episodePackageService');
const {
  syncStoryboardVariantLinks,
} = require('../services/storyboardVariantService');

// 语义冲突映射 409;其余业务错误(PACKAGE_INVALID / PACKAGE_DECISION_INVALID /
// CONFLICT_UNRESOLVED / VARIANT_CHARACTER_MISMATCH / VARIANT_SORT_ORDER_DUPLICATE)一律 400
const CONFLICT_CODES = new Set(['TARGET_NOT_BLANK', 'PACKAGE_HASH_MISMATCH']);

function mapServiceError(res, log, scope, err) {
  if (err && err.code) {
    const status = CONFLICT_CODES.has(err.code) ? 409 : 400;
    return response.error(res, status, err.code, err.message);
  }
  log.error(`episode package ${scope} failed`, { error: err.message });
  response.internalError(res, err.message || '服务器错误');
}

function previewImport(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.raw_json_text || !String(body.raw_json_text).trim()) {
      return response.badRequest(res, 'raw_json_text 必填');
    }
    try {
      const out = previewPackageImport(db, {
        rawText: body.raw_json_text,
        filename: body.filename,
        dramaId: body.drama_id,
        targetEpisodeId: body.target_episode_id,
      });
      response.success(res, out);
    } catch (err) {
      mapServiceError(res, log, 'preview', err);
    }
  };
}

function importPackage(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.raw_json_text || !String(body.raw_json_text).trim()) {
      return response.badRequest(res, 'raw_json_text 必填');
    }
    if (!body.source_sha256) {
      return response.badRequest(res, 'source_sha256 必填');
    }
    try {
      const out = importEpisodePackage(db, {
        rawText: body.raw_json_text,
        sourceSha256: body.source_sha256,
        dramaId: body.drama_id,
        targetEpisodeId: body.target_episode_id,
        filename: body.filename,
        decisions: body.decisions,
      });
      response.success(res, out);
    } catch (err) {
      mapServiceError(res, log, 'import', err);
    }
  };
}

function saveVariantLinks(db, log) {
  return (req, res) => {
    const storyboardId = Number(req.params.id);
    if (!Number.isFinite(storyboardId)) return response.badRequest(res, '无效的ID');
    const links = (req.body || {}).links;
    if (!Array.isArray(links)) return response.badRequest(res, 'links 必须为数组');
    try {
      const rows = syncStoryboardVariantLinks(db, storyboardId, links);
      response.success(res, rows);
    } catch (err) {
      mapServiceError(res, log, 'variant-links', err);
    }
  };
}

module.exports = function episodePackageRoutes(db, cfg, log) {
  const r = express.Router();
  r.post('/episodes/import-package/preview', previewImport(db, log));
  r.post('/episodes/import-package', importPackage(db, log));
  r.put('/storyboards/:id/character-variant-links', saveVariantLinks(db, log));
  return r;
};
