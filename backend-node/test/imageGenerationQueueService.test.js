const { it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const taskService = require('../src/services/imageGenerationTaskService');
const queue = require('../src/services/imageGenerationQueueService');

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE dramas (id INTEGER PRIMARY KEY, metadata TEXT, deleted_at TEXT, updated_at TEXT);
    CREATE TABLE image_generation_batches (id TEXT PRIMARY KEY, drama_id INTEGER, resource_scope TEXT, generation_channel TEXT, status TEXT, total_count INTEGER, completed_count INTEGER DEFAULT 0, review_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE image_generation_tasks (id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER, generation_channel TEXT, provider TEXT, model TEXT, prompt_snapshot TEXT, reference_manifest TEXT, aspect_ratio TEXT, frame_type TEXT, status TEXT, batch_id TEXT, queue_position INTEGER, image_generation_id INTEGER, external_job_id TEXT, error_code TEXT, error_message TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT);
    INSERT INTO dramas VALUES (7, '{"default_image_generation_channel":"chatgpt_web"}', NULL, NULL);`);
  return db;
}

it('claims exactly one ChatGPT task and advances after terminal outcomes', () => {
  const db = setup();
  const batch = taskService.createBatch(db, { dramaId: 7, resourceScope: 'characters', generationChannel: 'chatgpt_web', targets: [1, 2, 3].map((targetId) => ({ targetType: 'character', targetId })) });
  const first = queue.runNext(db, batch.id);
  assert.equal(first.queue_position, 0);
  assert.equal(first.status, 'preparing');
  assert.equal(queue.runNext(db, batch.id).id, first.id);

  taskService.transitionTask(db, first.id, 'submitted');
  taskService.transitionTask(db, first.id, 'needs_review');
  const second = queue.runNext(db, batch.id);
  assert.equal(second.queue_position, 1);
  queue.skipTask(db, second.id);
  const third = queue.runNext(db, batch.id);
  assert.equal(third.queue_position, 2);
  taskService.transitionTask(db, third.id, 'failed', { errorCode: 'BRIDGE_OFFLINE' });
  assert.equal(queue.runNext(db, batch.id), null);

  const finalBatch = db.prepare('SELECT * FROM image_generation_batches WHERE id=?').get(batch.id);
  assert.equal(finalBatch.review_count, 1);
  assert.equal(finalBatch.failed_count, 1);
  assert.equal(finalBatch.status, 'completed');
  db.close();
});

it('pauses, resumes, and retries failed work without creating another task', () => {
  const db = setup();
  const batch = taskService.createBatch(db, { dramaId: 7, resourceScope: 'props', generationChannel: 'chatgpt_web', targets: [{ targetType: 'prop', targetId: 8 }] });
  queue.pauseBatch(db, batch.id);
  assert.equal(queue.runNext(db, batch.id), null);
  queue.resumeBatch(db, batch.id);
  const task = queue.runNext(db, batch.id);
  taskService.transitionTask(db, task.id, 'failed');
  const retried = queue.retryTask(db, task.id);
  assert.equal(retried.id, task.id);
  assert.equal(retried.status, 'queued');
  db.close();
});

it('claims the oldest queued chatgpt task and blocks while one is active', () => {
  const db = setup();
  const first = taskService.createTask(db, { dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web', promptSnapshot: 'a', status: 'queued' });
  const second = taskService.createTask(db, { dramaId: 7, targetType: 'prop', targetId: 1, generationChannel: 'chatgpt_web', promptSnapshot: 'b', status: 'queued' });
  const claim = queue.claimNextChatgptTask(db);
  assert.equal(claim.claimed, true);
  assert.equal(claim.task.id, first.id);
  assert.equal(taskService.getTask(db, first.id).status, 'preparing');
  const blocked = queue.claimNextChatgptTask(db);
  assert.equal(blocked.claimed, false);
  assert.equal(blocked.active_task_id, first.id);
  taskService.transitionTask(db, first.id, 'failed', { errorCode: 'send_failed', errorMessage: 'x' });
  const next = queue.claimNextChatgptTask(db);
  assert.equal(next.claimed, true);
  assert.equal(next.task.id, second.id);
  db.close();
});

it('fails stale preparing tasks and keeps fresh ones active', () => {
  const db = setup();
  const stale = taskService.createTask(db, { dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web', promptSnapshot: 's', status: 'preparing' });
  db.prepare("UPDATE image_generation_tasks SET updated_at='2026-08-28T00:00:00.000Z' WHERE id=?").run(stale.id);
  const result = queue.claimNextChatgptTask(db, { now: () => new Date('2026-08-28T00:20:00.000Z') });
  assert.equal(taskService.getTask(db, stale.id).status, 'failed');
  assert.equal(taskService.getTask(db, stale.id).error_code, 'send_timeout');
  assert.equal(result.claimed, false);
  db.close();
});
