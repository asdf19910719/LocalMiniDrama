const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { buildSegmentPlan, validateSourceMedia } = require('./videoUpscalePlanner');
const { createSafeConfigSnapshot } = require('./videoUpscaleConfig');
const defaultMedia = require('./videoUpscaleMedia');
const { VideoUpscaleError, upscaleError } = require('./upscaleErrors');

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'skipped']);
const ACTIVE_STATUSES = [
  'pending', 'waiting_provider', 'starting_provider', 'uploading', 'queued', 'running',
  'downloading', 'stitching', 'validating', 'failed',
];

function createVideoUpscaleJobService({ db, repository, config, client, media = defaultMedia, log = console, sleep = null }) {
  const active = new Map();
  let providerTail = Promise.resolve();
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  function segmentPath(job, segment) {
    const folder = path.join(path.dirname(job.output_path), `.upscale-${job.id}`, 'segments');
    return path.join(folder, `${String(segment.segment_index).padStart(4, '0')}.mp4`);
  }

  function waitingDelayMs(retryCount) {
    return [60_000, 300_000, 900_000, 1_800_000][Math.min(Number(retryCount || 0), 3)];
  }

  function markError(job, error) {
    const retryable = error?.retryable === true || error?.code === 'PROVIDER_UNAVAILABLE';
    if (retryable) {
      const retryCount = Number(job.retry_count || 0) + 1;
      const next = new Date(Date.now() + waitingDelayMs(retryCount - 1)).toISOString();
      repository.updateJob(job.id, {
        status: 'waiting_provider', current_stage: 'waiting_provider', progress: Math.max(30, Number(job.progress || 0)),
        error_code: error.code || 'PROVIDER_UNAVAILABLE', error_message: error.message,
        retry_count: retryCount, waiting_since: job.waiting_since || new Date().toISOString(), next_retry_at: next,
      });
    } else {
      repository.updateJob(job.id, {
        status: 'failed', current_stage: 'failed', error_code: error?.code || 'UPSCALE_FAILED',
        error_message: error?.message || String(error), completed_at: new Date().toISOString(),
      });
    }
    return repository.getJob(job.id);
  }

  async function ensureProviderReady(job) {
    await client.health();
    const status = await client.getComfyStatus();
    const ready = status?.running === true && (!status.reason || status.reason === 'ready');
    if (ready) return;
    if (!config.auto_start_comfy) {
      throw upscaleError('COMFYUI_NOT_RUNNING', '云端面板在线，但 ComfyUI 尚未启动', { retryable: true });
    }
    repository.updateJob(job.id, { status: 'starting_provider', current_stage: 'starting_provider', progress: 31 });
    await client.startComfy();
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await wait(Math.min(config.poll_interval_seconds * 1000, 10_000));
      const next = await client.getComfyStatus();
      if (next?.running === true && (!next.reason || next.reason === 'ready')) return;
    }
    throw upscaleError('COMFYUI_START_TIMEOUT', '等待云端 ComfyUI 启动超时', { retryable: true });
  }

  async function pollSegment(job, segment) {
    const deadline = Date.now() + Number(config.max_poll_hours || 8) * 3600 * 1000;
    while (Date.now() < deadline) {
      if (repository.getJob(job.id)?.status === 'cancelled') {
        throw upscaleError('UPSCALE_CANCELLED', '云端超分已取消');
      }
      const result = await client.getResult(segment.prompt_id);
      if (result.status === 'completed') return result;
      repository.updateSegment(job.id, segment.segment_index, {
        status: result.status === 'running' ? 'running' : 'queued',
        progress: result.status === 'running' ? 20 : 5,
      });
      await wait(Number(config.poll_interval_seconds || 5) * 1000);
    }
    throw upscaleError('REMOTE_TIMEOUT', '云端超分任务等待超时，稍后将继续核对原任务', { retryable: true });
  }

  async function executeJob(jobId) {
    let job = repository.getJob(jobId);
    if (!job) throw upscaleError('UPSCALE_JOB_NOT_FOUND', '超分作业不存在');
    if (TERMINAL.has(job.status)) return job;
    try {
      repository.updateJob(job.id, {
        status: 'uploading', current_stage: 'provider_check', progress: Math.max(30, Number(job.progress || 0)),
        started_at: job.started_at || new Date().toISOString(), error_code: null, error_message: null, next_retry_at: null,
      });
      await ensureProviderReady(job);
      if (repository.getJob(jobId)?.status === 'cancelled') return repository.getJob(jobId);
      job = repository.getJob(jobId);
      if (job.segments.every((segment) => !segment.prompt_id && segment.status !== 'completed')) {
        await client.freeMemory();
      }
      if (!job.remote_input_name) {
        const remote = await client.uploadVideo(job.source_path);
        if (repository.getJob(jobId)?.status === 'cancelled') return repository.getJob(jobId);
        repository.updateJob(job.id, { remote_input_name: remote, current_stage: 'uploaded', progress: 35 });
      }
      job = repository.getJob(jobId);
      const totalFrames = Number(job.source_frame_count);
      for (let index = 0; ; index += 1) {
        job = repository.getJob(jobId);
        if (index >= job.segments.length) break;
        let segment = job.segments[index];
        const localOutput = segment.local_output_path || segmentPath(job, segment);
        if (segment.status === 'completed' && await media.validateSegment(localOutput, job, segment)) continue;
        try {
          if (!segment.prompt_id) {
            const promptId = await client.submitSegment({
              workflowId: job.workflow_id,
              method: job.method,
              remoteVideo: job.remote_input_name,
              frameCap: segment.requested_frame_count,
              skipFrames: segment.start_frame,
              filenamePrefix: segment.filename_prefix,
              clientId: segment.client_id,
              targetWidth: job.target_width,
              targetHeight: job.target_height,
              scale: config.scale,
            });
            repository.updateSegment(job.id, segment.segment_index, {
              status: 'queued', prompt_id: promptId, remote_input_name: job.remote_input_name,
              submitted_at: new Date().toISOString(), progress: 5,
            });
            segment = repository.getJob(jobId).segments[index];
          }
          repository.updateJob(job.id, {
            status: 'running', current_stage: `segment_${index + 1}_of_${job.segments.length}`,
            progress: 35 + Math.round(50 * Math.min(1, segment.start_frame / totalFrames)),
          });
          const result = await pollSegment(job, segment);
          if (repository.getJob(jobId)?.status === 'cancelled') return repository.getJob(jobId);
          repository.updateSegment(job.id, segment.segment_index, { status: 'downloading', progress: 90, remote_result_json: result.raw || result });
          await client.downloadResult(result.url, localOutput);
          if (!await media.validateSegment(localOutput, job, segment)) {
            throw upscaleError('SEGMENT_VALIDATION_FAILED', `超分分段 ${segment.segment_index + 1} 校验失败`);
          }
          repository.updateSegment(job.id, segment.segment_index, {
            status: 'completed', progress: 100, local_output_path: localOutput,
            completed_at: new Date().toISOString(), error_code: null, error_message: null,
          });
        } catch (error) {
          if (error?.code !== 'REMOTE_OOM') throw error;
          await client.freeMemory();
          const retries = Number(segment.retry_count || 0);
          if (retries < 1) {
            repository.updateSegment(job.id, segment.segment_index, {
              status: 'pending', prompt_id: null, progress: 0, retry_count: retries + 1,
              error_code: 'REMOTE_OOM', error_message: error.message,
            });
            index -= 1;
            continue;
          }
          const nextFrameCap = Math.max(60, Math.floor(Number(segment.requested_frame_count) / 2));
          if (nextFrameCap >= Number(segment.requested_frame_count)) {
            throw upscaleError('REMOTE_OOM_MIN_SEGMENT', '云端在最小 60 帧分段下仍显存不足');
          }
          const remainingPlan = buildSegmentPlan({
            frameCount: totalFrames - Number(segment.start_frame),
            frameCap: nextFrameCap,
            overlapFrames: Number(config.overlap_frames || 4),
          }).map((planned, offset) => ({
            ...planned,
            index: segment.segment_index + offset,
            startFrame: Number(segment.start_frame) + planned.startFrame,
            trimLeadingFrames: offset === 0 ? Number(segment.overlap_frames || 0) : planned.trimLeadingFrames,
          }));
          repository.replanRemaining(job.id, segment.segment_index, remainingPlan, job.method);
          index -= 1;
        }
      }
      job = repository.getJob(jobId);
      if (job.status === 'cancelled') return job;
      repository.updateJob(job.id, { status: 'stitching', current_stage: 'stitching', progress: 86 });
      await media.stitch(job, job.segments, job.output_path);
      repository.updateJob(job.id, { status: 'validating', current_stage: 'validating', progress: 93 });
      await media.validateFinal(job.output_path, job);
      repository.updateJob(job.id, {
        status: 'completed', current_stage: 'completed', progress: 100,
        completed_at: new Date().toISOString(), error_code: null, error_message: null,
      });
      return repository.getJob(jobId);
    } catch (error) {
      if (log?.warn) log.warn('video upscale job paused or failed', { job_id: jobId, code: error.code, error: error.message });
      const current = repository.getJob(jobId);
      if (current?.status === 'cancelled' || error?.code === 'UPSCALE_CANCELLED') return current;
      return markError(current, error);
    }
  }

  function runJob(jobId) {
    if (active.has(jobId)) return active.get(jobId);
    const promise = providerTail
      .catch(() => undefined)
      .then(() => executeJob(jobId))
      .finally(() => active.delete(jobId));
    active.set(jobId, promise);
    providerTail = promise.catch(() => undefined);
    return promise;
  }

  async function createAndRun({ episodeId, videoMergeId, asyncTaskId = null, sourcePath, outputPath, method }) {
    if (!config.enabled) throw upscaleError('UPSCALE_NOT_CONFIGURED', '云端视频超分服务未启用');
    if (!fs.existsSync(sourcePath)) throw upscaleError('SOURCE_VIDEO_MISSING', '基础合并视频不存在');
    const source = await media.probe(sourcePath);
    const target = validateSourceMedia(source, config);
    const selectedMethod = String(method || config.default_method || 'flash').toLowerCase();
    if (!['flash', 'seed'].includes(selectedMethod)) throw upscaleError('UNSUPPORTED_UPSCALE_METHOD', `不支持的超分模式：${selectedMethod}`);
    const id = randomUUID();
    const segments = buildSegmentPlan({
      frameCount: source.frameCount,
      frameCap: config.segment_frame_cap,
      overlapFrames: config.overlap_frames,
    });
    repository.createJob({
      id, episodeId, videoMergeId, asyncTaskId, provider: config.provider, method: selectedMethod,
      workflowId: config.workflows[selectedMethod], sourcePath, sourceFingerprint: media.fingerprint(sourcePath),
      source, target, outputPath, configSnapshot: createSafeConfigSnapshot(config), segments,
    });
    repository.updateJob(id, { output_path: outputPath });
    return runJob(id);
  }

  function skipJob(jobId) {
    const job = repository.getJob(jobId);
    if (!job) throw upscaleError('UPSCALE_JOB_NOT_FOUND', '超分作业不存在');
    if (!['failed', 'waiting_provider'].includes(job.status)) throw upscaleError('UPSCALE_STATE_CONFLICT', '当前状态不能跳过超分');
    repository.updateJob(jobId, { status: 'skipped', current_stage: 'skipped', completed_at: new Date().toISOString(), next_retry_at: null });
    return repository.getJob(jobId);
  }

  function cancelJob(jobId) {
    const job = repository.getJob(jobId);
    if (!job) throw upscaleError('UPSCALE_JOB_NOT_FOUND', '超分作业不存在');
    if (TERMINAL.has(job.status)) throw upscaleError('UPSCALE_STATE_CONFLICT', '当前状态不能取消');
    repository.updateJob(jobId, {
      status: 'cancelled', current_stage: 'cancelled', cancel_requested_at: new Date().toISOString(),
      completed_at: new Date().toISOString(), next_retry_at: null,
    });
    return repository.getJob(jobId);
  }

  async function retryJob(jobId) {
    const job = repository.getJob(jobId);
    if (!job) throw upscaleError('UPSCALE_JOB_NOT_FOUND', '超分作业不存在');
    if (!['failed', 'waiting_provider'].includes(job.status)) throw upscaleError('UPSCALE_STATE_CONFLICT', '当前状态不能重试');
    repository.updateJob(jobId, { status: 'pending', current_stage: 'retrying', next_retry_at: null, completed_at: null });
    return runJob(jobId);
  }

  return {
    createAndRun, runJob, retryJob, skipJob, cancelJob,
    isActive(jobId) { return active.has(jobId); },
  };
}

module.exports = { createVideoUpscaleJobService };
