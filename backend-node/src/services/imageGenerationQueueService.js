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

module.exports = { runNext, pauseBatch, resumeBatch, skipTask, retryTask, refreshBatch };
