const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const service = require('../src/services/imageGenerationTaskService');

describe('unified image generation task service', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      metadata TEXT,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE image_generation_batches (
      id TEXT PRIMARY KEY, drama_id INTEGER NOT NULL, resource_scope TEXT NOT NULL,
      generation_channel TEXT NOT NULL, status TEXT NOT NULL, total_count INTEGER NOT NULL,
      completed_count INTEGER NOT NULL DEFAULT 0, review_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE image_generation_tasks (
      id TEXT PRIMARY KEY, drama_id INTEGER NOT NULL, target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL, generation_channel TEXT NOT NULL, provider TEXT, model TEXT,
      prompt_snapshot TEXT, reference_manifest TEXT, aspect_ratio TEXT, frame_type TEXT,
      status TEXT NOT NULL, batch_id TEXT, queue_position INTEGER, image_generation_id INTEGER,
      external_job_id TEXT, error_code TEXT, error_message TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, completed_at TEXT
    )`);
    db.prepare('INSERT INTO dramas (id, title, metadata) VALUES (?, ?, ?)').run(7, 'test', '{}');
  });

  afterEach(() => db.close());

  it('persists target identity and uses the project default channel', () => {
    service.setDefaultChannel(db, 7, 'chatgpt_web');
    const task = service.createTask(db, {
      dramaId: 7,
      targetType: 'character',
      targetId: 9,
      promptSnapshot: 'portrait',
    });

    assert.equal(task.drama_id, 7);
    assert.equal(task.target_type, 'character');
    assert.equal(task.target_id, 9);
    assert.equal(task.generation_channel, 'chatgpt_web');
    assert.equal(task.status, 'draft');
    assert.equal(service.getDefaultChannel(db, 7), 'chatgpt_web');
  });

  it('rejects invalid channels and target types', () => {
    assert.throws(() => service.setDefaultChannel(db, 7, 'unknown'), /channel/i);
    assert.throws(() => service.createTask(db, {
      dramaId: 7,
      targetType: 'unknown',
      targetId: 9,
    }), /target type/i);
  });

  it('enforces task transitions and reports one project summary', () => {
    const first = service.createTask(db, {
      dramaId: 7,
      targetType: 'scene',
      targetId: 2,
      generationChannel: 'api',
    });
    const second = service.createTask(db, {
      dramaId: 7,
      targetType: 'prop',
      targetId: 3,
      generationChannel: 'chatgpt_web',
      status: 'queued',
    });

    service.transitionTask(db, first.id, 'preparing');
    service.transitionTask(db, first.id, 'submitted');
    service.transitionTask(db, first.id, 'generating');
    service.transitionTask(db, first.id, 'completed', { imageGenerationId: 55 });
    assert.throws(() => service.transitionTask(db, first.id, 'generating'), /transition/i);

    const summary = service.getSummary(db, 7);
    assert.equal(summary.total, 2);
    assert.equal(summary.completed, 1);
    assert.equal(summary.queued, 1);
    assert.equal(summary.active_task_id, second.id);
  });

  it('creates an ordered batch and its queued tasks atomically', () => {
    const batch = service.createBatch(db, {
      dramaId: 7,
      resourceScope: 'characters',
      generationChannel: 'chatgpt_web',
      targets: [
        { targetType: 'character', targetId: 4, promptSnapshot: 'four' },
        { targetType: 'character', targetId: 5, promptSnapshot: 'five' },
      ],
    });

    assert.equal(batch.total_count, 2);
    const tasks = db.prepare('SELECT * FROM image_generation_tasks WHERE batch_id=? ORDER BY queue_position').all(batch.id);
    assert.deepEqual(tasks.map((task) => task.queue_position), [0, 1]);
    assert.deepEqual(tasks.map((task) => task.status), ['queued', 'queued']);
  });

  it('prefers a pollable task over an older draft when restoring', () => {
    service.createTask(db, {
      id: 'older-draft', dramaId: 7, targetType: 'character', targetId: 1,
      generationChannel: 'chatgpt_web', status: 'draft', now: '2026-08-28T00:00:00.000Z',
    });
    service.createTask(db, {
      id: 'running-task', dramaId: 7, targetType: 'character', targetId: 2,
      generationChannel: 'chatgpt_web', status: 'submitted', now: '2026-08-28T00:01:00.000Z',
    });

    assert.equal(service.getSummary(db, 7).active_task_id, 'running-task');
  });
});
