'use strict';
const crypto = require('node:crypto');
const { validateFullV21 } = require('./packageContractV21.js');
const { createEpisodeCenterService } = require('../episodes/episodeCenterService.js');

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
 * V2.1 单集制作包导入引擎（episode-package@2.1 唯一协议）。
 * - 只允许"创建新剧集"或"填充空白剧集"两种写入目标；非空剧集 TARGET_NOT_BLANK 且事务内重检；
 * - 只写结构化草稿：剧本 revision、场次、资产、分镜与时段；绝不创建图片/视频/音频任务；
 * - 幂等：同 source_sha256 + 目标的重复导入拒绝（PACKAGE_ALREADY_IMPORTED）。
 */
function createEpisodeImportV21(db, { log = console } = {}) {
  const episodeCenter = createEpisodeCenterService(db, { log });
  const { ensureStableAssetKeys } = require('../../services/externalAiTaskBundleService.js');

  function nextEpisodeNumber(dramaId) {
    return episodeCenter ? null : null; // placeholder (unused)
  }

  function targetNumberFor(dramaId) {
    const row = db
      .prepare('SELECT COALESCE(MAX(episode_number), 0) AS n FROM episodes WHERE drama_id = ? AND deleted_at IS NULL')
      .get(dramaId);
    return row.n + 1;
  }

  function buildImportPlan(db2, pkg, { dramaId, targetEpisodeId, sourceFilename = '', sourceSha256 = '' } = {}) {
    void db2;
    ensureStableAssetKeys(db, dramaId);
    const validation = validateFullV21(pkg);
    const errors = [...validation.errors];

    // 目标解析
    let target;
    if (targetEpisodeId) {
      const row = db
        .prepare('SELECT * FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL')
        .get(Number(targetEpisodeId), Number(dramaId));
      if (!row) throw httpError('NOT_FOUND', 404, '目标剧集不存在');
      const blank = episodeCenter.getBlankStatus(row.id);
      target = {
        mode: 'fill_blank',
        episodeId: row.id,
        episodeNumber: row.episode_number,
        blank: blank.blank,
        blankReasons: blank.reasons,
      };
      if (!blank.blank) {
        errors.push(httpPlainError('TARGET_NOT_BLANK', `目标第 ${row.episode_number} 集不是空白剧集，不能写入`));
      }
    } else {
      target = { mode: 'create_new', episodeId: null, episodeNumber: targetNumberFor(dramaId), blank: true, blankReasons: [] };
    }

    // 资产匹配（source_key 精确匹配 → 复用；否则新建）
    const matches = [];
    const matchGroup = (type, items, table) => {
      for (const item of items || []) {
        const existing = db
          .prepare(`SELECT id FROM ${table} WHERE drama_id = ? AND source_key = ? AND deleted_at IS NULL LIMIT 1`)
          .get(Number(dramaId), item.source_key);
        matches.push({
          type,
          sourceKey: item.source_key,
          name: item.name,
          action: existing ? 'reuse' : 'create',
          existingId: existing ? existing.id : null,
        });
      }
    };
    const characters = pkg.assets?.characters || [];
    const scenes = pkg.assets?.scene_assets || [];
    const props = pkg.assets?.props || [];
    matchGroup('character', characters, 'characters');
    for (const c of characters) {
      for (const s of c.states || []) {
        matches.push({ type: 'character_state', sourceKey: s.source_key, name: s.name, action: 'match-with-character', existingId: null });
      }
    }
    matchGroup('scene', scenes, 'scenes');
    matchGroup('prop', props, 'props');

    const shotCount = (pkg.shot_packages || []).length;
    const segmentCount = (pkg.shot_packages || []).reduce((sum, s) => sum + (s.timed_segments || []).length, 0);

    return {
      ok: errors.length === 0 && validation.ok,
      errors,
      target,
      source: { filename: sourceFilename, sha256: sourceSha256 },
      script: {
        title: pkg.episode?.title || '',
        summary: pkg.episode?.summary || '',
        scriptPreview: (pkg.episode?.script || '').slice(0, 200),
        sceneCount: (pkg.story_scenes || []).length,
        wordCount: (pkg.episode?.script || '').length,
      },
      assets: {
        matches,
        createCount: matches.filter((m) => m.action === 'create').length,
        reuseCount: matches.filter((m) => m.action === 'reuse').length,
      },
      shots: { count: shotCount, segmentCount },
      summary: {
        target: target.mode === 'create_new' ? `创建第 ${target.episodeNumber} 集` : `填充第 ${target.episodeNumber} 集`,
        creates: matches.filter((m) => m.action === 'create').length,
        reuses: matches.filter((m) => m.action === 'reuse').length,
        scenes: (pkg.story_scenes || []).length,
        shots: shotCount,
        segments: segmentCount,
        mediaTasks: 0,
        remoteCost: 0,
      },
    };
  }

  function httpPlainError(code, message) {
    return { code, path: 'target', message };
  }

  function requireFreshBlank(episodeId) {
    const blank = episodeCenter.getBlankStatus(episodeId);
    if (!blank.blank) {
      throw httpError('TARGET_NOT_BLANK', 409, '目标剧集不是空白剧集（提交前事务内重检失败）');
    }
  }

  function insertEpisodeRow(dramaId, pkg, target) {
    const number = target.mode === 'fill_blank' ? target.episodeNumber : targetNumberFor(dramaId);
    if (target.mode === 'fill_blank') {
      db.prepare('UPDATE episodes SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(
        pkg.episode.title,
        pkg.episode.summary,
        nowIso(),
        target.episodeId
      );
      return target.episodeId;
    }
    const info = db
      .prepare(
        `INSERT INTO episodes (drama_id, episode_number, title, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?)`
      )
      .run(dramaId, number, pkg.episode.title, pkg.episode.summary, nowIso(), nowIso());
    return Number(info.lastInsertRowid);
  }

  function insertScriptRevision(episodeId, pkg, sourceLabel) {
    const maxRev = db
      .prepare('SELECT COALESCE(MAX(revision), 0) AS n FROM episode_script_revisions WHERE episode_id = ?')
      .get(episodeId).n;
    db.prepare(
      `INSERT INTO episode_script_revisions (episode_id, revision, status, title, content, source, scene_count, word_count, created_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
    ).run(
      episodeId,
      maxRev + 1,
      pkg.episode.title,
      pkg.episode.script,
      sourceLabel,
      (pkg.story_scenes || []).length,
      (pkg.episode.script || '').length,
      nowIso()
    );
  }

  function insertStoryScenes(episodeId, pkg) {
    const sceneIdByKey = new Map();
    for (const scene of pkg.story_scenes || []) {
      const sceneRow = db
        .prepare('SELECT id FROM scenes WHERE drama_id = ? AND source_key = ? AND deleted_at IS NULL LIMIT 1')
        .get(Number(episodeIdToDrama(episodeId)), scene.location_scene_ref);
      const info = db
        .prepare(
          `INSERT INTO story_scenes (episode_id, scene_key, scene_number, heading, location, summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          episodeId,
          scene.source_key,
          scene.scene_number,
          scene.heading,
          sceneRow ? `场景资产#${sceneRow.id}` : scene.location_scene_ref,
          scene.summary,
          nowIso()
        );
      sceneIdByKey.set(scene.source_key, { rowId: Number(info.lastInsertRowid), sceneAssetId: sceneRow ? sceneRow.id : null });
    }
    return sceneIdByKey;
  }

  function episodeIdToDrama(episodeId) {
    return db.prepare('SELECT drama_id FROM episodes WHERE id = ?').get(episodeId).drama_id;
  }

  function ensureAssetRows(dramaId, episodeId, pkg, decisions) {
    const ids = { characters: new Map(), states: new Map(), scenes: new Map(), props: new Map() };
    const skip = (sourceKey) => decisions && decisions.ignoredSourceKeys?.includes(sourceKey);

    for (const character of pkg.assets.characters || []) {
      if (skip(character.source_key)) continue;
      let row = db
        .prepare('SELECT id FROM characters WHERE drama_id = ? AND source_key = ? AND deleted_at IS NULL LIMIT 1')
        .get(dramaId, character.source_key);
      if (!row) {
        const info = db
          .prepare(
            `INSERT INTO characters (drama_id, name, role, description, personality, appearance, polished_prompt, negative_prompt, voice_style, source_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            dramaId,
            character.name,
            character.role,
            character.description,
            character.personality,
            character.appearance,
            character.base_image_prompt || null,
            character.negative_prompt || null,
            character.voice_profile || null,
            character.source_key,
            nowIso(),
            nowIso()
          );
        row = { id: Number(info.lastInsertRowid) };
      }
      ids.characters.set(character.source_key, row.id);
      for (const state of character.states || []) {
        let variant = db
          .prepare('SELECT id FROM character_variants WHERE character_id = ? AND source_key = ?')
          .get(row.id, state.source_key);
        if (!variant) {
          const info = db
            .prepare(
              `INSERT INTO character_variants (character_id, source_key, name, description, appearance, image_prompt, negative_prompt, is_default, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              row.id,
              state.source_key,
              state.name,
              state.description,
              state.appearance,
              state.base_image_prompt || null,
              state.negative_prompt || null,
              state.is_default ? 1 : 0,
              nowIso(),
              nowIso()
            );
          variant = { id: Number(info.lastInsertRowid) };
        }
        ids.states.set(state.source_key, { characterId: row.id, variantId: variant.id });
      }
    }

    for (const scene of pkg.assets.scene_assets || []) {
      if (skip(scene.source_key)) continue;
      let row = db
        .prepare('SELECT id FROM scenes WHERE drama_id = ? AND source_key = ? AND deleted_at IS NULL LIMIT 1')
        .get(dramaId, scene.source_key);
      if (!row) {
        const info = db
          .prepare(
            `INSERT INTO scenes (drama_id, episode_id, location, state, description, prompt, atmosphere, negative_prompt, source_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            dramaId,
            episodeId,
            scene.name,
            scene.state,
            scene.description,
            scene.base_image_prompt || null,
            scene.atmosphere,
            scene.negative_prompt || null,
            scene.source_key,
            nowIso(),
            nowIso()
          );
        row = { id: Number(info.lastInsertRowid) };
      }
      ids.scenes.set(scene.source_key, row.id);
    }

    for (const prop of pkg.assets.props || []) {
      if (skip(prop.source_key)) continue;
      let row = db
        .prepare('SELECT id FROM props WHERE drama_id = ? AND source_key = ? AND deleted_at IS NULL LIMIT 1')
        .get(dramaId, prop.source_key);
      if (!row) {
        const info = db
          .prepare(
            `INSERT INTO props (drama_id, episode_id, name, type, description, prompt, negative_prompt, source_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            dramaId,
            episodeId,
            prop.name,
            prop.type,
            prop.description,
            prop.base_image_prompt || null,
            prop.negative_prompt || null,
            prop.source_key,
            nowIso(),
            nowIso()
          );
        row = { id: Number(info.lastInsertRowid) };
      }
      ids.props.set(prop.source_key, row.id);
    }
    return ids;
  }

  function insertStoryboards(episodeId, pkg, assetIds, sceneIdByKey) {
    const dramaId = episodeIdToDrama(episodeId);
    const baseNumber = db
      .prepare('SELECT COALESCE(MAX(storyboard_number), 0) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
      .get(episodeId).n;
    let index = 0;
    for (const shot of pkg.shot_packages || []) {
      index += 1;
      const firstSceneRef = shot.story_scene_refs?.[0];
      const sceneInfo = sceneIdByKey.get(firstSceneRef);
      const primaryCharacters = [];
      const info = db
        .prepare(
          `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, duration, action, image_prompt, characters, status, source_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
        )
        .run(
          episodeId,
          sceneInfo?.sceneAssetId || null,
          baseNumber + index,
          shot.story_intent,
          shot.visual ? `${shot.visual.shot_size} / ${shot.visual.camera_angle} / ${shot.visual.camera_movement}` : '',
          shot.planned_duration_seconds,
          (shot.timed_segments || []).map((s) => s.action).join('；'),
          '',
          JSON.stringify([]),
          shot.source_key ?? null,
          nowIso(),
          nowIso()
        );
      const storyboardId = Number(info.lastInsertRowid);

      // 提示词与外部内容补写：canonical 的 base_video_prompt 及转换器保留在 extensions 中的
      // 万能提示词/画面描述/声音设计/转场等，写入 storyboards 对应列（无则保持原值，零侵入）。
      const extensions = shot.extensions && typeof shot.extensions === 'object' ? shot.extensions : null;
      const updates = [];
      const params = [];
      const pushUpdate = (column, value) => {
        updates.push(`${column} = ?`);
        params.push(value);
      };
      if (shot.base_video_prompt) pushUpdate('video_prompt', shot.base_video_prompt);
      if (extensions) {
        if (extensions.image_prompt) pushUpdate('image_prompt', extensions.image_prompt);
        if (extensions.universal_segment_text) pushUpdate('universal_segment_text', extensions.universal_segment_text);
        if (extensions.description) pushUpdate('description', extensions.description);
        if (extensions.shot_type) pushUpdate('shot_type', extensions.shot_type);
        if (extensions.audio_description) pushUpdate('audio_description', JSON.stringify(extensions.audio_description));
        if (extensions.transition && extensions.transition.type) pushUpdate('transition', extensions.transition.type);
        pushUpdate('is_primary', extensions.is_primary ? 1 : 0);
      }
      const dialogueText = (shot.timed_segments || [])
        .flatMap((segment) => segment.dialogue || [])
        .map((line) => `${line.speaker_ref ? line.speaker_ref + '：' : ''}${line.text}`)
        .join('\n');
      if (dialogueText) pushUpdate('dialogue', dialogueText);
      const narrationText = (shot.audio?.narration || []).join('\n');
      if (narrationText) pushUpdate('narration', narrationText);
      if (updates.length > 0) {
        db.prepare(`UPDATE storyboards SET ${updates.join(', ')} WHERE id = ?`).run(...params, storyboardId);
      }

      // 时段
      let seq = 0;
      for (const segment of shot.timed_segments || []) {
        seq += 1;
        db.prepare(
          `INSERT INTO storyboard_segments (storyboard_id, seq, start_seconds, end_seconds, visual, dialogue, sound, asset_refs_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          storyboardId,
          seq,
          segment.start_seconds,
          segment.end_seconds,
          segment.action,
          (segment.dialogue || []).map((d) => `${d.speaker_ref ? d.speaker_ref + '：' : ''}${d.text}`).join('\n'),
          (shot.audio?.ambience || []).concat(shot.audio?.sound_effects || []).join('；'),
          JSON.stringify({
            sceneRefs: segment.scene_asset_refs || [],
            characterRefs: segment.character_state_refs || [],
            propRefs: segment.prop_refs || [],
          }),
          nowIso(),
          nowIso()
        );
      }

      // 人物状态绑定（reference_role=primary，按出现顺序）
      let sortOrder = 0;
      const linkedVariants = new Set();
      for (const segment of shot.timed_segments || []) {
        for (const ref of segment.character_state_refs || []) {
          const state = assetIds.states.get(ref);
          if (!state || linkedVariants.has(state.variantId)) continue;
          linkedVariants.add(state.variantId);
          sortOrder += 1;
          db.prepare(
            `INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order)
             VALUES (?, ?, ?, 'primary', ?)`
          ).run(storyboardId, state.characterId, state.variantId, sortOrder);
          if (!primaryCharacters.includes(state.characterId)) primaryCharacters.push(state.characterId);
        }
      }
      // 人物 JSON 列（旧读取方兼容视图数据）
      if (primaryCharacters.length > 0) {
        db.prepare('UPDATE storyboards SET characters = ? WHERE id = ?').run(
          JSON.stringify(primaryCharacters),
          storyboardId
        );
      }
      // 道具绑定
      const propIds = new Set();
      for (const segment of shot.timed_segments || []) {
        for (const ref of segment.prop_refs || []) {
          const propId = assetIds.props.get(ref);
          if (propId) propIds.add(propId);
        }
      }
      for (const propId of propIds) {
        db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)').run(storyboardId, propId);
      }
      void dramaId;
    }
  }

  function confirmImport(db2, { pkg, dramaId, targetEpisodeId, sourceFilename = '', sourceSha256 = '', decisions = null, taskPackageId = null, sourceLabel = 'episode-package@2.1', reportExtra = null } = {}) {
    void db2;
    const validation = validateFullV21(pkg);
    if (!validation.ok) {
      const first = validation.errors.slice(0, 5).map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
      throw httpError('PACKAGE_INVALID', 400, `制作包校验失败：${first}`);
    }
    // 幂等：同 source hash 已成功导入 → 拒绝
    if (sourceSha256) {
      const existing = db
        .prepare('SELECT id FROM episode_imports WHERE source_sha256 = ? LIMIT 1')
        .get(sourceSha256);
      if (existing) {
        throw httpError('PACKAGE_ALREADY_IMPORTED', 409, '该结果文件已成功导入过，不能重复使用');
      }
    }
    const drama = db
      .prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL')
      .get(Number(dramaId));
    if (!drama) throw httpError('NOT_FOUND', 404, '项目不存在');

    let target;
    if (targetEpisodeId) {
      const row = db
        .prepare('SELECT * FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL')
        .get(Number(targetEpisodeId), Number(dramaId));
      if (!row) throw httpError('NOT_FOUND', 404, '目标剧集不存在');
      target = { mode: 'fill_blank', episodeId: row.id, episodeNumber: row.episode_number };
    } else {
      target = { mode: 'create_new', episodeId: null, episodeNumber: targetNumberFor(dramaId) };
    }

    const tx = db.transaction(() => {
      // 事务内重检目标（防 TOCTOU）
      if (target.mode === 'fill_blank') requireFreshBlank(target.episodeId);
      else {
        const occupied = db
          .prepare('SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL')
          .get(dramaId, target.episodeNumber);
        if (occupied) throw httpError('TARGET_NOT_BLANK', 409, `第 ${target.episodeNumber} 集已存在`);
      }

      const episodeId = insertEpisodeRow(dramaId, pkg, target);
      insertScriptRevision(episodeId, pkg, sourceLabel);
      const sceneIdByKey = insertStoryScenes(episodeId, pkg);
      const assetIds = ensureAssetRows(dramaId, episodeId, pkg, decisions);
      insertStoryboards(episodeId, pkg, assetIds, sceneIdByKey);

      // 审计记录（不可变）
      const report = {
        scenes: (pkg.story_scenes || []).length,
        shots: (pkg.shot_packages || []).length,
        segments: (pkg.shot_packages || []).reduce((s, x) => s + (x.timed_segments || []).length, 0),
        mediaTasks: 0,
        ...(reportExtra && typeof reportExtra === 'object' ? reportExtra : {}),
      };
      db.prepare(
        `INSERT INTO episode_imports (episode_id, schema_name, schema_version, source_filename, source_sha256, raw_json, normalized_json, match_decisions, imported_at, import_report, task_package_id)
         VALUES (?, ?, '2.1', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        episodeId,
        pkg.schema,
        sourceFilename || null,
        sourceSha256 || null,
        JSON.stringify(pkg),
        JSON.stringify(pkg),
        JSON.stringify(decisions || {}),
        nowIso(),
        JSON.stringify(report),
        taskPackageId
      );
      return { episodeId, report };
    });

    const result = tx();
    log.info?.('V2.1 制作包导入完成', { episodeId: result.episodeId });
    return {
      episodeId: result.episodeId,
      report: result.report,
      writesApprovedScript: false,
      createsMediaTasks: false,
    };
  }

  return { buildImportPlan, confirmImport };
}

module.exports = { createEpisodeImportV21 };
