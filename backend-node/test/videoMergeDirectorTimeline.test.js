const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { processDirectorTimeline } = require('../src/services/videoMergeService');

describe('video merge Director timeline delegation', () => {
  it('runs the stored timeline command and records completion without changing legacy merge inputs', async () => {
    const row = {
      id: 'timeline-1', version: 'timeline_v1', status: 'validated', input_json: '{}',
      manifest_json: '{}', ffmpeg_command: 'ffmpeg -y out.mp4', output_path: '/tmp/out.mp4',
      output_sha256: null, ffprobe_json: null, created_at: new Date().toISOString(),
    };
    const db = {
      prepare(sql) {
        return {
          get() { return row; },
          run(...args) {
            if (sql.includes("status = 'completed'")) {
              row.status = 'completed'; row.output_sha256 = args[0]; row.ffprobe_json = args[1];
            }
            return { changes: 1 };
          },
        };
      },
    };
    const result = await processDirectorTimeline(db, { info() {}, warn() {} }, 'timeline-1', {
      runCommand: async () => ({ ok: true, outputSha256: 'out-hash', ffprobe: { format: { duration: 2 } } }),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.output_sha256, 'out-hash');
    assert.equal(JSON.parse(result.ffprobe_json).format.duration, 2);
  });

  it('executes persisted argument arrays without splitting paths that contain spaces', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'director persisted command '));
    const outputPath = path.join(tempDir, 'timeline output.mp4');
    fs.writeFileSync(outputPath, 'timeline-output');
    const commandArgs = ['-y', '-i', 'E:\\media files\\clip one.mp4', outputPath];
    const row = {
      id: 'timeline-2', status: 'validated', input_json: '{}', output_path: outputPath,
      manifest_json: JSON.stringify({ commandArgs }), ffmpeg_command: 'quoted command',
    };
    const db = {
      prepare(sql) {
        return {
          get() { return row; },
          run(...args) {
            if (sql.includes("status = 'completed'")) {
              row.status = 'completed'; row.output_sha256 = args[0]; row.ffprobe_json = args[1];
            }
            return { changes: 1 };
          },
        };
      },
    };
    const calls = [];
    const result = await processDirectorTimeline(db, null, row.id, {
      ffmpegPath: 'ffmpeg.exe',
      ffprobePath: 'ffprobe.exe',
      runProcess: async (file, args) => {
        calls.push({ file, args });
        if (file === 'ffprobe.exe') return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video' }], format: { duration: '2' } }), stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.deepEqual(calls[0], { file: 'ffmpeg.exe', args: commandArgs });
    assert.equal(result.status, 'completed');
    assert.equal(result.output_sha256.length, 64);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
