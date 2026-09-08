'use strict';

const { validateExternalAiResult } = require('./externalAiResultContract');
const { getCurrentAssetState } = require('./externalAiTaskBundleService');

function adapterError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function packagePrefix(packageId) {
  const compact = clean(packageId)
    .replace(/^extai_/i, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .slice(0, 12)
    .toLowerCase();
  return `ai_${compact || 'task'}`;
}

function keyPart(value) {
  return clean(value)
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^new_/, '')
    .slice(0, 64) || 'asset';
}

function getColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function activeClause(columns) {
  return columns.has('deleted_at') ? ' AND deleted_at IS NULL' : '';
}

function loadExisting(db, table, id, dramaId, label, sourceKey) {
  const columns = getColumns(db, table);
  const row = db.prepare(
    `SELECT * FROM ${table} WHERE id = ? AND drama_id = ?${activeClause(columns)}`
  ).get(Number(id), Number(dramaId));
  if (!row) {
    throw adapterError('PACKAGE_REFERENCE_INVALID', `${label}引用 "${sourceKey}" 已删除、已移动或不属于当前项目`);
  }
  return row;
}

function loadExistingVariant(db, snapshotEntry, dramaId, variantKey) {
  const columns = getColumns(db, 'character_variants');
  const row = db.prepare(`
    SELECT cv.*, c.drama_id, c.source_key AS character_source_key
    FROM character_variants cv
    INNER JOIN characters c ON c.id = cv.character_id
    WHERE cv.id = ? AND c.drama_id = ?${columns.has('deleted_at') ? ' AND cv.deleted_at IS NULL' : ''}
  `).get(Number(snapshotEntry.id), Number(dramaId));
  if (!row) {
    throw adapterError('PACKAGE_REFERENCE_INVALID', `人物状态引用 "${variantKey}" 已删除、已移动或不属于当前项目`);
  }
  return row;
}

function existingCharacterToPackage(db, row) {
  const columns = getColumns(db, 'character_variants');
  const variants = db.prepare(
    `SELECT * FROM character_variants WHERE character_id = ?${activeClause(columns)} ORDER BY is_default DESC, id ASC`
  ).all(row.id).map((variant) => ({
    source_key: variant.source_key,
    name: variant.name,
    description: variant.description || '',
    appearance: variant.appearance || '',
    image_prompt: variant.image_prompt || '',
    negative_prompt: variant.negative_prompt || '',
    is_default: Number(variant.is_default) === 1,
  }));
  return {
    source_key: row.source_key,
    name: row.name,
    role: row.role || 'minor',
    description: row.description || '',
    personality: row.personality || '',
    appearance: row.appearance || '',
    image_prompt: row.polished_prompt || '',
    negative_prompt: row.negative_prompt || '',
    voice_profile: row.voice_style || '',
    variants,
  };
}

function existingSceneToPackage(row) {
  return {
    source_key: row.source_key,
    name: row.location,
    state: row.state || row.time || '',
    description: row.description || '',
    atmosphere: row.atmosphere || '',
    image_prompt: row.prompt || '',
    negative_prompt: row.negative_prompt || '',
  };
}

function existingPropToPackage(row) {
  return {
    source_key: row.source_key,
    name: row.name,
    type: row.type || '',
    description: row.description || '',
    image_prompt: row.prompt || '',
    negative_prompt: row.negative_prompt || '',
  };
}

function defaultAudioPlan() {
  return {
    version: 1,
    bgm: {
      mode: 'none',
      planning: 'external',
      source_type: 'none',
      prompt: null,
      continuity_key: null,
      local_path: null,
      volume_db: -22,
      ducking_db: -8,
      fade_in_ms: 0,
      fade_out_ms: 0,
      crossfade_ms: 0,
    },
    mastering: { target_lufs: -14, true_peak_db: -1 },
    speech: { dialogue_owner: 'h3_native', narration_owner: 'post_tts' },
  };
}

