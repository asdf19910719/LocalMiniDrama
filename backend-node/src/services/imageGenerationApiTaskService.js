const tasks = require('./imageGenerationTaskService');
const targets = require('./imageGenerationTargetService');

const ACTIVE_IMAGE_STATUSES = new Set(['pending', 'queued', 'processing', 'generating', 'submitted']);

/**
 * Reconcile the asynchronous image_generations row with its unified API task.
 * Polling this operation is idempotent: terminal tasks are returned unchanged,
 * while a completed image is bound to the original immutable target snapshot.
 */
function reconcileTask(db, taskOrId) {
  let task = typeof taskOrId === 'object' && taskOrId
    ? taskOrId
    : tasks.getTask(db, taskOrId);
  if (!task || task.generation_channel !== 'api' || task.status !== 'generating' || !task.image_generation_id) {
    return task;
  }
  const image = db.prepare('SELECT * FROM image_generations WHERE id=?').get(Number(task.image_generation_id));
  if (!image || ACTIVE_IMAGE_STATUSES.has(String(image.status || '').toLowerCase())) return task;
  if (String(image.status || '').toLowerCase() === 'completed') {
    try {
      targets.bindResult(db, task, image.id);
      return tasks.transitionTask(db, task.id, 'completed');
    } catch (error) {
      return tasks.transitionTask(db, task.id, 'failed', {
        errorCode: error.code || 'IMAGE_RESULT_BIND_FAILED',
        errorMessage: error.message,
      });
    }
  }
  return tasks.transitionTask(db, task.id, 'failed', {
    errorCode: image.error_code || 'IMAGE_GENERATION_FAILED',
    errorMessage: image.error_msg || '图片生成失败',
  });
}

module.exports = { reconcileTask };
