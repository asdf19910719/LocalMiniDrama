const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeEpisodeAudioPlan,
  normalizeStoryboardAudioDescription,
  normalizeStoryboardTransition,
  normalizeFieldState,
  reconcileStoryboardAudioWithEpisodePlan,
  serializeCanonicalJson,
} = require('../src/services/storyboardAvContractService');

test('legacy text audio is retained losslessly', () => {
  assert.deepEqual(normalizeStoryboardAudioDescription('雨声与脚步声'), {
    version: 1,
    ambience: [],
    sound_effects: [],
    dialogue_treatment: null,
    diegetic_music: null,
    silence: false,
    music_cue: { mode: 'mute', prompt: null, intensity: 0, start: null, end: null },
    speech_override: { dialogue_owner: null, narration_owner: null },
    raw_description: '雨声与脚步声',
    extensions: {},
    provenance: { source: 'legacy' },
  });
});

test('episode BGM accepts exactly three modes', () => {
  for (const mode of ['none', 'episode_track', 'per_segment']) {
    assert.equal(normalizeEpisodeAudioPlan({ bgm: { mode } }).bgm.mode, mode);
  }
  assert.throws(
    () => normalizeEpisodeAudioPlan({ bgm: { mode: 'ambient_guess' } }),
    (error) => error.code === 'AUDIO_PLAN_INVALID',
  );
});

test('canonical serialization is recursively key-order stable', () => {
  assert.equal(
    serializeCanonicalJson({ b: 2, nested: { z: 3, a: 1 }, a: 1 }),
    serializeCanonicalJson({ a: 1, nested: { a: 1, z: 3 }, b: 2 }),
  );
});

test('unknown audio and transition keys survive in extensions', () => {
  assert.deepEqual(
    normalizeStoryboardAudioDescription({ ambient: '雨声', vendor_gain: 3 }).extensions,
    { vendor_gain: 3 },
  );
  assert.deepEqual(
    normalizeStoryboardTransition({ to_next: '硬切', vendor_curve: 'x' }).extensions,
    { vendor_curve: 'x' },
  );
});

test('dialogue and narration owners are independent validated fields', () => {
  const plan = normalizeEpisodeAudioPlan({
    speech: { dialogue_owner: 'h3_native', narration_owner: 'post_tts' },
  });
  assert.equal(plan.speech.dialogue_owner, 'h3_native');
  assert.equal(plan.speech.narration_owner, 'post_tts');
  assert.throws(
    () => normalizeEpisodeAudioPlan({ speech: { dialogue_owner: 'both' } }),
    (error) => error.code === 'AUDIO_PLAN_INVALID',
  );
});

test('field state preserves source lock and revision', () => {
  assert.deepEqual(normalizeFieldState({
    'audio_description.music_cue.prompt': { source: 'manual', locked: true, revision: 4 },
  })['audio_description.music_cue.prompt'], {
    source: 'manual',
    locked: true,
    revision: 4,
    updated_at: null,
  });
});

test('JSON object strings normalize and music cue intensity is clamped', () => {
  const audio = normalizeStoryboardAudioDescription(JSON.stringify({
    ambience: 'rain',
    sound_effects: ['door scrape'],
    music_cue: { mode: 'override', prompt: 'low piano', intensity: 4 },
  }));
  assert.deepEqual(audio.ambience, ['rain']);
  assert.deepEqual(audio.sound_effects, ['door scrape']);
  assert.equal(audio.music_cue.intensity, 1);
  assert.equal(audio.music_cue.prompt, 'low piano');
});

test('explicit null is distinct from a missing legacy value', () => {
  assert.equal(normalizeStoryboardAudioDescription(null), null);
  assert.equal(normalizeStoryboardTransition(null), null);
  assert.equal(normalizeEpisodeAudioPlan(null).bgm.mode, 'none');
});

test('episode BGM policy determines the effective per-shot cue', () => {
  const stinger = normalizeStoryboardAudioDescription({
    ambience: ['rain'],
    music_cue: { mode: 'stinger', prompt: 'single low hit', intensity: 0.8 },
  });

  for (const mode of ['none', 'episode_track']) {
    const audio = reconcileStoryboardAudioWithEpisodePlan(stinger, { bgm: { mode } });
    assert.deepEqual(audio.ambience, ['rain']);
    assert.deepEqual(audio.music_cue, {
      mode: 'mute', prompt: null, intensity: 0, start: null, end: null,
    });
  }
  assert.equal(
    reconcileStoryboardAudioWithEpisodePlan(stinger, { bgm: { mode: 'per_segment' } }).music_cue.mode,
    'stinger',
  );
});
