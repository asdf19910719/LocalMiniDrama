const {
  normalizeEpisodeAudioPlan,
  normalizeStoryboardAudioDescription,
  normalizeStoryboardTransition,
  normalizeFieldState,
  serializeCanonicalJson,
} = require('./storyboardAvContractService');

const STORYBOARD_SCALAR_FIELDS = [
  'scene_id', 'storyboard_number', 'title', 'description', 'layout_description',
  'location', 'time', 'duration', 'dialogue', 'narration', 'action', 'result',
  'atmosphere', 'image_prompt', 'polished_prompt', 'video_prompt', 'shot_type',
  'angle', 'angle_h', 'angle_v', 'angle_s', 'movement', 'lighting_style',
  'depth_of_field', 'emotion', 'emotion_intensity', 'segment_index', 'segment_title',
  'creation_mode', 'universal_segment_text', 'source_key', 'composed_image',
  'image_url', 'local_path', 'main_panel_idx', 'video_url', 'audio_local_path',
  'narration_audio_local_path', 'first_frame_image_id', 'last_frame_image_id',
  'last_frame_image_url', 'last_frame_local_path', 'status', 'error_msg',
];

const STORYBOARD_JSON_FIELDS = new Set([
  'characters', 'audio_description', 'transition', 'continuity_snapshot',
  'production_metadata',
]);

const CLEARABLE_FIELDS = new Set([
  ...STORYBOARD_SCALAR_FIELDS.filter((field) => !['storyboard_number'].includes(field)),
  ...STORYBOARD_JSON_FIELDS,
]);

const FIELD_STATE_ROOTS = new Set([
  'audio_description', 'transition', 'layout_description', 'is_primary',
  'emotion', 'emotion_intensity', 'lighting_style', 'depth_of_field',
  'continuity_snapshot',
]);

function repositoryError(message) {
  const error = new Error(`STORYBOARD_PATCH_INVALID: ${message}`);
  error.code = 'STORYBOARD_PATCH_INVALID';
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function parseJsonObjectLossless(value) {
  if (value == null || value === '') return {};
  if (isPlainObject(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : { raw_description: value };
  } catch (_) {
    return { raw_description: String(value) };
  }
}

function sanitizeImageUrl(value) {
  if (!value || String(value).startsWith('data:')) return value ? null : value;
  return value;
}

function projectStoryboardRow(row, links = []) {
  if (!row) return null;
  let audioDescription = null;
  let transition = null;
  try { audioDescription = normalizeStoryboardAudioDescription(row.audio_description); } catch (_) {
    audioDescription = normalizeStoryboardAudioDescription(String(row.audio_description || ''));
  }
  try { transition = normalizeStoryboardTransition(row.transition); } catch (_) {
    transition = normalizeStoryboardTransition(String(row.transition || ''));
  }
  const metadata = parseJsonObjectLossless(row.production_metadata);
  metadata.field_state = normalizeFieldState(metadata.field_state);

  return {
    id: row.id,
    episode_id: row.episode_id,
    scene_id: row.scene_id ?? null,
    storyboard_number: row.storyboard_number ?? 0,
    title: row.title ?? null,
    description: row.description ?? null,
    layout_description: row.layout_description ?? null,
    location: row.location ?? null,
    time: row.time ?? null,
    duration: row.duration ?? 0,
    dialogue: row.dialogue ?? null,
    narration: row.narration ?? null,
    action: row.action ?? null,
    result: row.result ?? null,
    atmosphere: row.atmosphere ?? null,
    emotion: row.emotion ?? null,
    emotion_intensity: row.emotion_intensity ?? null,
    image_prompt: row.image_prompt ?? null,
    polished_prompt: row.polished_prompt ?? null,
    video_prompt: row.video_prompt ?? null,
    shot_type: row.shot_type ?? null,
    angle: row.angle ?? null,
    angle_h: row.angle_h ?? null,
    angle_v: row.angle_v ?? null,
    angle_s: row.angle_s ?? null,
    movement: row.movement ?? null,
    lighting_style: row.lighting_style ?? null,
    depth_of_field: row.depth_of_field ?? null,
    segment_index: row.segment_index ?? 0,
    segment_title: row.segment_title ?? null,
    creation_mode: row.creation_mode === 'universal' ? 'universal' : 'classic',
    universal_segment_text: row.universal_segment_text ?? null,
    source_key: row.source_key ?? null,
    audio_description: audioDescription,
    transition,
    is_primary: row.is_primary === true || Number(row.is_primary) === 1,
    production_metadata: metadata,
    continuity_snapshot: parseJson(row.continuity_snapshot, null),
    first_frame_image_id: row.first_frame_image_id ?? null,
    last_frame_image_id: row.last_frame_image_id ?? null,
    last_frame_image_url: sanitizeImageUrl(row.last_frame_image_url),
    last_frame_local_path: row.last_frame_local_path ?? null,
    characters: Array.isArray(row.characters) ? row.characters : (parseJson(row.characters, []) || []),
    character_variant_links: Array.isArray(links) ? links : [],
    composed_image: row.composed_image ?? null,
    image_url: sanitizeImageUrl(row.image_url),
    local_path: row.local_path ?? null,
    main_panel_idx: row.main_panel_idx != null ? Number(row.main_panel_idx) : null,
    video_url: row.video_url ?? null,
    audio_local_path: row.audio_local_path ?? null,
    narration_audio_local_path: row.narration_audio_local_path ?? null,
    status: row.status || 'pending',
    error_msg: row.error_msg ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function projectEpisodeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    drama_id: row.drama_id,
    episode_number: row.episode_number,
    title: row.title,
    script_content: row.script_content,
    description: row.description,
    duration: row.duration ?? 0,
    status: row.status || 'draft',
    video_url: row.video_url,
    thumbnail: row.thumbnail,
    audio_plan: normalizeEpisodeAudioPlan(row.audio_plan),
    production_profile: parseJsonObjectLossless(row.production_profile),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getTableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function deepMerge(current, patch) {
  if (!isPlainObject(patch)) return patch;
  const merged = isPlainObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = isPlainObject(value) ? deepMerge(merged[key], value) : value;
  }
  return merged;
}

function collectLeafPaths(value, prefix) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) return prefix ? [prefix] : [];
  const paths = [];
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(nested) && Object.keys(nested).length > 0) paths.push(...collectLeafPaths(nested, path));
    else paths.push(path);
  }
  return paths;
}

