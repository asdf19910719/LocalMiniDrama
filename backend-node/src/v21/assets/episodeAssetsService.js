'use strict';
const crypto = require('node:crypto');

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * V2.1 本集设定服务（ASSET-201 / GATE-201）。
 * - 只投影当前剧本实际引用的角色/场景/道具三 Tab；底层只保存 assetId+stateId+mediaVersionId 引用
 * - mediaReadiness：checking/ready/needs-attention/snapshot-failed/script-unapproved
 * - 进入分镜恒可进入；检查与不可变素材快照在"点击"动作中事务完成；失败零部分写入
 * - 生成守卫：readiness 非 ready 时禁用媒体提交并给唯一"去处理"恢复入口
 */
function createEpisodeAssetsService(db, { log = console } = {}) {
  // B4：本集选择表补充音色指针列（幂等）
  require('../db.js').ensureSelectionVoiceColumn(db);

  function requireEpisode(episodeId) {
    const row = db
      .prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL')
      .get(Number(episodeId));
    if (!row) throw httpError('NOT_FOUND', 404, '剧集不存在');
    return row;
  }

  /** 本集引用对象派生：复用既有引用结构（episode_characters / scenes.episode_id / 分镜道具） */
  function getReferencedAssets(episodeId) {
    const episode = requireEpisode(episodeId);
    const selections = db
      .prepare('SELECT * FROM episode_asset_selections WHERE episode_id = ?')
      .all(episodeId);
    const selectionKey = (type, id) => `${type}:${id}`;
    const selectedKeys = new Set(selections.map((s) => selectionKey(s.asset_type, s.asset_id)));
    // B4：音色指针（character 选择行上的 voice_json）
    const voiceByKey = {};
    for (const s of selections) {
      if (s.voice_json) {
        try { voiceByKey[selectionKey(s.asset_type, s.asset_id)] = JSON.parse(s.voice_json); } catch (_) {}
      }
    }

    const characters = db
      .prepare(
        `SELECT c.* FROM episode_characters ec JOIN characters c ON c.id = ec.character_id
         WHERE ec.episode_id = ? AND c.deleted_at IS NULL ORDER BY c.id`
      )
      .all(episodeId)
      .map((c) => ({
        assetType: 'character',
        assetId: c.id,
        name: c.name,
        description: c.description || '',
        stateId: defaultVariantId(c.id) || '',
        mediaVersionId: c.image_url || null,
        currentImage: c.image_url || null,
        voice: voiceByKey[selectionKey('character', c.id)] || null,
        blocked: !c.image_url,
        required: true,
      }));
    // QA-006：剧本按名引用的项目人物动态并入投影——V2.1 原生流程不写 episode_characters，
    // 以"已确认剧本正文/场次摘要中出现人物名"作为本集引用依据（与 EP-ASSET"只投影本集剧本实际引用的对象"一致）
    const matchedByName = db
      .prepare(
        `SELECT DISTINCT c.* FROM characters c
         WHERE c.drama_id = ? AND c.deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM episode_script_revisions r
             WHERE r.episode_id = ? AND r.status = 'approved'
               AND (r.content LIKE '%' || c.name || '%')
           )
           AND c.name != ''
           AND NOT EXISTS (
             SELECT 1 FROM episode_characters ec
             WHERE ec.episode_id = ? AND ec.character_id = c.id
           )
         ORDER BY c.id`
      )
      .all(episode.drama_id, episodeId, episodeId)
      .map((c) => ({
        assetType: 'character',
        assetId: c.id,
        name: c.name,
        description: c.description || '',
        stateId: defaultVariantId(c.id) || '',
        mediaVersionId: c.image_url || null,
        currentImage: c.image_url || null,
        voice: voiceByKey[selectionKey('character', c.id)] || null,
        blocked: !c.image_url,
        required: true,
      }));
    for (const m of matchedByName) {
      if (!characters.some((c) => c.assetId === m.assetId)) characters.push(m);
    }
    const scenes = db
      .prepare('SELECT * FROM scenes WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id')
      .all(episodeId)
      .map((s) => ({
        assetType: 'scene',
        assetId: s.id,
        name: s.location || '',
        description: s.description || '',
        stateId: '',
        mediaVersionId: s.image_url || null,
        currentImage: s.image_url || null,
        blocked: !s.image_url,
        required: true,
      }));
    const props = db
      .prepare(
        `SELECT DISTINCT p.* FROM storyboard_props sp
         JOIN storyboards sb ON sb.id = sp.storyboard_id
         JOIN props p ON p.id = sp.prop_id
         WHERE sb.episode_id = ? AND p.deleted_at IS NULL AND sb.deleted_at IS NULL
         ORDER BY p.id`
      )
      .all(episodeId)
      .map((p) => ({
        assetType: 'prop',
        assetId: p.id,
        name: p.name || '',
        description: p.description || '',
        stateId: '',
        mediaVersionId: p.image_url || null,
        currentImage: p.image_url || null,
        blocked: !p.image_url,
        required: false,
      }));

    // 显式选择指针也是本集引用（V2.1：本集设定底层保存 assetId+stateId+mediaVersionId）
    for (const sel of selections) {
      const key = selectionKey(sel.asset_type, sel.asset_id);
      if (selectedKeys.has(key) === false) continue;
      if (sel.asset_type === 'character' && !characters.some((x) => x.assetId === sel.asset_id)) {
        const row = db
          .prepare('SELECT * FROM characters WHERE id = ? AND deleted_at IS NULL')
          .get(sel.asset_id);
        if (row) {
          characters.push({
            assetType: 'character',
            assetId: row.id,
            name: row.name,
            description: row.description || '',
            stateId: sel.state_id || defaultVariantId(row.id) || '',
            mediaVersionId: sel.media_version_id || row.image_url || null,
            currentImage: row.image_url || null,
            blocked: !(sel.media_version_id || row.image_url),
            required: true,
          });
        }
      } else if (sel.asset_type === 'scene' && !scenes.some((x) => x.assetId === sel.asset_id)) {
        const row = db
          .prepare('SELECT * FROM scenes WHERE id = ? AND deleted_at IS NULL')
          .get(sel.asset_id);
        if (row) {
          scenes.push({
            assetType: 'scene',
            assetId: row.id,
            name: row.location || '',
            description: row.description || '',
            stateId: sel.state_id || '',
            mediaVersionId: sel.media_version_id || row.image_url || null,
            currentImage: row.image_url || null,
            blocked: !(sel.media_version_id || row.image_url),
            required: true,
          });
        }
      } else if (sel.asset_type === 'prop' && !props.some((x) => x.assetId === sel.asset_id)) {
        const row = db
          .prepare('SELECT * FROM props WHERE id = ? AND deleted_at IS NULL')
          .get(sel.asset_id);
        if (row) {
          props.push({
            assetType: 'prop',
            assetId: row.id,
            name: row.name || '',
            description: row.description || '',
            stateId: sel.state_id || '',
            mediaVersionId: sel.media_version_id || row.image_url || null,
            currentImage: row.image_url || null,
            blocked: !(sel.media_version_id || row.image_url),
            required: false,
          });
        }
      }
    }

    // 已有选择的状态/版本覆盖默认投影
    for (const list of [characters, scenes, props]) {
      for (const item of list) {
        const sel = selections.find(
          (s) => s.asset_type === item.assetType && s.asset_id === item.assetId
        );
        if (sel) {
          if (sel.state_id) item.stateId = sel.state_id;
          if (sel.media_version_id) item.mediaVersionId = sel.media_version_id;
          item.blocked = !item.mediaVersionId && !item.currentImage;
        }
      }
    }

    void episode;
    return { characters, scenes, props };
  }

  function defaultVariantId(characterId) {
    const row = db
      .prepare(
        'SELECT id FROM character_variants WHERE character_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, id ASC LIMIT 1'
      )
      .get(characterId);
    return row ? row.id : null;
  }

  function getApprovedScript(episodeId) {
    return db
      .prepare(
        "SELECT id, revision FROM episode_script_revisions WHERE episode_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1"
      )
      .get(episodeId);
  }

  function resolveMediaReadiness(episodeId) {
    const episode = requireEpisode(episodeId);
    const approved = getApprovedScript(episodeId);
    if (!approved) {
      return { status: 'script-unapproved', text: '确认剧本后才能生成本集媒体', missing: [], recovery: null };
    }
    const refs = getReferencedAssets(episodeId);
    const all = [...refs.characters, ...refs.scenes, ...refs.props];
    const missing = all.filter((r) => r.required && r.blocked);
    if (missing.length > 0) {
      return {
        status: 'needs-attention',
        text: `有 ${missing.length} 项可稍后处理`,
        missing,
        readyCount: all.length - missing.length,
        totalCount: all.length,
        recovery: { id: 'resolve-episode-assets', label: '去处理' },
      };
    }
    const latest = getLatestSnapshotRow(episodeId);
    if (latest && latest.status === 'failed') {
      return {
        status: 'snapshot-failed',
        text: '素材快照保存失败，媒体生成已暂停',
        missing: [],
        recovery: { id: 'retry-snapshot', label: '重试准备分镜' },
      };
    }
    void episode;
    return {
      status: 'ready',
      text: '本集设定已准备好',
      missing: [],
      readyCount: all.length,
      totalCount: all.length,
      recovery: null,
    };
  }

  function getLatestSnapshotRow(episodeId) {
    return db
      .prepare(
        'SELECT * FROM episode_asset_set_snapshots WHERE episode_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get(episodeId);
  }

  function getLatestSnapshot(episodeId) {
    return getLatestSnapshotRow(episodeId) || null;
  }

  /**
   * 进入分镜（GATE-201）：导航立即允许；同一动作内完成检查 + 不可变快照事务。
   * 必需项缺失时不写快照（返回 needs-attention）；快照写入失败落 failed 记录（零部分写入）。
   */
  function enterStoryboard(episodeId) {
    const episode = requireEpisode(episodeId);
    const readiness = resolveMediaReadiness(episodeId);
    if (readiness.status === 'script-unapproved' || readiness.status === 'needs-attention') {
      return {
        navigation: 'immediate',
        snapshot: null,
        readiness,
      };
    }
    const approved = getApprovedScript(episodeId);
    const refs = getReferencedAssets(episodeId);
    const all = [...refs.characters, ...refs.scenes, ...refs.props].filter((r) => !r.blocked);
    const items = all.map((r) => ({
      assetType: r.assetType,
      assetId: r.assetId,
      stateId: r.stateId,
      mediaVersionId: r.mediaVersionId,
      mediaFingerprint: sha256Text(`${r.assetType}:${r.assetId}:${r.stateId}:${r.mediaVersionId}`),
      required: r.required,
    }));
    const fingerprint = sha256Text(
      JSON.stringify({ scriptRevision: approved.id, items })
    );
    try {
      const tx = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO episode_asset_set_snapshots (episode_id, script_revision_id, status, fingerprint, items_json, created_at)
             VALUES (?, ?, 'active', ?, ?, ?)`
          )
          .run(episodeId, approved.id, fingerprint, JSON.stringify(items), nowIso());
        return Number(info.lastInsertRowid);
      });
      const snapshotId = tx();
      return {
        navigation: 'immediate',
        snapshot: { id: snapshotId, status: 'active', fingerprint },
        readiness: resolveMediaReadiness(episodeId),
        projectId: episode.drama_id,
      };
    } catch (err) {
      log.error?.('素材快照写入失败', { episodeId, error: err.message });
      db.prepare(
        `INSERT INTO episode_asset_set_snapshots (episode_id, script_revision_id, status, fingerprint, items_json, error_json, created_at)
         VALUES (?, ?, 'failed', '', '[]', ?, ?)`
      ).run(episodeId, approved.id, JSON.stringify({ error: err.message }), nowIso());
      return {
        navigation: 'immediate',
        snapshot: { status: 'failed', error: err.message },
        readiness: {
          status: 'snapshot-failed',
          text: '素材快照保存失败，媒体生成已暂停',
          missing: [],
          recovery: { id: 'retry-snapshot', label: '重试准备分镜' },
        },
      };
    }
  }

  /** 分镜媒体生成守卫（与原型 getStoryboardMediaGenerationGuard 同形） */
  function getMediaGenerationGuard({ episodeId, shotId = null } = {}) {
    const readiness = resolveMediaReadiness(episodeId);
    const enabled = readiness.status === 'ready';
    const episode = db.prepare('SELECT drama_id FROM episodes WHERE id = ?').get(episodeId);
    return {
      enabled,
      readiness: readiness.status,
      shotId: shotId ? Number(shotId) : null,
      recoveryTarget: enabled
        ? null
        : { routeId: 'studio-assets', params: { projectId: episode ? episode.drama_id : null, episodeId: Number(episodeId) } },
    };
  }

  /** 更新本集选择指针（assetId+stateId+mediaVersionId） */
  function updateSelection(episodeId, { assetType, assetId, stateId = '', mediaVersionId = null, voice = undefined } = {}) {
    requireEpisode(episodeId);
    const existing = db
      .prepare('SELECT id FROM episode_asset_selections WHERE episode_id = ? AND asset_type = ? AND asset_id = ?')
      .get(episodeId, assetType, assetId);
    // B4：voice 仅在显式传入时更新（undefined = 保持不变；null = 清除）
    let voiceJson;
    if (voice !== undefined) {
      voiceJson = voice == null ? null : JSON.stringify(voice);
    }
    if (existing) {
      if (voice === undefined) {
        db.prepare(
          'UPDATE episode_asset_selections SET state_id = ?, media_version_id = ?, updated_at = ? WHERE id = ?'
        ).run(String(stateId), mediaVersionId, nowIso(), existing.id);
      } else {
        db.prepare(
          'UPDATE episode_asset_selections SET state_id = ?, media_version_id = ?, voice_json = ?, updated_at = ? WHERE id = ?'
        ).run(String(stateId), mediaVersionId, voiceJson, nowIso(), existing.id);
      }
    } else {
      db.prepare(
        `INSERT INTO episode_asset_selections (episode_id, asset_type, asset_id, state_id, media_version_id, voice_json, selected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(episodeId, assetType, assetId, String(stateId), mediaVersionId, voiceJson ?? null, nowIso(), nowIso());
    }
    return { saved: true };
  }

  function listSelections(episodeId) {
    return db
      .prepare('SELECT * FROM episode_asset_selections WHERE episode_id = ?')
      .all(episodeId);
  }

  return {
    getReferencedAssets,
    resolveMediaReadiness,
    enterStoryboard,
    getLatestSnapshot,
    getMediaGenerationGuard,
    updateSelection,
    listSelections,
  };
}

module.exports = { createEpisodeAssetsService };
