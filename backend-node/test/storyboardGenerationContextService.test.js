const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { saveCanonicalStoryboard } = require('../src/services/storyboardCanonicalRepository');
const {
  buildStoryboardGenerationContext,
  generationContextFingerprint,
} = require('../src/services/storyboardGenerationContextService');

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, genre, style, metadata, status, created_at, updated_at) VALUES (1, 'D', '悬疑', 'cinematic', '{}', 'draft', ?, ?)").run(now, now);
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, script_content, audio_plan, status, created_at, updated_at) VALUES (2, 1, 1, 'E', '她在雨夜开门。', ?, 'draft', ?, ?)")
    .run(JSON.stringify({ bgm: { mode: 'per_segment', prompt: 'shared theme', planning: 'manual' } }), now, now);
  db.prepare("INSERT INTO scenes (id, drama_id, episode_id, location, time, prompt, atmosphere, negative_prompt, updated_at, created_at) VALUES (3, 1, 2, '门厅', '夜', 'dark hall', 'cold rain', 'sunlight', ?, ?)").run(now, now);
  db.prepare("INSERT INTO characters (id, drama_id, name, appearance, negative_prompt, seedance2_voice_asset, created_at, updated_at) VALUES (4, 1, '林夏', '湿外套', 'red dress', ?, ?, ?)")
    .run(JSON.stringify({ status: 'active', local_path: '/static/voice.wav', updated_at: now }), now, now);
  db.prepare("INSERT INTO character_variants (id, character_id, source_key, name, appearance, image_url, updated_at, created_at) VALUES (5, 4, 'wet', '雨夜', '湿外套', '/static/wet.png', ?, ?)").run(now, now);
  db.prepare("INSERT INTO props (id, drama_id, name, description, negative_prompt, created_at, updated_at) VALUES (6, 1, '钥匙', '旧铜钥匙', 'oversized', ?, ?)").run(now, now);
  const shot = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    scene_id: 3,
    title: '开门',
    action: '林夏推开门',
    dialogue: '有人在里面吗？',
    universal_segment_text: 'woman opens the door @图片1',
    video_prompt: 'legacy visual prompt。音效：door scrape',
    characters: [4],
    audio_description: {
      ambience: ['rain'],
      sound_effects: ['door scrape'],
      music_cue: { mode: 'inherit', intensity: 0.7 },
    },
    transition: { type: 'cut', audio_bridge: { mode: 'carry', duration_ms: 300 } },
    continuity_snapshot: { wardrobe: 'wet coat' },
  }, { source: 'import', lock: false, now });
  db.prepare("INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note) VALUES (?, 4, 5, 'character_identity', 1, 'keep wet hair')").run(shot.id);
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, 6)').run(shot.id);
  return { db, storyboardId: shot.id };
}

test('universal visual prompt does not hide audiovisual sidecars', (t) => {
  const { db, storyboardId } = createDb();
  t.after(() => db.close());
  const context = buildStoryboardGenerationContext(db, storyboardId);
  assert.equal(context.version, 1);
  assert.equal(context.storyboard.visual_prompt, 'woman opens the door @图片1');
  assert.deepEqual(context.audio.sound_effects, ['door scrape']);
  assert.equal(context.audio.ambience[0], 'rain');
  assert.equal(context.episode.audio_plan.bgm.mode, 'per_segment');
  assert.equal(context.transition.audio_bridge.mode, 'carry');
  assert.equal(context.scene.atmosphere, 'cold rain');
  assert.equal(context.scene.negative_prompt, 'sunlight');
  assert.equal(context.props[0].negative_prompt, 'oversized');
});

test('reference role, framing note, entity semantics, and audio reference participate in fingerprint', (t) => {
  const { db, storyboardId } = createDb();
  t.after(() => db.close());
  const before = buildStoryboardGenerationContext(db, storyboardId);
  const characterReference = before.references.find((item) => item.entity_type === 'character_variant');
  assert.equal(characterReference.entity_name, '林夏·雨夜');
  assert.equal(characterReference.reference_role, 'character_identity');
  assert.equal(characterReference.framing_note, 'keep wet hair');
  assert.equal(characterReference.audio_url, '/static/voice.wav');

  db.prepare('UPDATE storyboard_character_variants SET framing_note = ? WHERE storyboard_id = ?')
    .run('keep wet coat', storyboardId);
  const after = buildStoryboardGenerationContext(db, storyboardId);
  assert.notEqual(generationContextFingerprint(before), generationContextFingerprint(after));
  assert.equal(after.references.find((item) => item.entity_type === 'character_variant').framing_note, 'keep wet coat');
});

test('structured request overrides merge only explicit audio and transition leaves', (t) => {
  const { db, storyboardId } = createDb();
  t.after(() => db.close());
  const context = buildStoryboardGenerationContext(db, storyboardId, {
    fieldOverrides: {
      audio_description: { music_cue: { mode: 'mute' } },
      transition: { audio_bridge: { duration_ms: 900 } },
    },
  });
  assert.deepEqual(context.audio.sound_effects, ['door scrape']);
  assert.equal(context.audio.music_cue.mode, 'mute');
  assert.equal(context.transition.audio_bridge.mode, 'carry');
  assert.equal(context.transition.audio_bridge.duration_ms, 900);
});