/**
 * 外部 AI 常把万能提示词中的参考图写成可读的语义 token（@场景/@人物/@道具），
 * 而项目内部和视频提交统一使用按槽位编号的 @图片N。导入时按同一套槽位顺序
 * 做确定性转换，避免预览误报“未引用槽位”，也避免语义 token 在 H3 提交时失效。
 */
function normalizeUniversalSegmentText(text, storyboard, aliases = {}) {
  if (typeof text !== 'string' || !text.trim() || !storyboard || typeof storyboard !== 'object') return text;

  const slots = [];
  if (clean(storyboard.scene_ref)) slots.push({ type: 'scene', ref: clean(storyboard.scene_ref), index: slots.length + 1 });
  const characterRefs = Array.isArray(storyboard.character_refs) ? storyboard.character_refs : [];
  characterRefs
    .map((ref, originalIndex) => ({ ref, originalIndex }))
    .filter(({ ref }) => ref && typeof ref === 'object' && !Array.isArray(ref))
    .sort((a, b) => {
      const left = Number.isFinite(a.ref.sort_order) ? a.ref.sort_order : Number.POSITIVE_INFINITY;
      const right = Number.isFinite(b.ref.sort_order) ? b.ref.sort_order : Number.POSITIVE_INFINITY;
      return left - right || a.originalIndex - b.originalIndex;
    })
    .forEach(({ ref }) => slots.push({
      type: 'character',
      ref: clean(ref.character_ref),
      variant: clean(ref.variant_ref),
      index: slots.length + 1,
    }));
  for (const ref of Array.isArray(storyboard.prop_refs) ? storyboard.prop_refs : []) {
    slots.push({ type: 'prop', ref: clean(ref), index: slots.length + 1 });
  }

  const scene = slots.find((slot) => slot.type === 'scene');
  const chars = slots.filter((slot) => slot.type === 'character');
  const props = slots.filter((slot) => slot.type === 'prop');
  const slotFor = (type, ref, variant) => {
    const normalizedRef = clean(ref);
    if (!normalizedRef) return null;
    if (type === 'scene') return scene && (!normalizedRef || scene.ref === normalizedRef) ? scene : null;
    if (type === 'prop') return props.find((slot) => slot.ref === normalizedRef) || null;
    return chars.find((slot) => slot.ref === normalizedRef && (!variant || slot.variant === clean(variant)))
      || chars.find((slot) => slot.ref === normalizedRef)
      || null;
  };

  let normalized = text;
  normalized = normalized.replace(/@场景(?:\s+([A-Za-z][A-Za-z0-9_.:-]*))?/g, (token, ref) => {
    const slot = slotFor('scene', ref) || scene;
    return slot ? `@图片${slot.index}` : token;
  });
  normalized = normalized.replace(/@人物(?:\s+([A-Za-z][A-Za-z0-9_.:-]*)(?:\/([A-Za-z][A-Za-z0-9_.:-]*))?)?/g, (token, ref, variant) => {
    const slot = slotFor('character', ref, variant) || chars[0];
    return slot ? `@图片${slot.index}` : token;
  });
  normalized = normalized.replace(/@道具(?:\s+([A-Za-z][A-Za-z0-9_.:-]*))?/g, (token, ref) => {
    const slot = slotFor('prop', ref);
    return slot ? `@图片${slot.index}` : token;
  });
  const aliasEntries = [];
  for (const [alias, ref] of Object.entries(aliases.scenes || {})) {
    const slot = slotFor('scene', ref);
    if (slot && clean(alias)) aliasEntries.push([clean(alias), slot.index]);
  }
  for (const [alias, ref] of Object.entries(aliases.characters || {})) {
    const slot = slotFor('character', ref.character_ref, ref.variant_ref);
    if (slot && clean(alias)) aliasEntries.push([clean(alias), slot.index]);
  }
  for (const [alias, ref] of Object.entries(aliases.props || {})) {
    const slot = slotFor('prop', ref);
    if (slot && clean(alias)) aliasEntries.push([clean(alias), slot.index]);
  }
  aliasEntries.sort((left, right) => right[0].length - left[0].length);
  for (const [alias, index] of aliasEntries) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(new RegExp(`@${escaped}(?![A-Za-z0-9_])`, 'g'), `@图片${index}`);
  }
  return normalized;
}