function filterLockedPatch(value, prefix, state) {
  if (!isPlainObject(value)) {
    return state[prefix]?.locked === true ? undefined : value;
  }
  if (state[prefix]?.locked === true) return undefined;
  const filtered = {};
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const accepted = filterLockedPatch(nested, path, state);
    if (accepted !== undefined) filtered[key] = accepted;
  }
  return Object.keys(filtered).length ? filtered : undefined;
}

function isAllowedStatePath(path) {
  const root = String(path || '').split('.')[0];
  return FIELD_STATE_ROOTS.has(root);
}

function applyFieldStatePatch(currentState, valuePatch, options = {}) {
  const now = options.now || new Date().toISOString();
  const state = normalizeFieldState(currentState);
  const source = options.source || 'manual';
  const lock = options.lock == null ? source === 'manual' : options.lock === true;
  const changedPaths = Array.isArray(valuePatch)
    ? valuePatch
    : Object.entries(valuePatch || {}).flatMap(([key, value]) => collectLeafPaths(value, key));

  for (const path of changedPaths) {
    if (!isAllowedStatePath(path)) continue;
    const previous = state[path] || { revision: 0 };
    state[path] = {
      source,
      locked: lock,
      revision: Number(previous.revision || 0) + 1,
      updated_at: now,
    };
  }
  for (const path of options.unlockFields || []) {
    if (!isAllowedStatePath(path)) throw repositoryError(`cannot unlock field ${path}`);
    const previous = state[path] || { source: 'default', revision: 0 };
    state[path] = {
      source: previous.source || 'default',
      locked: false,
      revision: Number(previous.revision || 0) + 1,
      updated_at: now,
    };
  }
  return state;
}

function serializeStoryboardValue(field, value, currentValue, options = {}) {
  if (value === null) return null;
  if (field === 'audio_description') {
    const merged = isPlainObject(value)
      ? deepMerge(normalizeStoryboardAudioDescription(currentValue) || {}, value)
      : value;
    return serializeCanonicalJson(normalizeStoryboardAudioDescription(merged, {
      source: options.source,
      bgmMode: options.bgmMode,
    }));
  }
  if (field === 'transition') {
    const merged = isPlainObject(value)
      ? deepMerge(normalizeStoryboardTransition(currentValue) || {}, value)
      : value;
    return serializeCanonicalJson(normalizeStoryboardTransition(merged));
  }
  if (field === 'characters') {
    if (typeof value === 'string') {
      const parsed = parseJson(value, null);
      return serializeCanonicalJson(Array.isArray(parsed) ? parsed : []);
    }
    return serializeCanonicalJson(Array.isArray(value) ? value : []);
  }
  if (field === 'continuity_snapshot' || field === 'production_metadata') {
    return serializeCanonicalJson(value);
  }
  return value;
}

function loadLinks(db, storyboardId) {
  try {
    const { listStoryboardVariantLinks } = require('./storyboardVariantService');
    return listStoryboardVariantLinks(db, storyboardId);
  } catch (_) {
    return [];
  }
}

function loadProjectedStoryboard(db, storyboardId) {
  const row = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboardId));
  return row ? projectStoryboardRow(row, loadLinks(db, storyboardId)) : null;
}

function runAtomically(db, fn) {
  return db.inTransaction ? fn() : db.transaction(fn)();
}

