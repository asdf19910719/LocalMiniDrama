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
    CREATE TABLE external_generation_jobs (id TEXT PRIMARY KEY, image_generation_task_id TEXT, drama_id INTEGER);
    CREATE TABLE external_generation_attempts (id TEXT PRIMARY KEY, job_id TEXT, status TEXT, assistant_message_id TEXT, updated_at TEXT);
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

it('claim-next skips batch-owned queued tasks and leaves them for run-next', () => {
  const db = setup();
  const batchTask = taskService.createTask(db, { dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web', promptSnapshot: 'batch', status: 'queued', batchId: 'batch-1' });
  const solo = taskService.createTask(db, { dramaId: 7, targetType: 'prop', targetId: 2, generationChannel: 'chatgpt_web', promptSnapshot: 'solo', status: 'queued' });
  const claim = queue.claimNextChatgptTask(db);
  assert.equal(claim.claimed, true);
  assert.equal(claim.task.id, solo.id);
  assert.equal(taskService.getTask(db, batchTask.id).status, 'queued');
  taskService.transitionTask(db, solo.id, 'failed', { errorCode: 'send_failed', errorMessage: 'x' });
  const drained = queue.claimNextChatgptTask(db);
  assert.equal(drained.claimed, false);
  assert.equal(drained.active_task_id, undefined);
  assert.equal(taskService.getTask(db, batchTask.id).status, 'queued');
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

it('releases stale submitted and generating tasks for review before claiming the next queued task', () => {
  for (const status of ['submitted', 'generating']) {
    const db = setup();
    const stale = taskService.createTask(db, {
      dramaId: 7,
      targetType: 'character',
      targetId: 1,
      generationChannel: 'chatgpt_web',
      promptSnapshot: status,
      status,
      now: '2026-08-28T00:00:00.000Z',
    });
    const next = taskService.createTask(db, {
      dramaId: 7,
      targetType: 'prop',
      targetId: 2,
      generationChannel: 'chatgpt_web',
      promptSnapshot: 'next',
      status: 'queued',
      now: '2026-08-28T00:01:00.000Z',
    });

    const result = queue.claimNextChatgptTask(db, {
      now: () => new Date('2026-08-28T00:16:00.001Z'),
    });

    const expired = taskService.getTask(db, stale.id);
    assert.equal(expired.status, 'needs_review', `${status} task should release the queue without becoming resendable`);
    assert.equal(expired.error_code, 'result_timeout');
    assert.equal(result.claimed, true);
    assert.equal(result.task.id, next.id);
    db.close();
  }
});

it('reserves timeout recovery only when no other ChatGPT task is active and can release it', () => {
  const db = setup();
  const timedOut = taskService.createTask(db, {
    dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web',
    promptSnapshot: 'timed out', status: 'submitted',
  });
  taskService.transitionTask(db, timedOut.id, 'needs_review', {
    errorCode: 'result_timeout', errorMessage: '等待超时',
  });
  db.prepare('UPDATE image_generation_tasks SET external_job_id=? WHERE id=?').run('job-timeout', timedOut.id);
  db.prepare('INSERT INTO external_generation_jobs (id, image_generation_task_id, drama_id) VALUES (?, ?, ?)').run('job-timeout', timedOut.id, 7);
  db.prepare('INSERT INTO external_generation_attempts (id, job_id, status, assistant_message_id, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('attempt-timeout', 'job-timeout', 'generating', 'assistant-timeout', new Date().toISOString());
  const active = taskService.createTask(db, {
    dramaId: 7, targetType: 'prop', targetId: 2, generationChannel: 'chatgpt_web',
    promptSnapshot: 'active', status: 'preparing',
  });

  assert.throws(() => queue.beginResultRecovery(db, timedOut.id), /已有其他 ChatGPT 生图任务正在执行/);
  taskService.transitionTask(db, active.id, 'failed');

  const reserved = queue.beginResultRecovery(db, timedOut.id);
  assert.equal(reserved.status, 'generating');
  const released = queue.releaseResultRecovery(db, timedOut.id, '恢复捕获失败');
  assert.equal(released.status, 'needs_review');
  assert.equal(released.error_code, 'result_timeout');
  assert.equal(released.error_message, '恢复捕获失败');
  db.close();
});

it('refuses timeout recovery without a durable assistant identity after the queue has advanced', () => {
  const db = setup();
  const timedOut = taskService.createTask(db, {
    dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web',
    promptSnapshot: 'unbound', status: 'submitted',
  });
  db.prepare('UPDATE image_generation_tasks SET external_job_id=? WHERE id=?').run('job-unbound', timedOut.id);
  db.prepare('INSERT INTO external_generation_jobs (id, image_generation_task_id, drama_id) VALUES (?, ?, ?)').run('job-unbound', timedOut.id, 7);
  db.prepare('INSERT INTO external_generation_attempts (id, job_id, status, assistant_message_id, updated_at) VALUES (?, ?, ?, NULL, ?)')
    .run('attempt-unbound', 'job-unbound', 'generating', new Date().toISOString());

  assert.throws(() => queue.beginResultRecovery(db, timedOut.id), /缺少已绑定的 ChatGPT 回复标识/);
  taskService.transitionTask(db, timedOut.id, 'needs_review', {
    errorCode: 'result_timeout', errorMessage: '等待超时',
  });
  assert.throws(() => queue.beginResultRecovery(db, timedOut.id), /缺少已绑定的 ChatGPT 回复标识/);
  assert.equal(taskService.getTask(db, timedOut.id).status, 'needs_review');
  db.close();
});

it('requeues an orphaned preparing claim that never created a send attempt', () => {
  const db = setup();
  const stuck = taskService.createTask(db, { dramaId: 7, targetType: 'scene', targetId: 4, generationChannel: 'chatgpt_web', promptSnapshot: 'x', status: 'preparing' });
  db.prepare('UPDATE image_generation_tasks SET external_job_id=? WHERE id=?').run('job-orphan', stuck.id);
  db.prepare('INSERT INTO external_generation_jobs (id, image_generation_task_id, drama_id) VALUES (?, ?, ?)').run('job-orphan', stuck.id, 7);
  // 领取后驱动页面死亡:prepare-send 没来得及创建任何发送尝试
  db.prepare("UPDATE image_generation_tasks SET updated_at='2026-08-28T00:10:00.000Z' WHERE id=?").run(stuck.id);
  const result = queue.claimNextChatgptTask(db, { now: () => new Date('2026-08-28T00:12:00.000Z') });
  // 退回队列并立即重新认领,不再干等 10 分钟过期
  assert.equal(result.claimed, true);
  assert.equal(result.task.id, stuck.id);
  assert.equal(taskService.getTask(db, stuck.id).status, 'preparing');
  assert.equal(taskService.getTask(db, stuck.id).error_code, null);
  db.close();
});

it('keeps a preparing task with a pending send attempt active', () => {
  const db = setup();
  const task = taskService.createTask(db, { dramaId: 7, targetType: 'scene', targetId: 5, generationChannel: 'chatgpt_web', promptSnapshot: 'y', status: 'preparing' });
  db.prepare('UPDATE image_generation_tasks SET external_job_id=? WHERE id=?').run('job-pending', task.id);
  db.prepare('INSERT INTO external_generation_jobs (id, image_generation_task_id, drama_id) VALUES (?, ?, ?)').run('job-pending', task.id, 7);
  db.prepare('INSERT INTO external_generation_attempts (id, job_id, status, updated_at) VALUES (?, ?, ?, ?)').run('attempt-pending', 'job-pending', 'ready_to_send', new Date().toISOString());
  db.prepare("UPDATE image_generation_tasks SET updated_at='2026-08-28T00:10:00.000Z' WHERE id=?").run(task.id);
  const result = queue.claimNextChatgptTask(db, { now: () => new Date('2026-08-28T00:12:00.000Z') });
  // 已有发送尝试的后台链可能仍在推进:保持活跃,交给 10 分钟过期路径
  assert.equal(result.claimed, false);
  assert.equal(result.active_task_id, task.id);
  assert.equal(taskService.getTask(db, task.id).status, 'preparing');
  db.close();
});

it('reconciles a submitted task whose external attempt already needs review', () => {
  const db = setup();
  const task = taskService.createTask(db, { dramaId: 7, targetType: 'scene', targetId: 10, generationChannel: 'chatgpt_web', promptSnapshot: 'stale', status: 'submitted' });
  db.prepare('UPDATE image_generation_tasks SET external_job_id=? WHERE id=?').run('job-review', task.id);
  db.prepare('INSERT INTO external_generation_jobs (id, image_generation_task_id, drama_id) VALUES (?, ?, ?)').run('job-review', task.id, 7);
  db.prepare('INSERT INTO external_generation_attempts (id, job_id, status, updated_at) VALUES (?, ?, ?, ?)').run('attempt-review', 'job-review', 'needs_review', new Date().toISOString());
  const result = queue.claimNextChatgptTask(db);
  assert.equal(taskService.getTask(db, task.id).status, 'needs_review');
  assert.equal(result.claimed, false);
  db.close();
});
