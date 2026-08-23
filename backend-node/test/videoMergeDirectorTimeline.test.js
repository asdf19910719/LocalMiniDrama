const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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
});