function patchStoryboard(db, storyboardId, patch = {}, options = {}) {
  const id = Number(storyboardId);
  const existing = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!existing) return null;
  const clearFields = options.clearFields ?? patch.clear_fields ?? [];
  const unlockFields = options.unlockFields ?? patch.unlock_fields ?? [];
  if (!Array.isArray(clearFields) || !Array.isArray(unlockFields)) {
    throw repositoryError('clear_fields and unlock_fields must be arrays');
  }
  for (const field of clearFields) {
    if (!CLEARABLE_FIELDS.has(field) && field !== 'is_primary') throw repositoryError(`cannot clear field ${field}`);
  }
  for (const path of unlockFields) {
    if (!isAllowedStatePath(path)) throw repositoryError(`cannot unlock field ${path}`);
  }

  const columns = getTableColumns(db, 'storyboards');
  const existingMetadata = parseJsonObjectLossless(existing.production_metadata);
  const existingFieldState = normalizeFieldState(existingMetadata.field_state);
  const values = {};
  const changedForState = {};
  const acceptedFields = new Set([...STORYBOARD_SCALAR_FIELDS, ...STORYBOARD_JSON_FIELDS, 'is_primary']);
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'clear_fields' || field === 'unlock_fields' || !acceptedFields.has(field) || !columns.has(field)) continue;
    const accepted = options.respectLocks && FIELD_STATE_ROOTS.has(field)
      ? filterLockedPatch(value, field, existingFieldState)
      : value;
    if (accepted === undefined) continue;
    values[field] = serializeStoryboardValue(field, accepted, existing[field], options);
    if (FIELD_STATE_ROOTS.has(field)) changedForState[field] = accepted;
  }
  for (const field of clearFields) {
    if (options.respectLocks && existingFieldState[field]?.locked === true) continue;
    if (columns.has(field)) values[field] = field === 'is_primary' ? 0 : null;
    if (FIELD_STATE_ROOTS.has(field)) changedForState[field] = null;
  }
  if (Object.prototype.hasOwnProperty.call(values, 'is_primary')) {
    values.is_primary = values.is_primary ? 1 : 0;
  }

  return runAtomically(db, () => {
    if (columns.has('production_metadata') && (Object.keys(changedForState).length || unlockFields.length)) {
      const metadata = existingMetadata;
      metadata.field_state = applyFieldStatePatch(metadata.field_state, changedForState, {
        source: options.source || 'manual',
        lock: options.lock,
        unlockFields,
        now: options.now,
      });
      values.production_metadata = serializeCanonicalJson(metadata);
    }
    if (Object.keys(values).length) {
      values.updated_at = options.now || new Date().toISOString();
      const fields = Object.keys(values);
      const sql = `UPDATE storyboards SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`;
      db.prepare(sql).run(...fields.map((field) => values[field]), id);
    }
    return loadProjectedStoryboard(db, id);
  });
}

function saveCanonicalStoryboard(db, episodeId, input = {}, options = {}) {
  const existingId = Number(input.id || options.storyboardId || 0);
  if (existingId && db.prepare('SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(existingId)) {
    return patchStoryboard(db, existingId, input, options);
  }
  const columns = getTableColumns(db, 'storyboards');
  const now = options.now || new Date().toISOString();
  const values = {
    episode_id: Number(episodeId),
    storyboard_number: Number(input.storyboard_number ?? input.shot_number ?? 0) || 0,
    status: input.status || 'pending',
    created_at: input.created_at || now,
    updated_at: now,
  };
  for (const field of [...STORYBOARD_SCALAR_FIELDS, ...STORYBOARD_JSON_FIELDS, 'is_primary']) {
    if (input[field] === undefined || field === 'production_metadata') continue;
    values[field] = serializeStoryboardValue(field, input[field], null, options);
  }
  values.is_primary = input.is_primary ? 1 : 0;

  if (columns.has('production_metadata')) {
    const metadata = parseJsonObjectLossless(input.production_metadata);
    const statePatch = {};
    for (const field of FIELD_STATE_ROOTS) {
      if (input[field] !== undefined) statePatch[field] = input[field];
    }
    metadata.field_state = applyFieldStatePatch(metadata.field_state, statePatch, {
      source: options.source || 'default',
      lock: options.lock,
      now,
    });
    values.production_metadata = serializeCanonicalJson(metadata);
  }

  const fields = Object.keys(values).filter((field) => columns.has(field));
  const placeholders = fields.map(() => '?').join(', ');
  const info = db.prepare(
    `INSERT INTO storyboards (${fields.join(', ')}) VALUES (${placeholders})`,
  ).run(...fields.map((field) => values[field]));
  return loadProjectedStoryboard(db, Number(info.lastInsertRowid));
}

module.exports = {
  STORYBOARD_SCALAR_FIELDS,
  projectStoryboardRow,
  projectEpisodeRow,
  saveCanonicalStoryboard,
  patchStoryboard,
  applyFieldStatePatch,
};
