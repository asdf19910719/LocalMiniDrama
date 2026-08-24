const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateArtifactQuality } = require('../src/director/directorQualityService');

describe('Director auxiliary review quality checks', () => {
  it('reports black frames, freezes, decode errors, and audio/video drift', () => {
    const result = evaluateArtifactQuality({
      ffprobe: {
        streams: [
          { codec_type: 'video', width: 864, height: 480, r_frame_rate: '24/1', duration: '5.0' },
          { codec_type: 'audio', duration: '5.4' },
        ],
        format: { duration: '5.4' },
      },
      analysisText: [
        'black_start:0 black_end:0.40 black_duration:0.40',
        'freeze_start:2.0 freeze_duration:1.2',
        'Invalid NAL unit size',
      ].join('\n'),
    });

    assert.equal(result.status, 'failed');
    assert.ok(result.issues.some((issue) => issue.code === 'BLACK_FRAMES'));
    assert.ok(result.issues.some((issue) => issue.code === 'FROZEN_VIDEO'));
    assert.ok(result.issues.some((issue) => issue.code === 'DECODE_ERROR'));
    assert.ok(result.issues.some((issue) => issue.code === 'AV_DESYNC'));
    assert.equal(result.media.width, 864);
    assert.equal(result.media.fps, 24);
  });

  it('passes a clean H.264/AAC probe without detector findings', () => {
    const result = evaluateArtifactQuality({
      ffprobe: {
        streams: [
          { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '24/1', duration: '5.0' },
          { codec_type: 'audio', codec_name: 'aac', duration: '5.03' },
        ],
        format: { duration: '5.03' },
      },
      analysisText: '',
    });
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.issues, []);
  });

  it('does not report passed when the FFmpeg detector cannot execute', async () => {
    const { analyzeArtifact } = require('../src/director/directorQualityService');
    const result = await analyzeArtifact({
      artifactPath: 'missing.mp4',
      ffprobe: { streams: [{ codec_type: 'video', width: 864, height: 480, r_frame_rate: '24/1' }], format: { duration: '5' } },
      runCommand: async () => { throw new Error('ffmpeg executable missing'); },
    });
    assert.equal(result.status, 'analysis_failed');
    assert.equal(result.analyzer.status, 'failed');
    assert.ok(result.issues.some((issue) => issue.code === 'QUALITY_ANALYZER_UNAVAILABLE'));
  });
});
