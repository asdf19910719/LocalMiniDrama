const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPostproductionPlan,
  validatePostproductionProbe,
  executePostproduction,
} = require('../src/director/directorPostproductionService');

describe('Director postproduction pipeline', () => {
  it('builds deterministic audio, subtitle, color, and 720p upscale arguments', () => {
    const plan = buildPostproductionPlan({
      inputPath: 'input.mp4',
      outputPath: 'output-720p.mp4',
      subtitlePath: 'captions.srt',
      musicPath: 'music.mp3',
      color: { brightness: 0.02, saturation: 1.05, contrast: 1.02 },
      upscale: { mode: 'ffmpeg-lanczos', width: 1280, height: 720 },
    });

    assert.deepEqual(plan.output, { width: 1280, height: 720, fps: 24, pixelFormat: 'yuv420p' });
    assert.match(plan.command, /captions\.srt/);
    assert.ok(plan.args.includes('music.mp3'));
    assert.match(plan.command, /scale=1280:720:flags=lanczos/);
    assert.match(plan.command, /subtitles=/);
    assert.match(plan.command, /eq=brightness=0\.02:contrast=1\.02:saturation=1\.05/);
    assert.equal(plan.audioPolicy, 'replace_or_mix');
  });

  it('includes TTS and music as separate mixed audio inputs', () => {
    const plan = buildPostproductionPlan({
      inputPath: 'input.mp4',
      outputPath: 'output.mp4',
      ttsPath: 'dialogue.mp3',
      musicPath: 'music.mp3',
    });

    assert.deepEqual(plan.audioInputs, ['music.mp3', 'dialogue.mp3']);
    assert.ok(plan.args.includes('music.mp3'));
    assert.ok(plan.args.includes('dialogue.mp3'));
    assert.match(plan.command, /amix=inputs=3/);
    assert.equal(plan.ttsPath, 'dialogue.mp3');
  });

  it('rejects a 720p claim when the probe does not match the requested output', () => {
    assert.throws(() => validatePostproductionProbe({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 864, height: 480, r_frame_rate: '24/1' }],
      format: { duration: '5.0' },
    }, { width: 1280, height: 720, fps: 24, requireAudio: false }), /dimensions/i);
  });

  it('executes the persisted command and returns a quality-checked artifact result', async () => {
    const calls = [];
    const result = await executePostproduction({
      plan: buildPostproductionPlan({ inputPath: 'in.mp4', outputPath: 'out.mp4' }),
      runCommand: async (file, args) => {
        calls.push({ file, args });
        return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 864, height: 480, r_frame_rate: '24/1' }, { codec_type: 'audio', codec_name: 'aac' }], format: { duration: '5.01' } }) };
      },
      ffmpegPath: 'ffmpeg-test',
      probePath: 'ffprobe-test',
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].file, 'ffmpeg-test');
    assert.equal(calls[1].file, 'ffprobe-test');
    assert.equal(result.quality.status, 'passed');
    assert.equal(result.outputPath, 'out.mp4');
  });

  it('falls back to ffmpeg stream parsing when ffprobe is unavailable', async () => {
    const calls = [];
    const result = await executePostproduction({
      plan: buildPostproductionPlan({ inputPath: 'in.mp4', outputPath: 'out.mp4' }),
      runCommand: async (file, args) => {
        calls.push({ file, args });
        if (file === 'ffprobe-test') return { code: 1, stderr: 'ffprobe missing' };
        if (args[0] === '-hide_banner') return { code: 1, stderr: 'Duration: 00:00:05.00, start: 0.000000\nStream #0:0: Video: h264, 864x480, 24 fps\nStream #0:1: Audio: aac, 32000 Hz, stereo' };
        return { code: 0, stdout: '', stderr: '' };
      },
      ffmpegPath: 'ffmpeg-test',
      probePath: 'ffprobe-test',
    });
    assert.equal(result.quality.status, 'passed');
    assert.equal(calls[2].file, 'ffmpeg-test');
  });
});
