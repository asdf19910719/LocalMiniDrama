'use strict';
/**
 * C4 Shot Package 导出服务：按 shot-package-v2.1.schema.json 组装每镜头的
 * 结构化包（结构/时段/引用/风格/音频），供「导出 Shot Package JSON」使用。
 * 单镜头包为 schema 合同文档；本服务返回 {schema, version, episode_id, shots:[...]} 集合文档，
 * 其中 shots 数组内每一项逐条满足单镜头 schema。
 */
const crypto = require('node:crypto');

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function createShotPackageService({ db, log = console } = {}) {
  /** 解析台词文本为 speechEvent 列表（"角色：台词" 每行一条） */
  function parseDialogue(seg) {
    const text = String(seg.dialogue || '').trim();
    if (!text) return [];
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        start_seconds: Number(seg.start_seconds),
        end_seconds: Number(seg.end_seconds),
        text: line,
      }));
  }

  function firstOrDefault(value, fallback) {
    const text = String(value || '').trim();
    return text || fallback;
  }

  function buildShotPackage(shot) {
    const segments = db
      .prepare('SELECT * FROM storyboard_segments WHERE storyboard_id = ? ORDER BY seq')
      .all(shot.id);
    const variantRefs = db
      .prepare(
        `SELECT scv.character_id AS characterId, scv.variant_id AS variantId, c.name
         FROM storyboard_character_variants scv LEFT JOIN characters c ON c.id = scv.character_id
         WHERE scv.storyboard_id = ? ORDER BY scv.sort_order, scv.id`
      )
      .all(shot.id);
    const propRefs = db
      .prepare(
        `SELECT sp.prop_id AS propId FROM storyboard_props sp WHERE sp.storyboard_id = ? ORDER BY sp.rowid`
      )
      .all(shot.id);

    const episode = db.prepare('SELECT drama_id FROM episodes WHERE id = ?').get(shot.episode_id);
    const style = db.prepare('SELECT style_id FROM dramas WHERE id = ?').get(episode.drama_id);
    const styleId = (style && style.style_id) || 'none';

    // story_scenes：按场次顺序与镜头位置配对（createFromScript 即按场次顺序生成）
    const storyScenes = db
      .prepare('SELECT id FROM story_scenes WHERE episode_id = ? ORDER BY scene_number')
      .all(shot.episode_id);
    const position = Math.max(0, Number(shot.storyboard_number) - 1);
    const storySceneId = storyScenes.length
      ? storyScenes[Math.min(position, storyScenes.length - 1)].id
      : `ep${shot.episode_id}`;

    const references = [
      { role: 'scene_view', asset_version_id: storySceneId, required: true, note: '场景视图引用' },
      ...variantRefs.map((r) => ({
        role: 'character_state',
        asset_version_id: r.variantId || r.characterId,
        required: true,
        note: r.name || '角色状态引用',
      })),
      ...propRefs.map((r) => ({
        role: 'prop',
        asset_version_id: r.propId,
        required: false,
        note: '道具引用',
      })),
    ];

    const timedSegments = segments.map((seg, index) => ({
      id: seg.id,
      start_seconds: Number(seg.start_seconds),
      end_seconds: Number(seg.end_seconds),
      action: firstOrDefault(seg.visual, `${shot.title || '镜头'} · 第 ${index + 1} 段`),
      camera: index === 0 ? firstOrDefault(shot.movement, 'static') : 'cut',
      dialogue: parseDialogue(seg),
      scene_asset_version_ids: [storySceneId],
      character_state_version_ids: variantRefs.map((r) => r.variantId || r.characterId),
      prop_version_ids: propRefs.map((r) => r.propId),
    }));
    if (timedSegments.length === 0) {
      timedSegments.push({
        id: `${shot.id}-seg-1`,
        start_seconds: 0,
        end_seconds: Math.max(0.5, Number(shot.duration) || 6),
        action: firstOrDefault(shot.action || shot.description, shot.title || `镜头 ${shot.storyboard_number}`),
        camera: 'static',
        dialogue: [],
        scene_asset_version_ids: [storySceneId],
        character_state_version_ids: [],
        prop_version_ids: [],
      });
    }

    const dialogue = timedSegments.flatMap((seg) => seg.dialogue);

    return {
      schema: 'local-mini-drama.shot-package',
      version: '2.1',
      shot_id: shot.id,
      revision: Number(shot.structure_revision) || 1,
      story_scene_ids: [storySceneId],
      planned_duration_seconds: Math.max(0.5, Number(shot.duration) || 6),
      request_duration_seconds: null,
      story_intent: firstOrDefault(shot.description || shot.action, shot.title || `镜头 ${shot.storyboard_number}`),
      visual: {
        shot_size: firstOrDefault(shot.shot_type, 'medium'),
        camera_angle: firstOrDefault(shot.angle_s, 'eye-level'),
        camera_movement: firstOrDefault(shot.movement, 'static'),
        composition: firstOrDefault(shot.layout_description, 'balanced'),
        lighting: firstOrDefault(shot.lighting_style, 'natural'),
      },
      timed_segments: timedSegments,
      continuity: { entry: {}, exit: {}, axis: null },
      look_ref: {
        version_id: `style:${styleId}`,
        fingerprint: sha256Text(`style:${styleId}`),
      },
      references,
      audio: {
        dialogue,
        narration: [],
        ambience: [],
        sound_effects: [],
        music_intent: firstOrDefault(shot.atmosphere, null) || null,
      },
      extensions: {
        'v21.localminidrama': {
          title: shot.title || '',
          storyboard_number: shot.storyboard_number,
          image_url: shot.image_url || null,
        },
      },
    };
  }

  function buildEpisodePackage(episodeId) {
    const shots = db
      .prepare('SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number')
      .all(Number(episodeId));
    return {
      schema: 'local-mini-drama.shot-package',
      version: '2.1',
      episode_id: Number(episodeId),
      generated_at: new Date().toISOString(),
      shots: shots.map(buildShotPackage),
    };
  }

  log.info && log.info('V2.1 Shot Package 服务就绪');
  return { buildEpisodePackage, buildShotPackage };
}

module.exports = { createShotPackageService };
