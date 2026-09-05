const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createVideoUpscaleRepository } = require('../src/services/videoUpscale/videoUpscaleRepository');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE video_merges (id INTEGER PRIMARY KEY, upscale_job_id TEXT, base_merged_url TEXT);
  `);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '33_video_upscale_jobs.sql'), 'utf8');
  db.exec(sql);
  return db;
}

test('upscale repository creates a durable job and ordered segments without secrets', () => {
  const db = createDb();
  db.prepare('INSERT INTO video_merges (id) VALUES (8)').run();
  const repo = createVideoUpscaleRepository(db);
  repo.createJob({
    id: 'job-1', episodeId: 7, videoMergeId: 8, method: 'flash', workflowId: 'M20',
    sourcePath: 'base.mp4', sourceFingerprint: 'sha256', source: {
      width: 1312, height: 736, fpsNumerator: 24, fpsDenominator: 1, frameCount: 481,
    },
    target: { width: 2624, height: 1472 },
    configSnapshot: { base_url: 'https://panel.test', api_key: 'must-not-persist' },
    segments: [
      { index: 0, startFrame: 0, frameCount: 240, trimLeadingFrames: 0 },
      { index: 1, startFrame: 236, frameCount: 240, trimLeadingFrames: 4 },
      { index: 2, startFrame: 472, frameCount: 9, trimLeadingFrames: 4 },
    ],
  });

  const job = repo.getJob('job-1');
  assert.equal(job.status, 'pending');
  assert.equal(job.segments.length, 3);
  assert.deepEqual(job.segments.map((segment) => segment.segment_index), [0, 1, 2]);
  assert.equal(job.config_snapshot.api_key, undefined);
  assert.equal(db.prepare('SELECT upscale_job_id FROM video_merges WHERE id = 8').get().upscale_job_id, 'job-1');
  db.close();
});

test('upscale repository conditionally claims a job only once', () => {
  const db = createDb();
  db.prepare('INSERT INTO video_merges (id) VALUES (8)').run();
  const repo = createVideoUpscaleRepository(db);
  repo.createJob({
    id: 'job-2', episodeId: 7, videoMergeId: 8, method: 'seed', workflowId: 'M19',
    sourcePath: 'base.mp4', sourceFingerprint: 'hash',
    source: { width: 1312, height: 736, fpsNumerator: 24000, fpsDenominator: 1001, frameCount: 10 },
    target: { width: 2624, height: 1472 }, configSnapshot: {},
    segments: [{ index: 0, startFrame: 0, frameCount: 10, trimLeadingFrames: 0 }],
  });

  assert.equal(repo.transitionJob('job-2', ['pending'], 'uploading', { progress: 31 }), true);
  assert.equal(repo.transitionJob('job-2', ['pending'], 'uploading', { progress: 31 }), false);
  assert.equal(repo.getJob('job-2').progress, 31);
  db.close();
});

test('upscale repository resumes prompt and completed download checkpoints', () => {
  const db = createDb();
  db.prepare('INSERT INTO video_merges (id) VALUES (8)').run();
  const repo = createVideoUpscaleRepository(db);
  repo.createJob({
    id: 'job-3', episodeId: 7, videoMergeId: 8, method: 'flash', workflowId: 'M20',
    sourcePath: 'base.mp4', sourceFingerprint: 'hash',
    source: { width: 1312, height: 736, fpsNumerator: 24, fpsDenominator: 1, frameCount: 10 },
    target: { width: 2624, height: 1472 }, configSnapshot: {},
    segments: [{ index: 0, startFrame: 0, frameCount: 10, trimLeadingFrames: 0 }],
  });
  repo.updateSegment('job-3', 0, { status: 'running', prompt_id: 'prompt-1', remote_input_name: 'source.mp4' });
  let loaded = repo.getJob('job-3');
  assert.equal(loaded.segments[0].prompt_id, 'prompt-1');
  repo.updateSegment('job-3', 0, { status: 'completed', local_output_path: 'part.mp4', remote_result_json: { ok: true } });
  loaded = repo.getJob('job-3');
  assert.equal(loaded.segments[0].status, 'completed');
  assert.deepEqual(loaded.segments[0].remote_result, { ok: true });
  db.close();
});

test('upscale migration enforces one row per job segment', () => {
  const db = createDb();
  db.prepare(`INSERT INTO video_upscale_jobs
    (id, method, workflow_id, source_path, status, created_at, updated_at)
    VALUES ('job', 'flash', 'M20', 'base.mp4', 'pending', 'now', 'now')`).run();
  const insert = db.prepare(`INSERT INTO video_upscale_segments
    (job_id, segment_index, start_frame, requested_frame_count, overlap_frames, status, created_at, updated_at)
    VALUES ('job', 0, 0, 10, 0, 'pending', 'now', 'now')`);
  insert.run();
  assert.throws(() => insert.run(), /UNIQUE constraint failed/);
  db.close();
});
