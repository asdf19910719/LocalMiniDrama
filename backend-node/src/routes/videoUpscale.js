const response = require('../response');

function publicJob(job) {
  if (!job) return null;
  const {
    config_snapshot_json: _snapshotText,
    config_snapshot: _snapshot,
    source_path: _sourcePath,
    remote_input_name: _remoteInput,
    ...safe
  } = job;
  safe.segments = (job.segments || []).map((segment) => {
    const { remote_result_json: _raw, remote_result: _result, local_output_path: _local, remote_input_name: _input, ...publicSegment } = segment;
    return publicSegment;
  });
  safe.allowed_actions = {
    retry: ['failed', 'waiting_provider'].includes(job.status),
    skip: ['failed', 'waiting_provider'].includes(job.status),
    cancel: !['completed', 'failed', 'cancelled', 'skipped'].includes(job.status),
  };
  return safe;
}

function sendError(res, error, log, action) {
  if (log?.warn) log.warn(`video upscale ${action}`, { code: error.code, error: error.message });
  if (error.code === 'UPSCALE_JOB_NOT_FOUND') return response.error(res, 404, error.code, error.message);
  if (error.code === 'UPSCALE_STATE_CONFLICT') return response.error(res, 409, error.code, error.message);
  if (error.code === 'UNSUPPORTED_UPSCALE_METHOD' || error.code === 'UNSUPPORTED_SOURCE_DIMENSIONS') {
    return response.error(res, 400, error.code, error.message);
  }
  return response.error(res, 503, error.code || 'UPSCALE_SERVICE_ERROR', error.message || '云端超分服务错误');
}

function routes(_db, log, runtime) {
  return {
    capabilities: async (_req, res) => {
      try { response.success(res, await runtime.capabilities()); }
      catch (error) { sendError(res, error, log, 'capabilities'); }
    },
    get: async (req, res) => {
      try {
        const job = runtime.getJob(req.params.id);
        if (!job) return response.error(res, 404, 'UPSCALE_JOB_NOT_FOUND', '超分作业不存在');
        response.success(res, publicJob(job));
      } catch (error) { sendError(res, error, log, 'get'); }
    },
    retry: async (req, res) => {
      try { response.accepted(res, publicJob(await runtime.retryJob(req.params.id))); }
      catch (error) { sendError(res, error, log, 'retry'); }
    },
    skip: async (req, res) => {
      try { response.accepted(res, publicJob(await runtime.skipJob(req.params.id))); }
      catch (error) { sendError(res, error, log, 'skip'); }
    },
    cancel: async (req, res) => {
      try { response.accepted(res, publicJob(await runtime.cancelJob(req.params.id))); }
      catch (error) { sendError(res, error, log, 'cancel'); }
    },
  };
}

module.exports = routes;
module.exports.publicJob = publicJob;
