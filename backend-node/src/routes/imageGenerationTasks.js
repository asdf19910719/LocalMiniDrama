const express = require('express');
const response = require('../response');
const tasks = require('../services/imageGenerationTaskService');
const targets = require('../services/imageGenerationTargetService');

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
    return tasks.createTask(db, {
      ...input,
      promptSnapshot: generation.prompt,
      referenceManifest: input.referenceImages || generation.references,
      frameType: generation.frameType,
    });
  }));

  router.get('/image-generation-tasks/:taskId', (req, res) => handle(res, () => {
    const task = tasks.getTask(db, req.params.taskId);
    if (!task) throw new Error('Image generation task not found');
    return task;
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

  return router;
};
