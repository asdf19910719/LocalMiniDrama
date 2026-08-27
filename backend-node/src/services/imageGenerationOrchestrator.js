const imageService = require('./imageService');
const tasks = require('./imageGenerationTaskService');
const targets = require('./imageGenerationTargetService');

function parseReferences(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (_) {
    return undefined;
  }
}

/**
 * Dispatch one API-channel task through the existing image service. The image
 * service remains responsible for provider selection and asynchronous polling;
 * this layer owns the unified task lifecycle and result linkage.
 */
async function submitTask(db, log = console, taskId, options = {}) {
  const task = tasks.getTask(db, taskId);
  if (!task) throw new Error('Image generation task not found');
  if (task.generation_channel !== 'api') throw new Error('Only API image generation tasks can be submitted here');
  if (task.status === 'completed') return task;
  if (task.status === 'generating') return task;
  if (!['draft', 'queued', 'preparing', 'failed'].includes(task.status)) {
    throw new Error(`Image generation task cannot submit from ${task.status}`);
  }

  let prepared = task;
  if (prepared.status === 'draft' || prepared.status === 'queued' || prepared.status === 'failed') {
    prepared = tasks.transitionTask(db, prepared.id, 'preparing');
  }
  const input = targets.buildGenerationInput(db, prepared);
  const createImage = options.createImage || imageService.create;
  try {
    const image = await Promise.resolve(createImage(db, log, {
      drama_id: prepared.drama_id,
      storyboard_id: prepared.target_type.startsWith('storyboard_') ? prepared.target_id : undefined,
      scene_id: input.target.scene_id || undefined,
      prompt: input.prompt,
      reference_images: input.references,
      aspect_ratio: prepared.aspect_ratio || undefined,
      frame_type: input.frameType || prepared.frame_type || undefined,
      provider: prepared.provider || undefined,
      model: prepared.model || undefined,
    }));
    const imageId = image?.id ?? image?.image_generation_id;
    if (!imageId) throw new Error('Image service did not return an image generation id');
    return tasks.transitionTask(db, prepared.id, 'generating', { imageGenerationId: imageId });
  } catch (error) {
    tasks.transitionTask(db, prepared.id, 'failed', { errorCode: error.code || 'IMAGE_GENERATION_SUBMIT_FAILED', errorMessage: error.message });
    throw error;
  }
}

module.exports = { submitTask, parseReferences };
