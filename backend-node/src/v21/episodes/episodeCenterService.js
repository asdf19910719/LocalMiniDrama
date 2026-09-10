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

/**
 * V2.1 剧集中心（EP-201 / NAV-201 收敛口径）：
 * - 新建剧集 = 空白草稿 + 直达剧本页；无目标时长字段；
 * - 筛选只有 全部/需要处理/制作中/已完成；
 * - 删除 = 回收站式可恢复，删除前列影响；
 * - 非空剧集不可被外部导入写入（23.5 判定）。
 */
function createEpisodeCenterService(db, { log = console } = {}) {
  function getEpisodeRow(episodeId) {
    return db
      .prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL')
      .get(Number(episodeId));
  }

  function requireEpisode(episodeId) {
    const row = getEpisodeRow(episodeId);
    if (!row) throw httpError('NOT_FOUND', 404, '剧集不存在或已删除');
    return row;
  }

  function nextEpisodeNumber(dramaId) {
    const row = db
      .prepare(
        'SELECT COALESCE(MAX(episode_number), 0) AS n FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
      )
      .get(dramaId);
    return row.n + 1;
  }

  function createEpisode(dramaId, { title = '', episodeNumber = null } = {}) {
    const drama = db
      .prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL')
      .get(Number(dramaId));
    if (!drama) throw httpError('NOT_FOUND', 404, '项目不存在或已删除');
    const number = episodeNumber || nextEpisodeNumber(dramaId);
    const conflict = db
      .prepare(
        'SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL'
      )
      .get(dramaId, number);
    if (conflict) {
      throw httpError('EPISODE_NUMBER_CONFLICT', 409, `第 ${number} 集已存在`);
    }
    const now = nowIso();
    const info = db
      .prepare(
        `INSERT INTO episodes (drama_id, episode_number, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?)`
      )
      .run(dramaId, number, title || '', now, now);
    log.info?.('V2.1 剧集已创建', { episodeId: info.lastInsertRowid, number });
    return { id: Number(info.lastInsertRowid), episodeNumber: number, blank: true };
  }

  /** 23.5 非空剧集判定 */
  function getBlankStatus(episodeId) {
    const row = requireEpisode(episodeId);
    const reasons = [];
    if ((row.script_content || '').trim() || (row.description || '').trim()) {
      reasons.push({ code: 'SCRIPT_NOT_EMPTY', detail: '剧本或梗概非空' });
    }
    const revision = db
      .prepare('SELECT id FROM episode_script_revisions WHERE episode_id = ? LIMIT 1')
      .get(row.id);
    if (revision) reasons.push({ code: 'SCRIPT_NOT_EMPTY', detail: '已存在剧本版本' });
    const scenes = db
      .prepare('SELECT COUNT(*) AS n FROM story_scenes WHERE episode_id = ?')
      .get(row.id).n;
    if (scenes > 0) reasons.push({ code: 'HAS_SCENES', detail: `已存在 ${scenes} 个场次` });
    const boards = db
      .prepare('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
      .get(row.id).n;
    if (boards > 0) reasons.push({ code: 'HAS_STORYBOARDS', detail: `已存在 ${boards} 个分镜` });
    const media = db
      .prepare(
        `SELECT COUNT(*) AS n FROM image_generations g
         JOIN storyboards sb ON sb.id = g.storyboard_id
         WHERE sb.episode_id = ?`
      )
      .get(row.id).n;
    if (media > 0) reasons.push({ code: 'HAS_MEDIA', detail: '分镜已有图片候选' });
    const imported = db
      .prepare('SELECT id FROM episode_imports WHERE episode_id = ? LIMIT 1')
      .get(row.id);
    if (imported) reasons.push({ code: 'IMPORTED', detail: '已有成功的制作包导入记录' });
    return { blank: reasons.length === 0, reasons };
  }

  function listBlankEpisodes(dramaId) {
    const rows = db
      .prepare(
        'SELECT id, episode_number, title FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number'
      )
      .all(Number(dramaId));
    return {
      items: rows
        .filter((r) => getBlankStatus(r.id).blank)
        .map((r) => ({ id: r.id, episodeNumber: r.episode_number, title: r.title })),
    };
  }

  function deriveEpisodeProjection(episodeId) {
    const state = db
      .prepare(
        `SELECT stage, status FROM production_stage_states WHERE episode_id = ?
         ORDER BY CASE stage WHEN 'cut' THEN 3 WHEN 'storyboard' THEN 2 WHEN 'assets' THEN 1 ELSE 0 END DESC`
      )
      .all(episodeId);
    const active = state.find((s) => s.status !== 'not_started');
    const stale = state.some((s) => s.status === 'stale');
    let stage = active ? active.stage : null;
    if (!stage) {
      const hasContent =
        db
          .prepare('SELECT id FROM episode_script_revisions WHERE episode_id = ? LIMIT 1')
          .get(episodeId) ||
        db
          .prepare('SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL LIMIT 1')
          .get(episodeId);
      stage = hasContent ? 'script' : null;
    }
    let status = 'blank';
    if (stage) {
      const cutApproved = state.some((s) => s.stage === 'cut' && s.status === 'approved');
      status = cutApproved ? 'completed' : stale ? 'needs-attention' : 'making';
    }
    return { stage, status };
  }

  function listEpisodes(dramaId, { status = 'all', q = '' } = {}) {
    requireProject(dramaId);
    let rows = db
      .prepare(
        'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
      )
      .all(Number(dramaId));
    if (q && String(q).trim()) {
      const needle = String(q).trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          String(r.title || '').toLowerCase().includes(needle) ||
          String(r.episode_number).includes(needle)
      );
    }
    let items = rows.map((r) => {
      const proj = deriveEpisodeProjection(r.id);
      const hasImport = Boolean(
        db.prepare('SELECT id FROM episode_imports WHERE episode_id = ? LIMIT 1').get(r.id)
      );
      return {
        id: r.id,
        episodeNumber: r.episode_number,
        title: r.title,
        status: proj.status,
        stage: proj.stage,
        needsAttention: proj.status === 'needs-attention',
        lastWorkedAt: r.updated_at,
        hasImportSource: hasImport,
        updatedAt: r.updated_at,
      };
    });
    if (status && status !== 'all') {
      items = items.filter((i) => i.status === status);
    }
    return { items, total: items.length };
  }

  function requireProject(dramaId) {
    const drama = db
      .prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL')
      .get(Number(dramaId));
    if (!drama) throw httpError('NOT_FOUND', 404, '项目不存在或已删除');
    return drama;
  }

  function getEpisode(episodeId) {
    const row = requireEpisode(episodeId);
    const proj = deriveEpisodeProjection(row.id);
    return {
      id: row.id,
      dramaId: row.drama_id,
      episodeNumber: row.episode_number,
      title: row.title,
      status: proj.status,
      stage: proj.stage,
      updatedAt: row.updated_at,
    };
  }

  function renameEpisode(episodeId, { title } = {}) {
    const row = requireEpisode(episodeId);
    if (title === undefined || title === null) throw httpError('VALIDATION_ERROR', 400, '标题不能为空');
    db.prepare('UPDATE episodes SET title = ?, updated_at = ? WHERE id = ?').run(
      String(title),
      nowIso(),
      row.id
    );
    return getEpisode(row.id);
  }

  function reorderEpisodes(dramaId, { order } = {}) {
    requireProject(dramaId);
    if (!Array.isArray(order) || order.length === 0) {
      throw httpError('VALIDATION_ERROR', 400, 'order 必须是非空数组');
    }
    const rows = db
      .prepare('SELECT id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL')
      .all(Number(dramaId));
    const existing = new Set(rows.map((r) => r.id));
    const requested = order.map(Number);
    const sameSet =
      requested.length === existing.size && requested.every((id) => existing.has(id));
    if (!sameSet) {
      throw httpError(
        'EPISODE_ORDER_CONFLICT',
        409,
        'order 必须包含本项目全部剧集且不重复；请刷新后重试'
      );
    }
    const tx = db.transaction(() => {
      requested.forEach((episodeId, index) => {
        db.prepare('UPDATE episodes SET episode_number = ?, updated_at = ? WHERE id = ?').run(
          index + 1,
          nowIso(),
          episodeId
        );
      });
    });
    tx();
    return { updated: requested.length };
  }

  function softDeleteEpisode(episodeId) {
    const row = requireEpisode(episodeId);
    const impacts = {
      scriptRevisions: db
        .prepare('SELECT COUNT(*) AS n FROM episode_script_revisions WHERE episode_id = ?')
        .get(row.id).n,
      storyboards: db
        .prepare('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
        .get(row.id).n,
      mediaCount:
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM image_generations g
             JOIN storyboards sb ON sb.id = g.storyboard_id WHERE sb.episode_id = ?`
          )
          .get(row.id).n +
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM video_generations v
             JOIN storyboards sb ON sb.id = v.storyboard_id WHERE sb.episode_id = ?`
          )
          .get(row.id).n,
    };
    db.prepare('UPDATE episodes SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
      nowIso(),
      nowIso(),
      row.id
    );
    log.info?.('V2.1 剧集已移入回收站', { episodeId: row.id, impacts });
    return { deleted: true, recoverable: true, impacts };
  }

  function restoreEpisode(episodeId) {
    const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(Number(episodeId));
    if (!row) throw httpError('NOT_FOUND', 404, '剧集不存在');
    db.prepare('UPDATE episodes SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(
      nowIso(),
      row.id
    );
    return { restored: true };
  }

  function getImportSource(episodeId) {
    const row = requireEpisode(episodeId);
    const rec = db
      .prepare(
        'SELECT * FROM episode_imports WHERE episode_id = ? ORDER BY imported_at DESC, id DESC LIMIT 1'
      )
      .get(row.id);
    if (!rec) return null;
    return {
      packageId: rec.task_package_id || null,
      schemaName: rec.schema_name || null,
      schemaVersion: rec.schema_version || null,
      sourceFilename: rec.source_filename || null,
      sourceSha256: rec.source_sha256 || null,
      importedAt: rec.imported_at,
      report: rec.import_report ? JSON.parse(rec.import_report) : null,
      readOnly: true,
    };
  }

  return {
    getEpisodeRow,
    getEpisode,
    createEpisode,
    listEpisodes,
    listBlankEpisodes,
    renameEpisode,
    reorderEpisodes,
    softDeleteEpisode,
    restoreEpisode,
    getImportSource,
    getBlankStatus,
  };
}

module.exports = { createEpisodeCenterService };
