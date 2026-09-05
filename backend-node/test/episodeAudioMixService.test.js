const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildEpisodeAudioMixPlan, runEpisodeAudioMix } = require('../src/services/episodeAudioMixService');
const { getFfmpegPath, hasLocalFfmpeg } = require('../src/utils/ffmpegPath');

test('dialogue and narration are mixed over generated base audio instead of replacing it', () => {
  const plan = buildEpisodeAudioMixPlan({
    baseHasAudio: true,
    bgmMode: 'none',
    dialoguePath: 'dialogue.wav',
    narrationPath: 'narration.wav',
    durationSeconds: 6,
  });
  assert.match(plan.filterComplex, /\[0:a\]/);
  assert.match(plan.filterComplex, /amix/);
  assert.match(plan.filterComplex, /sidechaincompress/);
  assert.notDeepEqual(plan.maps, ['1:a']);
});

test('episode_track adds one BGM input while per_segment reuses clip audio', () => {
  const episode = buildEpisodeAudioMixPlan({ baseHasAudio: true, bgmMode: 'episode_track', bgmPath: 'score.wav', durationSeconds: 6 });
  const segments = buildEpisodeAudioMixPlan({ baseHasAudio: true, bgmMode: 'per_segment', bgmPath: 'score.wav', durationSeconds: 6 });
  assert.equal(episode.inputs.includes('score.wav'), true);
  assert.equal((episode.filterComplex.match(/sidechaincompress/g) || []).length, 0);
  assert.equal(segments.inputs.includes('score.wav'), false);
  assert.throws(
    () => buildEpisodeAudioMixPlan({ baseHasAudio: true, bgmMode: 'episode_track', durationSeconds: 6 }),
    (error) => error.code === 'EPISODE_BGM_MEDIA_REQUIRED',
  );
});

test('missing base audio creates an equal-duration silent base layer', () => {
  const plan = buildEpisodeAudioMixPlan({ baseHasAudio: false, bgmMode: 'none', durationSeconds: 6 });
  assert.match(plan.filterComplex, /anullsrc/);
});

test('speech ownership selects exactly one source per language layer', () => {
  const native = buildEpisodeAudioMixPlan({ baseHasAudio: true, dialogueOwner: 'h3_native', dialoguePath: 'dialogue.wav', durationSeconds: 6 });
  const post = buildEpisodeAudioMixPlan({ baseHasAudio: true, dialogueOwner: 'post_tts', dialoguePath: 'dialogue.wav', durationSeconds: 6 });
  assert.equal(native.inputs.includes('dialogue.wav'), false);
  assert.equal(post.inputs.includes('dialogue.wav'), true);
});

function spectralMagnitude(buffer, frequency, sampleRate = 8000) {
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const angle = 2 * Math.PI * frequency * index / sampleRate;
    real += samples[index] * Math.cos(angle);
    imaginary -= samples[index] * Math.sin(angle);
  }
  return Math.hypot(real, imaginary) / Math.max(1, samples.length);
}

test('real ffmpeg mix preserves base, speech, and episode BGM frequency bands', { skip: !hasLocalFfmpeg() }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'episode-audio-mix-'));
  const ffmpeg = getFfmpegPath();
  const base = path.join(root, 'base.mp4');
  const dialogue = path.join(root, 'dialogue.wav');
  const bgm = path.join(root, 'bgm.wav');
  const output = path.join(root, 'output.mp4');
  const segmentOutput = path.join(root, 'per-segment.mp4');
  const nativeOutput = path.join(root, 'native-speech.mp4');
  const run = (args) => {
    const result = spawnSync(ffmpeg, args, { maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString().slice(-1500));
    return result;
  };
  try {
    run(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=12:d=2', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=8000:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', base]);
    run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=2', dialogue]);
    run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=8000:duration=2', bgm]);
    const decode = (file) => run(['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1']).stdout;
    const plan = buildEpisodeAudioMixPlan({
      basePath: base, outputPath: output, baseHasAudio: true,
      dialoguePath: dialogue, narrationOwner: 'none',
      bgmMode: 'episode_track', bgmPath: bgm, bgmLevel: 0.4,
      durationSeconds: 2,
    });
    runEpisodeAudioMix(plan);
    const decoded = decode(output);
    const noise = spectralMagnitude(decoded, 1377);
    for (const frequency of [220, 440, 880]) {
      assert.ok(spectralMagnitude(decoded, frequency) > Math.max(0.00005, noise * 2), `missing ${frequency} Hz layer`);
    }

    const segmentPlan = buildEpisodeAudioMixPlan({
      basePath: base, outputPath: segmentOutput, baseHasAudio: true,
      dialogueOwner: 'none', narrationOwner: 'none',
      bgmMode: 'per_segment', bgmPath: bgm, durationSeconds: 2,
    });
    runEpisodeAudioMix(segmentPlan);
    const segmentDecoded = decode(segmentOutput);
    assert.ok(spectralMagnitude(segmentDecoded, 220) > spectralMagnitude(segmentDecoded, 880) * 5, 'per_segment must not add episode BGM');

    const nativePlan = buildEpisodeAudioMixPlan({
      basePath: base, outputPath: nativeOutput, baseHasAudio: true,
      dialogueOwner: 'h3_native', dialoguePath: dialogue,
      narrationOwner: 'none', bgmMode: 'none', durationSeconds: 2,
    });
    runEpisodeAudioMix(nativePlan);
    const nativeDecoded = decode(nativeOutput);
    assert.ok(spectralMagnitude(decoded, 440) > spectralMagnitude(nativeDecoded, 440) * 5, 'post_tts should add speech once; h3_native should not add TTS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
