const crypto = require('node:crypto');

const {
  projectStoryboardRow,
  projectEpisodeRow,
} = require('./storyboardCanonicalRepository');
const {
  normalizeStoryboardAudioDescription,
  normalizeStoryboardTransition,
  reconcileStoryboardAudioWithEpisodePlan,
  serializeCanonicalJson,
} = require('./storyboardAvContractService');
const { resolveStoryboardSlots } = require('./referenceSlotService');

function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function visualPromptFor(storyboard) {
  return [
    storyboard.universal_segment_text,
    storyboard.video_prompt,
    storyboard.polished_prompt,
    storyboard.image_prompt,
    storyboard.description,
  ].find((value) => value != null && String(value).trim()) || '';
}

function deepMerge(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const output = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(patch)) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(output[key], value)
      : value;
  }
  return output;
}

function summarizeNeighbor(row) {
  if (!row) return null;
  const shot = projectStoryboardRow(row);
  return {
    storyboard_number: shot.storyboard_number,
    title: shot.title,
    action: shot.action,
    result: shot.result,
    location: shot.location,
    time: shot.time,
    transition: shot.transition,
    continuity_snapshot: shot.continuity_snapshot,
  };
}

function buildStoryboardGenerationContext(db, storyboardId, options = {}) {
  const id = Number(storyboardId);
  const row = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) {
    const error = new Error('STORYBOARD_NOT_FOUND: storyboard not found');
    error.code = 'STORYBOARD_NOT_FOUND';
    throw error;
  }
  const storyboard = projectStoryboardRow(row);
  if (options.fieldOverrides && typeof options.fieldOverrides === 'object' && !Array.isArray(options.fieldOverrides)) {
    const { audio_description: audioOverride, transition: transitionOverride, ...scalarOverrides } = options.fieldOverrides;
    Object.assign(storyboard, scalarOverrides);
    if (audioOverride) {
      storyboard.audio_description = normalizeStoryboardAudioDescription(
        deepMerge(storyboard.audio_description, audioOverride),
      );
    }
    if (transitionOverride) {
      storyboard.transition = normalizeStoryboardTransition(deepMerge(storyboard.transition, transitionOverride));
    }
  }
  if (options.universalSegmentOverride !== undefined) {
    storyboard.universal_segment_text = options.universalSegmentOverride;
  }
  storyboard.visual_prompt = visualPromptFor(storyboard);

  const episodeRow = db.prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL').get(storyboard.episode_id);
  if (!episodeRow) {
    const error = new Error('EPISODE_NOT_FOUND: episode not found');
    error.code = 'EPISODE_NOT_FOUND';
    throw error;
  }
  const episode = projectEpisodeRow(episodeRow);
  const dramaRow = episode.drama_id == null
    ? null
    : db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(episode.drama_id);

  const previous = db.prepare(
    'SELECT * FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC, id DESC LIMIT 1',
  ).get(storyboard.episode_id, storyboard.storyboard_number);
  const next = db.prepare(
    'SELECT * FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC LIMIT 1',
  ).get(storyboard.episode_id, storyboard.storyboard_number);
  const scene = storyboard.scene_id == null
    ? null
    : db.prepare('SELECT * FROM scenes WHERE id = ? AND deleted_at IS NULL').get(storyboard.scene_id) || null;
  const props = db.prepare(
    `SELECT p.* FROM storyboard_props sp
     JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
     WHERE sp.storyboard_id = ? ORDER BY sp.rowid ASC`,
  ).all(id).map((prop) => ({
    id: prop.id,
    name: prop.name,
    type: prop.type ?? null,
    description: prop.description ?? null,
    prompt: prop.prompt ?? null,
    negative_prompt: prop.negative_prompt ?? null,
    image_url: prop.local_path || prop.image_url || null,
    updated_at: prop.updated_at ?? null,
  }));

  const resolved = resolveStoryboardSlots(db, id, { maxSlots: options.maxReferenceSlots || 9 });
  const references = resolved.slots.map((slot) => ({
    slot: slot.index,
    image_label: `图片${slot.index}`,
    entity_type: slot.entity_type || slot.type,
    entity_id: slot.entity_id ?? slot.asset_id,
    entity_name: slot.entity_name ?? slot.name ?? null,
    reference_role: slot.reference_role ?? null,
    variant: slot.variant ?? null,
    framing_note: slot.framing_note ?? null,
    image_url: slot.image_url ?? null,
    image_available: slot.image_available === true,
    image_version: slot.image_version ?? null,
    audio_label: slot.audio_label ?? null,
    audio_url: slot.audio_url ?? null,
    audio_version: slot.audio_version ?? null,
  }));
  const audio = reconcileStoryboardAudioWithEpisodePlan(storyboard.audio_description || normalizeStoryboardAudioDescription({}, {
    source: 'default',
    bgmMode: episode.audio_plan.bgm.mode,
  }), episode.audio_plan);
  storyboard.audio_description = audio;

  return {
    version: 1,
    storyboard,
    episode: {
      ...episode,
      production_profile: episode.production_profile || {},
    },
    drama: dramaRow ? {
      id: dramaRow.id,
      title: dramaRow.title,
      genre: dramaRow.genre ?? null,
      style: dramaRow.style ?? null,
      metadata: parseObject(dramaRow.metadata),
    } : null,
    audio,
    transition: storyboard.transition,
    continuity: {
      current: storyboard.continuity_snapshot,
      previous: summarizeNeighbor(previous),
      next: summarizeNeighbor(next),
    },
    scene: scene ? {
      id: scene.id,
      location: scene.location,
      time: scene.time,
      prompt: scene.prompt,
      atmosphere: scene.atmosphere ?? null,
      negative_prompt: scene.negative_prompt ?? null,
      image_url: scene.local_path || scene.image_url || null,
      updated_at: scene.updated_at ?? null,
    } : null,
    props,
    references,
    reference_overflow: resolved.overflow.map((slot) => slot.index),
  };
}

function generationContextFingerprint(context) {
  return crypto.createHash('sha256').update(serializeCanonicalJson(context)).digest('hex');
}

module.exports = {
  buildStoryboardGenerationContext,
  generationContextFingerprint,
};
