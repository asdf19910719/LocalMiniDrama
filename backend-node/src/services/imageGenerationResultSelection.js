const targets = require('./imageGenerationTargetService');
const tasks = require('./imageGenerationTaskService');
const queue = require('./imageGenerationQueueService');

// 把一个抓回结果定稿为任务主图:绑定目标、结果行置 bound/selected、任务完成。
// select-result 路由与批量"采用首选"共用,保证两条入口行为一致。
function selectTaskResult(db, task, result) {
  if (!task) throw new Error('Image generation task not found');
  if (!result || result.image_generation_task_id !== task.id) throw new Error('External result does not belong to this image generation task');
  const target = targets.bindResult(db, task, result.image_generation_id);
  const now = new Date().toISOString();
  db.prepare(`UPDATE external_generation_results SET selected=0, updated_at=? WHERE attempt_id IN
    (SELECT id FROM external_generation_attempts WHERE job_id=?)`).run(now, task.external_job_id);
  db.prepare("UPDATE external_generation_results SET selected=1, status='bound', updated_at=? WHERE id=?").run(now, result.id);
  const completed = tasks.transitionTask(db, task.id, 'completed', { imageGenerationId: result.image_generation_id });
  if (task.batch_id) queue.refreshBatch(db, task.batch_id);
  return { task: completed, target, result: { ...result, selected: 1, status: 'bound' } };
}

// 对该剧所有 chatgpt_web 且 needs_review 的任务采用其首选候选;
// 无候选的任务保持 needs_review(返回 skipped),单任务失败不影响其余。
function batchSelectFirstResults(db, dramaId) {
  const rows = db.prepare(`SELECT * FROM image_generation_tasks
    WHERE drama_id=? AND generation_channel='chatgpt_web' AND status='needs_review'
    ORDER BY created_at`).all(Number(dramaId));
  return rows.map((task) => {
    const result = db.prepare(`SELECT r.*, ? AS image_generation_task_id FROM external_generation_results r
      JOIN external_generation_attempts a ON a.id = r.attempt_id
      JOIN external_generation_jobs j ON j.id = a.job_id
      WHERE j.image_generation_task_id = ? AND r.status IN ('imported','bound')
      ORDER BY a.sequence, r.result_index LIMIT 1`).get(task.id, task.id);
    if (!result) return { task_id: task.id, status: 'skipped', reason: 'no_candidates' };
    try {
      const selected = selectTaskResult(db, task, result);
      return { task_id: task.id, status: 'selected', image_generation_id: result.image_generation_id, target: selected.target };
    } catch (error) {
      return { task_id: task.id, status: 'failed', reason: error.message };
    }
  });
}

module.exports = { selectTaskResult, batchSelectFirstResults };
