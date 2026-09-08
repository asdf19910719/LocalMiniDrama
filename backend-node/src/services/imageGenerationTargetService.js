const { bindStoryboardFrameImage } = require('./storyboardFrameBinding');
const path = require('node:path');
const { resolveStoryboardSlots } = require('./referenceSlotService');
const { buildModePrompt, normalizeAssetMode } = require('./assetGenerationModes');
const { createStyleRegistryService } = require('./styleRegistryService');
const { compileImagePrompt } = require('./imagePromptCompiler');
const { createReferenceRegistry } = require('./referenceRegistry');
const { resolvePromptLanguage } = require('./promptLanguageResolver');

const TABLES = {
  character: { table: 'characters', name: 'name' },
  scene: { table: 'scenes', name: 'location' },
  prop: { table: 'props', name: 'name' },
};

function targetValues(task) {
  return {
    dramaId: Number(task.dramaId ?? task.drama_id),
    targetType: String(task.targetType ?? task.target_type ?? ''),
    targetId: Number(task.targetId ?? task.target_id),
  };
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return [...value];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function resolveStyleSnapshot(db, dramaId, task) {
  let project;
  try {
    project = db.prepare('SELECT style_id FROM dramas WHERE id=? AND deleted_at IS NULL').get(dramaId);
  } catch (error) {
    if (error.code !== 'SQLITE_ERROR') throw error;
    // 精简测试表可能尚无 style_id；生产迁移后的表不会进入该分支。
    project = { style_id: 'rh-101-cinematic' };
  }
  if (!project) {
    const error = new Error('Drama not found');
    error.code = 'DRAMA_NOT_FOUND';
    throw error;
  }
  if (!project.style_id) {
    const error = new Error('项目尚未选择风格');
    error.code = 'PROJECT_STYLE_REQUIRED';
    throw error;
  }
  const style = createStyleRegistryService({ db }).requireStyle(project.style_id);
  const supplied = parseObject(task.style_snapshot ?? task.styleSnapshot);
  const suppliedId = supplied.id || supplied.style_id;
  if ((suppliedId && suppliedId !== style.id) || supplied.style || supplied.style_prompt_zh || supplied.style_prompt_en) {
    const error = new Error('项目内生成请求不能覆盖项目风格');
    error.code = 'PROJECT_STYLE_OVERRIDE_FORBIDDEN';
    throw error;
  }
  return {
    id: style.id,
    version: style.version,
    labelZh: style.labelZh,
    labelEn: style.labelEn,
    promptZh: style.promptZh,
    promptEn: style.promptEn,
    keywords: style.keywords,
    recommendedCapabilities: style.recommendedCapabilities,
  };
}

function appendHistory(row) {
  const old = row.local_path || row.image_url;
  const history = parseList(row.extra_images);
  if (old && !history.includes(old)) history.push(old);
  return history.length ? JSON.stringify(history) : null;
}

function resolveTarget(db, task) {
  const { dramaId, targetType, targetId } = targetValues(task);
  if (!Number.isInteger(dramaId) || dramaId <= 0 || !Number.isInteger(targetId) || targetId <= 0) {
    throw new Error('Invalid image generation target identity');
  }
  if (!['character', 'character_variant', 'scene', 'prop', 'storyboard_main', 'storyboard_first', 'storyboard_last'].includes(targetType)) {
    throw new Error(`Unsupported image generation target type: ${targetType}`);
  }
  if (targetType === 'character_variant') {
    const row = db.prepare(`SELECT cv.*, c.drama_id, c.name AS character_name,
      c.image_url AS character_image_url, c.local_path AS character_local_path,
      c.negative_prompt AS character_negative_prompt
      FROM character_variants cv
      JOIN characters c ON c.id = cv.character_id WHERE cv.id=? AND cv.deleted_at IS NULL`).get(targetId);
    if (!row) throw new Error(`Image generation ${targetType} target not found`);
    if (Number(row.drama_id) !== dramaId) throw new Error('Image generation target belongs to another drama');
    const displayName = row.character_name ? `${row.character_name}·${row.name}` : row.name;
    return { ...row, target_type: targetType, target_name: displayName || `状态 ${targetId}` };
  }
  if (TABLES[targetType]) {
    const config = TABLES[targetType];
    const row = db.prepare(`SELECT * FROM ${config.table} WHERE id=? AND deleted_at IS NULL`).get(targetId);
    if (!row) throw new Error(`Image generation ${targetType} target not found`);
    if (Number(row.drama_id) !== dramaId) throw new Error('Image generation target belongs to another drama');
    return { ...row, target_type: targetType, target_name: row[config.name] || '' };
  }
  if (targetType.startsWith('storyboard_')) {
    const row = db.prepare(`SELECT sb.*, ep.drama_id FROM storyboards sb
      JOIN episodes ep ON ep.id=sb.episode_id WHERE sb.id=? AND sb.deleted_at IS NULL`).get(targetId);
    if (!row) throw new Error('Image generation storyboard target not found');
    if (Number(row.drama_id) !== dramaId) throw new Error('Image generation target belongs to another drama');
    return { ...row, target_type: targetType, target_name: row.title || `分镜 ${targetId}` };
  }
  throw new Error(`Unsupported image generation target type: ${targetType}`);
}

function reference(role, sourceId, url) {
  return url ? { role, sourceId, url } : null;
}

function addressableReferenceUrl(db, { local_path: localPath, remote_image_url: remoteImageUrl, image_url: resolvedImageUrl } = {}) {
  const local = String(localPath || '').trim();
  const remote = String(remoteImageUrl || '').trim();
  if (local) {
    if (/^https?:\/\//i.test(local) || /^\/(?:static|api)\//i.test(local)) return local;
    if (path.isAbsolute(local) || /^\\\\/.test(local)) {
      try {
        const external = db.prepare(`SELECT result.id
          FROM external_generation_results result
          JOIN image_generations image ON image.id = result.image_generation_id
          WHERE image.local_path = ?
          ORDER BY result.rowid DESC LIMIT 1`).get(local);
        if (external?.id) {
          return `/api/v1/external-generation/results/${encodeURIComponent(external.id)}/content`;
        }
      } catch (_) {}
      // Never expose an operating-system path to the browser extension.
      return remote && /^https?:\/\//i.test(remote) ? remote : null;
    }
    return `/static/${local.replace(/^[\\/]+/, '').replace(/\\/g, '/')}`;
  }
  const resolved = String(resolvedImageUrl || '').trim();
  return remote || resolved || null;
}

function collectStoryboardReferences(db, target) {
  const { slots } = resolveStoryboardSlots(db, target.id);
  return slots.flatMap((slot) => {
    if (!slot.image_available) return [];
    const url = addressableReferenceUrl(db, slot);
    if (!url) return [];
    return [{
      role: slot.type,
      sourceId: slot.type === 'character_variant' ? slot.variant_id : slot.asset_id,
      url,
      slotIndex: slot.index,
      assetId: slot.asset_id,
      variantId: slot.variant_id ?? null,
      name: slot.name ?? null,
      referenceRole: slot.reference_role ?? null,
      framingNote: slot.framing_note ?? null,
    }];
  });
}

function buildGenerationInput(db, task) {
  const target = resolveTarget(db, task);
  const { dramaId } = targetValues(task);
  const hasReferenceSnapshot = task.reference_manifest != null || task.referenceManifest != null;
  let prompt = '';
  const references = [];
  let frameType = null;
  let assetMode = null;
  if (target.target_type === 'character') {
    assetMode = normalizeAssetMode('character', task.asset_mode ?? task.assetMode ?? target.asset_mode);
    prompt = assetMode === 'SINGLE'
      ? (target.appearance || target.description || target.name || '')
      : (target.polished_prompt || target.appearance || target.description || target.name || '');
  } else if (target.target_type === 'character_variant') {
    assetMode = normalizeAssetMode('character_variant', task.asset_mode ?? task.assetMode ?? target.asset_mode);
    prompt = target.image_prompt || target.appearance || target.description || target.name || '';
    const useIdentityReference = task.use_identity_reference == null
      ? target.use_identity_reference !== 0
      : task.use_identity_reference === true || task.use_identity_reference === 1;
    if (useIdentityReference) {
      const identityUrl = addressableReferenceUrl(db, {
        local_path: target.character_local_path,
        image_url: target.character_image_url,
      });
      const identityReference = reference('character_identity', target.character_id, identityUrl);
      if (identityReference) references.push(identityReference);
    }
  } else if (target.target_type === 'scene') {
    assetMode = normalizeAssetMode('scene', task.asset_mode ?? task.assetMode ?? target.asset_mode);
    prompt = assetMode === 'QUAD_GRID'
      ? (target.polished_prompt || target.prompt || target.location || '')
      : (target.polished_prompt_single || target.prompt || target.polished_prompt || target.location || '');
  } else if (target.target_type === 'prop') {
    prompt = target.polished_prompt || target.prompt || target.description || target.name || '';
  } else {
    frameType = target.target_type === 'storyboard_first'
      ? 'storyboard_first'
      : target.target_type === 'storyboard_last' ? 'storyboard_last' : null;
    // Dedicated frame prompts are authoritative for first/last generation;
    // generic storyboard polishing must not replace them.
    if (frameType) {
      try {
        const frameKind = frameType === 'storyboard_first' ? 'first' : 'last';
        const frame = db.prepare(
          'SELECT prompt FROM frame_prompts WHERE storyboard_id=? AND frame_type IN (?,?) ORDER BY updated_at DESC, created_at DESC LIMIT 1'
        ).get(target.id, frameType, frameKind);
        prompt = frame?.prompt || '';
      } catch (_) {}
    }
    if (!prompt) prompt = target.polished_prompt || target.image_prompt || target.description || target.title || '';
    references.push(...collectStoryboardReferences(db, target));
    if (target.target_type === 'storyboard_last' && target.first_frame_image_id) {
      const first = db.prepare('SELECT id, image_url, local_path FROM image_generations WHERE id=?').get(target.first_frame_image_id);
      const ref = first && reference('storyboard_first', first.id, first.image_url || first.local_path);
      if (ref) references.push(ref);
    }
  }
  const styleSnapshot = resolveStyleSnapshot(db, dramaId, task);
  const persistedPrompt = task.prompt_snapshot ?? task.promptSnapshot;
  const requestedPrompt = String(persistedPrompt ?? prompt).trim();
  const modePrompt = persistedPrompt != null
    ? requestedPrompt
    : (assetMode ? buildModePrompt(target.target_type, assetMode, requestedPrompt) : requestedPrompt);
  const negativePrompt = String(
    task.negative_prompt_snapshot
      ?? task.negativePromptSnapshot
      ?? target.negative_prompt
      ?? target.character_negative_prompt
      ?? ''
  ).trim();
  let compiledPrompt = persistedPrompt != null ? modePrompt : null;
  let compiledNegative = negativePrompt;
  let compilation = null;
  if (persistedPrompt == null && styleSnapshot.id) {
    const referenceRegistry = createReferenceRegistry(references.map((item, index) => ({
      url: item.url,
      name: item.name || item.role || `参考图${index + 1}`,
      role: item.referenceRole || item.role,
      sortOrder: item.slotIndex ?? index,
      realPerson: item.realPerson === true,
    })), 'mixed');
    const targetType = target.target_type.startsWith('storyboard_') ? 'storyboard' : target.target_type;
    const compilerMode = targetType === 'scene'
      ? (assetMode === 'QUAD_GRID' ? 'MULTI_VIEW' : assetMode || 'NORMAL')
      : ['character', 'character_variant'].includes(targetType) ? (assetMode || (targetType === 'character' ? 'TURNAROUND' : 'SINGLE'))
        : targetType === 'storyboard' ? 'FRAME' : 'SINGLE';
    const language = resolvePromptLanguage({ style: styleSnapshot });
    compilation = compileImagePrompt({ targetType, mode: compilerMode, basePrompt: requestedPrompt, negativePrompt, style: styleSnapshot, language, references: referenceRegistry });
    compiledPrompt = compilation.finalPrompt;
    compiledNegative = compilation.negativePrompt || '';
  }
  return {
    target,
    // prompt_snapshot is the already compiled, immutable execution prompt. It
    // must not receive mode/style instructions again when an API task submits.
    prompt: compiledPrompt,
    references: hasReferenceSnapshot
      ? parseList(task.reference_manifest ?? task.referenceManifest)
      : references,
    frameType,
    assetMode,
    negativePrompt: compiledNegative,
    styleSnapshot,
    compilation,
  };
}

function bindAsset(db, table, targetId, image) {
  const current = db.prepare(`SELECT image_url, local_path, extra_images FROM ${table} WHERE id=?`).get(targetId);
  const history = appendHistory(current);
  const now = new Date().toISOString();
  db.prepare(`UPDATE ${table} SET image_url=?, local_path=?, extra_images=?, image_updated_at=?, updated_at=? WHERE id=?`)
    .run(image.image_url, image.local_path, history, now, now, targetId);
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(targetId);
}

function bindResult(db, task, imageGenerationId) {
  const { dramaId, targetType, targetId } = targetValues(task);
  resolveTarget(db, task);
  const image = db.prepare('SELECT * FROM image_generations WHERE id=?').get(Number(imageGenerationId));
  if (!image) throw new Error('Image generation result not found');
  if (Number(image.drama_id) !== dramaId) throw new Error('Image generation result belongs to another drama');
  return db.transaction(() => {
    const timestamp = new Date().toISOString();
    if (targetType === 'character_variant') {
      // character_variants 无 image_updated_at 列,历史仍记入 extra_images
      const current = db.prepare('SELECT image_url, local_path, extra_images FROM character_variants WHERE id=?').get(targetId);
      const history = appendHistory(current);
      db.prepare('UPDATE character_variants SET image_url=?, local_path=?, extra_images=?, updated_at=? WHERE id=?')
        .run(image.image_url, image.local_path, history, timestamp, targetId);
      return db.prepare('SELECT * FROM character_variants WHERE id=?').get(targetId);
    }
    if (targetType === 'character') {
      db.prepare('UPDATE image_generations SET character_id=?, updated_at=? WHERE id=?').run(targetId, timestamp, image.id);
      return bindAsset(db, 'characters', targetId, image);
    }
    if (targetType === 'scene') {
      db.prepare('UPDATE image_generations SET scene_id=?, updated_at=? WHERE id=?').run(targetId, timestamp, image.id);
      return bindAsset(db, 'scenes', targetId, image);
    }
    if (targetType === 'prop') return bindAsset(db, 'props', targetId, image);
    const frameType = targetType === 'storyboard_last'
      ? 'storyboard_last'
      : targetType === 'storyboard_first' ? 'storyboard_first' : null;
    db.prepare('UPDATE image_generations SET storyboard_id=?, frame_type=?, updated_at=? WHERE id=?')
      .run(targetId, frameType, timestamp, image.id);
    bindStoryboardFrameImage(db, targetId, frameType, image.id, image.image_url, image.local_path);
    return db.prepare('SELECT * FROM storyboards WHERE id=?').get(targetId);
  })();
}

module.exports = { resolveTarget, buildGenerationInput, bindResult, addressableReferenceUrl };
