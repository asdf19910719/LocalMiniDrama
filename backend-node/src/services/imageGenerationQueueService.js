const tasks = require('./imageGenerationTaskService');

const ACTIVE = ['preparing', 'submitted', 'generating'];

function getBatch(db, id) {
  const batch = db.prepare('SELECT * FROM image_generation_batches WHERE id=?').get(String(id));
  if (!batch) throw new Error('Image generation batch not found');
  return batch;
}

function refreshBatch(db, batchId) {
  const counts = db.prepare(`SELECT
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
    SUM(CASE WHEN status='needs_review' THEN 1 ELSE 0 END) review,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
    SUM(CASE WHEN status IN ('draft','queued','preparing','submitted','generating') THEN 1 ELSE 0 END) remaining
    FROM image_generation_tasks WHERE batch_id=?`).get(String(batchId));
  const batch = getBatch(db, batchId);
  const status = batch.status === 'paused' ? 'paused' : Number(counts.remaining || 0) === 0 ? 'completed' : 'running';
  db.prepare(`UPDATE image_generation_batches SET status=?, completed_count=?, review_count=?, failed_count=?, updated_at=? WHERE id=?`)
    .run(status, counts.completed || 0, counts.review || 0, counts.failed || 0, new Date().toISOString(), String(batchId));
  return getBatch(db, batchId);
}

function runNext(db, batchId) {
  return db.transaction(() => {
    const batch = getBatch(db, batchId);
    if (batch.status === 'paused' || batch.status === 'completed' || batch.status === 'cancelled') return null;
    const active = db.prepare(`SELECT * FROM image_generation_tasks WHERE batch_id=? AND status IN (${ACTIVE.map(() => '?').join(',')}) ORDER BY queue_position LIMIT 1`)
      .get(String(batchId), ...ACTIVE);
    if (active) return active;
    const next = db.prepare("SELECT * FROM image_generation_tasks WHERE batch_id=? AND status='queued' ORDER BY queue_position LIMIT 1").get(String(batchId));
    if (!next) { refreshBatch(db, batchId); return null; }
    const claimed = tasks.transitionTask(db, next.id, 'preparing');
    db.prepare("UPDATE image_generation_batches SET status='running', updated_at=? WHERE id=?").run(new Date().toISOString(), String(batchId));
    return claimed;
  })();
}

function pauseBatch(db, batchId) {
  getBatch(db, batchId);
  db.prepare("UPDATE image_generation_batches SET status='paused', updated_at=? WHERE id=?").run(new Date().toISOString(), String(batchId));
  return getBatch(db, batchId);
}

function resumeBatch(db, batchId) {
  const batch = getBatch(db, batchId);
  if (batch.status !== 'paused') throw new Error('Only a paused image generation batch can resume');
  db.prepare("UPDATE image_generation_batches SET status='queued', updated_at=? WHERE id=?").run(new Date().toISOString(), String(batchId));
  return getBatch(db, batchId);
}

function skipTask(db, taskId) {
  const task = tasks.getTask(db, taskId);
  if (!task) throw new Error('Image generation task not found');
  const updated = tasks.transitionTask(db, taskId, 'cancelled');
  if (task.batch_id) refreshBatch(db, task.batch_id);
  return updated;
}

function retryTask(db, taskId) {
  const task = tasks.getTask(db, taskId);
  if (!task) throw new Error('Image generation task not found');
  if (task.status !== 'failed') throw new Error('Only a failed image generation task can retry');
  const updated = tasks.transitionTask(db, taskId, 'queued');
  if (task.batch_id) db.prepare("UPDATE image_generation_batches SET status='queued', updated_at=? WHERE id=?").run(new Date().toISOString(), task.batch_id);
  return updated;
}

function cancelTask(db, taskId) {
  return skipTask(db, taskId);
}

const PREPARING_STALE_MS = 10 * 60 * 1000;

function claimNextChatgptTask(db, { now = () => new Date() } = {}) {
  return db.transaction(() => {
    const timestamp = now();
    const staleBefore = new Date(timestamp.getTime() - PREPARING_STALE_MS).toISOString();
    // Reconcile attempts that already failed capture before applying the
    // single-active-task lock. Older adapter builds could persist
    // `needs_review` only on the external attempt, leaving the unified task
    // stuck in `submitted` and blocking every queued task behind it.
    db.prepare(`UPDATE image_generation_tasks
      SET status='needs_review', updated_at=?
      WHERE generation_channel='chatgpt_web' AND status IN ('preparing','submitted','generating')
        AND external_job_id IN (
          SELECT job_id FROM external_generation_attempts WHERE status='needs_review'
        )`).run(timestamp.toISOString());
    const stale = db.prepare(`SELECT * FROM image_generation_tasks
      WHERE generation_channel='chatgpt_web' AND status='preparing' AND updated_at < ?
      ORDER BY updated_at LIMIT 1`).get(staleBefore);
    if (stale) tasks.transitionTask(db, stale.id, 'failed', { errorCode: 'send_timeout', errorMessage: '超时未发送，已跳过' });
    const active = db.prepare(`SELECT id FROM image_generation_tasks
      WHERE generation_channel='chatgpt_web' AND status IN ('submitted','generating') LIMIT 1`).get()
      || db.prepare(`SELECT id FROM image_generation_tasks
        WHERE generation_channel='chatgpt_web' AND status='preparing' AND updated_at >= ?
        ORDER BY updated_at DESC LIMIT 1`).get(staleBefore);
    if (active) return { claimed: false, active_task_id: active.id };
    // 批次任务由 run-next 领取（批次自身串行）；领取查询只消费单独任务，
    // 但 preparing/submitted/generating 的批次任务仍算全局活跃（并发 1 覆盖批次）。
    const next = db.prepare(`SELECT * FROM image_generation_tasks
      WHERE generation_channel='chatgpt_web' AND status='queued' AND batch_id IS NULL
      ORDER BY created_at LIMIT 1`).get();
    if (!next) return { claimed: false };
    return { claimed: true, task: tasks.transitionTask(db, next.id, 'preparing') };
  })();
}

module.exports = { runNext, pauseBatch, resumeBatch, skipTask, retryTask, cancelTask, refreshBatch, claimNextChatgptTask };
