const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { saveCanonicalStoryboard } = require('../src/services/storyboardCanonicalRepository');
const { createH3PromptDraftService } = require('../src/services/h3PromptDraftService');

const PROMPT = [
  'subject_definitions:',
  '<Subject 1> is Lin Xia in <Picture 1>, used as character identity.',
  '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).',
  'summary:',
  '[reference generation + audio reference] Lin Xia opens the door.',
  'retention_analysis:',
  '<Subject 1>: fully_preserved - identity retained.',
  '<Audio 1>: reference - voice timbre retained.',
  'detailed_description:',
  '[Shot 1] <Subject 1> from <Picture 1> opens the door; <Audio 1> anchors voice timbre and a harsh metal scrape follows the movement.',
  'overall_soundscape: Rain and a harsh metal door scrape.',
  'non_diegetic_music: N/A',
].join('\n');

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, 'D', 'draft', ?, ?)").run(now, now);
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, audio_plan, status, created_at, updated_at) VALUES (2, 1, 1, 'E', ?, 'draft', ?, ?)")
    .run(JSON.stringify({ bgm: { mode: 'none' }, speech: { dialogue_owner: 'none', narration_owner: 'post_tts' } }), now, now);
  db.prepare("INSERT INTO characters (id, drama_id, name, seedance2_voice_asset, created_at, updated_at) VALUES (3, 1, 'Lin Xia', ?, ?, ?)")
    .run(JSON.stringify({ status: 'active', local_path: '/static/lin.wav', updated_at: now }), now, now);
  db.prepare("INSERT INTO character_variants (id, character_id, source_key, name, image_url, created_at, updated_at) VALUES (4, 3, 'normal', 'normal', '/static/lin.png', ?, ?)").run(now, now);
  const shot = saveCanonicalStoryboard(db, 2, {
    storyboard_number: 1,
    duration: 6,
    universal_segment_text: 'Lin Xia opens a metal door',
    audio_description: { sound_effects: ['金属门摩擦声'], music_cue: { mode: 'mute' } },
  }, { source: 'import', lock: false, now });
  db.prepare("INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order) VALUES (?, 3, 4, 'character_identity', 1)").run(shot.id);
  db.prepare(
    `INSERT INTO ai_service_configs (id, service_type, provider, api_protocol, name, model, default_model, settings, is_default, is_active, created_at, updated_at)
     VALUES (7, 'video', 'comfyui', 'minimax_h3', 'H3', '["minimax-h3"]', 'minimax-h3', '{"width":864,"height":480}', 1, 1, ?, ?)`,
  ).run(now, now);
  return { db, storyboardId: shot.id };
}

test('draft persists normalized context, audio labels, and review confirmation bound to prompt hash', async (t) => {
  const { db, storyboardId } = createDb();
  t.after(() => db.close());
  const service = createH3PromptDraftService({
    compileFn: async (_db, _log, input) => {
      assert.equal(input.context.episode.audio_plan.bgm.mode, 'none');
      assert.equal(input.referenceAudios[0].audio_url, '/static/lin.wav');
      return { sourcePrompt: input.prompt, compiledPrompt: PROMPT, promptFormat: 'Ref2VA', compilerVersion: 'h3-skill-agent-v1', skillProvenance: {} };
    },
    semanticReviewFn: async () => ({
      status: 'uncertain',
      manifest: { version: 1, events: [{ id: 'sfx_1', status: 'uncertain', evidence: 'possible scrape' }] },
    }),
  });
  const draft = await service.compileDraft(db, {}, {}, { storyboardId, videoConfigId: 7 });
  assert.equal(draft.status, 'needs_review');
  assert.equal(draft.semantic_review_status, 'uncertain');
  assert.equal(draft.semantic_review_confirmed, 0);
  const snapshot = JSON.parse(draft.reference_snapshot);
  assert.equal(snapshot.audio[0].audio_url, '/static/lin.wav');
  assert.equal(snapshot.context.episode.audio_plan.bgm.mode, 'none');

  const confirmed = service.confirmSemanticReview(db, { draftId: draft.id, promptHash: draft.compiled_prompt_hash });
  assert.equal(confirmed.semantic_review_confirmed, 1);
  assert.throws(
    () => service.confirmSemanticReview(db, { draftId: draft.id, promptHash: 'stale-hash' }),
    (error) => error.code === 'H3_SEMANTIC_REVIEW_REQUIRED',
  );
});
