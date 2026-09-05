const { resolveVideoUpscaleConfig } = require('./videoUpscaleConfig');
const { createVideoUpscaleRepository } = require('./videoUpscaleRepository');
const { createVideoUpscaleJobService } = require('./videoUpscaleJobService');
const { ZealmanUpscaleClient } = require('./zealmanUpscaleClient');
const { upscaleError } = require('./upscaleErrors');

function createVideoUpscaleRuntime({ db, appConfig, log, clientFactory, media, sleep }) {
  const repository = createVideoUpscaleRepository(db);
  const config = resolveVideoUpscaleConfig(db, appConfig);
  const client = clientFactory
    ? clientFactory(config)
    : new ZealmanUpscaleClient({ baseUrl: config.base_url, apiKey: config.api_key });
  const service = createVideoUpscaleJobService({ db, repository, config, client, media, sleep, log });
  let completionHandler = null;
  let recoveryPromise = null;

  async function notify(job) {
    if (completionHandler && ['completed', 'skipped', 'failed', 'cancelled'].includes(job?.status)) {
      try { await completionHandler(job); }
      catch (error) { if (log?.error) log.error('video upscale completion handler', { job_id: job?.id, error: error.message }); }
    }
    return job;
  }

  async function capabilities() {
    const result = {
      enabled: config.enabled,
      provider: config.provider,
      base_url: config.base_url,
      default_method: config.default_method,
      source: { width: config.expected_source_width, height: config.expected_source_height },
      target: { width: config.expected_source_width * config.scale, height: config.expected_source_height * config.scale },
      methods: {
        flash: { workflow_id: config.workflows.flash, recommended: true },
        seed: { workflow_id: config.workflows.seed, recommended: false },
      },
      provider_online: false,
      comfyui_running: false,
      message: config.enabled ? '正在检查云端服务' : '云端视频超分服务未启用',
    };
    if (!config.enabled) return result;
    try {
      await client.health();
      result.provider_online = true;
      const status = await client.getComfyStatus();
      result.comfyui_running = status?.running === true && (!status.reason || status.reason === 'ready');
      result.message = result.comfyui_running ? '云端超分服务可用' : '云端面板在线，ComfyUI 尚未就绪';
      for (const method of ['flash', 'seed']) {
        try {
          await client.loadWorkflowTemplate(config.workflows[method]);
          result.methods[method].available = true;
        } catch (error) {
          result.methods[method].available = false;
          result.methods[method].error_code = error.code || 'WORKFLOW_CHECK_FAILED';
        }
      }
    } catch (error) {
      result.message = `云端设备不可用：${error.message}`;
      result.error_code = error.code || 'PROVIDER_UNAVAILABLE';
    }
    return result;
  }

  async function performRecovery() {
    const due = repository.listRecoverable();
    const results = [];
    for (const row of due) {
      // The original merge caller owns finalization for jobs started in this process.
      // Recovery only adopts persisted work that has no current in-memory owner.
      if (service.isActive(row.id)) continue;
      if (row.status === 'waiting_provider' && row.waiting_since) {
        const waitingMs = Date.now() - Date.parse(row.waiting_since);
        const maxWaitingMs = Number(config.offline_wait_hours || 24) * 3600 * 1000;
        if (Number.isFinite(waitingMs) && waitingMs >= maxWaitingMs) {
          repository.updateJob(row.id, {
            current_stage: 'waiting_manual', next_retry_at: null,
            error_message: '云端设备持续不可用，自动等待已停止；请启动设备后手动重试，或跳过超分',
          });
          results.push(repository.getJob(row.id));
          continue;
        }
      }
      results.push(await notify(await service.runJob(row.id)));
    }
    return results;
  }

  return {
    repository,
    capabilities,
    getJob: (id) => repository.getJob(id),
    createAndRun: (input) => service.createAndRun(input),
    runJob: (id) => service.runJob(id),
    retryJob(id) {
      const job = repository.getJob(id);
      if (!job) throw upscaleError('UPSCALE_JOB_NOT_FOUND', '超分作业不存在');
      if (!['failed', 'waiting_provider'].includes(job.status)) {
        throw upscaleError('UPSCALE_STATE_CONFLICT', '当前状态不能重试');
      }
      repository.updateJob(id, {
        status: 'pending', current_stage: 'retrying', next_retry_at: null, completed_at: null,
      });
      const pending = service.runJob(id);
      pending.then(notify).catch((error) => log?.error?.('video upscale retry', { job_id: id, error: error.message }));
      return repository.getJob(id);
    },
    skipJob(id) {
      const job = service.skipJob(id);
      setImmediate(() => notify(job));
      return job;
    },
    cancelJob(id) {
      const job = service.cancelJob(id);
      setImmediate(() => notify(job));
      return job;
    },
    listRecoverable: () => repository.listRecoverable(),
    setCompletionHandler(handler) { completionHandler = typeof handler === 'function' ? handler : null; },
    recoverDueJobs() {
      if (recoveryPromise) return recoveryPromise;
      recoveryPromise = performRecovery().finally(() => { recoveryPromise = null; });
      return recoveryPromise;
    },
  };
}

module.exports = { createVideoUpscaleRuntime };
