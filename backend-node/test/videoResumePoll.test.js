const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const videoService = require('../src/services/videoService');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      storyboard_id INTEGER,
      provider TEXT,
      prompt TEXT,
      model TEXT,
      status TEXT,
      task_id TEXT,
      provider_task_id TEXT,
      error_msg TEXT,
      video_url TEXT,
      local_path TEXT,
      image_gen_id INTEGER,
      image_url TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

const silentLog = { info() {}, warn() {}, error() {} };

function insertVideo(db, { status, providerTaskId = null, error = null }) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO video_generations
      (drama_id, storyboard_id, provider, prompt, status, provider_task_id, error_msg, created_at, updated_at)
    VALUES (1, 10, 'legacy', 'prompt', ?, ?, ?, ?, ?)
  `).run(status, providerTaskId, error, now, now);
  return Number(result.lastInsertRowid);
}

describe('videoService unified lifecycle compatibility', () => {
  it('maps legacy statuses on read without rewriting stored history', () => {
    const db = createTestDb();
    const processingId = insertVideo(db, { status: 'processing' });
    const completedId = insertVideo(db, { status: 'completed' });

    assert.equal(videoService.getById(db, processingId).status, 'running');
    assert.equal(videoService.getById(db, completedId).status, 'review');
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(processingId).status, 'processing');
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(completedId).status, 'completed');
  });

  it('exposes resumability without exposing the upstream task id', () => {
    const db = createTestDb();
    const resumableId = insertVideo(db, { status: 'failed', providerTaskId: 'upstream-task', error: '查询超时' });
    const freshRetryId = insertVideo(db, { status: 'failed', error: '提交失败' });

    const resumable = videoService.getById(db, resumableId);
    const freshRetry = videoService.getById(db, freshRetryId);
    assert.equal(resumable.can_resume_poll, true);
    assert.equal(freshRetry.can_resume_poll, false);
    assert.equal(resumable.provider_task_id, undefined);
    assert.equal(resumable.error_msg, '查询超时');
    assert.equal(resumable.error.code, 'VIDEO_GENERATION_FAILED');
  });

  it('keeps startup recovery inert until the provider registry lifecycle is configured', () => {
    const db = createTestDb();
    const legacyId = insertVideo(db, { status: 'processing' });

    assert.equal(videoService.resumeProcessingVideoGenerations(db, silentLog), 0);
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(legacyId).status, 'processing');
  });

  it('delegates resume-poll and startup recovery to the configured unified service', async () => {
    const db = createTestDb();
    const calls = [];
    const lifecycle = {
      async retryVideoGeneration(id) {
        calls.push(['retry', Number(id)]);
        return { id: Number(id), status: 'queued', task_id: 'new-task' };
      },
      async processVideoGeneration(id, options) {
        calls.push(['process', Number(id), options]);
      },
      async recoverVideoGenerations() {
        calls.push(['recover']);
        return 3;
      },
    };
    videoService.configureUnifiedVideoGenerationService(db, lifecycle);

    const result = await videoService.resumeFailedVideoPoll(db, silentLog, 7);
    assert.deepEqual(result, { ok: true, item: { id: 7, status: 'queued', task_id: 'new-task' } });
    await videoService.resumePollForVideoGeneration(db, silentLog, 8);
    assert.equal(await videoService.resumeProcessingVideoGenerations(db, silentLog), 3);
    assert.deepEqual(calls, [
      ['retry', 7],
      ['process', 8, { operation: 'recover' }],
      ['recover'],
    ]);
  });

  it('preserves the legacy resume response envelope for lifecycle errors', async () => {
    const db = createTestDb();
    videoService.configureUnifiedVideoGenerationService(db, {
      async retryVideoGeneration() {
        throw Object.assign(new Error('原始配置快照缺失'), {
          code: 'VIDEO_CONFIG_SNAPSHOT_INVALID',
          status: 409,
        });
      },
    });

    const result = await videoService.resumeFailedVideoPoll(db, silentLog, 1);
    assert.deepEqual(result, {
      ok: false,
      status: 409,
      error: '原始配置快照缺失',
      code: 'VIDEO_CONFIG_SNAPSHOT_INVALID',
    });
  });
});
