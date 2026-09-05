const aiClient = require('./aiClient');
const { safeParseAIJSON } = require('../utils/safeJson');
const {
  normalizeEpisodeAudioPlan,
  serializeCanonicalJson,
} = require('./storyboardAvContractService');
const {
  projectStoryboardRow,
  patchStoryboard,
} = require('./storyboardCanonicalRepository');

function plannerError(message) {
  const error = new Error(`EPISODE_AUDIO_PLAN_INVALID: ${message}`);
  error.code = 'EPISODE_AUDIO_PLAN_INVALID';
  return error;
}

function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function isLocked(state, path) {
  return !!(state && state[path] && state[path].locked === true);
}

function buildPlanningPrompt(episode, storyboards, audioPlan) {
  const shotText = storyboards.map((shot) => [
    `SHOT ${shot.storyboard_number}`,
    `title: ${shot.title || ''}`,
    `action: ${shot.action || ''}`,
    `dialogue: ${shot.dialogue || ''}`,
    `narration: ${shot.narration || ''}`,
    `emotion: ${shot.emotion || ''}`,
    `existing audio: ${serializeCanonicalJson(shot.audio_description)}`,
  ].join('\n')).join('\n\n');
  return [
    'Plan one coherent non-diegetic music arc for the entire episode.',
    'Return JSON only: {"episode_bgm":{"prompt":"...","continuity_key":"..."},"storyboard_cues":[{"storyboard_number":1,"mode":"inherit|override|mute|stinger","prompt":null,"intensity":0.5,"start":null,"end":null,"sound_effects":[]}]}.',
    'Every listed SHOT must appear exactly once. Do not invent or omit a shot.',
    `Episode title: ${episode.title || ''}`,
    `Episode script: ${episode.script_content || ''}`,
    `Current audio strategy: ${serializeCanonicalJson(audioPlan)}`,
    shotText,
  ].join('\n\n');
}

function normalizePlannerResult(raw, storyboardNumbers) {
  const parsed = typeof raw === 'string' ? safeParseAIJSON(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw plannerError('planner response must be a JSON object');
  }
  const cues = parsed.storyboard_cues;
  if (!Array.isArray(cues)) throw plannerError('storyboard_cues must be an array');
  const expected = new Set(storyboardNumbers);
  const seen = new Set();
  for (const cue of cues) {
    const number = Number(cue && cue.storyboard_number);
    if (!Number.isInteger(number) || !expected.has(number) || seen.has(number)) {
      throw plannerError('every existing storyboard number must appear exactly once');
    }
    seen.add(number);
  }
  if (seen.size !== expected.size) {
    throw plannerError('every existing storyboard number must appear exactly once');
  }
  return {
    episodeBgm: parsed.episode_bgm && typeof parsed.episode_bgm === 'object'
      ? parsed.episode_bgm
      : {},
    cues,
  };
}

function createEpisodeAudioPlanService(dependencies = {}) {
  const generateText = dependencies.generateText || (async (db, log, input) => aiClient.generateText(
    db,
    log,
    'text',
    input,
    'You are an episode-wide audiovisual music planner. Return strict JSON only.',
    { scene_key: 'episode_audio_planning', temperature: 0.4 },
  ));

  async function ensureEpisodeAudioPlan(db, log, { episodeId, force = false } = {}) {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
    if (!episode) throw plannerError('episode not found');
    const currentPlan = normalizeEpisodeAudioPlan(episode.audio_plan);
    if (currentPlan.bgm.mode !== 'per_segment' || currentPlan.bgm.planning !== 'ai') return currentPlan;
    if (!force && currentPlan.provenance && currentPlan.provenance.planned_at) return currentPlan;

    const rows = db.prepare(
      'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC',
    ).all(Number(episodeId));
    if (rows.length === 0) throw plannerError('episode has no storyboards');
    const storyboards = rows.map((row) => projectStoryboardRow(row));
    const raw = await generateText(db, log, buildPlanningPrompt(episode, storyboards, currentPlan));
    const result = normalizePlannerResult(raw, storyboards.map((shot) => Number(shot.storyboard_number)));
    const now = new Date().toISOString();

    const persistedPlan = db.transaction(() => {
      const latestEpisode = db.prepare('SELECT audio_plan FROM episodes WHERE id = ?').get(Number(episodeId));
      const nextPlan = normalizeEpisodeAudioPlan(latestEpisode && latestEpisode.audio_plan);
      const episodeState = nextPlan.field_state || {};
      if (!isLocked(episodeState, 'bgm.prompt') && result.episodeBgm.prompt !== undefined) {
        nextPlan.bgm.prompt = result.episodeBgm.prompt == null ? null : String(result.episodeBgm.prompt);
        nextPlan.field_state['bgm.prompt'] = { source: 'story_audio_planner', locked: false, revision: Number(episodeState['bgm.prompt']?.revision || 0) + 1, updated_at: now };
      }
      if (!isLocked(episodeState, 'bgm.continuity_key') && result.episodeBgm.continuity_key !== undefined) {
        nextPlan.bgm.continuity_key = result.episodeBgm.continuity_key == null ? null : String(result.episodeBgm.continuity_key);
        nextPlan.field_state['bgm.continuity_key'] = { source: 'story_audio_planner', locked: false, revision: Number(episodeState['bgm.continuity_key']?.revision || 0) + 1, updated_at: now };
      }
      nextPlan.provenance = {
        ...(nextPlan.provenance || {}),
        source: 'story_audio_planner',
        updated_at: now,
        planned_at: now,
      };
      db.prepare('UPDATE episodes SET audio_plan = ?, updated_at = ? WHERE id = ?')
        .run(serializeCanonicalJson(nextPlan), now, Number(episodeId));

      const rowByNumber = new Map(rows.map((row) => [Number(row.storyboard_number), row]));
      for (const cue of result.cues) {
        const row = rowByNumber.get(Number(cue.storyboard_number));
        const metadata = parseObject(row.production_metadata);
        const state = metadata.field_state || {};
        const musicCue = {};
        for (const key of ['mode', 'prompt', 'intensity', 'start', 'end']) {
          if (cue[key] !== undefined && !isLocked(state, `audio_description.music_cue.${key}`)) {
            musicCue[key] = cue[key];
          }
        }
        const audioPatch = {};
        if (Object.keys(musicCue).length) audioPatch.music_cue = musicCue;
        if (cue.sound_effects !== undefined && !isLocked(state, 'audio_description.sound_effects')) {
          audioPatch.sound_effects = cue.sound_effects;
        }
        if (cue.ambience !== undefined && !isLocked(state, 'audio_description.ambience')) {
          audioPatch.ambience = cue.ambience;
        }
        if (Object.keys(audioPatch).length) {
          patchStoryboard(db, row.id, { audio_description: audioPatch }, {
            source: 'story_audio_planner',
            lock: false,
            now,
          });
        }
      }
      return nextPlan;
    })();
    log && log.info && log.info('Episode audio plan persisted', {
      episode_id: Number(episodeId),
      storyboard_count: rows.length,
      force: !!force,
    });
    return persistedPlan;
  }

  return { ensureEpisodeAudioPlan };
}

const defaultService = createEpisodeAudioPlanService();

module.exports = {
  buildPlanningPrompt,
  createEpisodeAudioPlanService,
  ensureEpisodeAudioPlan: defaultService.ensureEpisodeAudioPlan,
};
