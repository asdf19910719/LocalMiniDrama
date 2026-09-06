const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { importEpisodePackage, sha256Text } = require('../src/services/episodePackageService');
const { mapAiStoryboardToCanonical } = require('../src/services/episodeStoryboardService');
const { saveCanonicalStoryboard, patchStoryboard } = require('../src/services/storyboardCanonicalRepository');
const { buildUniversalSegmentUserPromptBundle } = require('../src/services/universalSegmentPromptBundle');
const { buildStoryboardGenerationContext, generationContextFingerprint } = require('../src/services/storyboardGenerationContextService');
const { createH3PromptCompiler } = require('../src/services/h3PromptCompiler');
const { serializeCanonicalJson } = require('../src/services/storyboardAvContractService');

const EXAMPLE_PATH = path.join(__dirname, 'fixtures', 'episodePackageV11.json');
const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-09-06T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, 'AV Pipeline', 'draft', ?, ?)").run(now, now);
  return db;
}

function deterministicH3(context, music) {
  const refs = (context.references || []).filter((item) => item.image_url);
  if (!refs.length) {
    return [
      'integrated_multimodal_description:',
      '[Shot 1] A continuous dramatic action with synchronized rain and a metallic door scrape.',
      'overall_soundscape: Rain ambience and a metallic door scrape.',
      `non_diegetic_music: ${music}`,
    ].join('\n');
  }
  const definitions = refs.map((ref) => `<Picture ${ref.slot}> is ${ref.entity_name || ref.entity_type}, used as ${(ref.reference_role || 'environment reference').replace(/_/g, ' ')}.`);
  const retention = refs.map((ref) => `<Picture ${ref.slot}>: fully_preserved - ${ref.entity_name || ref.entity_type} remains the visual anchor.`);
  return [
    'subject_definitions:',
    ...definitions,
    'summary:',
    `[reference generation] The scene follows ${refs.map((ref) => `<Picture ${ref.slot}>`).join(', ')}.`,
    'retention_analysis:',
    ...retention,
    'detailed_description:',
    `[Shot 1] ${refs.map((ref) => `<Picture ${ref.slot}>`).join(', ')} anchor a continuous dramatic action with synchronized rain and a metallic door scrape.`,
    'overall_soundscape: Rain ambience and a metallic door scrape.',
    `non_diegetic_music: ${music}`,
  ].join('\n');
}

async function compileFixture(context, music, inspectSource) {
  const compiler = createH3PromptCompiler({
    skillAgent: {
      run: async (_db, _log, input) => {
        inspectSource(input.sourceBundle);
        return { prompt: deterministicH3(context, music), provenance: { fixture: true } };
      },
    },
  });
  return compiler.compile({}, log, {
    prompt: context.storyboard.visual_prompt,
    durationSeconds: context.storyboard.duration || 5,
    context,
  });
}

test('external AI package preserves AV sidecars through universal context and H3 compilation', async (t) => {
  const db = createDb();
  t.after(() => db.close());
  const pkg = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
  pkg.audio_plan = {
    version: 1,
    bgm: { mode: 'none', planning: 'external', source_type: 'none' },
    speech: { dialogue_owner: 'none', narration_owner: 'post_tts' },
  };
  pkg.storyboards[0].audio_description = {
    ambience: ['雨声'],
    sound_effects: ['金属门摩擦声'],
    music_cue: { mode: 'mute' },
  };
  pkg.storyboards[0].transition = { type: 'cut', audio_bridge: { mode: 'carry', duration_ms: 300 } };
  const rawText = JSON.stringify(pkg);
  const imported = importEpisodePackage(db, { rawText, sourceSha256: sha256Text(rawText), dramaId: 1, filename: 'external-ai.json' });
  const storyboard = db.prepare('SELECT id, scene_id FROM storyboards WHERE episode_id = ? ORDER BY storyboard_number LIMIT 1').get(imported.episode_id);
  db.prepare("UPDATE scenes SET image_url = '/static/imported-scene.png' WHERE id = ?").run(storyboard.scene_id);

  const bundle = buildUniversalSegmentUserPromptBundle(db, storyboard.id, {});
  assert.equal(bundle.ok, true, bundle.message);
  assert.match(bundle.userPrompt, /金属门摩擦声/);
  assert.match(bundle.userPrompt, /audio_bridge/);
  assert.equal(bundle.generationContext.episode.audio_plan.bgm.mode, 'none');
  const compiled = await compileFixture(bundle.generationContext, 'N/A', (source) => {
    assert.match(source, /AUDIO_DESCRIPTION/);
    assert.match(source, /金属门摩擦声/);
    assert.match(source, /TRANSITION_PLAN/);
    assert.match(source, /REFERENCE_VISUAL_BINDINGS/);
  });
  assert.match(compiled.compiledPrompt, /metallic door scrape/i);
  assert.match(compiled.compiledPrompt, /non_diegetic_music:\s*N\/A/i);
});

test('storyboard AI mapping preserves planned per-segment music through H3 compilation and stale fingerprinting', async (t) => {
  const db = createDb();
  t.after(() => db.close());
  const now = '2026-09-06T00:00:00.000Z';
  const audioPlan = {
    bgm: { mode: 'per_segment', prompt: 'shared low strings', planning: 'ai', continuity_key: 'episode_main_theme' },
    speech: { dialogue_owner: 'none', narration_owner: 'post_tts' },
  };
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, script_content, audio_plan, status, created_at, updated_at) VALUES (20, 1, 1, 'Story Episode', '雨夜开门', ?, 'draft', ?, ?)")
    .run(serializeCanonicalJson(audioPlan), now, now);
  db.prepare("INSERT INTO scenes (id, drama_id, episode_id, location, state, prompt, atmosphere, image_url, created_at, updated_at) VALUES (21, 1, 20, '门厅', '雨夜', 'dark entrance', 'wet and tense', '/static/story-scene.png', ?, ?)").run(now, now);
  const mapped = mapAiStoryboardToCanonical({
    shot_number: 1,
    scene_id: 21,
    title: '开门',
    duration: 6,
    action: '她推开生锈的门',
    video_prompt: 'A woman opens a rusty door in the rain.',
    sound_effect: 'metallic door scrape',
    bgm_prompt: 'restrained urgent pulse over the shared low-string theme',
    transition: { type: 'cut' },
    emotion: '紧张',
    emotion_intensity: 8,
    is_primary: true,
  }, { episodeAudioPlan: audioPlan, source: 'story_ai' });
  const saved = saveCanonicalStoryboard(db, 20, mapped, { source: 'story_ai', lock: false, now });
  const before = buildStoryboardGenerationContext(db, saved.id);
  assert.equal(before.audio.music_cue.mode, 'override');
  assert.equal(before.audio.sound_effects[0], 'metallic door scrape');
  assert.equal(before.episode.audio_plan.bgm.continuity_key, 'episode_main_theme');
  const compiled = await compileFixture(before, 'Restrained urgent pulse over a shared low-string theme.', (source) => {
    assert.match(source, /episode_main_theme/);
    assert.match(source, /restrained urgent pulse/i);
  });
  assert.doesNotMatch(compiled.compiledPrompt, /non_diegetic_music:\s*N\/A/i);

  const fingerprint = generationContextFingerprint(before);
  patchStoryboard(db, saved.id, { audio_description: { music_cue: { intensity: 0.2 } } }, { source: 'manual', now: '2026-09-06T00:05:00.000Z' });
  assert.notEqual(generationContextFingerprint(buildStoryboardGenerationContext(db, saved.id)), fingerprint);
});
