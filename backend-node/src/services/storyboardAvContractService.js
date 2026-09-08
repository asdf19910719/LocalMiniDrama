const BGM_MODES = new Set(['none', 'episode_track', 'per_segment']);
const BGM_PLANNING_MODES = new Set(['manual', 'ai', 'external']);
const BGM_SOURCE_TYPES = new Set(['none', 'local_file', 'media_library', 'generated']);
const SPEECH_OWNERS = new Set(['h3_native', 'post_tts', 'none']);
const MUSIC_CUE_MODES = new Set(['inherit', 'override', 'mute', 'stinger']);
const TRANSITION_TYPES = new Set(['cut', 'dissolve', 'fade']);

function contractError(message) {
  const error = new Error(`AUDIO_PLAN_INVALID: ${message}`);
  error.code = 'AUDIO_PLAN_INVALID';
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseObjectOrText(value, fieldName) {
  if (isPlainObject(value)) return { object: value, raw: null };
  if (typeof value !== 'string') {
    throw contractError(`${fieldName} must be an object or string`);
  }

  const trimmed = value.trim();
  if (!trimmed) return { object: {}, raw: '' };
  try {
    const parsed = JSON.parse(trimmed);
    if (isPlainObject(parsed)) return { object: parsed, raw: null };
  } catch (_) {
    // Ordinary legacy text is deliberately retained below.
  }
  return { object: {}, raw: value };
}

function normalizeStringArray(value) {
  if (value == null || value === '') return [];
  const source = Array.isArray(value) ? value : [value];
  return source
    .filter((item) => item != null && String(item).trim())
    .map((item) => String(item).trim());
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback) {
  return Math.min(max, Math.max(min, numberOr(value, fallback)));
}

function normalizeNullableOwner(value, fieldName) {
  if (value == null || value === '') return null;
  if (!SPEECH_OWNERS.has(value)) throw contractError(`${fieldName} has unsupported owner ${value}`);
  return value;
}

function normalizeOwner(value, fallback, fieldName) {
  const owner = value == null || value === '' ? fallback : value;
  if (!SPEECH_OWNERS.has(owner)) throw contractError(`${fieldName} has unsupported owner ${owner}`);
  return owner;
}

function normalizeFieldState(value) {
  if (value == null) return {};
  if (!isPlainObject(value)) throw contractError('field_state must be an object');
  const normalized = {};
  for (const [path, state] of Object.entries(value)) {
    if (!path || !isPlainObject(state)) throw contractError(`invalid field_state entry ${path || '<empty>'}`);
    normalized[path] = {
      source: typeof state.source === 'string' && state.source ? state.source : 'default',
      locked: state.locked === true,
      revision: Math.max(0, Math.trunc(numberOr(state.revision, 0))),
      updated_at: typeof state.updated_at === 'string' && state.updated_at ? state.updated_at : null,
    };
  }
  return normalized;
}

function normalizeEpisodeAudioPlan(value, options = {}) {
  let input = {};
  if (value != null && value !== '') {
    const parsed = parseObjectOrText(value, 'audio_plan');
    if (parsed.raw !== null) throw contractError('audio_plan text must contain a JSON object');
    input = parsed.object;
  }

  const bgmInput = input.bgm == null ? {} : input.bgm;
  if (!isPlainObject(bgmInput)) throw contractError('bgm must be an object');
  const mode = bgmInput.mode == null || bgmInput.mode === '' ? 'none' : bgmInput.mode;
  if (!BGM_MODES.has(mode)) throw contractError(`unsupported bgm.mode ${mode}`);
  const planning = bgmInput.planning == null || bgmInput.planning === '' ? 'manual' : bgmInput.planning;
  if (!BGM_PLANNING_MODES.has(planning)) throw contractError(`unsupported bgm.planning ${planning}`);
  const sourceType = bgmInput.source_type == null || bgmInput.source_type === ''
    ? 'none'
    : bgmInput.source_type;
  if (!BGM_SOURCE_TYPES.has(sourceType)) throw contractError(`unsupported bgm.source_type ${sourceType}`);

  const speechInput = input.speech == null ? {} : input.speech;
  if (!isPlainObject(speechInput)) throw contractError('speech must be an object');
  const masteringInput = input.mastering == null ? {} : input.mastering;
  if (!isPlainObject(masteringInput)) throw contractError('mastering must be an object');
  const provenanceInput = isPlainObject(input.provenance) ? input.provenance : {};

  const known = new Set(['version', 'bgm', 'mastering', 'speech', 'field_state', 'provenance', 'extensions']);
  const extensions = isPlainObject(input.extensions) ? { ...input.extensions } : {};
  for (const [key, item] of Object.entries(input)) {
    if (!known.has(key)) extensions[key] = item;
  }

  return {
    version: 1,
    bgm: {
      mode,
      prompt: bgmInput.prompt == null ? null : String(bgmInput.prompt),
      planning,
      continuity_key: bgmInput.continuity_key == null ? null : String(bgmInput.continuity_key),
      source_type: sourceType,
      local_path: bgmInput.local_path == null ? null : String(bgmInput.local_path),
      volume_db: numberOr(bgmInput.volume_db, -22),
      ducking_db: numberOr(bgmInput.ducking_db, -8),
      fade_in_ms: Math.max(0, numberOr(bgmInput.fade_in_ms, 800)),
      fade_out_ms: Math.max(0, numberOr(bgmInput.fade_out_ms, 1200)),
      crossfade_ms: Math.max(0, numberOr(bgmInput.crossfade_ms, 500)),
    },
    mastering: {
      target_lufs: numberOr(masteringInput.target_lufs, -14),
      true_peak_db: numberOr(masteringInput.true_peak_db, -1),
    },
    speech: {
      dialogue_owner: normalizeOwner(
        speechInput.dialogue_owner,
        options.dialogueOwner || 'h3_native',
        'speech.dialogue_owner',
      ),
      narration_owner: normalizeOwner(
        speechInput.narration_owner,
        options.narrationOwner || 'post_tts',
        'speech.narration_owner',
      ),
    },
    field_state: normalizeFieldState(input.field_state),
    provenance: {
      ...provenanceInput,
      source: provenanceInput.source || options.source || 'default',
      updated_at: provenanceInput.updated_at || null,
    },
    extensions,
  };
}

function normalizeStoryboardAudioDescription(value, options = {}) {
  if (value == null) return null;
  const { object: input, raw } = parseObjectOrText(value, 'audio_description');
  const cueInput = input.music_cue == null ? {} : input.music_cue;
  if (!isPlainObject(cueInput)) throw contractError('music_cue must be an object');
  const defaultCueMode = options.bgmMode === 'per_segment' ? 'inherit' : 'mute';
  const cueMode = cueInput.mode == null || cueInput.mode === '' ? defaultCueMode : cueInput.mode;
  if (!MUSIC_CUE_MODES.has(cueMode)) throw contractError(`unsupported music_cue.mode ${cueMode}`);

  const speechInput = input.speech_override == null ? {} : input.speech_override;
  if (!isPlainObject(speechInput)) throw contractError('speech_override must be an object');
  const provenanceInput = isPlainObject(input.provenance) ? input.provenance : {};
  const known = new Set([
    'version', 'ambience', 'ambient', 'sound_effects', 'sound_effect',
    'dialogue_treatment', 'diegetic_music', 'silence', 'music_cue',
    'speech_override', 'raw_description', 'extensions', 'provenance',
    'non_diegetic_music',
  ]);
  const extensions = isPlainObject(input.extensions) ? { ...input.extensions } : {};
  for (const [key, item] of Object.entries(input)) {
    if (!known.has(key)) extensions[key] = item;
  }

  let effectiveCueMode = cueMode;
  let effectiveCuePrompt = cueInput.prompt == null ? null : String(cueInput.prompt);
  if (input.non_diegetic_music != null && input.non_diegetic_music !== '') {
    effectiveCueMode = 'override';
    effectiveCuePrompt = typeof input.non_diegetic_music === 'string'
      ? input.non_diegetic_music
      : serializeCanonicalJson(input.non_diegetic_music);
  }

  return {
    version: 1,
    ambience: normalizeStringArray(input.ambience ?? input.ambient),
    sound_effects: normalizeStringArray(input.sound_effects ?? input.sound_effect),
    dialogue_treatment: input.dialogue_treatment == null ? null : String(input.dialogue_treatment),
    diegetic_music: input.diegetic_music ?? null,
    silence: input.silence === true,
    music_cue: {
      mode: effectiveCueMode,
      prompt: effectiveCuePrompt,
      intensity: clamp(cueInput.intensity, 0, 1, effectiveCueMode === 'mute' ? 0 : 0.5),
      start: cueInput.start == null ? null : String(cueInput.start),
      end: cueInput.end == null ? null : String(cueInput.end),
    },
    speech_override: {
      dialogue_owner: normalizeNullableOwner(speechInput.dialogue_owner, 'speech_override.dialogue_owner'),
      narration_owner: normalizeNullableOwner(speechInput.narration_owner, 'speech_override.narration_owner'),
    },
    raw_description: raw !== null
      ? raw
      : (input.raw_description == null ? null : String(input.raw_description)),
    extensions,
    provenance: {
      ...provenanceInput,
      source: provenanceInput.source || options.source || (raw !== null ? 'legacy' : 'default'),
    },
  };
}

function reconcileStoryboardAudioWithEpisodePlan(audio, episodeAudioPlan) {
  if (!audio || episodeAudioPlan?.bgm?.mode === 'per_segment') return audio;
  const cue = audio.music_cue || {};
  return {
    ...audio,
    music_cue: {
      ...cue,
      mode: 'mute',
      prompt: null,
      intensity: 0,
    },
  };
}

function normalizeTransitionType(value) {
  if (value == null || value === '') return { type: 'cut', visualDescription: null };
  const normalized = String(value).trim().toLowerCase();
  const aliases = {
    cut: 'cut',
    'hard cut': 'cut',
    '硬切': 'cut',
    '切': 'cut',
    dissolve: 'dissolve',
    '溶解': 'dissolve',
    '叠化': 'dissolve',
    fade: 'fade',
    '淡入淡出': 'fade',
    '淡出': 'fade',
  };
  const type = aliases[normalized];
  return type
    ? { type, visualDescription: null }
    : { type: 'cut', visualDescription: String(value) };
}

function normalizeStoryboardTransition(value) {
  if (value == null) return null;
  const { object: input, raw } = parseObjectOrText(value, 'transition');
  const sourceType = input.type ?? input.to_next ?? raw;
  const mapped = normalizeTransitionType(sourceType);
  const bridgeInput = input.audio_bridge == null ? {} : input.audio_bridge;
  if (!isPlainObject(bridgeInput)) throw contractError('audio_bridge must be an object');
  const known = new Set([
    'version', 'type', 'to_next', 'duration', 'visual_description',
    'audio_bridge', 'extensions',
  ]);
  const extensions = isPlainObject(input.extensions) ? { ...input.extensions } : {};
  for (const [key, item] of Object.entries(input)) {
    if (!known.has(key)) extensions[key] = item;
  }
  return {
    version: 1,
    type: mapped.type,
    duration: Math.max(0, numberOr(input.duration, 0)),
    visual_description: input.visual_description == null
      ? mapped.visualDescription
      : String(input.visual_description),
    audio_bridge: {
      mode: bridgeInput.mode == null ? 'carry' : String(bridgeInput.mode),
      duration_ms: Math.max(0, numberOr(bridgeInput.duration_ms, 0)),
      ...(bridgeInput.description == null ? {} : { description: String(bridgeInput.description) }),
    },
    extensions,
  };
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (value[key] !== undefined) result[key] = sortCanonical(value[key]);
      return result;
    }, {});
}

function serializeCanonicalJson(value) {
  return JSON.stringify(sortCanonical(value));
}

module.exports = {
  BGM_MODES,
  MUSIC_CUE_MODES,
  SPEECH_OWNERS,
  normalizeEpisodeAudioPlan,
  normalizeStoryboardAudioDescription,
  reconcileStoryboardAudioWithEpisodePlan,
  normalizeStoryboardTransition,
  normalizeFieldState,
  serializeCanonicalJson,
};
