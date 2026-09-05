const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { upscaleError, VideoUpscaleError } = require('./upscaleErrors');

const WORKFLOW_NODES = Object.freeze({
  flash: { video: '195', prefix: '204', scale: '192' },
  seed: { video: '25', prefix: '27', upscale: '29' },
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireInput(template, nodeId, inputName, value) {
  const node = template[nodeId];
  if (!node || !node.inputs || !Object.prototype.hasOwnProperty.call(node.inputs, inputName)) {
    throw upscaleError('WORKFLOW_SCHEMA_CHANGED', `云端工作流缺少节点输入 ${nodeId}:${inputName}`);
  }
  node.inputs[inputName] = value;
}

function applyWorkflowInputs(template, method, values) {
  const nodes = WORKFLOW_NODES[method];
  if (!nodes) throw upscaleError('UNSUPPORTED_UPSCALE_METHOD', `不支持的超分模式：${method}`);
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw upscaleError('WORKFLOW_SCHEMA_CHANGED', '云端工作流没有返回有效模板');
  }
  const output = cloneJson(template);
  delete output._api_config;
  requireInput(output, nodes.video, 'video', values.remoteVideo);
  requireInput(output, nodes.video, 'frame_load_cap', values.frameCap);
  requireInput(output, nodes.video, 'skip_first_frames', values.skipFrames);
  requireInput(output, nodes.prefix, 'filename_prefix', values.filenamePrefix);
  if (method === 'flash') {
    requireInput(output, nodes.scale, 'value', values.scale);
  } else {
    requireInput(output, nodes.upscale, 'resolution', Math.min(values.targetWidth, values.targetHeight));
    requireInput(output, nodes.upscale, 'max_resolution', Math.max(values.targetWidth, values.targetHeight));
  }
  return output;
}

function extractVideoResult(payload, baseUrl) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const video = results.find((item) => item && item.type === 'video' && item.url);
  if (!video) throw upscaleError('REMOTE_OUTPUT_MISSING', '云端任务完成但没有返回视频文件');
  return new URL(String(video.url), `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function mapHttpError(status, body, pathName) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 404 && pathName.includes('/workflow/config/')) {
    return upscaleError('WORKFLOW_NOT_FOUND', '云端超分工作流不存在', { httpStatus: status });
  }
  if (status === 404 && ['/api/health', '/api/comfy/status', '/api/comfy/start'].includes(pathName)) {
    return upscaleError('PROVIDER_UNAVAILABLE', '云端转发在线，但目标设备或服务尚未启动', { retryable: true, httpStatus: status });
  }
  if (/out of memory|cuda.*memory|oom/i.test(text)) {
    return upscaleError('REMOTE_OOM', '云端显存不足', { retryable: true, httpStatus: status });
  }
  return upscaleError(
    status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'REMOTE_REQUEST_FAILED',
    `云端接口返回 HTTP ${status}`,
    { retryable: status >= 500 || status === 429, httpStatus: status }
  );
}

class ZealmanUpscaleClient {
  constructor({ baseUrl, apiKey = '', fetchImpl = globalThis.fetch, requestTimeoutMs = 60000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  url(pathName) { return `${this.baseUrl}/${String(pathName).replace(/^\/+/, '')}`; }

  headers(extra = {}) {
    return { ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}), ...extra };
  }

  async requestJson(method, pathName, body) {
    let response;
    try {
      response = await this.fetchImpl(this.url(pathName), {
        method,
        headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw upscaleError('PROVIDER_UNAVAILABLE', `无法连接云端超分服务：${error.message}`, { retryable: true, cause: error });
    }
    let payload;
    const text = await response.text();
    try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = { raw: text }; }
    if (!response.ok) throw mapHttpError(response.status, payload, pathName);
    if (payload?.success === false && payload?.error) {
      if (/out of memory|cuda.*memory|oom/i.test(String(payload.error))) {
        throw upscaleError('REMOTE_OOM', '云端显存不足', { retryable: true, details: payload.error });
      }
      throw upscaleError('REMOTE_WORKFLOW_FAILED', String(payload.error), { details: payload });
    }
    return payload;
  }

  health() { return this.requestJson('GET', '/api/health'); }
  getComfyStatus() { return this.requestJson('GET', '/api/comfy/status'); }
  startComfy() { return this.requestJson('POST', '/api/comfy/start', {}); }
  freeMemory() {
    return this.requestJson('POST', '/api/comfy/proxy/free', { unload_models: true, free_memory: true }).catch(() => null);
  }

  async uploadVideo(localPath) {
    const stat = fs.statSync(localPath);
    const boundary = `----LocalMiniDrama${randomUUID().replace(/-/g, '')}`;
    const fileName = path.basename(localPath).replace(/["\r\n]/g, '_');
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: video/mp4\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`);
    const body = Readable.from((async function* streamMultipart() {
      yield prefix;
      for await (const chunk of fs.createReadStream(localPath)) yield chunk;
      yield suffix;
    })());
    let response;
    try {
      response = await this.fetchImpl(this.url('/api/comfy/upload/file'), {
        method: 'POST',
        headers: this.headers({
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(prefix.length + stat.size + suffix.length),
        }),
        body,
        duplex: 'half',
        signal: AbortSignal.timeout(Math.max(this.requestTimeoutMs, 30 * 60 * 1000)),
      });
    } catch (error) {
      throw upscaleError('UPLOAD_FAILED', `上传视频失败：${error.message}`, { retryable: true, cause: error });
    }
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch (_) { payload = { raw: text }; }
    if (!response.ok) throw mapHttpError(response.status, payload, '/api/comfy/upload/file');
    const remoteName = payload.name || payload.filename;
    if (!remoteName) throw upscaleError('UPLOAD_FAILED', '云端上传响应缺少文件名', { details: payload });
    return String(remoteName);
  }

  async loadWorkflowTemplate(workflowId) {
    const payload = await this.requestJson('GET', `/api/workflow/config/${encodeURIComponent(workflowId)}`);
    if (!payload.workflow_template || typeof payload.workflow_template !== 'object') {
      throw upscaleError('WORKFLOW_SCHEMA_CHANGED', '云端工作流配置缺少 workflow_template');
    }
    return payload.workflow_template;
  }

  async submitSegment({
    workflowId, method, remoteVideo, frameCap, skipFrames, filenamePrefix, clientId,
    targetWidth, targetHeight, scale,
  }) {
    const template = await this.loadWorkflowTemplate(workflowId);
    const workflowTemplate = applyWorkflowInputs(template, method, {
      remoteVideo, frameCap, skipFrames, filenamePrefix, targetWidth, targetHeight, scale,
    });
    const payload = await this.requestJson('POST', '/api/workflow/generate', {
      source: 'quick', workflow_template: workflowTemplate, client_id: clientId,
    });
    if (!payload.prompt_id) throw upscaleError('REMOTE_SUBMISSION_UNKNOWN', '云端提交没有返回 prompt_id', { retryable: true });
    return String(payload.prompt_id);
  }

  async getResult(promptId) {
    const payload = await this.requestJson('GET', `/api/workflow/result?prompt_id=${encodeURIComponent(promptId)}`);
    if (payload.error) throw upscaleError('REMOTE_WORKFLOW_FAILED', String(payload.error), { details: payload });
    const video = Array.isArray(payload.results)
      ? payload.results.find((item) => item?.type === 'video' && item.url)
      : null;
    if (video) return { status: 'completed', url: new URL(String(video.url), `${this.baseUrl}/`).toString(), raw: payload };
    const state = String(payload.status || payload.state || '').toLowerCase();
    if (['failed', 'error'].includes(state)) throw upscaleError('REMOTE_WORKFLOW_FAILED', payload.message || '云端工作流失败', { details: payload });
    return { status: state === 'running' ? 'running' : 'queued', raw: payload };
  }

  async downloadResult(url, destination) {
    const temporary = `${destination}.part`;
    let response;
    try {
      response = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(30 * 60 * 1000) });
    } catch (error) {
      throw upscaleError('DOWNLOAD_FAILED', `下载超分结果失败：${error.message}`, { retryable: true, cause: error });
    }
    if (!response.ok) throw mapHttpError(response.status, '', '/download');
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const out = fs.createWriteStream(temporary);
    try {
      await require('node:stream/promises').pipeline(Readable.fromWeb(response.body), out);
      await fs.promises.rename(temporary, destination);
    } catch (error) {
      try { await fs.promises.unlink(temporary); } catch (_) {}
      if (error instanceof VideoUpscaleError) throw error;
      throw upscaleError('DOWNLOAD_FAILED', `保存超分结果失败：${error.message}`, { retryable: true, cause: error });
    }
    return destination;
  }
}

module.exports = {
  WORKFLOW_NODES,
  ZealmanUpscaleClient,
  applyWorkflowInputs,
  extractVideoResult,
};