function adaptExternalAiResult(db, result, task) {
  const validation = validateExternalAiResult(result);
  if (!validation.ok) {
    const first = validation.errors.slice(0, 8).map((item) => `${item.path || '(root)'}: ${item.message}`).join('; ');
    throw adapterError('PACKAGE_INVALID', `外部 AI 结果校验失败（${validation.errors.length} 个错误）：${first}`, validation.errors);
  }
  if (!task || result.package_id !== task.package_id) {
    throw adapterError('PACKAGE_TASK_NOT_FOUND', '结果中的 package_id 与项目任务不匹配');
  }
  if (Number(result.episode.episode_number) !== Number(task.target_episode_number)) {
    throw adapterError(
      'PACKAGE_TARGET_MISMATCH',
      `结果集号 ${result.episode.episode_number} 与任务目标第 ${task.target_episode_number} 集不一致`,
    );
  }

  const snapshot = task.asset_snapshot || {};
  const prefix = packagePrefix(task.package_id);
  const localToKey = new Map();
  const rememberLocal = (localRef) => {
    const key = `${prefix}_${keyPart(localRef)}`;
    localToKey.set(localRef, key);
    return key;
  };
  const assets = result.new_assets;
  for (const character of assets.characters) {
    rememberLocal(character.local_ref);
    for (const variant of character.variants) rememberLocal(variant.local_ref);
  }
  for (const group of ['character_variants', 'scenes', 'props']) {
    for (const item of assets[group]) rememberLocal(item.local_ref);
  }
  for (const storyboard of result.storyboards) rememberLocal(storyboard.local_ref);

  const resolve = (ref) => localToKey.get(ref) || ref;
  const newCharacterRefs = new Set(assets.characters.map((item) => item.local_ref));
  const newSceneRefs = new Set(assets.scenes.map((item) => item.local_ref));
  const newPropRefs = new Set(assets.props.map((item) => item.local_ref));
  const nestedNewVariantOwner = new Map();
  for (const character of assets.characters) {
    for (const variant of character.variants) nestedNewVariantOwner.set(variant.local_ref, character.local_ref);
  }
  const standaloneNewVariants = new Map(assets.character_variants.map((item) => [item.local_ref, item]));

  const usedExistingCharacters = new Set();
  const usedExistingScenes = new Set();
  const usedExistingProps = new Set();
  const usedExistingCharacterVariants = [];
  const currentRows = { characters: new Map(), variants: new Map(), scenes: new Map(), props: new Map() };

  const requireExistingCharacter = (ref) => {
    const entry = snapshot.characters?.[ref];
    if (!entry) throw adapterError('PACKAGE_REFERENCE_INVALID', `人物引用 "${ref}" 不在该任务的项目资产中`);
    if (!currentRows.characters.has(ref)) {
      currentRows.characters.set(ref, loadExisting(db, 'characters', entry.id, task.drama_id, '人物', ref));
    }
    usedExistingCharacters.add(ref);
    return currentRows.characters.get(ref);
  };
  const requireExistingVariant = (characterRef, variantRef) => {
    const entry = snapshot.variants?.[variantRef];
    if (!entry) throw adapterError('PACKAGE_REFERENCE_INVALID', `人物状态引用 "${variantRef}" 不在该任务的项目资产中`);
    if (entry.character_source_key !== characterRef) {
      throw adapterError('PACKAGE_REFERENCE_INVALID', `人物状态 "${variantRef}" 不属于人物 "${characterRef}"`);
    }
    if (!currentRows.variants.has(variantRef)) {
      currentRows.variants.set(variantRef, loadExistingVariant(db, entry, task.drama_id, variantRef));
    }
    return currentRows.variants.get(variantRef);
  };
  const requireExistingScene = (ref) => {
    const entry = snapshot.scenes?.[ref];
    if (!entry) throw adapterError('PACKAGE_REFERENCE_INVALID', `场景引用 "${ref}" 不在该任务的项目资产中`);
    if (!currentRows.scenes.has(ref)) currentRows.scenes.set(ref, loadExisting(db, 'scenes', entry.id, task.drama_id, '场景', ref));
    usedExistingScenes.add(ref);
  };
  const requireExistingProp = (ref) => {
    const entry = snapshot.props?.[ref];
    if (!entry) throw adapterError('PACKAGE_REFERENCE_INVALID', `道具引用 "${ref}" 不在该任务的项目资产中`);
    if (!currentRows.props.has(ref)) currentRows.props.set(ref, loadExisting(db, 'props', entry.id, task.drama_id, '道具', ref));
    usedExistingProps.add(ref);
  };

  for (const variant of assets.character_variants) {
    if (newCharacterRefs.has(variant.character_ref)) {
      throw adapterError('PACKAGE_REFERENCE_INVALID', `新人物的状态必须放在该人物 variants 内：${variant.local_ref}`);
    }
    requireExistingCharacter(variant.character_ref);
  }

  for (const storyboard of result.storyboards) {
    if (!newSceneRefs.has(storyboard.scene_ref)) requireExistingScene(storyboard.scene_ref);
    for (const propRef of storyboard.prop_refs) {
      if (!newPropRefs.has(propRef)) requireExistingProp(propRef);
    }
    for (const ref of storyboard.character_refs) {
      if (!newCharacterRefs.has(ref.character_ref)) requireExistingCharacter(ref.character_ref);
      if (nestedNewVariantOwner.has(ref.variant_ref)) {
        if (nestedNewVariantOwner.get(ref.variant_ref) !== ref.character_ref) {
          throw adapterError('PACKAGE_REFERENCE_INVALID', `新人物状态 "${ref.variant_ref}" 不属于人物 "${ref.character_ref}"`);
        }
      } else if (standaloneNewVariants.has(ref.variant_ref)) {
        if (standaloneNewVariants.get(ref.variant_ref).character_ref !== ref.character_ref) {
          throw adapterError('PACKAGE_REFERENCE_INVALID', `新人物状态 "${ref.variant_ref}" 不属于人物 "${ref.character_ref}"`);
        }
      } else {
        if (newCharacterRefs.has(ref.character_ref)) {
          throw adapterError('PACKAGE_REFERENCE_INVALID', `新人物 "${ref.character_ref}" 不包含状态 "${ref.variant_ref}"`);
        }
        requireExistingVariant(ref.character_ref, ref.variant_ref);
      }
    }
  }

  const characters = assets.characters.map((character) => ({
    source_key: resolve(character.local_ref),
    name: character.name,
    role: character.role,
    description: character.description,
    personality: character.personality,
    appearance: character.appearance,
    image_prompt: character.base_image_prompt,
    negative_prompt: character.negative_prompt,
    voice_profile: character.voice_profile,
    variants: character.variants.map((variant) => ({
      source_key: resolve(variant.local_ref),
      name: variant.name,
      description: variant.description,
      appearance: variant.appearance,
      image_prompt: variant.base_image_prompt,
      negative_prompt: variant.negative_prompt,
      is_default: variant.is_default,
    })),
  }));
  for (const characterRef of usedExistingCharacters) {
    const expanded = existingCharacterToPackage(db, currentRows.characters.get(characterRef));
    for (const variant of expanded.variants) {
      usedExistingCharacterVariants.push({
        character_ref: characterRef,
        variant_ref: variant.source_key,
      });
    }
    for (const variant of assets.character_variants.filter((item) => item.character_ref === characterRef)) {
      expanded.variants.push({
        source_key: resolve(variant.local_ref),
        name: variant.name,
        description: variant.description,
        appearance: variant.appearance,
        image_prompt: variant.base_image_prompt,
        negative_prompt: variant.negative_prompt,
        is_default: variant.is_default,
      });
    }
    characters.push(expanded);
  }

  const scenes = assets.scenes.map((scene) => ({
    source_key: resolve(scene.local_ref),
    name: scene.name,
    state: scene.state,
    description: scene.description,
    atmosphere: scene.atmosphere,
    image_prompt: scene.base_image_prompt,
    negative_prompt: scene.negative_prompt,
  }));
  for (const ref of usedExistingScenes) scenes.push(existingSceneToPackage(currentRows.scenes.get(ref)));

  const props = assets.props.map((prop) => ({
    source_key: resolve(prop.local_ref),
    name: prop.name,
    type: prop.type,
    description: prop.description,
    image_prompt: prop.base_image_prompt,
    negative_prompt: prop.negative_prompt,
  }));
  for (const ref of usedExistingProps) props.push(existingPropToPackage(currentRows.props.get(ref)));

  const aliases = { scenes: {}, characters: {}, props: {} };
  for (const scene of assets.scenes) aliases.scenes[scene.name] = scene.local_ref;
  for (const character of assets.characters) {
    aliases.characters[character.name] = { character_ref: character.local_ref };
    for (const variant of character.variants) {
      aliases.characters[variant.name] = { character_ref: character.local_ref, variant_ref: variant.local_ref };
    }
  }
  for (const prop of assets.props) aliases.props[prop.name] = prop.local_ref;
  for (const [ref, row] of currentRows.scenes) aliases.scenes[row.location] = ref;
  for (const [ref, row] of currentRows.characters) aliases.characters[row.name] = { character_ref: ref };
  for (const [ref, row] of currentRows.variants) aliases.characters[row.name] = {
    character_ref: row.character_source_key,
    variant_ref: ref,
  };
  for (const [ref, row] of currentRows.props) aliases.props[row.name] = ref;

  const storyboards = result.storyboards.map((storyboard) => ({
    ...storyboard,
    source_key: resolve(storyboard.local_ref),
    local_ref: undefined,
    scene_ref: resolve(storyboard.scene_ref),
    universal_segment_text: normalizeUniversalSegmentText(storyboard.universal_segment_text, storyboard, aliases),
    character_refs: storyboard.character_refs.map((ref) => ({
      ...ref,
      character_ref: resolve(ref.character_ref),
      variant_ref: resolve(ref.variant_ref),
    })),
    prop_refs: storyboard.prop_refs.map(resolve),
    image_prompt: storyboard.base_image_prompt,
    video_prompt: storyboard.base_video_prompt,
    base_image_prompt: undefined,
    base_video_prompt: undefined,
  }));

  const current = getCurrentAssetState(db, task.drama_id, { ensureKeys: false });
  const warnings = current.assetsDigest === task.assets_digest ? [] : [{
    code: 'PACKAGE_ASSETS_CHANGED',
    path: 'package_id',
    message: '任务包生成后项目资产发生过变化；已按当前仍存在的引用重新校验，导入不会覆盖已有资产。',
  }];

  return {
    package: {
      schema: 'local-mini-drama.episode-package',
      version: '1.1',
      generator: { ...(result.generator || { name: 'external-ai' }), package_id: task.package_id },
      generation_profile: {
        contract_profile: 'complete_av_v1',
        video_mode: 'multi_reference_r2v',
        uses_first_last_frame: false,
        max_reference_images: 9,
        reference_order: ['scene', 'character_variant', 'prop'],
      },
      audio_plan: result.audio_plan || defaultAudioPlan(),
      episode: {
        source_key: `${prefix}_episode_${result.episode.episode_number}`,
        ...result.episode,
      },
      characters,
      scenes,
      props,
      storyboards,
    },
    validationContext: {
      trustedExistingAssets: {
        characters: [...usedExistingCharacters],
        characterVariants: usedExistingCharacterVariants,
        scenes: [...usedExistingScenes],
        props: [...usedExistingProps],
      },
    },
    warnings,
    assetDigestStatus: current.assetsDigest === task.assets_digest ? 'current' : 'changed',
  };
}

module.exports = {
  adaptExternalAiResult,
};
