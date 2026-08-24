const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { processDirectorTimeline } = require('../src/services/videoMergeService');
const { buildPostproductionPlan } = require('../src/director/directorPostproductionService');

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

  it('runs the optional Director postproduction plan after timeline composition', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'director postproduction '));
    const basePath = path.join(tempDir, 'timeline.mp4');
    const finalPath = path.join(tempDir, 'timeline-720p.mp4');
    fs.writeFileSync(basePath, 'timeline-output');
    const plan = buildPostproductionPlan({ inputPath: basePath, outputPath: finalPath, upscale: { mode: 'ffmpeg-lanczos', width: 1280, height: 720 } });
    const row = {
      id: 'timeline-post', status: 'validated', input_json: '{}', output_path: basePath,
      manifest_json: JSON.stringify({ commandArgs: ['-y', '-i', 'clip.mp4', basePath], postproduction: plan }),
      ffmpeg_command: 'quoted command',
    };
    const calls = [];
    const db = {
      prepare(sql) {
        return {
          get() { return row; },
          run(...args) {
            if (sql.includes('manifest_json = ?')) row.manifest_json = args[0];
            if (sql.includes("status = 'completed'")) { row.status = 'completed'; row.output_sha256 = args[0]; row.ffprobe_json = args[1]; }
            return { changes: 1 };
          },
        };
      },
    };
    const result = await processDirectorTimeline(db, null, row.id, {
      ffmpegPath: 'ffmpeg-test',
      ffprobePath: 'ffprobe-test',
      runProcess: async (file, args) => {
        calls.push({ file, args });
        if (file === 'ffprobe-test') {
          return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: args.includes(finalPath) ? 1280 : 864, height: args.includes(finalPath) ? 720 : 480, r_frame_rate: '24/1' }, { codec_type: 'audio', codec_name: 'aac' }], format: { duration: '2' } }), stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(calls.length, 4);
    assert.equal(calls[2].file, 'ffmpeg-test');
    assert.ok(calls[2].args.includes(finalPath));
    assert.equal(result.status, 'completed');
    assert.equal(JSON.parse(result.manifest_json).postproductionResult.quality.status, 'passed');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
