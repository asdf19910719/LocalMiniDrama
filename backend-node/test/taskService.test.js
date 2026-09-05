const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const taskService = require('../src/services/taskService');

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
  `);
  return db;
}

describe('taskService.failOrphanedAsyncTasksOnStartup', () => {
  it('marks pending and processing tasks as failed on startup', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-pending', 'background_extraction', 'pending', '42', now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-processing', 'background_extraction', 'processing', '42', now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, 100, '', ?, ?, ?, ?)`
    ).run('task-done', 'background_extraction', 'completed', '42', now, now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, 'video_generation', 'pending', 0, '', ?, ?, ?)`
    ).run('video-recoverable', '42', now, now);

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });
    assert.equal(count, 3);

    const pending = taskService.getTask(db, 'task-pending');
    const processing = taskService.getTask(db, 'task-processing');
    const done = taskService.getTask(db, 'task-done');
    const videoRecoverable = taskService.getTask(db, 'video-recoverable');

    assert.equal(pending.status, 'failed');
    assert.equal(processing.status, 'failed');
    assert.equal(pending.error, taskService.ORPHAN_ASYNC_TASK_MSG);
    assert.equal(done.status, 'completed');
    assert.equal(videoRecoverable.status, 'failed');
  });

  it('only preserves video tasks backed by a recoverable canonical video row and snapshot', () => {
    const db = createTestDb();
    db.exec(`
      CREATE TABLE video_generations (
        id INTEGER PRIMARY KEY,
        task_id TEXT,
        status TEXT,
        config_snapshot TEXT,
        deleted_at TEXT
      );
    `);
    const now = new Date().toISOString();
    const insertTask = db.prepare(`
      INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
      VALUES (?, 'video_generation', ?, 0, '', '42', ?, ?)
    `);
    insertTask.run('video-recoverable', 'pending', now, now);
    insertTask.run('video-unmatched', 'pending', now, now);
    insertTask.run('video-no-snapshot', 'processing', now, now);
    insertTask.run('video-terminal-row', 'processing', now, now);
    const insertVideo = db.prepare(`
      INSERT INTO video_generations (id, task_id, status, config_snapshot)
      VALUES (?, ?, ?, ?)
    `);
    insertVideo.run(1, 'video-recoverable', 'waiting', '{"configId":1,"provider":"fake","model":"v1"}');
    insertVideo.run(2, 'video-no-snapshot', 'running', null);
    insertVideo.run(3, 'video-terminal-row', 'review', '{"configId":1,"provider":"fake","model":"v1"}');

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });

    assert.equal(count, 3);
    assert.equal(taskService.getTask(db, 'video-recoverable').status, 'pending');
    assert.equal(taskService.getTask(db, 'video-unmatched').status, 'failed');
    assert.equal(taskService.getTask(db, 'video-no-snapshot').status, 'failed');
    assert.equal(taskService.getTask(db, 'video-terminal-row').status, 'failed');
  });

  it('preserves a video merge task backed by a recoverable upscale job', () => {
    const db = createTestDb();
    db.exec(`
      CREATE TABLE video_merges (id INTEGER PRIMARY KEY, task_id TEXT, deleted_at TEXT);
      CREATE TABLE video_upscale_jobs (
        id TEXT PRIMARY KEY, video_merge_id INTEGER, status TEXT, config_snapshot_json TEXT
      );
    `);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO async_tasks
      (id, type, status, progress, message, resource_id, created_at, updated_at)
      VALUES ('merge-task', 'video_merge', 'processing', 35, '等待云端', '9', ?, ?)`)
      .run(now, now);
    db.prepare("INSERT INTO video_merges (id, task_id) VALUES (9, 'merge-task')").run();
    db.prepare(`INSERT INTO video_upscale_jobs
      (id, video_merge_id, status, config_snapshot_json)
      VALUES ('upscale-job', 9, 'waiting_provider', '{"provider":"zealman"}')`).run();

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });

    assert.equal(count, 0);
    assert.equal(taskService.getTask(db, 'merge-task').status, 'processing');
  });

  it('cancelTask marks active task as failed', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-active', 'background_extraction', 'processing', '42', now, now);

    const result = taskService.cancelTask(db, { info() {} }, 'task-active');
    assert.equal(result.ok, true);
    const task = taskService.getTask(db, 'task-active');
    assert.equal(task.status, 'failed');
    assert.equal(task.error, taskService.USER_CANCEL_TASK_MSG);
  });
});
