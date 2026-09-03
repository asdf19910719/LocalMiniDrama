// 单集制作包导入 + 分镜人物状态关联路由
// 挂载要求:在 index.js 中先于各 '/:id' 形参路由 use,避免精确路径被吞。
const express = require('express');
const response = require('../response');
const {
  previewPackageImport,
  importEpisodePackage,
  episodeBlankStatus,
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

/**
 * preview/import 共用的导入目标校验:
 * - drama_id 缺失 → { error: 'drama_id 必填' }(此前不校验,目标集只能手输 ID,功能不可用);
 * - target_episode_id 给定时校验该剧集属于 drama_id(防跨剧填充),不属于 → 400。
 * 校验通过返回 { dramaId, targetEpisodeId }(无目标集时 targetEpisodeId 为 null)。
 */
function requireImportTarget(db, body) {
  const dramaId = Number(body.drama_id);
  if (!Number.isFinite(dramaId) || dramaId <= 0) {
    return { error: 'drama_id 必填' };
  }
  const rawTarget = body.target_episode_id;
  if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === '') {
    return { dramaId, targetEpisodeId: null };
  }
  const targetEpisodeId = Number(rawTarget);
  const episode = Number.isFinite(targetEpisodeId) && targetEpisodeId > 0
    ? db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(targetEpisodeId)
    : null;
  if (!episode || Number(episode.drama_id) !== dramaId) {
    return { error: '目标剧集不属于当前剧' };
  }
  return { dramaId, targetEpisodeId };
}

function previewImport(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.raw_json_text || !String(body.raw_json_text).trim()) {
      return response.badRequest(res, 'raw_json_text 必填');
    }
    const target = requireImportTarget(db, body);
    if (target.error) {
      return response.badRequest(res, target.error);
    }
    try {
      const out = previewPackageImport(db, {
        rawText: body.raw_json_text,
        filename: body.filename,
        dramaId: target.dramaId,
        targetEpisodeId: target.targetEpisodeId,
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
    const target = requireImportTarget(db, body);
    if (target.error) {
      return response.badRequest(res, target.error);
    }
    try {
      const out = importEpisodePackage(db, {
        rawText: body.raw_json_text,
        sourceSha256: body.source_sha256,
        dramaId: target.dramaId,
        targetEpisodeId: target.targetEpisodeId,
        filename: body.filename,
        decisions: body.decisions,
      });
      response.success(res, out);
    } catch (err) {
      mapServiceError(res, log, 'import', err);
    }
  };
}

/**
 * 空白剧集列表(导入弹窗“填充空白剧集”下拉的数据源):
 * 遍历该剧未删分集(按 episode_number 排序),逐个用 episodeBlankStatus 判定,
 * 仅返回空白集。集数量级为几十,逐个判定可接受。
 */
function listBlankEpisodes(db, log) {
  return (req, res) => {
    const dramaId = Number(req.params.dramaId);
    if (!Number.isFinite(dramaId) || dramaId <= 0) {
      return response.badRequest(res, '无效的 dramaId');
    }
    try {
      const rows = db.prepare(
        'SELECT id, episode_number, title FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC, id ASC'
      ).all(dramaId);
      const data = [];
      for (const row of rows) {
        if (episodeBlankStatus(db, row.id).status === 'blank') {
          data.push({ id: row.id, episode_number: row.episode_number, title: row.title });
        }
      }
      response.success(res, data);
    } catch (err) {
      log.error('episode package blank-episodes failed', { error: err.message });
      response.internalError(res, err.message || '服务器错误');
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
  r.get('/dramas/:dramaId/blank-episodes', listBlankEpisodes(db, log));
  r.post('/episodes/import-package/preview', previewImport(db, log));
  r.post('/episodes/import-package', importPackage(db, log));
  r.put('/storyboards/:id/character-variant-links', saveVariantLinks(db, log));
  return r;
};
