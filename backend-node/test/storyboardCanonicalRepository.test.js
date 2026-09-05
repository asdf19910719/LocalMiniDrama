const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const {
  projectStoryboardRow,
  projectEpisodeRow,
  saveCanonicalStoryboard,
  patchStoryboard,
} = require('../src/services/storyboardCanonicalRepository');

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, 'D', 'draft', ?, ?)").run(now, now);
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (2, 1, 1, 'E', 'draft', ?, ?)").run(now, now);
  return db;
}

test('projection returns parsed AV fields, production metadata, and primary marker', () => {
  const projected = projectStoryboardRow({
    id: 7,
    audio_description: JSON.stringify({ version: 1, ambience: ['rain'] }),
    transition: JSON.stringify({ version: 1, type: 'cut', duration: 0 }),
    layout_description: 'left/right anchor',
    production_metadata: JSON.stringify({ field_state: { layout_description: { source: 'manual', locked: true, revision: 1 } } }),
    continuity_snapshot: JSON.stringify({ lighting: 'cold' }),
    is_primary: 1,
    characters: '[2,1]',
  }, [{ variant_id: 9 }]);
  assert.deepEqual(projected.audio_description.ambience, ['rain']);
  assert.equal(projected.transition.type, 'cut');
  assert.equal(projected.layout_description, 'left/right anchor');
  assert.equal(projected.is_primary, true);
  assert.equal(projected.production_metadata.field_state.layout_description.locked, true);
  assert.deepEqual(projected.continuity_snapshot, { lighting: 'cold' });
  assert.deepEqual(projected.character_variant_links, [{ variant_id: 9 }]);
});

test('episode projection returns a default-none audio plan and parsed production profile', () => {
  const projected = projectEpisodeRow({
    id: 2,
    audio_plan: null,
    production_profile: JSON.stringify({ generation_mode: 'import' }),
  });
  assert.equal(projected.audio_plan.bgm.mode, 'none');
  assert.deepEqual(projected.production_profile, { generation_mode: 'import' });
});

test('patch does not null fields absent from the request', (t) => {
  const db = createDb();
  t.after(() => db.close());
  const created = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    title: 'old',
    layout_description: 'anchor',
    audio_description: { ambience: ['rain'] },
    transition: { type: 'cut' },
  });
  patchStoryboard(db, created.id, { title: 'renamed' }, { clearFields: [] });
  const row = db.prepare('SELECT title, layout_description, audio_description, transition FROM storyboards WHERE id = ?').get(created.id);
  assert.equal(row.title, 'renamed');
  assert.equal(row.layout_description, 'anchor');
  assert.match(row.audio_description, /rain/);
  assert.match(row.transition, /cut/);
});

test('clear_fields clears only named nullable fields', (t) => {
  const db = createDb();
  t.after(() => db.close());
  const created = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    audio_description: { ambience: ['rain'] },
    transition: { type: 'cut' },
  });
  patchStoryboard(db, created.id, {}, { clearFields: ['transition'] });
  const row = db.prepare('SELECT audio_description, transition FROM storyboards WHERE id = ?').get(created.id);
  assert.notEqual(row.audio_description, null);
  assert.equal(row.transition, null);
  assert.throws(
    () => patchStoryboard(db, created.id, {}, { clearFields: ['episode_id'] }),
    (error) => error.code === 'STORYBOARD_PATCH_INVALID',
  );
});

test('legacy explicit null still clears existing nullable scalar fields', (t) => {
  const db = createDb();
  t.after(() => db.close());
  const created = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    video_url: '/static/a.mp4',
    first_frame_image_id: 7,
    audio_description: { ambience: ['rain'] },
  });
  patchStoryboard(db, created.id, { video_url: null, first_frame_image_id: null }, { clearFields: [] });
  const row = db.prepare('SELECT video_url, first_frame_image_id, audio_description FROM storyboards WHERE id = ?').get(created.id);
  assert.equal(row.video_url, null);
  assert.equal(row.first_frame_image_id, null);
  assert.notEqual(row.audio_description, null);
});

test('manual nested patch merges values and atomically locks only changed leaf paths', (t) => {
  const db = createDb();
  t.after(() => db.close());
  const created = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    audio_description: {
      ambience: ['rain'],
      sound_effects: ['old door'],
      music_cue: { mode: 'inherit', prompt: 'old score', intensity: 0.3 },
    },
  }, { source: 'story_ai' });
  const updated = patchStoryboard(db, created.id, {
    audio_description: { music_cue: { prompt: 'manual piano' } },
  }, { source: 'manual', clearFields: [], now: '2026-09-05T01:00:00.000Z' });
  assert.deepEqual(updated.audio_description.ambience, ['rain']);
  assert.deepEqual(updated.audio_description.sound_effects, ['old door']);
  assert.equal(updated.audio_description.music_cue.prompt, 'manual piano');
  const state = updated.production_metadata.field_state['audio_description.music_cue.prompt'];
  assert.deepEqual(state, {
    source: 'manual',
    locked: true,
    revision: 2,
    updated_at: '2026-09-05T01:00:00.000Z',
  });
});

test('unlock_fields releases AI ownership without changing the value', (t) => {
  const db = createDb();
  t.after(() => db.close());
  const created = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    layout_description: 'left anchor',
  });
  patchStoryboard(db, created.id, { layout_description: 'manual anchor' }, { source: 'manual' });
  const updated = patchStoryboard(db, created.id, {}, { unlockFields: ['layout_description'] });
  assert.equal(updated.layout_description, 'manual anchor');
  assert.equal(updated.production_metadata.field_state.layout_description.locked, false);
});

test('AI regeneration respects manually locked scalar and nested leaves', (t) => {
  const db = createDb();
  t.after(() => db.close());
  const created = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    layout_description: 'AI layout',
    audio_description: { ambience: ['rain'], music_cue: { mode: 'inherit', prompt: 'old score' } },
  }, { source: 'story_ai', lock: false });
  patchStoryboard(db, created.id, {
    layout_description: 'manual layout',
    audio_description: { music_cue: { prompt: 'manual piano' } },
  }, { source: 'manual', lock: true });
  const regenerated = patchStoryboard(db, created.id, {
    layout_description: 'new AI layout',
    audio_description: { ambience: ['wind'], music_cue: { prompt: 'new AI score', intensity: 0.8 } },
  }, { source: 'story_ai', lock: false, respectLocks: true });
  assert.equal(regenerated.layout_description, 'manual layout');
  assert.equal(regenerated.audio_description.music_cue.prompt, 'manual piano');
  assert.deepEqual(regenerated.audio_description.ambience, ['wind']);
  assert.equal(regenerated.audio_description.music_cue.intensity, 0.8);
});
