const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaService = require('../src/services/dramaService');
const {
  sha256Text,
  importEpisodePackage,
} = require('../src/services/episodePackageService');

const EXAMPLE_PATH = path.join(__dirname, 'fixtures', 'episodePackageV11.json');

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-09-05T00:00:00.000Z';
  db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, '导入测试', 'draft', ?, ?)").run(now, now);
  return db;
}

function loadPackage() {
  return JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
}

function importPackage(db, pkg) {
  const rawText = JSON.stringify(pkg);
  return importEpisodePackage(db, {
    rawText,
    sourceSha256: sha256Text(rawText),
    dramaId: 1,
    filename: 'external-ai.json',
  });
}

test('package AV fields survive import and canonical API projection', (t) => {
  const db = createDb();
  t.after(() => db.close());
  const pkg = loadPackage();

  const result = importPackage(db, pkg);
  const projected = dramaService.getDrama(db, 1);
  const episode = projected.episodes.find((item) => item.id === result.episode_id);
  const storyboard = episode.storyboards[0];
  assert.equal(episode.audio_plan.bgm.mode, 'per_segment');
  assert.equal(episode.audio_plan.bgm.prompt, pkg.audio_plan.bgm.prompt);
  assert.equal(episode.audio_plan.bgm.continuity_key, pkg.audio_plan.bgm.continuity_key);
  assert.equal(episode.audio_plan.speech.dialogue_owner, pkg.audio_plan.speech.dialogue_owner);
  assert.equal(episode.audio_plan.speech.narration_owner, pkg.audio_plan.speech.narration_owner);
  assert.equal(episode.production_profile.generation_profile.video_mode, pkg.generation_profile.video_mode);
  assert.equal(episode.production_profile.duration_target_seconds, pkg.episode.duration_target_seconds);
  assert.equal(projected.characters[0].appearance, pkg.characters[0].appearance);
  assert.equal(projected.characters[0].polished_prompt, pkg.characters[0].image_prompt);
  assert.equal(projected.characters[0].negative_prompt, pkg.characters[0].negative_prompt);
  assert.equal(projected.characters[0].voice_style, pkg.characters[0].voice_profile);
  assert.equal(episode.scenes[0].atmosphere, pkg.scenes[0].atmosphere);
  assert.equal(episode.scenes[0].negative_prompt, pkg.scenes[0].negative_prompt);
  assert.equal(episode.props[0].negative_prompt, pkg.props[0].negative_prompt);
  assert.deepEqual(storyboard.audio_description.sound_effects, pkg.storyboards[0].audio_description.sound_effects);
  assert.equal(storyboard.audio_description.music_cue.mode, 'inherit');
  assert.equal(episode.storyboards[1].audio_description.music_cue.mode, 'override');
  assert.equal(
    episode.storyboards[1].audio_description.music_cue.prompt,
    pkg.storyboards[1].audio_description.music_cue.prompt,
  );
  assert.equal(storyboard.transition.audio_bridge.mode, 'carry');
  assert.equal(storyboard.is_primary, true);
  assert.equal(storyboard.layout_description, pkg.storyboards[0].composition);
});

test('legacy explicit shot music enables per_segment without AI inference', (t) => {
  const db = createDb();
  t.after(() => db.close());
  const pkg = loadPackage();
  delete pkg.generation_profile.contract_profile;
  delete pkg.audio_plan;
  pkg.storyboards[0].audio_description = { non_diegetic_music: 'restrained piano' };
  pkg.storyboards[1].audio_description = { ambience: ['room tone'] };

  const result = importPackage(db, pkg);
  const projected = dramaService.getDrama(db, 1);
  const episode = projected.episodes.find((item) => item.id === result.episode_id);
  assert.equal(episode.audio_plan.bgm.mode, 'per_segment');
  assert.equal(episode.storyboards[0].audio_description.music_cue.mode, 'override');
  assert.equal(episode.storyboards[0].audio_description.music_cue.prompt, 'restrained piano');
  assert.equal(episode.storyboards[1].audio_description.music_cue.mode, 'mute');
  assert.equal(result.warnings.some((item) => item.action === 'legacy_music_to_per_segment'), true);
});
