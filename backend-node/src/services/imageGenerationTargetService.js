const { bindStoryboardFrameImage } = require('./storyboardFrameBinding');

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

function appendHistory(row) {
  const old = row.local_path || row.image_url;
  const history = parseList(row.extra_images);
  if (old && !history.includes(old)) history.push(old);
  return history.length ? JSON.stringify(history) : null;
}

function resolveTarget(db, task) {
  const { dramaId, targetType, targetId } = targetValues(task);
  if (!Number.isFinite(dramaId) || !Number.isFinite(targetId)) throw new Error('Invalid image generation target identity');
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

function buildGenerationInput(db, task) {
  const target = resolveTarget(db, task);
  let prompt = '';
  const references = [];
  let frameType = null;
  if (target.target_type === 'character') {
    prompt = target.polished_prompt || target.appearance || target.description || target.name || '';
    const ref = reference('character', target.id, target.ref_image || target.image_url || target.local_path);
    if (ref) references.push(ref);
  } else if (target.target_type === 'scene') {
    prompt = target.polished_prompt_single || target.polished_prompt || target.prompt || target.location || '';
    const ref = reference('scene', target.id, target.ref_image || target.image_url || target.local_path);
    if (ref) references.push(ref);
  } else if (target.target_type === 'prop') {
    prompt = target.polished_prompt || target.prompt || target.description || target.name || '';
    const ref = reference('prop', target.id, target.ref_image || target.image_url || target.local_path);
    if (ref) references.push(ref);
  } else {
    prompt = target.polished_prompt || target.image_prompt || target.description || target.title || '';
    frameType = target.target_type === 'storyboard_first'
      ? 'storyboard_first'
      : target.target_type === 'storyboard_last' ? 'storyboard_last' : null;
    if (target.scene_id) {
      const scene = db.prepare('SELECT id, ref_image, image_url, local_path FROM scenes WHERE id=? AND deleted_at IS NULL').get(target.scene_id);
      const ref = scene && reference('scene', scene.id, scene.ref_image || scene.image_url || scene.local_path);
      if (ref) references.push(ref);
    }
    if (target.target_type === 'storyboard_last' && target.first_frame_image_id) {
      const first = db.prepare('SELECT id, image_url, local_path FROM image_generations WHERE id=?').get(target.first_frame_image_id);
      const ref = first && reference('storyboard_first', first.id, first.image_url || first.local_path);
      if (ref) references.push(ref);
    }
  }
  return { target, prompt: String(task.prompt_snapshot || prompt).trim(), references, frameType };
}

function bindAsset(db, table, targetId, image) {
  const current = db.prepare(`SELECT image_url, local_path, extra_images FROM ${table} WHERE id=?`).get(targetId);
  const history = appendHistory(current);
  db.prepare(`UPDATE ${table} SET image_url=?, local_path=?, extra_images=?, updated_at=? WHERE id=?`)
    .run(image.image_url, image.local_path, history, new Date().toISOString(), targetId);
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

module.exports = { resolveTarget, buildGenerationInput, bindResult };
