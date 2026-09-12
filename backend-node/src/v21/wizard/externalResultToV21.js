'use strict';

const { validateExternalAiResult } = require('../../services/externalAiResultContract');
const { packagePrefix, keyPart, normalizeUniversalSegmentText } = require('../../services/externalAiResultAdapter');
const { SCHEMA_NAME, SCHEMA_VERSION, validateFullV21 } = require('../import/packageContractV21.js');

function contractError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  if (details) err.details = details;
  return err;
}

function nonEmpty(value, fallback = '未填写') {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : fallback;
}

function strOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * 纯引用完整性检查（不分配 key、不触库）：storyboards 的 scene_ref / character_refs / prop_refs
 * 必须指向任务包冻结清单中的既有 source_key，或本结果 new_assets 声明的 local_ref；
 * character_variants 只允许为既有人物追加状态。向导的 validateResult 校验清单复用本函数。
 */
function collectReferenceErrors(result, manifest) {
  const errors = [];
  const assets = result.new_assets || {};
  const manifestCharacters = manifest.characters || [];

  const variantsByChar = new Map();
  const ensureSet = (key) => {
    let set = variantsByChar.get(key);
    if (!set) {
      set = new Set();
      variantsByChar.set(key, set);
    }
    return set;
  };
  for (const character of assets.characters || []) {
    const set = ensureSet(character.local_ref);
    for (const variant of character.variants || []) set.add(variant.local_ref);
  }
  for (const item of assets.character_variants || []) ensureSet(item.character_ref).add(item.local_ref);
  for (const character of manifestCharacters) {
    const set = ensureSet(character.source_key);
    for (const variant of character.variants || []) set.add(variant.source_key);
  }

  const newCharacters = new Set((assets.characters || []).map((c) => c.local_ref));
  const newScenes = new Set((assets.scenes || []).map((s) => s.local_ref));
  const newProps = new Set((assets.props || []).map((p) => p.local_ref));
  const existingCharacters = new Set(manifestCharacters.map((c) => c.source_key));
  const existingScenes = new Set((manifest.scenes || []).map((s) => s.source_key));
  const existingProps = new Set((manifest.props || []).map((p) => p.source_key));

  for (const item of assets.character_variants || []) {
    if (newCharacters.has(item.character_ref)) {
      errors.push(`新人物 "${item.character_ref}" 的状态必须放在该人物的 variants 内（character_variants 仅用于既有人物）：${item.local_ref}`);
    } else if (!existingCharacters.has(item.character_ref)) {
      errors.push(`character_variants "${item.local_ref}" 引用的人物 "${item.character_ref}" 不在该任务的项目资产中`);
    }
  }

  for (const sb of result.storyboards || []) {
    if (!newScenes.has(sb.scene_ref) && !existingScenes.has(sb.scene_ref)) {
      errors.push(`分镜 "${sb.local_ref}" 的场景引用 "${sb.scene_ref}" 不存在（既有人物/场景/道具只能引用 source_key）`);
    }
    for (const ref of sb.character_refs || []) {
      const isNew = newCharacters.has(ref.character_ref);
      if (!isNew && !existingCharacters.has(ref.character_ref)) {
        errors.push(`分镜 "${sb.local_ref}" 引用的人物 "${ref.character_ref}" 不在该任务的项目资产中，也未在 new_assets 中声明`);
        continue;
      }
      if (!variantsByChar.get(ref.character_ref)?.has(ref.variant_ref)) {
        errors.push(`分镜 "${sb.local_ref}" 的人物状态 "${ref.variant_ref}" 不属于人物 "${ref.character_ref}"`);
      }
    }
    for (const ref of sb.prop_refs || []) {
      if (!newProps.has(ref) && !existingProps.has(ref)) {
        errors.push(`分镜 "${sb.local_ref}" 引用的道具 "${ref}" 不存在`);
      }
    }
  }
  return errors;
}

/**
 * external-ai-result@2（任务包返回格式：storyboards/local_ref）→ episode-package@2.1 规范包。
 * 确定性转换：单时段时码闭合（[0, duration_seconds]）、台词均匀分片、既有资产按冻结 source_key
 * 展开、新资产分配 ai_<任务短码>_ 前缀 key；分镜按 scene_ref 首次出现聚合为场次；
 * 外部专有内容（万能提示词、转场、声音设计、is_primary 等）保留在 shot.extensions 供导入引擎落库。
 */
