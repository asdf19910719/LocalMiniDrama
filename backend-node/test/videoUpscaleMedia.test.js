const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProbe, buildStitchArgs } = require('../src/services/videoUpscale/videoUpscaleMedia');

test('media probe preserves rational fps and detects the source audio stream', () => {
  const parsed = parseProbe({
    streams: [
      { codec_type: 'video', width: 1312, height: 736, avg_frame_rate: '24000/1001', nb_read_frames: '241' },
      { codec_type: 'audio' },
    ],
    format: { duration: '10.052' },
  });
  assert.deepEqual(parsed, {
    width: 1312, height: 736, fpsNumerator: 24000, fpsDenominator: 1001,
    frameCount: 241, duration: 10.052, hasAudio: true,
  });
});

test('stitch args trim overlap by frames and never let short audio truncate video', () => {
  const args = buildStitchArgs({
    source_path: 'base.mp4', source_has_audio: 1, source_frame_count: 241,
    source_fps_num: 24, source_fps_den: 1, target_width: 2624, target_height: 1472,
  }, [
    { local_output_path: 'part0.mp4', overlap_frames: 0 },
    { local_output_path: 'part1.mp4', overlap_frames: 4 },
  ], 'out.mp4');
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[1:v\]trim=start_frame=4/);
  assert.match(filter, /scale=2624:1472/);
  assert.deepEqual(args.slice(args.indexOf('-frames:v'), args.indexOf('-frames:v') + 2), ['-frames:v', '241']);
  assert.equal(args.includes('-shortest'), false, 'audio duration must not truncate the exact video frame count');
  assert.ok(args.includes('-af'));
  assert.match(args[args.indexOf('-af') + 1], /apad/);
});
