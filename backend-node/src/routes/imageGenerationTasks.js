const express = require('express');
const response = require('../response');
const tasks = require('../services/imageGenerationTaskService');
const targets = require('../services/imageGenerationTargetService');
const queue = require('../services/imageGenerationQueueService');
const { createExternalJob, getExternalJob, createGenerationAttempt } = require('../services/externalGenerationService');

module.exports = (db, log = console) => {
  const router = express.Router();
  const handle = (res, operation) => {
    try { response.success(res, operation()); }
    catch (error) {
      log.error?.('imageGenerationTasks', { error: error.message });
      response.badRequest(res, error.message);
    }
  };

  router.post('/image-generation-tasks', (req, res) => handle(res, () => {
    const input = req.body || {};
    const generation = targets.buildGenerationInput(db, {
      drama_id: input.dramaId,
      target_type: input.targetType,
      target_id: input.targetId,
      prompt_snapshot: input.prompt,
    });
    let task = tasks.createTask(db, {
      ...input,
      promptSnapshot: generation.prompt,
      referenceManifest: input.referenceImages || generation.references,
      frameType: generation.frameType,
    });
    if (task.generation_channel === 'chatgpt_web') {
      const job = createExternalJob(db, {
        dramaId: task.drama_id,
        storyboardId: task.target_type.startsWith('storyboard_') ? task.target_id : null,
        assetType: task.target_type,
        provider: 'chatgpt-web',
        site: 'chatgpt',
        promptSnapshot: task.prompt_snapshot,
        imageGenerationTaskId: task.id,
      });
      task = tasks.transitionTask(db, task.id, task.status, { externalJobId: job.id });
    }
    return task.external_job_id ? { ...task, external_job: getExternalJob(db, task.external_job_id) } : task;
  }));

  router.get('/image-generation-tasks/:taskId', (req, res) => handle(res, () => {
    const task = tasks.getTask(db, req.params.taskId);
    if (!task) throw new Error('Image generation task not found');
    return task.external_job_id ? { ...task, external_job: getExternalJob(db, task.external_job_id) } : task;
  }));

  router.get('/dramas/:dramaId/image-generation-summary', (req, res) =>
    handle(res, () => tasks.getSummary(db, req.params.dramaId)));

  router.get('/dramas/:dramaId/image-generation-default', (req, res) =>
    handle(res, () => ({ channel: tasks.getDefaultChannel(db, req.params.dramaId) })));

  router.put('/dramas/:dramaId/image-generation-default', (req, res) =>
    handle(res, () => ({ channel: tasks.setDefaultChannel(db, req.params.dramaId, req.body?.channel) })));

  router.post('/image-generation-batches', (req, res) => handle(res, () => tasks.createBatch(db, {
    dramaId: req.body?.dramaId,
    resourceScope: req.body?.scope,
    generationChannel: req.body?.generationChannel,
    targets: req.body?.targets,
  })));

  router.post('/image-generation-batches/:batchId/pause', (req, res) =>
    handle(res, () => queue.pauseBatch(db, req.params.batchId)));
  router.post('/image-generation-batches/:batchId/resume', (req, res) =>
    handle(res, () => queue.resumeBatch(db, req.params.batchId)));
  router.post('/image-generation-batches/:batchId/run-next', (req, res) =>
    handle(res, () => queue.runNext(db, req.params.batchId)));
  router.post('/image-generation-tasks/:taskId/retry', (req, res) =>
    handle(res, () => queue.retryTask(db, req.params.taskId)));
  router.post('/image-generation-tasks/:taskId/skip', (req, res) =>
    handle(res, () => queue.skipTask(db, req.params.taskId)));
  router.post('/image-generation-tasks/:taskId/cancel', (req, res) =>
    handle(res, () => queue.skipTask(db, req.params.taskId)));

  router.post('/image-generation-tasks/:taskId/prepare-send', (req, res) => handle(res, () => {
    let task = tasks.getTask(db, req.params.taskId);
    if (!task || task.generation_channel !== 'chatgpt_web' || !task.external_job_id) throw new Error('ChatGPT image generation task not found');
    if (task.status === 'draft' || task.status === 'queued') task = tasks.transitionTask(db, task.id, 'preparing');
    if (task.status !== 'preparing') throw new Error(`Image generation task cannot prepare from ${task.status}`);
    const attempt = createGenerationAttempt(db, task.external_job_id, { status: 'ready_to_send' });
    return { task, attempt, external_job: getExternalJob(db, task.external_job_id) };
  }));

  router.post('/image-generation-tasks/:taskId/acknowledge', (req, res) => handle(res, () => db.transaction(() => {
    const task = tasks.getTask(db, req.params.taskId);
    if (!task || task.status !== 'preparing') throw new Error('Image generation task is not awaiting acknowledgement');
    const attempt = db.prepare(`SELECT attempt.* FROM external_generation_attempts attempt
      JOIN external_generation_jobs job ON job.id=attempt.job_id
      WHERE attempt.id=? AND job.image_generation_task_id=?`).get(req.body?.attemptId, task.id);
    if (!attempt) throw new Error('Generation attempt does not belong to this task');
    db.prepare("UPDATE external_generation_attempts SET status='submitted', updated_at=? WHERE id=?")
      .run(new Date().toISOString(), attempt.id);
    return tasks.transitionTask(db, task.id, 'submitted');
  })()));

  router.post('/image-generation-tasks/:taskId/select-result', (req, res) => handle(res, () => db.transaction(() => {
    const task = tasks.getTask(db, req.params.taskId);
    if (!task) throw new Error('Image generation task not found');
    const result = db.prepare(`SELECT result.*, job.image_generation_task_id
      FROM external_generation_results result
      JOIN external_generation_attempts attempt ON attempt.id=result.attempt_id
      JOIN external_generation_jobs job ON job.id=attempt.job_id
      WHERE result.id=?`).get(req.body?.resultId);
    if (!result || result.image_generation_task_id !== task.id) throw new Error('External result does not belong to this image generation task');
    const target = targets.bindResult(db, task, result.image_generation_id);
    db.prepare(`UPDATE external_generation_results SET selected=0, updated_at=? WHERE attempt_id IN
      (SELECT id FROM external_generation_attempts WHERE job_id=?)`).run(new Date().toISOString(), task.external_job_id);
    db.prepare("UPDATE external_generation_results SET selected=1, status='bound', updated_at=? WHERE id=?")
      .run(new Date().toISOString(), result.id);
    const completed = tasks.transitionTask(db, task.id, 'completed', { imageGenerationId: result.image_generation_id });
    if (task.batch_id) queue.refreshBatch(db, task.batch_id);
    return { task: completed, target, result: { ...result, selected: 1, status: 'bound' } };
  })()));

  return router;
};
