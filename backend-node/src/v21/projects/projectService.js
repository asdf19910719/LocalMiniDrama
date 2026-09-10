'use strict';

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function parseMeta(row) {
  try {
    return JSON.parse(row.metadata || '{}') || {};
  } catch {
    return {};
  }
}

const STAGE_ORDER = ['script', 'assets', 'storyboard', 'cut'];

/**
 * V2.1 项目服务（Project Hub / 概览聚合）。
 * 原型合同锚点：
 * - 新建项目只要名称/画幅/题材，无任何时长与输出偏好字段（NAV-201 / EP-201）；
 * - 概览素材只保留一行聚合（对象数 + 缺少可用形象数）；
 * - 卡片只显示上次工作、当前阶段与健康摘要（PROJECTS-003）。
 */
function createProjectService(db, { log = console } = {}) {
  function styleRegistry() {
    const { createStyleRegistryService } = require('../../services/styleRegistryService.js');
    return createStyleRegistryService({ db });
  }

  /** 安装默认风格：统一风格目录第一项（新项目表单无风格步骤，由概览中央弹窗更换） */
  function resolveDefaultStyleId() {
    const registry = styleRegistry();
    const styles = registry.listStyles({});
    const first = Array.isArray(styles) ? styles[0] : null;
    if (!first) throw httpError('STYLE_CATALOG_EMPTY', 500, '风格目录为空，无法创建项目');
    return first.id;
  }

  function getProject(projectId) {
    return db
      .prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL')
      .get(Number(projectId));
  }

  /** 派生剧集当前所处阶段（无阶段状态记录时按内容推导） */
  function deriveEpisodeStage(episodeId) {
    const state = db
      .prepare(
        `SELECT stage, status FROM production_stage_states
         WHERE episode_id = ? AND status != 'not_started'
         ORDER BY CASE stage WHEN 'cut' THEN 3 WHEN 'storyboard' THEN 2 WHEN 'assets' THEN 1 ELSE 0 END DESC
         LIMIT 1`
      )
      .get(episodeId);
    if (state) return state.stage;
    const draft = db
      .prepare(
        `SELECT id FROM episode_script_revisions WHERE episode_id = ? LIMIT 1`
      )
      .get(episodeId);
    if (draft) return 'script';
    const content = db
      .prepare('SELECT script_content FROM episodes WHERE id = ?')
      .get(episodeId);
    if (content && content.script_content) return 'script';
    return 'script';
  }

  function deriveLastWork(projectId) {
    const episode = db
      .prepare(
        `SELECT id, episode_number, updated_at FROM episodes
         WHERE drama_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC, episode_number ASC LIMIT 1`
      )
      .get(projectId);
    if (!episode) return null;
    return {
      episodeId: episode.id,
      episodeNumber: episode.episode_number,
      stage: deriveEpisodeStage(episode.id),
    };
  }

  function healthOf(projectId) {
    const stale = db
      .prepare(
        `SELECT COUNT(*) AS n FROM production_stage_states s
         JOIN episodes e ON e.id = s.episode_id
         WHERE e.drama_id = ? AND e.deleted_at IS NULL AND s.status = 'stale'`
      )
      .get(projectId).n;
    const generating =
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM image_generations WHERE drama_id = ? AND status = 'processing'`
        )
        .get(projectId).n +
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM video_generations v
           JOIN storyboards sb ON sb.id = v.storyboard_id
           JOIN episodes e ON e.id = sb.episode_id
           WHERE e.drama_id = ? AND v.status = 'processing'`
        )
        .get(projectId).n;
    return { generating, pending: 0, needsUpdate: stale };
  }

  function cardOf(row) {
    const meta = parseMeta(row);
    const episodeCount = db
      .prepare('SELECT COUNT(*) AS n FROM episodes WHERE drama_id = ? AND deleted_at IS NULL')
      .get(row.id).n;
    return {
      id: row.id,
      title: row.title,
      thumbnail: row.thumbnail || null,
      genre: meta.genre || row.genre || null,
      aspectRatio: meta.aspect_ratio || null,
      episodeCount,
      updatedAt: row.updated_at,
      lastWork: deriveLastWork(row.id),
      health: healthOf(row.id),
    };
  }

  function listProjects({ q = '', status = 'all', sort = 'recent' } = {}) {
    let rows = db
      .prepare('SELECT * FROM dramas WHERE deleted_at IS NULL')
      .all();
    if (q && String(q).trim()) {
      const needle = String(q).trim().toLowerCase();
      rows = rows.filter((r) => String(r.title || '').toLowerCase().includes(needle));
    }
    if (sort === 'title') {
      rows.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'));
    } else {
      rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    }

    let cards = rows.map(cardOf);
    if (status === 'archived') {
      cards = db
        .prepare('SELECT * FROM dramas WHERE deleted_at IS NOT NULL')
        .all()
        .map(cardOf);
    } else if (status === 'needs-attention') {
      cards = cards.filter((c) => c.health.needsUpdate > 0 || c.health.pending > 0);
    } else if (status === 'completed') {
      cards = cards.filter((c) => {
        if (c.episodeCount === 0) return false;
        const done = db
          .prepare(
            `SELECT COUNT(*) AS n FROM production_stage_states s
             JOIN episodes e ON e.id = s.episode_id
             WHERE e.drama_id = ? AND e.deleted_at IS NULL AND s.stage = 'cut' AND s.status = 'approved'`
          )
          .get(c.id).n;
        return done >= c.episodeCount;
      });
    } else if (status === 'making') {
      cards = cards.filter(
        (c) => c.episodeCount > 0 && !(c.health.needsUpdate > 0) && c.lastWork
      );
    }
    return { items: cards, total: cards.length };
  }

  function createProject({ title, aspectRatio = '16:9', genre = '', description = '' } = {}) {
    if (!title || !String(title).trim()) {
      throw httpError('VALIDATION_ERROR', 400, '项目名称不能为空');
    }
    for (const key of Object.keys(arguments[0] || {})) {
      if (['title', 'aspectRatio', 'genre', 'description'].includes(key)) continue;
      const v = arguments[0][key];
      if (v !== undefined && /duration|output|preference/i.test(key)) {
        throw httpError(
          'VALIDATION_ERROR',
          400,
          `V2.1 项目资料不支持字段 "${key}"（已删除时长与输出偏好）`
        );
      }
    }
    const now = nowIso();
    const styleId = resolveDefaultStyleId();
    const info = db
      .prepare(
        `INSERT INTO dramas (title, description, genre, style_id, status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
      )
      .run(
        String(title).trim(),
        description || null,
        genre || null,
        styleId,
        JSON.stringify({ aspect_ratio: aspectRatio, genre: genre || '' }),
        now,
        now
      );
    const id = info.lastInsertRowid;
    log.info?.('V2.1 项目已创建', { projectId: id });
    return { id: Number(id), title: String(title).trim() };
  }

  function getOverview(projectId) {
    const row = getProject(projectId);
    if (!row) throw httpError('NOT_FOUND', 404, '项目不存在');
    const meta = parseMeta(row);
    const episodeCount = db
      .prepare('SELECT COUNT(*) AS n FROM episodes WHERE drama_id = ? AND deleted_at IS NULL')
      .get(row.id).n;
    const objectCount =
      db
        .prepare('SELECT COUNT(*) AS n FROM characters WHERE drama_id = ? AND deleted_at IS NULL')
        .get(row.id).n +
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM scenes WHERE drama_id = ? AND deleted_at IS NULL'
        )
        .get(row.id).n +
      db
        .prepare('SELECT COUNT(*) AS n FROM props WHERE drama_id = ? AND deleted_at IS NULL')
        .get(row.id).n;
    const missingImageCount =
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM characters WHERE drama_id = ? AND deleted_at IS NULL AND (image_url IS NULL OR image_url = '')"
        )
        .get(row.id).n +
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM scenes WHERE drama_id = ? AND deleted_at IS NULL AND (image_url IS NULL OR image_url = '')"
        )
        .get(row.id).n +
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM props WHERE drama_id = ? AND deleted_at IS NULL AND (image_url IS NULL OR image_url = '')"
        )
        .get(row.id).n;
    return {
      hero: {
        projectId: row.id,
        title: row.title,
        genre: meta.genre || row.genre || null,
        aspectRatio: meta.aspect_ratio || null,
        episodeCount,
        updatedAt: row.updated_at,
        description: row.description || null,
        thumbnail: row.thumbnail || null,
      },
      style: { styleId: row.style_id || null, appliesTo: 'future-generations-only' },
      assetsAggregate: { objectCount, missingImageCount },
      nextStep: deriveLastWork(row.id),
      pending: [],
    };
  }

  function updateProfile(projectId, { title, cover, genre, aspectRatio, description } = {}) {
    const row = getProject(projectId);
    if (!row) throw httpError('NOT_FOUND', 404, '项目不存在');
    const meta = parseMeta(row);
    const nextMeta = {
      ...meta,
      aspect_ratio: aspectRatio !== undefined ? aspectRatio : meta.aspect_ratio,
      genre: genre !== undefined ? genre : meta.genre,
    };
    db.prepare(
      `UPDATE dramas SET
         title = COALESCE(?, title),
         thumbnail = COALESCE(?, thumbnail),
         genre = COALESCE(?, genre),
         description = COALESCE(?, description),
         metadata = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      title !== undefined ? String(title).trim() : null,
      cover !== undefined ? cover : null,
      genre !== undefined ? genre : null,
      description !== undefined ? description : null,
      JSON.stringify(nextMeta),
      nowIso(),
      row.id
    );
    return getOverview(projectId);
  }

  function applyStyle(projectId, { styleId } = {}) {
    const row = getProject(projectId);
    if (!row) throw httpError('NOT_FOUND', 404, '项目不存在');
    if (!styleId) throw httpError('VALIDATION_ERROR', 400, 'styleId 不能为空');
    styleRegistry().requireStyle(styleId);
    db.prepare('UPDATE dramas SET style_id = ?, updated_at = ? WHERE id = ?').run(
      styleId,
      nowIso(),
      row.id
    );
    db.prepare(
      `INSERT INTO project_style_events (drama_id, event_type, style_id, payload_json, created_at)
       VALUES (?, 'style-applied', ?, ?, ?)`
    ).run(row.id, styleId, JSON.stringify({ styleId, appliesTo: 'future-generations-only' }), nowIso());
    return { projectId: row.id, styleId, appliesTo: 'future-generations-only' };
  }

  /** 回收站式软删除（界面文案为"删除"，底层可恢复） */
  function softDeleteProject(projectId) {
    const row = getProject(projectId);
    if (!row) throw httpError('NOT_FOUND', 404, '项目不存在');
    db.prepare('UPDATE dramas SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
      nowIso(),
      nowIso(),
      row.id
    );
    return { deleted: true, recoverable: true };
  }

  function restoreProject(projectId) {
    const row = db.prepare('SELECT * FROM dramas WHERE id = ?').get(Number(projectId));
    if (!row) throw httpError('NOT_FOUND', 404, '项目不存在');
    db.prepare('UPDATE dramas SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(
      nowIso(),
      row.id
    );
    return { restored: true };
  }

  return {
    getProject,
    listProjects,
    createProject,
    getOverview,
    updateProfile,
    applyStyle,
    softDeleteProject,
    restoreProject,
    deriveEpisodeStage,
  };
}

module.exports = { createProjectService, STAGE_ORDER };
