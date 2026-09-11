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

const TABLE_BY_TYPE = { character: 'characters', scene: 'scenes', prop: 'props' };

/**
 * V2.1 项目素材服务（ASSET-201 收敛口径）。
 * - 三类内部事实分离：资料修订（行字段）/媒体候选（image_generations + image_generation_tasks）/当前图（行 image_url）
 * - 生成只入候选；点击候选即设为当前图，返回旧指针供撤销；不改已确认剧集快照
 * - 删除为回收站式：被引用列影响并阻断；未引用软删除可恢复
 */
function createAssetQueryService(db, { log = console, mockProvider = null } = {}) {
  function requireAsset(type, assetId) {
    const table = TABLE_BY_TYPE[type];
    if (!table) throw httpError('VALIDATION_ERROR', 400, `未知素材类型: ${type}`);
    const row = db
      .prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`)
      .get(Number(assetId));
    if (!row) throw httpError('NOT_FOUND', 404, '素材不存在或已删除');
    return row;
  }

  function currentImageOf(type, row) {
    return row.image_url || null;
  }

  function listAssets(dramaId, { type = 'all', q = '', onlyBlocked = false } = {}) {
    const out = [];
    const types = type === 'all' ? ['character', 'scene', 'prop'] : [type];
    for (const t of types) {
      const table = TABLE_BY_TYPE[t];
      const rows = db
        .prepare(`SELECT * FROM ${table} WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id`)
        .all(Number(dramaId));
      for (const row of rows) {
        const name = row.name || row.location || '';
        if (q && !String(name).toLowerCase().includes(String(q).toLowerCase())) continue;
        const imageUrl = currentImageOf(t, row);
        const description = row.description || '';
        const blocked = !imageUrl;
        if (onlyBlocked && !blocked) continue;
        out.push({
          assetType: t,
          id: row.id,
          name,
          typeLabel: t === 'character' ? '角色' : t === 'scene' ? '场景' : '道具',
          subType: row.role || row.type || null,
          description,
          currentImage: imageUrl,
          blocked,
        });
      }
    }
    return { items: out, total: out.length };
  }

  function createAsset(dramaId, { type, fields = {} } = {}) {
    const now = nowIso();
    if (type === 'character') {
      if (!fields.name) throw httpError('VALIDATION_ERROR', 400, '角色需要名称');
      const info = db
        .prepare(
          `INSERT INTO characters (drama_id, name, role, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(dramaId, fields.name, fields.role || null, fields.description || null, now, now);
      return { id: Number(info.lastInsertRowid), type };
    }
    if (type === 'scene') {
      if (!fields.name) throw httpError('VALIDATION_ERROR', 400, '场景需要名称');
      const info = db
        .prepare(
          `INSERT INTO scenes (drama_id, location, time, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(dramaId, fields.name, fields.time || null, fields.description || null, now, now);
      return { id: Number(info.lastInsertRowid), type };
    }
    if (type === 'prop') {
      if (!fields.name) throw httpError('VALIDATION_ERROR', 400, '道具需要名称');
      const info = db
        .prepare(
          `INSERT INTO props (drama_id, name, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(dramaId, fields.name, fields.type || null, fields.description || null, now, now);
      return { id: Number(info.lastInsertRowid), type };
    }
    throw httpError('VALIDATION_ERROR', 400, `未知素材类型: ${type}`);
  }

  function candidateQuery(type, assetId) {
    if (type === 'character') {
      return db
        .prepare(
          `SELECT g.* FROM image_generations g
           WHERE g.character_id = ? AND g.status = 'succeeded' AND g.deleted_at IS NULL
           ORDER BY g.id DESC`
        )
        .all(Number(assetId));
    }
    if (type === 'scene') {
      return db
        .prepare(
          `SELECT g.* FROM image_generations g
           WHERE g.scene_id = ? AND g.status = 'succeeded' AND g.deleted_at IS NULL
           ORDER BY g.id DESC`
        )
        .all(Number(assetId));
    }
    return db
      .prepare(
        `SELECT g.* FROM image_generations g
         JOIN image_generation_tasks t ON t.image_generation_id = g.id
         WHERE t.target_type = 'prop' AND t.target_id = ? AND g.status = 'succeeded' AND g.deleted_at IS NULL
         ORDER BY g.id DESC`
      )
      .all(Number(assetId));
  }

  function getDetail(type, assetId) {
    const row = requireAsset(type, assetId);
    const candidates = candidateQuery(type, assetId).map((g) => ({
      candidateId: g.id,
      url: g.image_url,
      provider: g.provider || 'mock',
      createdAt: g.created_at,
      isCurrent: currentImageOf(type, row) === g.image_url,
    }));
    return {
      assetType: type,
      id: row.id,
      name: row.name || row.location || '',
      description: row.description || null,
      currentImage: currentImageOf(type, row),
      states:
        type === 'character'
          ? db
              .prepare('SELECT id, name, source_key, is_default FROM character_variants WHERE character_id = ? AND deleted_at IS NULL')
              .all(Number(assetId))
          : [],
      candidates,
      blocked: !currentImageOf(type, row),
    };
  }

  /** 生成候选：mock 通道（无 Key 可运行），产出真实文件 + 候选记录；绝不改当前图 */
  async function generateCandidate(dramaId, { type, assetId, prompt = '', size = '720x480' } = {}) {
    requireAsset(type, assetId);
    if (!mockProvider) throw httpError('PROVIDER_UNAVAILABLE', 503, '生成通道不可用');
    const submitted = mockProvider.submit({
      kind: 'image',
      ownerType: `project_asset_${type}`,
      ownerId: assetId,
      input: { prompt, size },
      idempotencyKey: null,
    });
    const result = await mockProvider.run(submitted.taskId);
    const now = nowIso();
    const relativeUrl = result.url;
    const info = db
      .prepare(
        `INSERT INTO image_generations (drama_id, character_id, scene_id, provider, prompt, image_url, local_path, status, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'mock', ?, ?, ?, 'succeeded', ?, ?, ?)`
      )
      .run(
        Number(dramaId),
        type === 'character' ? Number(assetId) : null,
        type === 'scene' ? Number(assetId) : null,
        prompt,
        relativeUrl,
        result.artifactPath,
        now,
        now,
        now
      );
    const genId = Number(info.lastInsertRowid);
    if (type === 'prop') {
      db.prepare(
        `INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, provider, prompt_snapshot, status, image_generation_id, created_at, updated_at)
         VALUES (?, ?, 'prop', ?, 'mock', 'mock', ?, 'succeeded', ?, ?, ?)`
      ).run(`v21_${genId}`, Number(dramaId), Number(assetId), prompt, genId, now, now);
    }
    return { candidateId: genId, url: relativeUrl, taskId: submitted.taskId };
  }

  /** URL 上传候选：仅向素材追加一条候选（provider='upload'），绝不改当前图（与"上传只入候选"合同一致） */
  function uploadCandidate({ type, assetId, imageUrl } = {}) {
    const row = requireAsset(type, assetId);
    const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
    if (!url) throw httpError('MISSING_IMAGE_URL', 400, 'imageUrl 必填');
    const now = nowIso();
    const info = db
      .prepare(
        `INSERT INTO image_generations (drama_id, character_id, scene_id, provider, prompt, image_url, local_path, status, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'upload', '', ?, NULL, 'succeeded', ?, ?, ?)`
      )
      .run(
        row.drama_id == null ? null : Number(row.drama_id),
        type === 'character' ? row.id : null,
        type === 'scene' ? row.id : null,
        url,
        now,
        now,
        now
      );
    const genId = Number(info.lastInsertRowid);
    if (type === 'prop') {
      // prop 候选经 image_generation_tasks 关联（与 generateCandidate 同一存储模式）
      db.prepare(
        `INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, provider, prompt_snapshot, status, image_generation_id, created_at, updated_at)
         VALUES (?, ?, 'prop', ?, 'upload', 'upload', '', 'succeeded', ?, ?, ?)`
      ).run(`v21_${genId}`, row.drama_id == null ? null : Number(row.drama_id), row.id, genId, now, now);
    }
    return {
      ok: true,
      candidate: {
        candidateId: genId,
        url,
        provider: 'upload',
        createdAt: now,
        isCurrent: false,
      },
    };
  }

  /** 点击候选即当前图；返回旧指针供前端撤销（撤销 = 再次调用并传回旧 imageUrl） */
  function useCandidate({ type, assetId, candidateId = null, imageUrl = null } = {}) {
    const row = requireAsset(type, assetId);
    let nextUrl = imageUrl;
    if (candidateId) {
      const gen = db.prepare('SELECT * FROM image_generations WHERE id = ?').get(Number(candidateId));
      if (!gen) throw httpError('NOT_FOUND', 404, '候选不存在');
      nextUrl = gen.image_url;
    }
    if (!nextUrl) throw httpError('VALIDATION_ERROR', 400, '需要 candidateId 或 imageUrl');
    const table = TABLE_BY_TYPE[type];
    db.prepare(`UPDATE ${table} SET image_url = ?, updated_at = ? WHERE id = ?`).run(
      nextUrl,
      nowIso(),
      row.id
    );
    return {
      assetType: type,
      assetId: row.id,
      current: { imageUrl: nextUrl },
      previous: { imageUrl: row.image_url || null },
      snapshotNote: '已确认剧集快照不受影响；变化只影响未来选择。',
    };
  }

  /** 删除影响分析 */
  function impactOf(type, assetId) {
    const impacts = { storyboards: 0, storyboardIds: [], episodes: [] };
    if (type === 'character') {
      const rows = db
        .prepare(
          `SELECT DISTINCT sb.id FROM storyboard_character_variants scv
           JOIN storyboards sb ON sb.id = scv.storyboard_id
           WHERE scv.character_id = ? AND sb.deleted_at IS NULL`
        )
        .all(Number(assetId));
      impacts.storyboardIds = rows.map((r) => r.id);
    } else if (type === 'scene') {
      const rows = db
        .prepare('SELECT id FROM storyboards WHERE scene_id = ? AND deleted_at IS NULL')
        .all(Number(assetId));
      impacts.storyboardIds = rows.map((r) => r.id);
    } else {
      const rows = db
        .prepare(
          `SELECT sb.id FROM storyboard_props sp JOIN storyboards sb ON sb.id = sp.storyboard_id
           WHERE sp.prop_id = ? AND sb.deleted_at IS NULL`
        )
        .all(Number(assetId));
      impacts.storyboardIds = rows.map((r) => r.id);
    }
    impacts.storyboards = impacts.storyboardIds.length;
    return impacts;
  }

  function deleteAsset({ type, assetId } = {}) {
    const row = requireAsset(type, assetId);
    const impacts = impactOf(type, assetId);
    if (impacts.storyboards > 0) {
      return {
        deleted: false,
        blocked: true,
        impacts,
        message: `该素材被 ${impacts.storyboards} 个分镜引用；请先替换或解除引用后再删除。`,
        recoverable: false,
      };
    }
    db.prepare(`UPDATE ${TABLE_BY_TYPE[type]} SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(
      nowIso(),
      nowIso(),
      row.id
    );
    return { deleted: true, recoverable: true, impacts };
  }

  function restoreAsset({ type, assetId } = {}) {
    db.prepare(`UPDATE ${TABLE_BY_TYPE[type]} SET deleted_at = NULL, updated_at = ? WHERE id = ?`).run(
      nowIso(),
      Number(assetId)
    );
    return { restored: true };
  }

  return {
    listAssets,
    createAsset,
    getDetail,
    generateCandidate,
    uploadCandidate,
    useCandidate,
    deleteAsset,
    restoreAsset,
    impactOf,
  };
}

module.exports = { createAssetQueryService };
