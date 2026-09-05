const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const sceneService = require('../src/services/sceneService');

const {
  mapAiStoryboardToCanonical,
  saveStoryboards,
} = require('../src/services/episodeStoryboardService');
const { saveCanonicalStoryboard, patchStoryboard } = require('../src/services/storyboardCanonicalRepository');

test('AI storyboard production fields are mapped into the canonical AV contract', () => {
  const canonical = mapAiStoryboardToCanonical({
    shot_number: 2,
    layout_description: 'woman left, door right',
    bgm_prompt: 'restrained strings',
    sound_effect: 'metal door scrape',
    emotion: 'tense',
    emotion_intensity: 3,
    is_primary: true,
    lighting_style: 'dramatic',
    depth_of_field: 'shallow',
  }, { episodeAudioPlan: { bgm: { mode: 'per_segment' } } });

  assert.equal(canonical.storyboard_number, 2);
  assert.equal(canonical.layout_description, 'woman left, door right');
  assert.deepEqual(canonical.audio_description.sound_effects, ['metal door scrape']);
  assert.equal(canonical.audio_description.music_cue.mode, 'override');
  assert.equal(canonical.audio_description.music_cue.prompt, 'restrained strings');
  assert.equal(canonical.emotion, 'tense');
  assert.equal(canonical.emotion_intensity, 3);
  assert.equal(canonical.is_primary, true);
  assert.equal(canonical.lighting_style, 'dramatic');
  assert.equal(canonical.depth_of_field, 'shallow');
});

test('AI mapping never enables BGM from emotion and mutes shot music outside per_segment mode', () => {
  const canonical = mapAiStoryboardToCanonical({
    shot_number: 1,
    emotion: 'epic and triumphant',
    bgm_prompt: 'large heroic orchestra',
    sound_effect: '',
  }, { episodeAudioPlan: { bgm: { mode: 'none' } } });

  assert.equal(canonical.audio_description.music_cue.mode, 'mute');
  assert.equal(canonical.audio_description.music_cue.prompt, null);
});

test('AI mapping keeps structured audio returned by a compatible generator', () => {
  const canonical = mapAiStoryboardToCanonical({
    shot_number: 3,
    audio_description: {
      ambience: ['rain'],
      sound_effects: ['shoe scrape'],
      music_cue: { mode: 'stinger', prompt: 'single low hit', intensity: 0.8 },
    },
  }, { episodeAudioPlan: { bgm: { mode: 'per_segment' } } });

  assert.deepEqual(canonical.audio_description.ambience, ['rain']);
  assert.deepEqual(canonical.audio_description.sound_effects, ['shoe scrape']);
  assert.equal(canonical.audio_description.music_cue.mode, 'stinger');
  assert.equal(canonical.audio_description.music_cue.prompt, 'single low hit');
});

test('AI mapping merges legacy sound and BGM leaves into a partial structured audio object', () => {
  const canonical = mapAiStoryboardToCanonical({
    shot_number: 4,
    audio_description: { ambience: ['rain'] },
    sound_effect: 'metal door scrape',
    bgm_prompt: 'restrained strings',
  }, { episodeAudioPlan: { bgm: { mode: 'per_segment' } } });
  assert.deepEqual(canonical.audio_description.ambience, ['rain']);
  assert.deepEqual(canonical.audio_description.sound_effects, ['metal door scrape']);
  assert.equal(canonical.audio_description.music_cue.mode, 'override');
  assert.equal(canonical.audio_description.music_cue.prompt, 'restrained strings');
});

test('background extraction persistence keeps scene atmosphere', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  runMigrationsAndEnsure(db);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, 'D', 'draft', ?, ?)").run(now, now);
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (2, 1, 1, 'E', 'draft', ?, ?)").run(now, now);
  sceneService.createSceneForEpisode(db, { info() {} }, 1, 2, {
    location: 'warehouse',
    time: 'night',
    prompt: 'abandoned warehouse',
    atmosphere: 'cold and damp',
  });
  assert.equal(db.prepare('SELECT atmosphere FROM scenes').get().atmosphere, 'cold and damp');
});

test('story regeneration keeps matched row identity and manually locked production fields', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  runMigrationsAndEnsure(db);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, 'D', 'draft', ?, ?)").run(now, now);
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (2, 1, 1, 'E', 'draft', ?, ?)").run(now, now);
  const created = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1, source_key: 'shot_a', layout_description: 'AI layout',
    audio_description: { ambience: ['rain'], music_cue: { mode: 'inherit', prompt: 'AI score' } },
  }, { source: 'story_ai', lock: false, now });
  patchStoryboard(db, created.id, {
    layout_description: 'manual layout',
    audio_description: { music_cue: { prompt: 'manual piano' } },
  }, { source: 'manual', lock: true, now });
  const saved = saveStoryboards(db, { info() {}, warn() {} }, 2, [{
    shot_number: 1, source_key: 'shot_a', composition: 'new AI layout',
    audio_description: { ambience: ['wind'], music_cue: { mode: 'inherit', prompt: 'new score' } },
  }], { style: { default_video_ratio: '16:9' } }, '', null, {
    episodeAudioPlan: { bgm: { mode: 'per_segment' } },
  });
  assert.equal(saved[0].id, created.id);
  assert.equal(saved[0].layout_description, 'manual layout');
  assert.equal(saved[0].audio_description.music_cue.prompt, 'manual piano');
  assert.deepEqual(saved[0].audio_description.ambience, ['wind']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM storyboards WHERE episode_id = 2 AND deleted_at IS NULL').get().count, 1);
});
