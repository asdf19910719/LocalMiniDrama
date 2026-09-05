const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_TEST_PROMPT,
  assertControlledPair,
  enforceCrispMotionPrompt,
  normalizeFfprobe,
  timingReductionPercent,
  evaluateStability,
  sanitizeReport,
} = require('../scripts/compareH3TeSpeed');

function prompt(overrides = {}) {
  return {
    '5': {
      class_type: 'MiniMaxH3Director',
      inputs: {
        global_prompt: 'A woman turns toward camera.', seed: 42,
        width: 864, height: 480, frame_rate: 24, total_frames: 72,
        steps: 20, sampler: 'res_multistep', scheduler: 'simple',
        shift_video: 12, shift_audio: 3, timeline_data: '{"refs":["ref.png"]}',
        ...overrides,
      },
    },
    '6': { class_type: 'CreateVideo', inputs: { fps: ['5', 2], bit_depth: 8 } },
    '7': { class_type: 'SaveVideo', inputs: { format: 'auto', codec: 'auto' } },
    '8': { class_type: 'PathchSageAttentionKJ', inputs: { sage_attention: 'auto', allow_compile: false } },
  };
}

describe('H3 TE-Speed comparison helpers', () => {
  test('forces every default and custom comparison prompt to keep action frames sharp', () => {
    const defaultPrompt = enforceCrispMotionPrompt(DEFAULT_TEST_PROMPT);
    const customPrompt = enforceCrispMotionPrompt('A warrior rises, turns, and performs one clean sword swing.');

    for (const value of [defaultPrompt, customPrompt]) {
      assert.match(value, /No motion blur/i);
      assert.match(value, /sharp in every frame/i);
      assert.match(value, /no temporal smearing/i);
    }
    assert.doesNotMatch(defaultPrompt, /natural motion blur/i);
  });

  test('rejects a comparison prompt that positively requests motion blur', () => {
    assert.throws(
      () => enforceCrispMotionPrompt('A sword fight with natural motion blur.'),
      /motion blur.*forbidden|forbidden.*motion blur/i,
    );
  });

  test('accepts paired prompts only when every controlled generation field matches', () => {
    assert.doesNotThrow(() => assertControlledPair(prompt(), prompt()));
    assert.throws(() => assertControlledPair(prompt(), prompt({ seed: 43 })), /seed/i);
    assert.throws(() => assertControlledPair(prompt(), prompt({ scheduler: 'beta' })), /scheduler/i);
  });

  test('normalizes ffprobe stream and duration data', () => {
    assert.deepEqual(normalizeFfprobe({
      format: { duration: '3.042', format_name: 'mov,mp4' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 864, height: 480, avg_frame_rate: '24/1', nb_frames: '73' },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2 },
      ],
    }), {
      durationSeconds: 3.042,
      formatName: 'mov,mp4',
      video: { codec: 'h264', width: 864, height: 480, frameRate: 24, frames: 73 },
      audio: { codec: 'aac', sampleRate: 44100, channels: 2 },
    });
  });

  test('calculates timing reduction and five-run stability gates', () => {
    assert.equal(timingReductionPercent(400, 280), 30);
    assert.deepEqual(evaluateStability([
      { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
      { status: 'completed' }, { status: 'completed' },
    ]), { passed: true, requiredRuns: 5, completedRuns: 5, failedRuns: 0 });
    assert.equal(evaluateStability([{ status: 'completed' }, { status: 'failed' }]).passed, false);
  });

  test('removes secrets from serialized run reports', () => {
    const report = sanitizeReport({
      baseUrl: 'http://user:pass@127.0.0.1:8191/?token=secret',
      apiKey: 'secret',
      nested: { access_token: 'secret', output: 'E:/safe/output.mp4' },
    });
    const text = JSON.stringify(report);
    assert.equal(text.includes('secret'), false);
    assert.equal(text.includes('user:pass'), false);
    assert.equal(report.nested.output, 'E:/safe/output.mp4');
  });
});
