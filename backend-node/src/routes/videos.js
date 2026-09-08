const response = require('../response');
const videoService = require('../services/videoService');
const taskService = require('../services/taskService');
const { createUnifiedVideoGenerationService } = require('../services/unifiedVideoGenerationService');

function sendLifecycleError(res, error) {
  const messageCode = /^[A-Z][A-Z0-9_]{2,}$/.test(String(error?.message || ''))
    ? String(error.message)
    : null;
  const code = error?.code || messageCode || 'INTERNAL_ERROR';
  const status = Number(error?.status)
    || (code.startsWith('VIDEO_') ? 400 : 500);
  const message = error?.message || '视频生成服务错误';
  response.error(res, status, code, message, error?.details);
}

function routes(db, log, { providerRegistry, lifecycleService, preparedService = null } = {}) {
  const lifecycle = lifecycleService || createUnifiedVideoGenerationService({ db, log, providerRegistry });

  function assertStyleContract(input = {}) {
    const dramaId = Number(input.drama_id ?? input.dramaId) || 0;
    const hasRequestStyle = input.style !== undefined || input.style_id !== undefined || input.styleId !== undefined;
    if (dramaId && hasRequestStyle) {
      const error = new Error('项目内视频生成不能覆盖项目风格');
      error.code = 'PROJECT_STYLE_OVERRIDE_FORBIDDEN';
      error.status = 400;
      throw error;
    }
    if (!dramaId && !String(input.style_id ?? input.styleId ?? '').trim()) {
      const error = new Error('自由视频生成必须选择 style_id');
      error.code = 'PROJECT_STYLE_REQUIRED';
      error.status = 400;
      throw error;
    }
  }

  return {
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = videoService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (error) {
        log.error('videos list', { error: error.message });
        response.internalError(res, error.message);
      }
    },

    create: async (req, res) => {
      try {
        assertStyleContract(req.body || {});
        const item = await lifecycle.createVideoGeneration(req.body || {});
        response.created(res, item);
      } catch (error) {
        log.error('videos create', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    preparedCreate: async (req, res) => {
      try {
        assertStyleContract(req.body || {});
        if (!preparedService) throw new Error('VIDEO_PREPARATION_UNAVAILABLE');
        const result = await preparedService.prepareAndCreateVideoGeneration(req.body || {});
        response.created(res, result);
      } catch (error) {
        log.error('videos prepared create', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    preparedBatch: async (req, res) => {
      try {
        if (!preparedService) throw new Error('VIDEO_PREPARATION_UNAVAILABLE');
        const inputs = Array.isArray(req.body) ? req.body : req.body?.inputs;
        if (!Array.isArray(inputs)) return response.badRequest(res, 'inputs 必须为数组');
        inputs.forEach(assertStyleContract);
        response.success(res, await preparedService.prepareAndCreateMany(inputs));
      } catch (error) {
        log.error('videos prepared batch', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    capabilities: (req, res) => {
      try {
        if (typeof lifecycle.getVideoCapabilities !== 'function') {
          const unavailable = new Error('VIDEO_CAPABILITIES_UNAVAILABLE');
          unavailable.code = 'VIDEO_CAPABILITIES_UNAVAILABLE';
          unavailable.status = 500;
          throw unavailable;
        }
        response.success(res, lifecycle.getVideoCapabilities());
      } catch (error) {
        log.error('videos capabilities', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    workflows: (req, res) => {
      try {
        if (typeof lifecycle.getWorkflowCatalog !== 'function') {
          const unavailable = new Error('VIDEO_WORKFLOW_CATALOG_UNAVAILABLE');
          unavailable.code = 'VIDEO_WORKFLOW_CATALOG_UNAVAILABLE';
          unavailable.status = 500;
          throw unavailable;
        }
        response.success(res, lifecycle.getWorkflowCatalog());
      } catch (error) {
        log.error('videos workflows', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    h3Preview: async (req, res) => {
      try {
        assertStyleContract(req.body || {});
        if (!lifecycle.previewH3Prompt) throw new Error('H3 prompt preview is not configured');
        response.success(res, await lifecycle.previewH3Prompt(req.body || {}));
      } catch (error) {
        log.error('videos h3 preview', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    get: (req, res) => {
      try {
        const item = lifecycle.getVideoGeneration(req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (error) {
        log.error('videos get', { error: error.message });
        response.internalError(res, error.message);
      }
    },

    delete: (req, res) => {
      try {
        const ok = videoService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (error) {
        log.error('videos delete', { error: error.message });
        response.internalError(res, error.message);
      }
    },

    cancel: async (req, res) => {
      try {
        response.success(res, await lifecycle.cancelVideoGeneration(req.params.id));
      } catch (error) {
        log.error('videos cancel', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    retry: async (req, res) => {
      try {
        response.success(res, await lifecycle.retryVideoGeneration(req.params.id));
      } catch (error) {
        log.error('videos retry', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    // Legacy compatibility: continuing a failed upstream poll is now the strict
    // snapshot retry path. It never resolves the current default configuration.
    resumePoll: async (req, res) => {
      try {
        response.success(res, await lifecycle.retryVideoGeneration(req.params.id));
      } catch (error) {
        log.error('videos resumePoll', { code: error.code, error: error.message });
        sendLifecycleError(res, error);
      }
    },

    fromImage: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'video_generation', req.params.image_gen_id);
        response.success(res, { task_id: task.id });
      } catch (error) {
        log.error('videos fromImage', { error: error.message });
        response.internalError(res, error.message);
      }
    },

    episodeBatch: (req, res) => {
      try {
        response.success(res, []);
      } catch (error) {
        log.error('videos episode batch', { error: error.message });
        response.internalError(res, error.message);
      }
    },
  };
}

module.exports = routes;
