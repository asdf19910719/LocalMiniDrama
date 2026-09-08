const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const createDramaRoutes = require('../src/routes/drama');
const { serializeCanonicalJson } = require('../src/services/storyboardAvContractService');
const { saveCanonicalStoryboard, patchStoryboard } = require('../src/services/storyboardCanonicalRepository');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function setup() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, 'D', 'draft', ?, ?)").run(now, now);
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, audio_plan, status, created_at, updated_at) VALUES (2, 1, 1, 'E', ?, 'draft', ?, ?)")
    .run(serializeCanonicalJson({ bgm: { mode: 'none', prompt: 'keep me' } }), now, now);
  saveCanonicalStoryboard(db, 2, { storyboard_number: 1, title: 'Shot', audio_description: { ambience: ['rain'] } }, { source: 'story_ai', now });
  const storageRoot = path.resolve(__dirname, '.media-test');
  return { db, routes: createDramaRoutes(db, { storage: { local_path: storageRoot } }, log), storageRoot };
}

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('audio-plan PATCH supports partial updates, returns canonical shots, and locks changed fields', (t) => {
  const { db, routes } = setup();
  t.after(() => db.close());
  const res = responseCapture();
  routes.updateEpisodeAudioPlan({ params: { id: 2 }, body: { audio_plan: { bgm: { mode: 'per_segment' } } } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.episode.audio_plan.bgm.mode, 'per_segment');
  assert.equal(res.body.data.episode.audio_plan.bgm.prompt, 'keep me');
  assert.equal(res.body.data.episode.audio_plan.field_state['bgm.mode'].locked, true);
  assert.deepEqual(res.body.data.storyboards[0].audio_description.ambience, ['rain']);
});

test('audio-plan PATCH can unlock AI-managed fields without losing values', (t) => {
  const { db, routes } = setup();
  t.after(() => db.close());
  let res = responseCapture();
  routes.updateEpisodeAudioPlan({ params: { id: 2 }, body: { audio_plan: { bgm: { prompt: 'manual score' } } } }, res);
  assert.equal(res.body.data.episode.audio_plan.field_state['bgm.prompt'].locked, true);
  res = responseCapture();
  routes.updateEpisodeAudioPlan({ params: { id: 2 }, body: { audio_plan: {}, unlock_fields: ['bgm.prompt'] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.episode.audio_plan.bgm.prompt, 'manual score');
  assert.equal(res.body.data.episode.audio_plan.field_state['bgm.prompt'].locked, false);
});

test('audio-plan PATCH rejects a BGM path outside project media storage', (t) => {
  const { db, routes, storageRoot } = setup();
  t.after(() => db.close());
  const res = responseCapture();
  const outside = path.resolve(storageRoot, '..', 'outside.mp3');
  routes.updateEpisodeAudioPlan({ params: { id: 2 }, body: { audio_plan: { bgm: { mode: 'episode_track', local_path: outside } } } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'EPISODE_AUDIO_PATH_INVALID');
});

test('audio-plan PATCH mutes stale cues on every shot for episode_track', (t) => {
  const { db, routes } = setup();
  t.after(() => db.close());
  const shot = db.prepare('SELECT id FROM storyboards WHERE episode_id = 2 LIMIT 1').get();
  patchStoryboard(db, shot.id, {
    audio_description: { music_cue: { mode: 'stinger', prompt: 'single low hit', intensity: 0.8 } },
  }, { source: 'manual', lock: false, now: '2026-09-05T00:01:00.000Z' });
  saveCanonicalStoryboard(db, 2, {
    storyboard_number: 2,
    title: 'Shot 2',
    audio_description: { music_cue: { mode: 'override', prompt: 'low strings', intensity: 0.6 } },
  }, { source: 'manual', lock: false, now: '2026-09-05T00:01:00.000Z' });

  const res = responseCapture();
  routes.updateEpisodeAudioPlan({ params: { id: 2 }, body: { audio_plan: { bgm: { mode: 'episode_track' } } } }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.storyboards.length, 2);
  for (const storyboard of res.body.data.storyboards) {
    assert.equal(storyboard.audio_description.music_cue.mode, 'mute');
    assert.equal(storyboard.audio_description.music_cue.prompt, null);
    assert.equal(storyboard.audio_description.music_cue.intensity, 0);
  }
});

test('audio-plan PATCH preserves shot stingers for per_segment', (t) => {
  const { db, routes } = setup();
  t.after(() => db.close());
  const shot = db.prepare('SELECT id FROM storyboards WHERE episode_id = 2 LIMIT 1').get();
  patchStoryboard(db, shot.id, {
    audio_description: { music_cue: { mode: 'stinger', prompt: 'single low hit', intensity: 0.8 } },
  }, { source: 'manual', lock: false, now: '2026-09-05T00:01:00.000Z' });

  const res = responseCapture();
  routes.updateEpisodeAudioPlan({ params: { id: 2 }, body: { audio_plan: { bgm: { mode: 'per_segment' } } } }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.storyboards[0].audio_description.music_cue.mode, 'stinger');
  assert.equal(res.body.data.storyboards[0].audio_description.music_cue.prompt, 'single low hit');
});
