const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildFfmpegTimelineArgs } = require('../src/services/videoMergeService');
const { segmentStartTimesMs, buildSpeechTimelineFilter, resolveSpeechOwner, resolveStorageLocalFile } = require('../src/services/mergedEpisodePostProcess');
const { getFfmpegPath, getFfprobePath, hasLocalFfmpeg } = require('../src/utils/ffmpegPath');

test('ordinary merge pairs video and audio transitions and supplies silence for missing audio', { skip: !hasLocalFfmpeg() }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-audio-timeline-'));
  const ffmpeg = getFfmpegPath();
  const withAudio = path.join(root, 'with-audio.mp4');
  const silent = path.join(root, 'silent.mp4');
  try {
    let result = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=12:d=2', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', withAudio], { maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString().slice(-1000));
    result = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=12:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent], { maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString().slice(-1000));
    const output = path.join(root, 'out.mp4');
    const args = buildFfmpegTimelineArgs([withAudio, silent], [
      { duration: 2, transition: { type: 'dissolve', duration: 0.5 } },
      { duration: 2, transition: { type: 'cut', duration: 0 } },
    ], output);
    const command = args.join(' ');
    assert.match(command, /xfade=transition=fade:duration=0\.5:offset=1\.5/);
    assert.match(command, /acrossfade=d=0\.5/);
    assert.match(command, /anullsrc=r=48000:cl=stereo/);
    assert.match(command, /-map \[aout\]/);
    result = spawnSync(ffmpeg, args, { maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString().slice(-1500));
    const probe = spawnSync(getFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const media = JSON.parse(probe.stdout);
    assert.equal(media.streams.some((stream) => stream.codec_type === 'audio'), true);
    assert.ok(Math.abs(Number(media.format.duration) - 3.5) < 0.15);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('per-segment hard cuts get boundary fades without changing video cut duration', { skip: !hasLocalFfmpeg() }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-bgm-fade-'));
  const ffmpeg = getFfmpegPath();
  const files = [path.join(root, 'a.mp4'), path.join(root, 'b.mp4')];
  try {
    for (const [index, file] of files.entries()) {
      const result = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=${index ? 'blue' : 'red'}:s=64x64:r=12:d=2`, '-f', 'lavfi', '-i', `sine=frequency=${index ? 440 : 220}:duration=2`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file], { maxBuffer: 16 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr?.toString().slice(-1000));
    }
    const args = buildFfmpegTimelineArgs(files, [
      { duration: 2, transition: { type: 'cut', duration: 0 } },
      { duration: 2, transition: { type: 'cut', duration: 0 } },
    ], path.join(root, 'out.mp4'), { audioFadeSeconds: 0.5 });
    const command = args.join(' ');
    assert.match(command, /afade=t=out:st=1\.5:d=0\.5/);
    assert.match(command, /afade=t=in:st=0:d=0\.5/);
    assert.match(command, /concat=n=2:v=1:a=0/);
    assert.match(command, /concat=n=2:v=0:a=1/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('narration subtitle starts use the overlapped output timeline', () => {
  const scenes = [
    { duration: 2, transition: { type: 'dissolve', duration: 0.5 } },
    { duration: 3, transition: { type: 'cut', duration: 0 } },
    { duration: 1 },
  ];
  assert.deepEqual(segmentStartTimesMs(scenes), [0, 1500, 4500]);
  const speech = buildSpeechTimelineFilter(scenes);
  assert.match(speech.filterComplex, /adelay=1500:all=1/);
  assert.match(speech.filterComplex, /adelay=4500:all=1/);
  assert.match(speech.filterComplex, /amix=inputs=3:duration=longest/);
});

test('hard-cut audio bridge participates in boundary processing', () => {
  const args = buildFfmpegTimelineArgs(['a.mp4', 'b.mp4'], [
    { duration: 2, transition: { type: 'cut', audio_bridge: { mode: 'carry', duration_ms: 300 } } },
    { duration: 2 },
  ], 'out.mp4');
  const command = args.join(' ');
  assert.match(command, /afade=t=out:st=1\.7:d=0\.3/);
  assert.match(command, /afade=t=in:st=0:d=0\.3/);
});

test('post speech ownership is resolved per layer and per shot override', () => {
  const plan = { speech: { dialogue_owner: 'h3_native', narration_owner: 'post_tts' } };
  assert.equal(resolveSpeechOwner({}, plan, 'dialogue'), 'h3_native');
  assert.equal(resolveSpeechOwner({}, plan, 'narration'), 'post_tts');
  const row = { audio_description: JSON.stringify({ speech_override: { dialogue_owner: 'none', narration_owner: 'h3_native' } }) };
  assert.equal(resolveSpeechOwner(row, plan, 'dialogue'), 'none');
  assert.equal(resolveSpeechOwner(row, plan, 'narration'), 'h3_native');
});

test('post speech paths cannot escape storage root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-path-root-'));
  try {
    assert.throws(() => resolveStorageLocalFile(root, '../secret.mp3'), /AUDIO_PATH_OUTSIDE_STORAGE/);
    assert.throws(() => resolveStorageLocalFile(root, path.resolve(root, 'absolute.mp3')), /AUDIO_PATH_OUTSIDE_STORAGE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