function convertExternalResultToV21(result, task) {
  const validation = validateExternalAiResult(result);
  if (!validation.ok) {
    const first = validation.errors.slice(0, 8).map((e) => `${e.path || '(root)'}: ${e.message}`).join('；');
    throw contractError('PACKAGE_INVALID', `外部 AI 结果不符合任务包返回格式（${validation.errors.length} 个错误）：${first}`, validation.errors);
  }

  const manifest = task.manifest || {};
  const referenceErrors = collectReferenceErrors(result, manifest);
  if (referenceErrors.length > 0) {
    throw contractError(
      'PACKAGE_REFERENCE_INVALID',
      `结果引用无法解析（${referenceErrors.length} 处）：${referenceErrors.slice(0, 5).join('；')}`,
      referenceErrors
    );
  }

  const assets = result.new_assets || {};
  const prefix = packagePrefix(task.packageId);
  const usedKeys = new Set();
  for (const group of ['characters', 'scenes', 'props']) {
    for (const item of manifest[group] || []) usedKeys.add(item.source_key);
    for (const item of manifest[group] || []) {
      if (group === 'characters') {
        for (const variant of item.variants || []) usedKeys.add(variant.source_key);
      }
    }
  }

  const localToKey = new Map();
  const allocKey = (localRef) => {
    let key = `${prefix}_${keyPart(localRef)}`;
    while (usedKeys.has(key)) key = `${key}_x`;
    usedKeys.add(key);
    localToKey.set(localRef, key);
    return key;
  };
  const resolve = (ref) => localToKey.get(ref) || ref;

  // ---- 资产：既有清单展开（复用冻结 source_key）----
  const characters = (manifest.characters || []).map((c) => {
    const states = (c.variants || []).map((v) => ({
      source_key: v.source_key,
      name: nonEmpty(v.name),
      description: nonEmpty(v.description),
      appearance: nonEmpty(v.appearance),
      base_image_prompt: strOrEmpty(v.base_image_prompt),
      negative_prompt: strOrEmpty(v.negative_prompt),
      is_default: Boolean(v.is_default),
    }));
    return {
      source_key: c.source_key,
      name: nonEmpty(c.name),
      role: ['main', 'supporting', 'minor'].includes(c.role) ? c.role : 'minor',
      description: nonEmpty(c.description),
      personality: nonEmpty(c.personality),
      appearance: nonEmpty(c.appearance),
      base_image_prompt: strOrEmpty(c.base_image_prompt),
      negative_prompt: strOrEmpty(c.negative_prompt),
      voice_profile: c.voice_profile ? String(c.voice_profile) : null,
      states,
    };
  });
  const sceneAssets = (manifest.scenes || []).map((s) => ({
    source_key: s.source_key,
    name: nonEmpty(s.name),
    state: nonEmpty(s.state),
    description: nonEmpty(s.description),
    atmosphere: nonEmpty(s.atmosphere),
    base_image_prompt: strOrEmpty(s.base_image_prompt),
    negative_prompt: strOrEmpty(s.negative_prompt),
  }));
  const props = (manifest.props || []).map((p) => ({
    source_key: p.source_key,
    name: nonEmpty(p.name),
    type: nonEmpty(p.type),
    description: nonEmpty(p.description),
    base_image_prompt: strOrEmpty(p.base_image_prompt),
    negative_prompt: strOrEmpty(p.negative_prompt),
  }));

  // ---- 新资产 ----
  const newVariantOwners = new Map();
  for (const nc of assets.characters || []) {
    const states = (nc.variants || []).map((v) => {
      newVariantOwners.set(v.local_ref, nc.local_ref);
      return {
        source_key: allocKey(v.local_ref),
        name: v.name,
        description: v.description,
        appearance: v.appearance,
        base_image_prompt: v.base_image_prompt,
        negative_prompt: v.negative_prompt,
        is_default: Boolean(v.is_default),
      };
    });
    characters.push({
      source_key: allocKey(nc.local_ref),
      name: nc.name,
      role: nc.role,
      description: nc.description,
      personality: nc.personality,
      appearance: nc.appearance,
      base_image_prompt: nc.base_image_prompt,
      negative_prompt: nc.negative_prompt,
      voice_profile: nc.voice_profile,
      states,
    });
  }
  // 既有人物追加状态（引用检查已确保 owner 为既有人物）
  const ownerBySourceKey = new Map(characters.map((c) => [c.source_key, c]));
  for (const item of assets.character_variants || []) {
    const owner = ownerBySourceKey.get(item.character_ref);
    if (!owner) continue; // 引用错误已在上方统一抛出
    owner.states.push({
      source_key: allocKey(item.local_ref),
      name: item.name,
      description: item.description,
      appearance: item.appearance,
      base_image_prompt: item.base_image_prompt,
      negative_prompt: item.negative_prompt,
      is_default: Boolean(item.is_default),
    });
  }
  // 既有角色没有任何状态时合成默认状态（canonical 要求 states ≥ 1）
  for (const character of characters) {
    if (character.states.length === 0) {
      character.states.push({
        source_key: `${character.source_key}_default_state`,
        name: '默认',
        description: character.description,
        appearance: character.appearance,
        base_image_prompt: character.base_image_prompt,
        negative_prompt: '',
        is_default: true,
      });
    }
  }
  for (const scene of assets.scenes || []) {
    sceneAssets.push({
      source_key: allocKey(scene.local_ref),
      name: scene.name,
      state: scene.state,
      description: scene.description,
      atmosphere: scene.atmosphere,
      base_image_prompt: scene.base_image_prompt,
      negative_prompt: scene.negative_prompt,
    });
  }
  for (const prop of assets.props || []) {
    props.push({
      source_key: allocKey(prop.local_ref),
      name: prop.name,
      type: prop.type,
      description: prop.description,
      base_image_prompt: prop.base_image_prompt,
      negative_prompt: prop.negative_prompt,
    });
  }

  const sceneIndex = new Map(sceneAssets.map((s) => [s.source_key, s]));
  const propIndex = new Map(props.map((p) => [p.source_key, p]));
  const speakerIndex = new Map();
  for (const character of characters) {
    if (!speakerIndex.has(character.name)) speakerIndex.set(character.name, character.source_key);
  }

  // 万能提示词语义 token（@场景/@人物/@道具/资产名）→ 规范槽位 @图片N 的兜底归一
  const aliases = { scenes: {}, characters: {}, props: {} };
  for (const scene of assets.scenes || []) aliases.scenes[scene.name] = scene.local_ref;
  for (const scene of manifest.scenes || []) aliases.scenes[scene.name] = scene.source_key;
  for (const character of assets.characters || []) {
    aliases.characters[character.name] = { character_ref: character.local_ref };
    for (const variant of character.variants || []) {
      aliases.characters[variant.name] = { character_ref: character.local_ref, variant_ref: variant.local_ref };
    }
  }
  for (const character of manifest.characters || []) {
    aliases.characters[character.name] = { character_ref: character.source_key };
    for (const variant of character.variants || []) {
      aliases.characters[variant.name] = { character_ref: character.source_key, variant_ref: variant.source_key };
    }
  }
  for (const prop of assets.props || []) aliases.props[prop.name] = prop.local_ref;
  for (const prop of manifest.props || []) aliases.props[prop.name] = prop.source_key;

  // ---- 分镜 → 场次聚合 + 分镜包 ----
  const storyScenes = [];
  const sceneGroupBySceneKey = new Map();
  const shotPackages = [];
  const dedupe = (values) => [...new Set(values)];

  for (const sb of result.storyboards) {
    const sceneKey = resolve(sb.scene_ref);
    const sceneAsset = sceneIndex.get(sceneKey);
    const resolvedCharRefs = sb.character_refs.map((ref) => ({
      character_ref: resolve(ref.character_ref),
      variant_ref: resolve(ref.variant_ref),
      reference_role: ref.reference_role,
      sort_order: ref.sort_order,
      framing_note: ref.framing_note,
    }));
    const resolvedProps = sb.prop_refs.map(resolve);

    let group = sceneGroupBySceneKey.get(sceneKey);
    if (!group) {
      group = {
        source_key: (() => {
          let key = `${prefix}_story_scene_${storyScenes.length + 1}`;
          while (usedKeys.has(key)) key = `${key}_x`;
          usedKeys.add(key);
          return key;
        })(),
        scene_number: storyScenes.length + 1,
        heading: `${sceneAsset.name} · ${sceneAsset.state}`,
        location_scene_ref: sceneKey,
        summary: sb.description,
      };
      sceneGroupBySceneKey.set(sceneKey, group);
      storyScenes.push(group);
    }

    const duration = sb.duration_seconds;
    const lineCount = sb.dialogue.length;
    const dialogue = sb.dialogue.map((line, index) => {
      const speech = {
        start_seconds: (index * duration) / lineCount,
        end_seconds: ((index + 1) * duration) / lineCount,
        text: line.line,
      };
      const speakerKey = speakerIndex.get(line.speaker);
      if (speakerKey) speech.speaker_ref = speakerKey;
      speech.performance = line.performance;
      return speech;
    });

    shotPackages.push({
      source_key: allocKey(sb.local_ref),
      shot_number: sb.storyboard_number,
      story_scene_refs: [group.source_key],
      planned_duration_seconds: duration,
      story_intent: sb.title,
      base_video_prompt: sb.base_video_prompt,
      visual: {
        shot_size: sb.shot_type,
        camera_angle: sb.camera_angle,
        camera_movement: sb.camera_movement,
        composition: sb.composition,
        lighting: sceneAsset.atmosphere === '未填写' ? '未指定' : sceneAsset.atmosphere,
      },
      timed_segments: [
        {
          start_seconds: 0,
          end_seconds: duration,
          action: `${sb.action.start}；${sb.action.progression}；${sb.action.end}`,
          ...(dialogue.length > 0 ? { dialogue } : {}),
          scene_asset_refs: [sceneKey],
          character_state_refs: dedupe(resolvedCharRefs.map((ref) => ref.variant_ref)),
          prop_refs: dedupe(resolvedProps),
        },
      ],
      continuity: {
        entry: {},
        exit: {
          type: sb.transition.type,
          duration: sb.transition.duration,
          visual_description: sb.transition.visual_description,
          audio_bridge: sb.transition.audio_bridge,
        },
      },
      audio: {
        dialogue: [],
        narration: sb.narration ? [sb.narration] : [],
        ambience: sb.audio_description.ambience,
        sound_effects: sb.audio_description.sound_effects,
        music_intent: sb.audio_description.silence
          ? { mode: 'mute' }
          : { ...sb.audio_description.music_cue },
      },
      extensions: {
        universal_segment_text: normalizeUniversalSegmentText(sb.universal_segment_text, sb, aliases),
        image_prompt: sb.base_image_prompt,
        description: sb.description,
        shot_type: sb.shot_type,
        camera_angle: sb.camera_angle,
        camera_movement: sb.camera_movement,
        transition: sb.transition,
        audio_description: sb.audio_description,
        dialogue_lines: sb.dialogue,
        notes: sb.notes || '',
        is_primary: Boolean(sb.is_primary),
      },
    });
  }

  // 音频计划：外部结构（bgm/mastering/speech）→ canonical 三字段
  let audioPlan;
  if (result.audio_plan) {
    audioPlan = {
      bgm_mode: result.audio_plan.bgm?.mode || 'none',
      dialogue_owner_default: result.audio_plan.speech?.dialogue_owner || 'h3_native',
      narration_owner_default: result.audio_plan.speech?.narration_owner || 'post_tts',
    };
  }

  const pkg = {
    schema: SCHEMA_NAME,
    version: SCHEMA_VERSION,
    episode: result.episode,
    assets: { characters, scene_assets: sceneAssets, props },
    story_scenes: storyScenes,
    shot_packages: shotPackages,
  };
  if (audioPlan) pkg.audio_plan = audioPlan;

  const canonicalValidation = validateFullV21(pkg);
  if (!canonicalValidation.ok) {
    const first = canonicalValidation.errors.slice(0, 5).map((e) => `${e.path || '(root)'}: ${e.message}`).join('；');
    throw contractError('PACKAGE_INVALID', `转换后的制作包校验失败：${first}`, canonicalValidation.errors);
  }

  const digestAbsent = result.assets_digest === undefined || result.assets_digest === null;
  const assetDigestStatus = digestAbsent ? 'missing' : result.assets_digest === task.assetsDigest ? 'current' : 'changed';
  const warnings = [];
  if (assetDigestStatus === 'missing') {
    warnings.push({
      code: 'PACKAGE_ASSETS_DIGEST_MISSING',
      path: 'assets_digest',
      message: '结果未携带 assets_digest 回执；导入按任务包冻结快照解析全部既有引用，不会覆盖已有资产。',
    });
  } else if (assetDigestStatus === 'changed') {
    warnings.push({
      code: 'PACKAGE_ASSETS_CHANGED',
      path: 'assets_digest',
      message: '结果携带的 assets_digest 与任务包冻结值不一致（建包后素材已变化或回执被改动）；已按冻结快照重新校验引用，导入不会覆盖已有资产。',
    });
  }

  return { package: pkg, warnings, assetDigestStatus };
}

module.exports = { convertExternalResultToV21, collectReferenceErrors };
