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
