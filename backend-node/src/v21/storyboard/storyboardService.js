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

const DEFAULT_SHOT_SECONDS = 6;

/**
 * V2.1 分镜阶段服务（STORYBOARD-021 五区合同的服务端事实源）。
 * - 场次—分镜—时段（方案 B）：单时段合法；拆分/合并/重排保持时码连续闭合
 * - 引用管理：本镜场景结构性不可移除；增删即时生效并令 H3 标脏
 * - 分镜图：提示词自动拼装/手工覆盖两态；生成/上传只入候选；设为当前 → H3 stale + 旧视频标"基于旧分镜图"
 * - H3 一等公民：状态机 ai-generated→dirty→saving→valid/invalid；来源变化 stale；永不覆盖人工文本
 * - 视频候选：director 候选三表为唯一事实源；成功只追加候选；采用指针唯一可撤销
 */
function createStoryboardService(db, { log = console, mockProvider = null, providerRouter = null, cfg = null } = {}) {
  const { ensureStoryboardV21Columns } = require('../db.js');
  ensureStoryboardV21Columns(db);

  function videoChannel() {
    if (!providerRouter) return { channel: 'mock' };
    return providerRouter.resolveVideoChannel();
  }

  function isRealH3Channel() {
    if (!providerRouter) return false;
    const ch = videoChannel();
    return ch.channel === 'real' && providerRouter.isH3Video(ch.resolved);
  }

  /** 分镜引用（场景/角色状态/道具）可用的参考图，优先本地路径（供真实图片通道传参考图） */
  function referenceUrlsForImage(shotId) {
    const rows = getReferenceRows(shotId);
    const urls = [];
    const sb = db.prepare('SELECT scene_id FROM storyboards WHERE id = ?').get(shotId);
    if (sb && sb.scene_id) {
      const scene = db.prepare('SELECT image_url, local_path FROM scenes WHERE id = ? AND deleted_at IS NULL').get(sb.scene_id);
      if (scene) urls.push(scene.local_path || scene.image_url);
    }
    for (const ch of rows.characters) {
      const variant = db.prepare('SELECT image_url, local_path FROM character_variants WHERE id = ?').get(ch.variantId);
      if (variant) urls.push(variant.local_path || variant.image_url);
    }
    for (const prop of rows.props) {
      const row = db.prepare('SELECT image_url, local_path, ref_image FROM props WHERE id = ? AND deleted_at IS NULL').get(prop.assetId);
      if (row) urls.push(row.ref_image || row.local_path || row.image_url);
    }
    return urls.filter(Boolean);
  }

  /** 由分段内容合成"业务源文本"，同步进 universal_segment_text（legacy H3 指纹新鲜度依据） */
  function composeShotSourceText(shotId) {
    const segments = listSegments(shotId);
    const lines = [];
    for (const seg of segments) {
      const dialogue = (seg.dialogue || '').trim();
      lines.push(
        `[${Number(seg.start_seconds).toFixed(1)}–${Number(seg.end_seconds).toFixed(1)}s] ${seg.visual || ''}${
          dialogue ? `；对白：${dialogue}` : ''
        }`
      );
    }
    const style = db.prepare('SELECT style_id FROM dramas WHERE id = ?').get(shotEpisodeDrama(shotId));
    if (style && style.style_id) {
      try {
        const { createStyleRegistryService } = require('../../services/styleRegistryService.js');
        const info = createStyleRegistryService({ db }).requireStyle(style.style_id);
        lines.push(`风格：${info.labelZh || style.style_id}`);
      } catch {
        lines.push(`风格：${style.style_id}`);
      }
    }
    return lines.join('\n');
  }

  function syncShotSourceColumns(shotId) {
    try {
      db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ?').run(
        composeShotSourceText(shotId),
        nowIso(),
        shotId
      );
    } catch (_) {
      // 未迁移的旧库缺列时静默跳过；真实通道此时不可用，mock 不依赖该列
    }
  }

  function requireEpisode(episodeId) {
    const row = db.prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
    if (!row) throw httpError('NOT_FOUND', 404, '剧集不存在');
    return row;
  }

  function requireShot(shotId) {
    const row = db
      .prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL')
      .get(Number(shotId));
    if (!row) throw httpError('NOT_FOUND', 404, '分镜不存在');
    return row;
  }

  function requireApprovedScript(episodeId) {
    const row = db
      .prepare(
        "SELECT id FROM episode_script_revisions WHERE episode_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1"
      )
      .get(Number(episodeId));
    if (!row) throw httpError('SCRIPT_NOT_APPROVED', 409, '需要已确认的剧本版本');
    return row;
  }

  function touchStage(episodeId) {
    const episode = requireEpisode(episodeId);
    const { createStageStateService } = require('../stage/stageStateService.js');
    const stages = createStageStateService(db);
    stages.ensureStage(episode.drama_id, episodeId, 'storyboard');
    const state = stages.getStage(episodeId, 'storyboard');
    if (state.status === 'not_started' || state.status === 'stale') {
      stages.markInProgress(episodeId, 'storyboard', {});
    }
    return stages;
  }

  function nextShotRevision(shotId) {
    const row = db.prepare('SELECT structure_revision FROM storyboards WHERE id = ?').get(shotId);
    const current = row && row.structure_revision ? row.structure_revision : 1;
    db.prepare('UPDATE storyboards SET structure_revision = ? WHERE id = ?').run(current + 1, shotId);
    return current + 1;
  }

  // ---------- 结构 ----------

  function createFromScript(episodeId) {
    const approved = requireApprovedScript(episodeId);
    const scenes = db
      .prepare('SELECT * FROM story_scenes WHERE episode_id = ? ORDER BY scene_number')
      .all(episodeId);
    if (scenes.length === 0) throw httpError('NO_SCENES', 400, '剧本没有可用的场次结构');
    const base = db
      .prepare('SELECT COALESCE(MAX(storyboard_number), 0) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
      .get(episodeId).n;
    const now = nowIso();
    const tx = db.transaction(() => {
      scenes.forEach((scene, index) => {
        const info = db
          .prepare(
            `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, duration, action, status, structure_revision, script_revision_id, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?)`
          )
          .run(
            episodeId,
            base + index + 1,
            scene.heading || `镜头 ${base + index + 1}`,
            scene.summary || '',
            DEFAULT_SHOT_SECONDS,
            scene.summary || scene.heading || '',
            approved.id,
            now,
            now
          );
        const storyboardId = Number(info.lastInsertRowid);
        db.prepare(
          `INSERT INTO storyboard_segments (storyboard_id, seq, start_seconds, end_seconds, visual, dialogue, sound, asset_refs_json, created_at, updated_at)
           VALUES (?, 1, 0, ?, ?, '', '', '[]', ?, ?)`
        ).run(storyboardId, DEFAULT_SHOT_SECONDS, scene.summary || scene.heading || '', now, now);
      });
    });
    tx();
    touchStage(episodeId);
    return { created: scenes.length };
  }

  // ---------- 结构 diff（B1 更新分镜结构向导） ----------

  /** 从已确认剧本重新推导期望结构（与 createFromScript 同一推导，只读） */
  function deriveExpectedStructure(episodeId) {
    const approved = requireApprovedScript(episodeId);
    const scenes = db
      .prepare('SELECT * FROM story_scenes WHERE episode_id = ? ORDER BY scene_number')
      .all(episodeId);
    if (scenes.length === 0) throw httpError('NO_SCENES', 400, '剧本没有可用的场次结构');
    return {
      approvedId: approved.id,
      expected: scenes.map((scene, index) => ({
        title: scene.heading || `镜头 ${index + 1}`,
        description: scene.summary || '',
        action: scene.summary || scene.heading || '',
        duration: DEFAULT_SHOT_SECONDS,
        visual: scene.summary || scene.heading || '',
      })),
    };
  }

  function previewStructureDiff(episodeId) {
    requireEpisode(episodeId);
    const { expected } = deriveExpectedStructure(episodeId);
    const current = listShots(episodeId);
    const added = [];
    const changed = [];
    const removed = [];
    let unchanged = 0;
    const pairCount = Math.min(expected.length, current.length);
    for (let i = 0; i < pairCount; i += 1) {
      const exp = expected[i];
      const cur = current[i];
      const fields = [];
      if ((cur.title || '') !== exp.title) fields.push('title');
      const detail = getShotDetail(cur.id);
      const seg = detail.segments[0];
      if (((seg && seg.visual) || '') !== exp.visual) fields.push('visual');
      if (Number(cur.duration || 0) !== exp.duration) fields.push('duration');
      if (fields.length) {
        changed.push({
          shotId: cur.id,
          number: cur.storyboard_number,
          title: cur.title,
          fields,
          expected: exp,
          humanEdited: (cur.structure_revision || 1) > 1,
        });
      } else {
        unchanged += 1;
      }
    }
    const baseNumber = current.length || 0;
    for (let i = pairCount; i < expected.length; i += 1) {
      added.push({ ...expected[i], storyboardNumber: baseNumber + added.length + 1 });
    }
    for (let i = pairCount; i < current.length; i += 1) {
      const cur = current[i];
      removed.push({
        shotId: cur.id,
        number: cur.storyboard_number,
        title: cur.title,
        humanEdited: (cur.structure_revision || 1) > 1,
      });
    }
    return { added, changed, removed, unchanged };
  }

  function applyStructureDiff(episodeId, diff = {}, _options = {}) {
    requireEpisode(episodeId);
    const { approvedId } = deriveExpectedStructure(episodeId);
    const now = nowIso();
    let addedCount = 0;
    let changedCount = 0;
    let removedCount = 0;
    let skipped = 0;
    const tx = db.transaction(() => {
      for (const item of diff.added || []) {
        const base = db
          .prepare('SELECT COALESCE(MAX(storyboard_number), 0) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
          .get(episodeId).n;
        const info = db
          .prepare(
            `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, duration, action, status, structure_revision, script_revision_id, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?)`
          )
          .run(episodeId, base + 1, item.title || `镜头 ${base + 1}`, item.description || '', item.duration || DEFAULT_SHOT_SECONDS, item.action || item.description || '', approvedId, now, now);
        const storyboardId = Number(info.lastInsertRowid);
        db.prepare(
          `INSERT INTO storyboard_segments (storyboard_id, seq, start_seconds, end_seconds, visual, dialogue, sound, asset_refs_json, created_at, updated_at)
           VALUES (?, 1, 0, ?, ?, '', '', '[]', ?, ?)`
        ).run(storyboardId, item.duration || DEFAULT_SHOT_SECONDS, item.visual || item.description || '', now, now);
        addedCount += 1;
      }
      for (const item of diff.changed || []) {
        if (item.skip) {
          skipped += 1;
          continue;
        }
        const shot = requireShot(item.shotId);
        const exp = item.expected || {};
        db.prepare(
          'UPDATE storyboards SET title = COALESCE(?, title), description = COALESCE(?, description), duration = COALESCE(?, duration), action = COALESCE(?, action), updated_at = ? WHERE id = ?'
        ).run(
          item.fields && item.fields.includes('title') ? exp.title : null,
          item.fields && item.fields.includes('description') ? exp.description : null,
          item.fields && item.fields.includes('duration') ? exp.duration : null,
          item.fields && (item.fields.includes('visual') || item.fields.includes('action')) ? (exp.action || exp.description || '') : null,
          now,
          shot.id
        );
        if (item.fields && item.fields.includes('visual')) {
          const seg = listSegments(shot.id)[0];
          if (seg) {
            db.prepare('UPDATE storyboard_segments SET visual = ?, updated_at = ? WHERE id = ?').run(exp.visual || '', now, seg.id);
          }
        }
        nextShotRevision(shot.id);
        changedCount += 1;
      }
      for (const item of diff.removed || []) {
        if (item.skip) {
          skipped += 1;
          continue;
        }
        // 回收站式软删：媒体候选（image_generations/director 三表）一律保留
        db.prepare('UPDATE storyboards SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, item.shotId);
        removedCount += 1;
      }
    });
    tx();
    touchStage(episodeId);
    return { applied: { added: addedCount, changed: changedCount, removed: removedCount, skipped } };
  }

  function listShots(episodeId) {
    return db
      .prepare(
        'SELECT id, episode_id, storyboard_number, title, duration, status, structure_revision FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number'
      )
      .all(Number(episodeId));
  }

  function listSegments(shotId) {
    return db
      .prepare('SELECT * FROM storyboard_segments WHERE storyboard_id = ? ORDER BY seq')
      .all(Number(shotId));
  }

  function validateClosure(segments) {
    let cursor = 0;
    for (const seg of segments) {
      if (seg.start_seconds !== cursor) {
        throw httpError('SEGMENT_CLOSURE_INVALID', 400, `时码不连续：第 ${seg.seq} 段应从 ${cursor} 开始`);
      }
      if (seg.end_seconds <= seg.start_seconds) {
        throw httpError('SEGMENT_CLOSURE_INVALID', 400, `第 ${seg.seq} 段结束必须大于开始`);
      }
      cursor = seg.end_seconds;
    }
    return cursor;
  }

  function shotSourceFingerprint(shotId) {
    const shot = requireShot(shotId);
    const segments = listSegments(shotId);
    const refs = getReferenceRows(shotId);
    const style = db.prepare('SELECT style_id FROM dramas WHERE id = ?').get(shotEpisodeDrama(shotId));
    return sha256Text(
      JSON.stringify({
        segments,
        refs,
        image: shot.image_prompt || '',
        currentImage: shot.image_url || null,
        styleId: style ? style.style_id : null,
        duration: shot.duration,
      })
    );
  }

  function shotEpisodeDrama(shotId) {
    return db
      .prepare('SELECT e.drama_id FROM storyboards sb JOIN episodes e ON e.id = sb.episode_id WHERE sb.id = ?')
      .get(shotId).drama_id;
  }

  function getShotDetail(shotId) {
    const shot = requireShot(shotId);
    return {
      id: shot.id,
      episodeId: shot.episode_id,
      number: shot.storyboard_number,
      title: shot.title,
      duration: shot.duration,
      status: shot.status,
      segments: listSegments(shotId),
      expectedRevision: shot.structure_revision || 1,
      currentImage: shot.image_url || null,
    };
  }

  function assertExpectedRevision(shot, expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null) return;
    if (Number(expectedRevision) !== Number(shot.structure_revision || 1)) {
      throw httpError(
        'SHOT_REVISION_CONFLICT',
        409,
        `expected_revision ${expectedRevision} 与当前 ${shot.structure_revision || 1} 不匹配`
      );
    }
  }

  // ---------- 时段 ----------

  function editSegment(shotId, segmentId, { visual, dialogue, sound, expectedRevision = null } = {}) {
    const shot = requireShot(shotId);
    assertExpectedRevision(shot, expectedRevision);
    db.prepare(
      'UPDATE storyboard_segments SET visual = COALESCE(?, visual), dialogue = COALESCE(?, dialogue), sound = COALESCE(?, sound), updated_at = ? WHERE id = ? AND storyboard_id = ?'
    ).run(visual ?? null, dialogue ?? null, sound ?? null, nowIso(), segmentId, shotId);
    syncShotSourceColumns(shotId);
    const revision = nextShotRevision(shotId);
    return { segments: listSegments(shotId), expectedRevision: revision };
  }

  function splitSegment(shotId, segmentId, atSeconds) {
    const shot = requireShot(shotId);
    const segments = listSegments(shotId);
    const index = segments.findIndex((s) => s.id === Number(segmentId));
    if (index < 0) throw httpError('NOT_FOUND', 404, '时段不存在');
    const seg = segments[index];
    if (atSeconds <= seg.start_seconds || atSeconds >= seg.end_seconds) {
      throw httpError('VALIDATION_ERROR', 400, '拆分点必须位于时段内部');
    }
    const tx = db.transaction(() => {
      db.prepare('UPDATE storyboard_segments SET end_seconds = ?, updated_at = ? WHERE id = ?').run(
        atSeconds,
        nowIso(),
        seg.id
      );
      db.prepare(
        'UPDATE storyboard_segments SET seq = seq + 1 WHERE storyboard_id = ? AND seq > ?'
      ).run(shotId, seg.seq);
      db.prepare(
        `INSERT INTO storyboard_segments (storyboard_id, seq, start_seconds, end_seconds, visual, dialogue, sound, asset_refs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?)`
      ).run(shotId, seg.seq + 1, atSeconds, seg.end_seconds, seg.visual, seg.asset_refs_json, nowIso(), nowIso());
    });
    tx();
    syncShotSourceColumns(shotId);
    const revision = nextShotRevision(shotId);
    void shot;
    return { segments: listSegments(shotId), expectedRevision: revision };
  }

  function mergeSegment(shotId, segmentId) {
    requireShot(shotId);
    const segments = listSegments(shotId);
    const index = segments.findIndex((s) => s.id === Number(segmentId));
    if (index < 0) throw httpError('NOT_FOUND', 404, '时段不存在');
    if (index === segments.length - 1) throw httpError('VALIDATION_ERROR', 400, '最后一个时段没有下一段可合并');
    const current = segments[index];
    const next = segments[index + 1];
    const tx = db.transaction(() => {
      db.prepare('UPDATE storyboard_segments SET end_seconds = ?, visual = ?, updated_at = ? WHERE id = ?').run(
        next.end_seconds,
        `${current.visual}；${next.visual}`.replace(/^；/, ''),
        nowIso(),
        current.id
      );
      db.prepare('DELETE FROM storyboard_segments WHERE id = ?').run(next.id);
      const remaining = listSegments(shotId);
      remaining.forEach((seg, i) => {
        db.prepare('UPDATE storyboard_segments SET seq = ? WHERE id = ?').run(i + 1, seg.id);
      });
    });
    tx();
    syncShotSourceColumns(shotId);
    const revision = nextShotRevision(shotId);
    return { segments: listSegments(shotId), expectedRevision: revision };
  }

  function moveSegment(shotId, segmentId, direction) {
    requireShot(shotId);
    const segments = listSegments(shotId);
    const index = segments.findIndex((s) => s.id === Number(segmentId));
    if (index < 0) throw httpError('NOT_FOUND', 404, '时段不存在');
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= segments.length) {
      throw httpError('VALIDATION_ERROR', 400, '不能越界移动');
    }
    // 交换时间窗（保持时码闭合），随后交换 seq
    const a = segments[index];
    const b = segments[targetIndex];
    const tx = db.transaction(() => {
      db.prepare('UPDATE storyboard_segments SET start_seconds = ?, end_seconds = ? WHERE id = ?').run(
        a.start_seconds,
        a.end_seconds,
        b.id
      );
      db.prepare('UPDATE storyboard_segments SET start_seconds = ?, end_seconds = ? WHERE id = ?').run(
        b.start_seconds,
        b.end_seconds,
        a.id
      );
      db.prepare('UPDATE storyboard_segments SET seq = ? WHERE id = ?').run(b.seq, a.id);
      db.prepare('UPDATE storyboard_segments SET seq = ? WHERE id = ?').run(a.seq, b.id);
    });
    tx();
    syncShotSourceColumns(shotId);
    const revision = nextShotRevision(shotId);
    return { segments: listSegments(shotId), expectedRevision: revision };
  }

  // ---------- 引用 ----------

  function getReferenceRows(shotId) {
    const characters = db
      .prepare(
        `SELECT scv.id AS referenceId, scv.character_id AS assetId, c.name, scv.variant_id AS variantId, scv.sort_order
         FROM storyboard_character_variants scv JOIN characters c ON c.id = scv.character_id
         WHERE scv.storyboard_id = ? ORDER BY scv.sort_order, scv.id`
      )
      .all(shotId)
      .map((r) => ({
        referenceId: r.referenceId,
        assetType: 'character',
        assetId: r.assetId,
        name: r.name,
        variantId: r.variantId,
        slot: r.sort_order,
      }));
    const props = db
      .prepare(
        `SELECT sp.prop_id AS assetId, p.name FROM storyboard_props sp JOIN props p ON p.id = sp.prop_id
         WHERE sp.storyboard_id = ?`
      )
      .all(shotId)
      .map((r) => ({ referenceId: `prop_${r.assetId}`, assetType: 'prop', assetId: r.assetId, name: r.name }));
    return { characters, props };
  }

  function getReferenceManager(shotId) {
    requireShot(shotId);
    const rows = getReferenceRows(shotId);
    const scene = db
      .prepare(
        `SELECT s.id AS assetId, s.location AS name FROM storyboards sb JOIN scenes s ON s.id = sb.scene_id WHERE sb.id = ?`
      )
      .get(shotId);
    return {
      characters: rows.characters,
      props: rows.props,
      scene: {
        locked: true,
        note: '本镜场景是结构性的，不可移除。',
        refs: scene ? [{ assetId: scene.assetId, name: scene.name }] : [],
      },
    };
  }

  function markReferencesChanged(shotId) {
    // H3 来源变化：指纹失效在下次读取时按当前指纹比对；此处只需 bump 结构修订
    return nextShotRevision(shotId);
  }

  function addReference(shotId, { assetType, assetId }) {
    requireShot(shotId);
    if (assetType !== 'character' && assetType !== 'prop') {
      throw httpError('VALIDATION_ERROR', 400, '仅支持添加角色或道具引用（场景为结构性引用）');
    }
    if (assetType === 'character') {
      const existing = db
        .prepare('SELECT id FROM storyboard_character_variants WHERE storyboard_id = ? AND character_id = ?')
        .get(shotId, assetId);
      if (existing) throw httpError('REFERENCE_DUPLICATE', 409, '该角色已在本镜引用中');
      const variant = db
        .prepare('SELECT id FROM character_variants WHERE character_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, id LIMIT 1')
        .get(assetId);
      const sort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM storyboard_character_variants WHERE storyboard_id = ?').get(shotId).n) + 1;
      db.prepare(
        `INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order)
         VALUES (?, ?, ?, 'primary', ?)`
      ).run(shotId, assetId, variant ? variant.id : 0, sort);
    } else {
      const existing = db.prepare('SELECT 1 FROM storyboard_props WHERE storyboard_id = ? AND prop_id = ?').get(shotId, assetId);
      if (existing) throw httpError('REFERENCE_DUPLICATE', 409, '该道具已在本镜引用中');
      db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)').run(shotId, assetId);
    }
    const revision = markReferencesChanged(shotId);
    const manager = getReferenceManager(shotId);
    return { ...manager, expectedRevision: revision };
  }

  function removeReference(shotId, referenceId) {
    requireShot(shotId);
    if (String(referenceId).startsWith('prop_')) {
      db.prepare('DELETE FROM storyboard_props WHERE storyboard_id = ? AND prop_id = ?').run(
        shotId,
        Number(String(referenceId).slice(5))
      );
    } else {
      db.prepare('DELETE FROM storyboard_character_variants WHERE storyboard_id = ? AND id = ?').run(
        shotId,
        referenceId
      );
    }
    const revision = markReferencesChanged(shotId);
    const manager = getReferenceManager(shotId);
    return { ...manager, expectedRevision: revision };
  }

  // ---------- 分镜图 ----------

  function deriveImagePrompt(shotId) {
    const shot = requireShot(shotId);
    const segments = listSegments(shotId);
    const manager = getReferenceManager(shotId);
    const refNames = [...manager.characters, ...manager.props].map((r) => r.name).filter(Boolean);
    const visuals = segments.map((s) => s.visual).filter(Boolean).join('；');
    const style = db
      .prepare('SELECT style_id FROM dramas WHERE id = ?')
      .get(shotEpisodeDrama(shotId));
    let styleLabel = '';
    if (style && style.style_id) {
      try {
        const { createStyleRegistryService } = require('../../services/styleRegistryService.js');
        const info = createStyleRegistryService({ db }).requireStyle(style.style_id);
        styleLabel = info.labelZh || info.labelEn || style.style_id;
      } catch {
        styleLabel = style.style_id;
      }
    }
    return `画面：${visuals || shot.description || ''}${refNames.length ? `；引用：${refNames.join('、')}` : ''}${styleLabel ? `；风格：${styleLabel}` : ''}`;
  }

  function getImagePrompt(shotId) {
    const shot = requireShot(shotId);
    return {
      text: shot.image_prompt || deriveImagePrompt(shotId),
      manual: Boolean(shot.image_prompt_manual),
      autoText: deriveImagePrompt(shotId),
    };
  }

  function editImagePrompt(shotId, { text } = {}) {
    requireShot(shotId);
    db.prepare('UPDATE storyboards SET image_prompt = ?, image_prompt_manual = 1, updated_at = ? WHERE id = ?').run(
      String(text || ''),
      nowIso(),
      shotId
    );
    markReferencesChanged(shotId);
    return getImagePrompt(shotId);
  }

  function resetImagePrompt(shotId) {
    requireShot(shotId);
    db.prepare('UPDATE storyboards SET image_prompt = NULL, image_prompt_manual = 0, updated_at = ? WHERE id = ?').run(
      nowIso(),
      shotId
    );
    markReferencesChanged(shotId);
    return getImagePrompt(shotId);
  }

  function imageCandidates(shotId) {
    // 'succeeded' = V2.1 mock/上传候选；'completed' = 真实 Provider（imageService）产出
    return db
      .prepare(
        `SELECT g.id AS candidateId, g.image_url AS url, g.local_path AS localPath, g.created_at AS createdAt
         FROM image_generations g WHERE g.storyboard_id = ? AND g.status IN ('succeeded','completed') AND g.deleted_at IS NULL
         ORDER BY g.id DESC`
      )
      .all(shotId);
  }

  async function generateImage(shotId, { prompt = null, channelOptions = {} } = {}) {
    requireShot(shotId);
    const effectivePrompt = prompt || getImagePrompt(shotId).text;
    if (providerRouter) {
      const real = await providerRouter.generateImage({
        shotId,
        dramaId: shotEpisodeDrama(shotId),
        prompt: effectivePrompt,
        referenceUrls: referenceUrlsForImage(shotId),
        channelOptions,
      });
      if (real) {
        // 真实通道候选行由 imageService 写入 image_generations，服务层不重复落库
        return { candidateId: real.candidateId, url: real.url, sha256: real.sha256 ?? null, provider: real.provider || null };
      }
    }
    if (!mockProvider) throw httpError('PROVIDER_UNAVAILABLE', 503, '生成通道不可用');
    const submitted = mockProvider.submit({
      kind: 'image',
      ownerType: 'storyboard_image',
      ownerId: shotId,
      input: { prompt: effectivePrompt },
    });
    const result = await mockProvider.run(submitted.taskId);
    const info = db
      .prepare(
        `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, image_url, local_path, status, completed_at, created_at, updated_at)
         VALUES (?, ?, 'mock', ?, ?, ?, 'succeeded', ?, ?, ?)`
      )
      .run(shotId, shotEpisodeDrama(shotId), effectivePrompt, result.url, result.artifactPath, nowIso(), nowIso(), nowIso());
    return { candidateId: Number(info.lastInsertRowid), url: result.url, sha256: result.sha256 };
  }

  function uploadImage(shotId, { imageUrl, localPath = null } = {}) {
    requireShot(shotId);
    const info = db
      .prepare(
        `INSERT INTO image_generations (storyboard_id, drama_id, provider, image_url, local_path, status, created_at, updated_at)
         VALUES (?, ?, 'upload', ?, ?, 'succeeded', ?, ?)`
      )
      .run(shotId, shotEpisodeDrama(shotId), imageUrl, localPath, nowIso(), nowIso());
    return { candidateId: Number(info.lastInsertRowid), url: imageUrl };
  }

  function setImageCurrent(shotId, { candidateId } = {}) {
    const shot = requireShot(shotId);
    const gen = db.prepare('SELECT * FROM image_generations WHERE id = ? AND storyboard_id = ?').get(candidateId, shotId);
    if (!gen) throw httpError('NOT_FOUND', 404, '分镜图候选不存在');
    db.prepare('UPDATE storyboards SET image_url = ?, updated_at = ? WHERE id = ?').run(gen.image_url, nowIso(), shotId);
    markReferencesChanged(shotId);
    // 旧视频标记"基于旧分镜图"
    const staleVideos = db
      .prepare(
        `SELECT dc.id AS candidateId FROM director_candidate_groups dcg
         JOIN director_candidates dc ON dc.group_id = dcg.id
         WHERE dcg.shot_id = ? AND dcg.selected_candidate_id = dc.id`
      )
      .all(String(shotId))
      .map((r) => r.candidateId);
    return {
      currentImage: { url: gen.image_url, candidateId: gen.id },
      h3Draft: { status: 'stale', statusLabel: '需要更新' },
      staleVideos,
    };
  }

  // ---------- H3 ----------

  function h3DraftRow(shotId) {
    if (isRealH3Channel()) {
      const ch = videoChannel();
      // 真实 H3 通道：草稿由 h3PromptDraftService.compileDraft 写入（video_config_id = 真实配置 id）
      return db
        .prepare(
          'SELECT * FROM storyboard_h3_prompt_drafts WHERE storyboard_id = ? AND video_config_id = ? ORDER BY id DESC LIMIT 1'
        )
        .get(shotId, String(ch.resolved.config.id));
    }
    return db
      .prepare(
        `SELECT * FROM storyboard_h3_prompt_drafts WHERE storyboard_id = ? AND video_config_id = 'v21' ORDER BY id DESC LIMIT 1`
      )
      .get(shotId);
  }

  /** 真实通道草稿的过期判定：完整编译行交给 legacy 新鲜度评估；不完整（测试替身）行不判过期 */
  function realDraftStale(row) {
    try {
      const params = row.generation_params ? JSON.parse(row.generation_params) : null;
      if (!params || params.durationSeconds == null) return false;
      const { createH3PromptDraftService } = require('../../services/h3PromptDraftService.js');
      return !!createH3PromptDraftService().evaluateDraftFreshness(db, row).stale;
    } catch (_) {
      return false;
    }
  }

  function compileH3Text(shotId) {
    const shot = requireShot(shotId);
    const segments = listSegments(shotId);
    const manager = getReferenceManager(shotId);
    const slotLabels = [...manager.characters, ...manager.props];
    const lines = [];
    slotLabels.forEach((ref, i) => {
      lines.push(`@图片${i + 1} ${ref.name || ref.assetType}`);
    });
    for (const seg of segments) {
      const dialogue = (seg.dialogue || '').trim();
      lines.push(
        `[${seg.start_seconds.toFixed(1)}–${seg.end_seconds.toFixed(1)}s] ${seg.visual || ''}${
          dialogue ? `；对白：${dialogue}` : ''
        }`
      );
    }
    const style = db.prepare('SELECT style_id FROM dramas WHERE id = ?').get(shotEpisodeDrama(shotId));
    if (style && style.style_id) {
      try {
        const { createStyleRegistryService } = require('../../services/styleRegistryService.js');
        const info = createStyleRegistryService({ db }).requireStyle(style.style_id);
        lines.push(`风格：${info.labelZh || style.style_id}`);
      } catch {
        lines.push(`风格：${style.style_id}`);
      }
    }
    void shot;
    return lines.join('\n');
  }

  function validateH3Text(shotId, text) {
    const shot = requireShot(shotId);
    const segments = listSegments(shotId);
    const manager = getReferenceManager(shotId);
    const slotCount = manager.characters.length + manager.props.length;
    const checks = [];
    const structureOk = segments.every((seg) =>
      String(text).includes(`[${seg.start_seconds.toFixed(1)}–${seg.end_seconds.toFixed(1)}s]`)
    );
    checks.push({ id: 'structure', label: '结构校验', ok: structureOk });
    let slotsOk = true;
    for (let i = 1; i <= slotCount; i += 1) {
      if (!String(text).includes(`@图片${i}`)) slotsOk = false;
    }
    checks.push({ id: 'slots', label: '引用槽位', ok: slotsOk });
    const hasDialogue = segments.some((s) => (s.dialogue || '').trim());
    const audioOk = !hasDialogue || String(text).includes('对白');
    checks.push({ id: 'audio', label: '音频语义覆盖', ok: audioOk });
    const styleRow = db.prepare('SELECT style_id FROM dramas WHERE id = ?').get(shotEpisodeDrama(shotId));
    const styleOk = !styleRow || !styleRow.style_id || String(text).includes('风格：');
    checks.push({ id: 'style', label: '提示词风格', ok: styleOk });
    const valid = checks.every((c) => c.ok);
    void shot;
    return { valid, checks, errors: checks.filter((c) => !c.ok).map((c) => c.label) };
  }

  function h3Fingerprint(shotId) {
    return shotSourceFingerprint(shotId);
  }

  function generateH3(shotId, options = {}) {
    requireShot(shotId);
    const existing = h3DraftRow(shotId);
    if (existing && existing.manually_edited === 1 && !options?.confirmOverwrite) {
      throw httpError('H3_MANUAL_PROTECTED', 409, '存在人工编辑的 H3 草稿；确认后才会重新生成，人工文本不会被覆盖');
    }
    if (isRealH3Channel() && providerRouter) {
      // 真实 H3 通道：先同步业务源文本，再经统一门禁编译（写入 video_config_id = 真实配置 id 的草稿行）
      syncShotSourceColumns(shotId);
      const ch = videoChannel();
      return providerRouter.compileH3Draft({ shotId, resolved: ch.resolved }).then((compiled) => {
        if (!compiled) throw httpError('PROVIDER_UNAVAILABLE', 503, 'H3 编译通道不可用');
        return {
          draftId: compiled.id,
          status: 'ai-generated',
          statusLabel: 'AI 生成',
          text: compiled.final_compiled_prompt,
          validation: { valid: compiled.status !== 'invalid', checks: [] },
          manuallyEdited: false,
          segments: listSegments(shotId),
          expectedRevision: requireShot(shotId).structure_revision || 1,
        };
      });
    }
    const text = compileH3Text(shotId);
    const validation = validateH3Text(shotId, text);
    const fingerprint = h3Fingerprint(shotId);
    const info = db
      .prepare(
        `INSERT INTO storyboard_h3_prompt_drafts
         (storyboard_id, video_config_id, workflow_id, source_prompt, source_fingerprint, ai_compiled_prompt, final_compiled_prompt, compiled_prompt_hash, manually_edited, status, validation_errors, created_at, updated_at)
         VALUES (?, 'v21', 'v21-default', '', ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(
        shotId,
        fingerprint,
        text,
        text,
        sha256Text(text),
        validation.valid ? 'valid' : 'invalid',
        JSON.stringify(validation.checks),
        nowIso(),
        nowIso()
      );
    return {
      draftId: Number(info.lastInsertRowid),
      status: 'ai-generated',
      statusLabel: 'AI 生成',
      text,
      validation,
      manuallyEdited: false,
      segments: listSegments(shotId),
      expectedRevision: requireShot(shotId).structure_revision || 1,
    };
  }

  function getH3Draft(shotId) {
    requireShot(shotId);
    const row = h3DraftRow(shotId);
    if (!row) return null;
    if (isRealH3Channel() && String(row.video_config_id) !== 'v21') {
      let status;
      let statusLabel;
      if (row.status === 'invalid') {
        status = 'invalid';
        statusLabel = '校验失败';
      } else if (realDraftStale(row)) {
        status = 'stale';
        statusLabel = '需要更新';
      } else if (row.manually_edited === 1) {
        status = 'valid';
        statusLabel = '已编辑';
      } else {
        status = 'ai-generated';
        statusLabel = 'AI 生成';
      }
      return {
        draftId: row.id,
        status,
        statusLabel,
        text: row.final_compiled_prompt,
        validation: { valid: row.status !== 'invalid', checks: [] },
        manuallyEdited: row.manually_edited === 1,
        segments: listSegments(shotId),
        expectedRevision: requireShot(shotId).structure_revision || 1,
      };
    }
    const currentFingerprint = h3Fingerprint(shotId);
    const validation = validateH3Text(shotId, row.final_compiled_prompt || '');
    let status;
    let statusLabel;
    if (row.status === 'invalid') {
      status = 'invalid';
      statusLabel = '校验失败';
    } else if (row.source_fingerprint !== currentFingerprint) {
      status = 'stale';
      statusLabel = '需要更新';
    } else if (row.manually_edited === 1) {
      status = 'valid';
      statusLabel = '已编辑';
    } else {
      status = 'ai-generated';
      statusLabel = 'AI 生成';
    }
    return {
      draftId: row.id,
      status,
      statusLabel,
      text: row.final_compiled_prompt,
      validation,
      manuallyEdited: row.manually_edited === 1,
      segments: listSegments(shotId),
      expectedRevision: requireShot(shotId).structure_revision || 1,
    };
  }

  function editH3(shotId, { text } = {}) {
    const draft = getH3Draft(shotId);
    return { ...draft, status: 'dirty', statusLabel: '已编辑', pendingText: text };
  }

  function saveH3(shotId, { text } = {}) {
    const row = h3DraftRow(shotId);
    if (!row) throw httpError('NOT_FOUND', 404, '尚无 H3 草稿，请先生成');
    if (isRealH3Channel() && providerRouter && String(row.video_config_id) !== 'v21') {
      // 真实通道草稿：经 legacy saveDraftText 校验保存（保留 source_fingerprint，提交门禁仍可用）
      return providerRouter.saveH3DraftText({ draftId: row.id, text }).then((saved) => {
        if (!saved) throw httpError('PROVIDER_UNAVAILABLE', 503, 'H3 编译通道不可用');
        const status = saved.status === 'invalid' ? 'invalid' : 'valid';
        return {
          draftId: row.id,
          status,
          statusLabel: status === 'valid' ? '校验通过' : '校验失败',
          text: saved.final_compiled_prompt,
          validation: { valid: status === 'valid', checks: [] },
          manuallyEdited: true,
          segments: listSegments(shotId),
          expectedRevision: requireShot(shotId).structure_revision || 1,
        };
      });
    }
    const validation = validateH3Text(shotId, text);
    const status = validation.valid ? 'valid' : 'invalid';
    db.prepare(
      `UPDATE storyboard_h3_prompt_drafts SET final_compiled_prompt = ?, compiled_prompt_hash = ?, manually_edited = 1, status = ?, validation_errors = ?, source_fingerprint = ?, updated_at = ? WHERE id = ?`
    ).run(text, sha256Text(text), status, JSON.stringify(validation.checks), h3Fingerprint(shotId), nowIso(), row.id);
    return {
      draftId: row.id,
      status,
      statusLabel: validation.valid ? '校验通过' : '校验失败',
      text,
      validation,
      manuallyEdited: true,
      segments: listSegments(shotId),
      expectedRevision: requireShot(shotId).structure_revision || 1,
    };
  }

  // ---------- 视频 ----------

  function ensureCandidateGroup(shotId) {
    const existing = db.prepare("SELECT id FROM director_candidate_groups WHERE shot_id = ?").get(String(shotId));
    if (existing) return existing.id;
    const id = `grp_${shotId}_${Date.now().toString(36)}`;
    db.prepare(
      `INSERT INTO director_candidate_groups (id, shot_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`
    ).run(id, String(shotId), nowIso(), nowIso());
    return id;
  }

  function activeVideoTasks(shotId) {
    return db
      .prepare(
        `SELECT * FROM async_tasks WHERE owner_type = 'storyboard_video' AND owner_id = ? AND status IN ('pending','running')`
      )
      .all(String(shotId));
  }

  function getVideoQuote(shotId, count) {
    requireShot(shotId);
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 3) {
      throw httpError('VALIDATION_ERROR', 400, '生成数量必须为 1–3 的整数');
    }
    const ch = videoChannel();
    if (providerRouter && ch.channel === 'real') {
      const info = providerRouter.videoChannelInfo();
      return {
        count: n,
        outputDuration: `${requireShot(shotId).duration}s`,
        estimatedCost: providerRouter.estimateVideoCost(ch.resolved),
        estimatedTime: '取决于 Provider，通常 1–5 分钟（非承诺值）',
        provider: info.provider,
        channel: 'real',
        model: info.model,
        h3: info.h3 || false,
      };
    }
    return {
      count: n,
      outputDuration: `${requireShot(shotId).duration}s`,
      estimatedCost: { estimated: 0, currency: 'local', note: 'mock 本地执行，不产生 API 费用' },
      estimatedTime: '约 1–2 分钟（非承诺值）',
      provider: 'mock',
    };
  }

  function jointGuard(shotId) {
    const shot = requireShot(shotId);
    const checks = [];
    const rows = getReferenceRows(shotId);
    checks.push({ id: 'references', label: '引用素材', ok: true, detail: `${rows.characters.length + rows.props.length} 个引用` });
    const ch = videoChannel();
    if (providerRouter && ch.channel === 'real') {
      // 真实通道：Provider 能力（引用数/时长上限）驱动本行（mock 恒通过）
      const caps = providerRouter.videoCapabilities(ch.resolved);
      const refCount = rows.characters.length + rows.props.length;
      const issues = [];
      if (caps) {
        if (caps.maxReferences != null && refCount > caps.maxReferences) {
          issues.push(`引用数 ${refCount} 超出模型上限 ${caps.maxReferences}`);
        }
        if (caps.maxDurationSeconds != null && Number(shot.duration) > caps.maxDurationSeconds) {
          issues.push(`时长 ${shot.duration}s 超出模型上限 ${caps.maxDurationSeconds}s`);
        }
      }
      checks.push({
        id: 'capability',
        label: '模型能力',
        ok: issues.length === 0,
        detail: issues.length ? issues.join('；') : `${ch.resolved.provider}/${ch.resolved.model}`,
      });
    } else {
      checks.push({ id: 'capability', label: '模型能力', ok: true, detail: 'mock 通道' });
    }
    const draft = getH3Draft(shotId);
    const h3Ok = Boolean(draft && ['ai-generated', 'valid'].includes(draft.status));
    checks.push({
      id: 'h3',
      label: '生成描述（H3）',
      ok: h3Ok,
      detail: draft ? draft.statusLabel : '尚未生成 H3 提示词',
    });
    const busy = activeVideoTasks(shotId).length > 0;
    checks.push({ id: 'tasks', label: '重复任务', ok: !busy, detail: busy ? '已有运行中任务' : '' });
    return { canSubmit: checks.every((c) => c.ok), checks, shot };
  }

  async function submitVideo(shotId, { count = 1, delayMs = 0, channelOptions = {} } = {}) {
    const shot = requireShot(shotId);
    const guard = jointGuard(shotId);
    if (!guard.canSubmit) {
      throw httpError('GENERATION_BLOCKED', 409, `存在未通过的前置检查：${guard.checks.filter((c) => !c.ok).map((c) => c.label).join('、')}`);
    }
    const quote = getVideoQuote(shotId, count);
    if (providerRouter) {
      const real = await providerRouter.submitVideo({
        shotId,
        dramaId: shotEpisodeDrama(shotId),
        count: quote.count,
        prompt: getH3Draft(shotId)?.text || '',
        duration: Math.max(0.5, Number(shot.duration) || 1),
        h3PromptDraftId: isRealH3Channel() ? (h3DraftRow(shotId)?.id ?? null) : null,
        groupId: ensureCandidateGroup(shotId),
        channelOptions,
      });
      if (real) {
        return { tasks: real.tasks.map((t) => ({ taskId: t.taskId, deduped: !!t.deduped })), quote };
      }
    }
    if (!mockProvider) throw httpError('PROVIDER_UNAVAILABLE', 503, '生成通道不可用');
    const tasks = [];
    for (let i = 0; i < quote.count; i += 1) {
      const submitted = mockProvider.submit({
        kind: 'video',
        ownerType: 'storyboard_video',
        ownerId: String(shotId),
        input: { prompt: getH3Draft(shotId)?.text || '', durationSeconds: Math.max(0.5, Number(shot.duration) || 1), delayMs: Math.min(30000, Math.max(0, Number(delayMs) || 0)) },
        cost: quote.estimatedCost,
      });
      tasks.push({ taskId: submitted.taskId, deduped: submitted.deduped });
    }
    return { tasks, quote };
  }

  async function completeVideoTask(taskId) {
    if (providerRouter) {
      const real = await providerRouter.waitForVideoTask(taskId);
      if (real) {
        return {
          candidateId: real.candidateId,
          artifactId: real.artifactId,
          group: real.group,
          url: real.url || null,
        };
      }
    }
    if (!mockProvider) throw httpError('PROVIDER_UNAVAILABLE', 503, '生成通道不可用');
    const task = mockProvider.getTask(taskId);
    if (!task) throw httpError('NOT_FOUND', 404, '任务不存在');
    if (task.status !== 'completed') {
      await mockProvider.run(taskId);
    }
    const shotId = Number(task.ownerId);
    const shot = requireShot(shotId);
    const group = ensureCandidateGroup(shotId);
    const result = mockProvider.getTask(taskId).result;
    const artifactId = `art_${taskId}_v1`;
    const existing = db.prepare('SELECT id FROM director_artifacts WHERE id = ?').get(artifactId);
    if (!existing) {
      db.prepare(
        `INSERT INTO director_artifacts (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size, manifest_json, created_at, ready_at)
         VALUES (?, ?, 1, 1, 'ready', ?, ?, ?, ?, ?, ?)`
      ).run(
        artifactId,
        taskId,
        result.artifactPath,
        result.sha256 || '',
        result.bytes || 0,
        JSON.stringify({
          shotId,
          provider: 'mock',
          duration: result.durationSeconds || null,
          imageHash: sha256Text(shot.image_url || 'no-image'),
          url: result.url,
        }),
        nowIso(),
        nowIso()
      );
      db.prepare(
        `INSERT INTO director_candidates (id, group_id, artifact_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, ?)`
      ).run(`cand_${taskId}`, group, artifactId, nowIso(), nowIso());
      db.prepare("UPDATE director_candidate_groups SET status = 'ready', updated_at = ? WHERE id = ?").run(nowIso(), group);
    }
    return { candidateId: `cand_${taskId}`, artifactId, group };
  }

  function videoCandidates(shotId) {
    const group = db.prepare('SELECT * FROM director_candidate_groups WHERE shot_id = ?').get(String(shotId));
    if (!group) return { candidates: [], adoptedCandidateId: null };
    const candidates = db
      .prepare(
        `SELECT dc.id AS candidateId, dc.status, da.artifact_path, da.manifest_json, da.created_at
         FROM director_candidates dc JOIN director_artifacts da ON da.id = dc.artifact_id
         WHERE dc.group_id = ? ORDER BY dc.created_at DESC`
      )
      .all(group.id)
      .map((row) => ({
        candidateId: row.candidateId,
        status: row.status,
        manifest: JSON.parse(row.manifest_json || '{}'),
        url: row.manifest_json ? (JSON.parse(row.manifest_json).url || null) : null,
        submittedAt: row.created_at,
        isAdopted: group.selected_candidate_id === row.candidateId,
      }));
    return { candidates, adoptedCandidateId: group.selected_candidate_id };
  }

  function adoptVideo(shotId, candidateId, { expectedSelectedCandidateId = undefined } = {}) {
    requireShot(shotId);
    const group = db.prepare('SELECT * FROM director_candidate_groups WHERE shot_id = ?').get(String(shotId));
    if (!group) throw httpError('NOT_FOUND', 404, '候选组不存在');
    if (expectedSelectedCandidateId !== undefined && group.selected_candidate_id !== expectedSelectedCandidateId) {
      throw httpError('ADOPTION_CONFLICT', 409, '采用指针已被其他操作更新，请刷新候选');
    }
    const candidate = db
      .prepare("SELECT id FROM director_candidates WHERE id = ? AND group_id = ? AND status = 'ready'")
      .get(candidateId, group.id);
    if (!candidate) throw httpError('NOT_FOUND', 404, '候选不存在或尚未就绪');
    db.prepare(
      "UPDATE director_candidate_groups SET selected_candidate_id = ?, selected_by = 'local-user', selected_at = ?, updated_at = ? WHERE id = ?"
    ).run(candidateId, nowIso(), nowIso(), group.id);
    return { adoptedCandidateId: candidateId };
  }

  function undoAdoptVideo(shotId) {
    requireShot(shotId);
    db.prepare(
      "UPDATE director_candidate_groups SET selected_candidate_id = NULL, selected_at = NULL, updated_at = ? WHERE shot_id = ?"
    ).run(nowIso(), String(shotId));
    return { adoptedCandidateId: null };
  }

  function getCompletion(episodeId) {
    const shots = listShots(episodeId);
    let adopted = 0;
    const staleShots = [];
    const missing = [];
    const failed = [];
    for (const shot of shots) {
      const { adoptedCandidateId, candidates } = videoCandidates(shot.id);
      if (!adoptedCandidateId) {
        if (candidates.length === 0) missing.push(shot);
        else missing.push(shot);
        continue;
      }
      const adoptedCand = candidates.find((c) => c.candidateId === adoptedCandidateId);
      if (!adoptedCand) {
        missing.push(shot);
        continue;
      }
      const fresh = requireShot(shot.id);
      const expectedHash = sha256Text(fresh.image_url || 'no-image');
      if (adoptedCand.manifest.imageHash && adoptedCand.manifest.imageHash !== expectedHash) {
        staleShots.push({ shotId: shot.id, number: shot.storyboard_number, reason: '基于旧分镜图' });
        continue;
      }
      adopted += 1;
    }
    const blockers = [];
    if (missing.length) blockers.push({ label: `镜头 ${missing.map((s) => s.storyboard_number).join('、')} 尚未生成`, shots: missing.map((s) => s.id) });
    if (staleShots.length) blockers.push({ label: `镜头 ${staleShots.map((s) => s.number).join('、')} 基于旧分镜图，需要确认`, shots: staleShots.map((s) => s.shotId) });
    if (failed.length) blockers.push({ label: `镜头 ${failed.map((s) => s.number).join('、')} 生成失败`, shots: failed.map((s) => s.id) });
    return { total: shots.length, adopted, staleShots, missing: missing.map((s) => s.id), blockers };
  }

  function getFrameChaining(shotId) {
    requireShot(shotId);
    const shot = requireShot(shotId);
    const prev = db
      .prepare(
        'SELECT id FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
      )
      .get(shot.episode_id, shot.storyboard_number);
    if (!prev) return { state: 'none', note: '本镜为第一镜' };
    const prevGroup = db.prepare('SELECT * FROM director_candidate_groups WHERE shot_id = ?').get(String(prev.id));
    if (!prevGroup || !prevGroup.selected_candidate_id) {
      return { state: 'waiting', note: '等待上一镜完成' };
    }
    const anchor = db
      .prepare(
        "SELECT id FROM director_anchors WHERE id = ?"
      )
      .get(`v21anchor_${prev.id}_${shotId}`);
    if (anchor) return { state: 'linked', note: '已衔接' };
    return { state: 'linkable', note: '可衔接' };
  }

  function confirmFrameLink(shotId) {
    const shot = requireShot(shotId);
    const prev = db
      .prepare(
        'SELECT id FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
      )
      .get(shot.episode_id, shot.storyboard_number);
    if (!prev) throw httpError('VALIDATION_ERROR', 400, '本镜为第一镜，无法衔接');
    const prevGroup = db.prepare('SELECT * FROM director_candidate_groups WHERE shot_id = ?').get(String(prev.id));
    if (!prevGroup || !prevGroup.selected_candidate_id) {
      throw httpError('VALIDATION_ERROR', 409, '等待上一镜完成后才能衔接');
    }
    const id = `v21anchor_${prev.id}_${shotId}`;
    const exists = db.prepare('SELECT id FROM director_anchors WHERE id = ?').get(id);
    if (!exists) {
      db.prepare(
        `INSERT INTO director_anchors (id, source_artifact_id, derived_artifact_id, frame_number, reference_role, reference_use, source_sha256, parameters_json, created_at)
         VALUES (?, ?, ?, 0, 'continuity_frame', 'first_frame_reference', '', '{}', ?)`
      ).run(id, prevGroup.selected_candidate_id, prevGroup.selected_candidate_id, nowIso());
    }
    return { state: 'linked', anchorId: id };
  }

  function unlinkFrameLink(shotId) {
    const shot = requireShot(shotId);
    const prev = db
      .prepare(
        'SELECT id FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
      )
      .get(shot.episode_id, shot.storyboard_number);
    if (!prev) return { state: 'none' };
    db.prepare('DELETE FROM director_anchors WHERE id = ?').run(`v21anchor_${prev.id}_${shotId}`);
    return getFrameChaining(shotId);
  }

  /** 批量预检：缺失分镜图 / 缺失视频 / 失败任务（设计稿 25 批量抽屉） */
  function batchPrecheck(episodeId) {
    const shots = listShots(episodeId);
    const missingImages = [];
    const missingVideos = [];
    const failed = [];
    const processing = [];
    for (const shot of shots) {
      if (!shot.image_url) missingImages.push(shot.id);
      const group = db.prepare('SELECT * FROM director_candidate_groups WHERE shot_id = ?').get(String(shot.id));
      const adopted = group && group.selected_candidate_id;
      const hasCandidates = db
        .prepare('SELECT COUNT(*) AS n FROM director_candidates WHERE group_id = ?')
        .get(group ? group.id : '').n > 0;
      const busy = activeVideoTasks(shot.id).length > 0;
      const failedTask = db
        .prepare(
          "SELECT id FROM async_tasks WHERE owner_type = 'storyboard_video' AND owner_id = ? AND status IN ('failed','cancelled') ORDER BY updated_at DESC LIMIT 1"
        )
        .get(String(shot.id));
      if (busy) {
        // 处理中镜头（有 pending/running 视频任务）：不进 failed / missingVideos
        processing.push(shot.id);
        continue;
      }
      if (!adopted && failedTask) failed.push({ shotId: shot.id, taskId: failedTask.id });
      else if (!adopted && !hasCandidates) missingVideos.push(shot.id);
    }
    return { missingImages, missingVideos, failed, processing };
  }

  /** 批量生成缺失分镜图 */
  async function batchGenerateMissingImages(episodeId) {
    const { missingImages } = batchPrecheck(episodeId);
    const results = [];
    for (const shotId of missingImages) {
      try {
        const r = await generateImage(shotId, {});
        results.push({ shotId, ok: true, candidateId: r.candidateId });
      } catch (err) {
        results.push({ shotId, ok: false, error: err.message });
      }
    }
    return { action: 'missing-images', total: missingImages.length, results };
  }

  /** 批量生成缺失视频（仅 H3 就绪且无活动任务的镜头） */
  async function batchGenerateMissingVideos(episodeId, { count = 1 } = {}) {
    const { missingVideos } = batchPrecheck(episodeId);
    const results = [];
    for (const shotId of missingVideos) {
      try {
        const guard = jointGuard(shotId);
        if (!guard.canSubmit) {
          results.push({ shotId, ok: false, error: guard.checks.filter((c) => !c.ok).map((c) => c.label).join('、') });
          continue;
        }
        const r = await submitVideo(shotId, { count });
        results.push({ shotId, ok: true, taskIds: r.tasks.map((t) => t.taskId) });
      } catch (err) {
        results.push({ shotId, ok: false, error: err.message });
      }
    }
    return { action: 'missing-videos', total: missingVideos.length, results };
  }

  /** 批量重试失败任务（按原输入创建新 attempt） */
  async function batchRetryFailed(episodeId) {
    const { failed } = batchPrecheck(episodeId);
    const results = [];
    for (const item of failed) {
      try {
        const r = retryTask(item.taskId);
        results.push({ shotId: item.shotId, ok: true, newTaskId: r.taskId });
      } catch (err) {
        results.push({ shotId: item.shotId, ok: false, error: err.message });
      }
    }
    return { action: 'retry-failed', total: failed.length, results };
  }

  /** 重试：按原输入快照创建新任务（mock 通道走 mockProvider；真实通道走统一服务重试） */
  async function retryTask(taskId) {
    if (providerRouter) {
      const real = await providerRouter.retryVideoTask(taskId);
      if (real) return real;
    }
    if (!mockProvider) throw httpError('PROVIDER_UNAVAILABLE', 503, '生成通道不可用');
    return mockProvider.retry(taskId);
  }

  /** 取消当前任务：mock 立即 cancel-requested；真实通道经统一服务取消并保留记录 */
  async function cancelVideoTask(taskId, reason = '') {
    if (providerRouter) {
      const real = await providerRouter.cancelVideoTask(taskId);
      if (real) return real;
    }
    if (!mockProvider) throw httpError('PROVIDER_UNAVAILABLE', 503, '生成通道不可用');
    const task = mockProvider.getTask(taskId);
    if (!task) throw httpError('NOT_FOUND', 404, `任务不存在: ${taskId}`);
    if (task.status === 'completed') throw httpError('TASK_NOT_CANCELLABLE', 409, '已完成任务不能取消');
    return mockProvider.cancel(taskId, reason);
  }

  /** 任务状态视图（生成 Sheet 轮询用）：mock 读 async_tasks；真实通道附 video_generations 终态 */
  function getVideoTaskStatus(taskId) {
    const task = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(taskId);
    if (!task) throw httpError('NOT_FOUND', 404, `任务不存在: ${taskId}`);
    const base = {
      taskId,
      status: task.status,
      progress: task.progress ?? 0,
      message: task.message || '',
      cancelRequested: task.cancel_state === 'cancelled',
      done: ['completed', 'failed', 'cancelled'].includes(task.status),
      ok: task.status === 'completed',
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error || null,
    };
    if (providerRouter && task.input_json) {
      try {
        const parsed = JSON.parse(task.input_json);
        if (parsed && parsed.videoGenerationId != null) {
          const gen = db.prepare('SELECT id, status, video_url FROM video_generations WHERE id = ?').get(Number(parsed.videoGenerationId));
          if (gen) {
            const videoDone = ['review', 'completed', 'selected'].includes(gen.status);
            base.videoStatus = gen.status;
            if (videoDone) {
              base.done = true;
              base.ok = true;
              base.result = { candidateId: `cand_${taskId}`, artifactId: `unified-video-${gen.id}`, url: gen.video_url };
            } else if (['failed', 'cancelled', 'interrupted'].includes(gen.status)) {
              base.done = true;
              base.ok = false;
            }
          }
        }
      } catch (_) {}
    }
    return base;
  }

  /** 生成历史抽屉（28）：任务记录（含失败/取消）+ 候选列表 */
  function getVideoHistory(shotId) {
    requireShot(shotId);
    const tasks = db
      .prepare(
        "SELECT id, status, progress, message, created_at, updated_at, completed_at, input_json, error FROM async_tasks WHERE owner_type = 'storyboard_video' AND owner_id = ? ORDER BY created_at DESC"
      )
      .all(String(shotId))
      .map((row) => ({
        taskId: row.id,
        status: row.status,
        progress: row.progress,
        message: row.message,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        prompt: row.input_json ? (JSON.parse(row.input_json).prompt || '') : '',
        error: row.error || null,
        cancelRequested: row.cancel_state === 'cancelled',
      }));
    const { candidates, adoptedCandidateId } = videoCandidates(shotId);
    return { tasks, candidates, adoptedCandidateId };
  }

  return {
    createFromScript,
    previewStructureDiff,
    applyStructureDiff,
    listShots,
    getShotDetail,
    editSegment,
    splitSegment,
    mergeSegment,
    moveSegment,
    getReferenceManager,
    addReference,
    removeReference,
    getImagePrompt,
    editImagePrompt,
    resetImagePrompt,
    imageCandidates,
    generateImage,
    uploadImage,
    setImageCurrent,
    generateH3,
    getH3Draft,
    editH3,
    saveH3,
    getVideoQuote,
    jointGuard,
    submitVideo,
    completeVideoTask,
    videoCandidates,
    adoptVideo,
    undoAdoptVideo,
    getCompletion,
    getFrameChaining,
    confirmFrameLink,
    unlinkFrameLink,
    batchPrecheck,
    batchGenerateMissingImages,
    batchGenerateMissingVideos,
    batchRetryFailed,
    getVideoHistory,
    cancelVideoTask,
    getVideoTaskStatus,
  };
}

module.exports = { createStoryboardService };
