const express = require('express');
const response = require('../response');
const tasks = require('../services/imageGenerationTaskService');
const targets = require('../services/imageGenerationTargetService');
const queue = require('../services/imageGenerationQueueService');
const orchestrator = require('../services/imageGenerationOrchestrator');
const { createExternalJob, getExternalJob, createGenerationAttempt } = require('../services/externalGenerationService');
const settingsService = require('../services/settingsService');
const selection = require('../services/imageGenerationResultSelection');
const { checkImageGenerationEnvironment } = require('../services/imageGenerationEnvironmentService');

module.exports = (db, log = console) => {
  const router = express.Router();
  const chatgptWebEnabled = () => settingsService.getGlobalSetting(db, 'chatgpt_web_enabled', true) !== false;
  const assertChannelEnabled = (channel) => {
    if (channel === 'chatgpt_web' && !chatgptWebEnabled()) throw new Error('ChatGPT 网页生图通道未在 API 配置中启用');
  };
  const getEffectiveDefaultChannel = (dramaId) => {
    const configuredChannel = tasks.getDefaultChannel(db, dramaId);
    return configuredChannel === 'chatgpt_web' && !chatgptWebEnabled() ? 'api' : configuredChannel;
  };
  const resolveChannel = (dramaId, requestedChannel) => {
    const channel = requestedChannel || getEffectiveDefaultChannel(dramaId);
    assertChannelEnabled(channel);
    return channel;
  };
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
      asset_mode: input.assetMode ?? input.asset_mode,
    });
    const requestedChannel = resolveChannel(input.dramaId, input.generationChannel || input.generation_channel);
    let task = tasks.createTask(db, {
      ...input,
      generationChannel: requestedChannel,
      promptSnapshot: generation.prompt,
      // References are resolved from the target identity above. Never trust a
      // stale client manifest, which can belong to another shot or asset.
      referenceManifest: generation.references,
      frameType: generation.frameType,
      assetMode: generation.assetMode,
      negativePromptSnapshot: generation.negativePrompt,
      styleSnapshot: generation.styleSnapshot,
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
      task = tasks.transitionTask(db, task.id, 'queued', { externalJobId: job.id });
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

  router.get('/dramas/:dramaId/image-generation-environment', (req, res) =>
    handle(res, () => checkImageGenerationEnvironment(db, {
      dramaId: req.params.dramaId,
      channel: req.query.channel,
      targetType: req.query.targetType,
      targetId: req.query.targetId,
    })));

  router.get('/dramas/:dramaId/image-generation-default', (req, res) =>
    handle(res, () => {
      const configuredChannel = tasks.getDefaultChannel(db, req.params.dramaId);
      const channel = getEffectiveDefaultChannel(req.params.dramaId);
      return { channel, configured_channel: configuredChannel };
    }));

  router.put('/dramas/:dramaId/image-generation-default', (req, res) =>
    handle(res, () => {
      assertChannelEnabled(req.body?.channel);
      return { channel: tasks.setDefaultChannel(db, req.params.dramaId, req.body?.channel) };
    }));

  router.post('/image-generation-batches', (req, res) => handle(res, () => {
    const channel = resolveChannel(req.body?.dramaId, req.body?.generationChannel || req.body?.generation_channel);
    return tasks.createBatch(db, {
      dramaId: req.body?.dramaId,
      resourceScope: req.body?.scope,
      generationChannel: channel,
      targets: req.body?.targets || (Array.isArray(req.body?.targetIds)
        ? req.body.targetIds.map((targetId) => ({ targetType: req.body.targetType || 'storyboard_main', targetId }))
        : []),
    });
  }));

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
    handle(res, () => queue.cancelTask(db, req.params.taskId)));
  router.post('/image-generation-tasks/:taskId/begin-result-recovery', (req, res) =>
    handle(res, () => queue.beginResultRecovery(db, req.params.taskId)));
  router.post('/image-generation-tasks/:taskId/release-result-recovery', (req, res) =>
    handle(res, () => queue.releaseResultRecovery(db, req.params.taskId, req.body?.message)));

  router.post('/image-generation-tasks/claim-next', (req, res) => handle(res, () => queue.claimNextChatgptTask(db)));

  router.post('/image-generation-tasks/:taskId/fail', (req, res) => handle(res, () => {
    const task = tasks.getTask(db, req.params.taskId);
    if (!task) throw new Error('Image generation task not found');
    if (task.generation_channel !== 'chatgpt_web' || task.status !== 'preparing') throw new Error('Only a preparing chatgpt_web task can be failed');
    return tasks.transitionTask(db, task.id, 'failed', { errorCode: 'send_failed', errorMessage: String(req.body?.message || '发送失败') });
  }));

  router.post('/image-generation-tasks/:taskId/defer', (req, res) => handle(res, () => queue.deferTask(db, req.params.taskId)));

  router.post('/image-generation-tasks/:taskId/prepare-send', (req, res) => handle(res, () => {
    let task = tasks.getTask(db, req.params.taskId);
    if (!task || task.generation_channel !== 'chatgpt_web') throw new Error('ChatGPT image generation task not found');
    if (!task.external_job_id) {
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
    if (task.status === 'draft' || task.status === 'queued') task = tasks.transitionTask(db, task.id, 'preparing');
    if (['submitted', 'generating', 'needs_review'].includes(task.status)) {
      const attempt = db.prepare(`SELECT * FROM external_generation_attempts
        WHERE job_id=? ORDER BY sequence DESC LIMIT 1`).get(task.external_job_id);
      if (!attempt) throw new Error('Submitted image generation task has no attempt');
      return {
        task,
        attempt,
        external_job: getExternalJob(db, task.external_job_id),
        already_submitted: true,
      };
    }
    if (task.status !== 'preparing') throw new Error(`Image generation task cannot prepare from ${task.status}`);
    const existingAttempt = db.prepare(`SELECT * FROM external_generation_attempts
      WHERE job_id=? AND status IN ('ready_to_send','submitted') ORDER BY sequence DESC LIMIT 1`).get(task.external_job_id);
    if (existingAttempt) return { task, attempt: existingAttempt, external_job: getExternalJob(db, task.external_job_id), already_submitted: false };
    const attempt = createGenerationAttempt(db, task.external_job_id, { status: 'ready_to_send' });
    return { task, attempt, external_job: getExternalJob(db, task.external_job_id), already_submitted: false };
  }));

  router.post('/image-generation-tasks/:taskId/submit', async (req, res) => {
    try {
      const task = await orchestrator.submitTask(db, log, req.params.taskId);
      response.success(res, task);
    } catch (error) {
      log.error?.('imageGenerationTasks submit', { error: error.message });
      response.badRequest(res, error.message);
    }
  });

  router.post('/image-generation-tasks/:taskId/acknowledge', (req, res) => handle(res, () => db.transaction(() => {
    const task = tasks.getTask(db, req.params.taskId);
    if (!task || !['preparing', 'submitted', 'generating'].includes(task.status)) throw new Error('Image generation task is not awaiting acknowledgement');
    const attempt = db.prepare(`SELECT attempt.* FROM external_generation_attempts attempt
      JOIN external_generation_jobs job ON job.id=attempt.job_id
      WHERE attempt.id=? AND job.image_generation_task_id=?`).get(req.body?.attemptId, task.id);
    if (!attempt) throw new Error('Generation attempt does not belong to this task');
    if (attempt.status === 'generating') {
      return task.status === 'preparing' ? tasks.transitionTask(db, task.id, 'generating') : task;
    }
    db.prepare(`UPDATE external_generation_attempts SET
      status=CASE WHEN status IN ('pending','ready_to_send','submitted') THEN 'submitted' ELSE status END,
      updated_at=? WHERE id=?`).run(new Date().toISOString(), attempt.id);
    return task.status === 'preparing' ? tasks.transitionTask(db, task.id, 'submitted') : task;
  })()));

  router.post('/image-generation-tasks/:taskId/select-result', (req, res) => handle(res, () => {
    const task = tasks.getTask(db, req.params.taskId);
    const result = db.prepare(`SELECT result.*, job.image_generation_task_id
      FROM external_generation_results result
      JOIN external_generation_attempts attempt ON attempt.id=result.attempt_id
      JOIN external_generation_jobs job ON job.id=attempt.job_id
      WHERE result.id=?`).get(req.body?.resultId);
    return selection.selectTaskResult(db, task, result);
  }));

  router.post('/dramas/:dramaId/image-generation-tasks/review/batch-select-first', (req, res) => handle(res, () => selection.batchSelectFirstResults(db, req.params.dramaId)));

  return router;
};
