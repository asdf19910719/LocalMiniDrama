const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { serializeCanonicalJson } = require('../src/services/storyboardAvContractService');
const {
  saveCanonicalStoryboard,
  patchStoryboard,
} = require('../src/services/storyboardCanonicalRepository');
const { createEpisodeAudioPlanService } = require('../src/services/episodeAudioPlanService');

function createDb(audioPlan = {
  bgm: { mode: 'per_segment', planning: 'ai' },
  speech: { dialogue_owner: 'h3_native', narration_owner: 'post_tts' },
}) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, 'D', 'draft', ?, ?)").run(now, now);
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, script_content, audio_plan, status, created_at, updated_at) VALUES (2, 1, 1, 'E', '雨夜追逐', ?, 'draft', ?, ?)")
    .run(serializeCanonicalJson(audioPlan), now, now);
  saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    title: '门口',
    dialogue: '林夏：别过来。',
    emotion: '紧张',
    audio_description: { sound_effects: ['old door sound'] },
  }, { source: 'story_ai', lock: false, now });
  saveCanonicalStoryboard(db, 2, {
    storyboard_number: 2,
    title: '走廊',
    narration: '脚步越来越近。',
    emotion: '恐惧',
  }, { source: 'story_ai', lock: false, now });
  return db;
}

const log = { info() {}, warn() {}, error() {} };

function loadShot(db, number) {
  const row = db.prepare('SELECT audio_description, production_metadata FROM storyboards WHERE episode_id = 2 AND storyboard_number = ? AND deleted_at IS NULL').get(number);
  return {
    audio_description: JSON.parse(row.audio_description),
    production_metadata: JSON.parse(row.production_metadata),
  };
}

test('AI audio planning is one episode-wide call and persists every cue', async (t) => {
  const db = createDb();
  t.after(() => db.close());
  let calls = 0;
  const service = createEpisodeAudioPlanService({
    generateText: async (_db, _log, input) => {
      calls += 1;
      assert.match(input, /SHOT 1/);
      assert.match(input, /SHOT 2/);
      assert.match(input, /林夏：别过来/);
      return JSON.stringify({
        episode_bgm: { prompt: 'shared low strings', continuity_key: 'main_theme' },
        storyboard_cues: [
          { storyboard_number: 1, mode: 'inherit', intensity: 0.3, start: 'fade_in', end: 'continue' },
          { storyboard_number: 2, mode: 'mute', intensity: 0, start: 'cut', end: 'silence' },
        ],
      });
    },
  });

  await service.ensureEpisodeAudioPlan(db, log, { episodeId: 2, force: false });
  await service.ensureEpisodeAudioPlan(db, log, { episodeId: 2, force: false });

  assert.equal(calls, 1);
  assert.equal(loadShot(db, 2).audio_description.music_cue.mode, 'mute');
  const plan = JSON.parse(db.prepare('SELECT audio_plan FROM episodes WHERE id = 2').get().audio_plan);
  assert.equal(plan.bgm.prompt, 'shared low strings');
  assert.equal(plan.bgm.continuity_key, 'main_theme');
  assert.ok(plan.provenance.planned_at);
});
test('AI replanning refreshes unlocked AI leaves but preserves manually locked leaves', async (t) => {
  const db = createDb();
  t.after(() => db.close());
  const first = db.prepare('SELECT id FROM storyboards WHERE episode_id = 2 AND storyboard_number = 1').get();
  patchStoryboard(db, first.id, {
    audio_description: { music_cue: { mode: 'override', prompt: 'manual piano' } },
  }, { source: 'manual', now: '2026-09-05T00:30:00.000Z' });

  const service = createEpisodeAudioPlanService({
    generateText: async () => JSON.stringify({
      episode_bgm: { prompt: 'new episode theme', continuity_key: 'theme_v2' },
      storyboard_cues: [
        {
          storyboard_number: 1,
          mode: 'inherit',
          prompt: 'new AI cue',
          intensity: 0.6,
          sound_effects: ['new planned door sound'],
        },
        { storyboard_number: 2, mode: 'inherit', intensity: 0.2 },
      ],
    }),
  });

  await service.ensureEpisodeAudioPlan(db, log, { episodeId: 2, force: true });
  const shot = loadShot(db, 1);
  assert.equal(shot.audio_description.music_cue.prompt, 'manual piano');
  assert.deepEqual(shot.audio_description.sound_effects, ['new planned door sound']);
  assert.equal(shot.production_metadata.field_state['audio_description.music_cue.prompt'].source, 'manual');
});

test('planner is skipped unless the explicit episode strategy is per_segment plus ai', async (t) => {
  const db = createDb({ bgm: { mode: 'episode_track', planning: 'ai' } });
  t.after(() => db.close());
  let calls = 0;
  const service = createEpisodeAudioPlanService({ generateText: async () => { calls += 1; return '{}'; } });
  const plan = await service.ensureEpisodeAudioPlan(db, log, { episodeId: 2, force: true });
  assert.equal(calls, 0);
  assert.equal(plan.bgm.mode, 'episode_track');
});

test('planner rejects incomplete or duplicate storyboard coverage without partial writes', async (t) => {
  const db = createDb();
  t.after(() => db.close());
  const before = db.prepare('SELECT audio_plan FROM episodes WHERE id = 2').get().audio_plan;
  const service = createEpisodeAudioPlanService({
    generateText: async () => JSON.stringify({
      episode_bgm: { prompt: 'bad' },
      storyboard_cues: [
        { storyboard_number: 1, mode: 'inherit' },
        { storyboard_number: 1, mode: 'mute' },
      ],
    }),
  });
  await assert.rejects(
    () => service.ensureEpisodeAudioPlan(db, log, { episodeId: 2, force: true }),
    /exactly once/,
  );
  assert.equal(db.prepare('SELECT audio_plan FROM episodes WHERE id = 2').get().audio_plan, before);
});
