const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { selectWorkflow } = require('./workflowRegistry');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');

const execFileAsync = promisify(execFile);

class ComfyUIClientError extends Error {
  constructor(message, code = 'COMFYUI_ERROR', details = {}) {
    super(message);
    this.name = 'ComfyUIClientError';
    this.code = code;
    this.details = details;
  }
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
}

function findOutput(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOutput(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value.filename === 'string' && value.filename) return value;
  for (const item of Object.values(value)) {
    const found = findOutput(item);
    if (found) return found;
  }
  return null;
}

function historyMessages(history) {
  const messages = history?.status?.messages;
  return Array.isArray(messages) ? messages.filter((message) => Array.isArray(message) && message.length >= 2) : [];
}

function isoFromComfyTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function executionTimingFromHistory(history) {
  const messages = historyMessages(history);
  const started = messages.find(([type]) => type === 'execution_start')?.[1];
  const completed = [...messages].reverse().find(([type]) => (
    type === 'execution_success' || type === 'execution_error' || type === 'execution_interrupted'
  ))?.[1];
  const startedAt = isoFromComfyTimestamp(started?.timestamp);
  const completedAt = isoFromComfyTimestamp(completed?.timestamp);
  return startedAt && completedAt ? { startedAt, completedAt } : null;
}

function executionErrorFromHistory(history) {
  const failure = [...historyMessages(history)].reverse().find(([type]) => type === 'execution_error')?.[1];
  if (!failure) return null;
  const exceptionType = String(failure.exception_type || '').trim();
  const exceptionMessage = String(failure.exception_message || '').trim();
  const message = exceptionType && exceptionMessage && !exceptionMessage.toLowerCase().includes(exceptionType.toLowerCase())
    ? `${exceptionType}: ${exceptionMessage}`
    : (exceptionMessage || exceptionType || 'ComfyUI workflow failed');
  return {
    code: 'COMFYUI_WORKFLOW_FAILED',
    message,
    details: {
      nodeId: failure.node_id == null ? null : String(failure.node_id),
      nodeType: failure.node_type || null,
      exceptionType: exceptionType || null,
    },
  };
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseFfmpegProbe(text) {
  const source = String(text || '');
  const durationMatch = source.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const streams = [];
  for (const line of source.split(/\r?\n/)) {
    const video = line.match(/Video:\s*([^,\s]+)/i);
    const audio = line.match(/Audio:\s*([^,\s]+)/i);
    if (video) {
      const dimensions = line.match(/(\d{2,5})x(\d{2,5})/);
      const frameRate = line.match(/(\d+(?:\.\d+)?)\s+fps/i);
      streams.push({
        codec_type: 'video',
        codec_name: video[1],
        ...(dimensions ? { width: Number(dimensions[1]), height: Number(dimensions[2]) } : {}),
        ...(frameRate ? { r_frame_rate: `${Number(frameRate[1])}/1` } : {}),
      });
    } else if (audio) {
      streams.push({ codec_type: 'audio', codec_name: audio[1] });
    }
  }
  return {
    streams,
    format: durationMatch
      ? { duration: String(Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])) }
      : {},
    probe_source: 'ffmpeg-fallback',
  };
}

function createComfyUIClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  outputDir = process.cwd(),
  pollIntervalMs = 1000,
  timeoutMs = 30 * 60 * 1000,
  requestTimeoutMs = 30 * 1000,
  ffprobePath = getFfprobePath(),
  ffmpegPath = getFfmpegPath(),
  probeMedia = null,
  allowExperimental = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required for ComfyUI client');
  const root = normalizeBaseUrl(baseUrl);

  async function request(endpoint, { raw = false, timeoutMs: requestTimeout = requestTimeoutMs, ...options } = {}) {
    let response;
    const controller = new AbortController();
    const timeout = Number(requestTimeout) > 0
      ? setTimeout(() => controller.abort(), Number(requestTimeout))
      : null;
    try {
      response = await fetchImpl(`${root}${endpoint}`, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError' && timeout) {
        throw new ComfyUIClientError(
          `ComfyUI request timed out after ${Number(requestTimeout)}ms: ${endpoint}`,
          'COMFYUI_TIMEOUT',
          { endpoint, timeoutMs: Number(requestTimeout) }
        );
      }
      throw new ComfyUIClientError(`ComfyUI request failed: ${error.message}`, 'COMFYUI_NETWORK_ERROR', { cause: error });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (raw) {
      if (!response.ok) {
        throw new ComfyUIClientError(`ComfyUI returned HTTP ${response.status}`, 'COMFYUI_HTTP_ERROR', { status: response.status });
      }
      return { response, body: null };
    }
    const contentType = response.headers?.get?.('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      throw new ComfyUIClientError(`ComfyUI returned HTTP ${response.status}`, 'COMFYUI_HTTP_ERROR', { status: response.status, body });
    }
    return { body, response };
  }

  async function submitWorkflow({ registry, workflowId, prompt, inputs = {}, clientId = `director-${crypto.randomUUID()}` }) {
    const selected = selectWorkflow(registry, workflowId, { allowExperimental });
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      throw new ComfyUIClientError('A ComfyUI API prompt object is required', 'COMFYUI_INVALID_PROMPT');
    }
    const { body } = await request('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        client_id: clientId,
        extra_data: {
          director_workflow_id: selected.id,
          director_workflow_sha256: selected.workflowSha256,
          inputs,
        },
      }),
    });
    if (!body || typeof body.prompt_id !== 'string' || !body.prompt_id) {
      throw new ComfyUIClientError('ComfyUI response did not include prompt_id', 'COMFYUI_INVALID_RESPONSE', { body });
    }
    return { promptId: body.prompt_id, queue: body, workflow: selected };
  }

  async function uploadImage({ filePath, filename }) {
    if (!filePath || !fs.existsSync(filePath)) throw new ComfyUIClientError('Reference image does not exist', 'COMFYUI_IMAGE_NOT_FOUND');
    const bytes = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('image', new Blob([bytes]), filename || path.basename(filePath));
    form.append('overwrite', 'false');
    const { body } = await request('/upload/image', { method: 'POST', body: form });
    return body;
  }

  // Optional endpoint exposed by deployments that allow removing uploaded inputs.
  async function deleteImage(filename) {
    const name = String(filename || '').replace(/[\\/]/g, '');
    if (!name) throw new ComfyUIClientError('Reference image filename is required', 'COMFYUI_IMAGE_NAME_REQUIRED');
    return (await request('/delete/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })).body;
  }

  async function getSystemStats() {
    return (await request('/system_stats')).body;
  }

  async function getQueue() {
    return (await request('/queue')).body;
  }

  async function getObjectInfo() {
    return (await request('/object_info')).body;
  }

  async function getModels(folders = []) {
    const uniqueFolders = [...new Set(folders.map((folder) => String(folder || '').trim()).filter(Boolean))];
    const entries = await Promise.all(uniqueFolders.map(async (folder) => {
      const { body } = await request(`/models/${encodeURIComponent(folder)}`);
      return [folder, Array.isArray(body) ? body : []];
    }));
    return Object.fromEntries(entries);
  }

  function queueContains(queue, key, promptId) {
    return (Array.isArray(queue?.[key]) ? queue[key] : []).some((entry) => {
      if (Array.isArray(entry)) return entry[1] === promptId;
      return entry?.prompt_id === promptId || entry?.promptId === promptId;
    });
  }

  function executionWasInterrupted(status) {
    return (Array.isArray(status?.messages) ? status.messages : [])
      .some((message) => Array.isArray(message) && message[0] === 'execution_interrupted');
  }

  async function getPromptStatus(promptId) {
    const normalizedId = String(promptId || '').trim();
    if (!normalizedId) throw new ComfyUIClientError('ComfyUI prompt_id is required', 'COMFYUI_PROMPT_ID_REQUIRED');
    const { body } = await request(`/history/${encodeURIComponent(normalizedId)}`);
    const history = body && (body[normalizedId] || (body.status || body.outputs ? body : null));
    const status = history?.status || {};
    const executionTiming = executionTimingFromHistory(history);
    if (executionWasInterrupted(status)) {
      return { status: 'interrupted', progress: 100, history };
    }
    if (status.status_str === 'error'
      || status.status_str === 'failed'
      || (status.completed === false && status.status_str === 'failure')) {
      return {
        status: 'failed', progress: 100, history,
        error: executionErrorFromHistory(history) || {
          code: 'COMFYUI_WORKFLOW_FAILED', message: 'ComfyUI workflow failed',
        },
        executionTiming,
      };
    }
    if (status.completed === true || status.status_str === 'success' || history?.outputs) {
      return { status: 'completed', progress: 100, history, executionTiming };
    }

    const queue = await getQueue();
    if (queueContains(queue, 'queue_running', normalizedId)) {
      return { status: 'running', progress: 0, history: null };
    }
    if (queueContains(queue, 'queue_pending', normalizedId)) {
      return { status: 'queued', progress: 0, history: null };
    }
    return { status: 'interrupted', progress: 0, history: null };
  }

  async function pollHistory(promptId, { timeout = timeoutMs, intervalMs = pollIntervalMs } = {}) {
    const startedAt = Date.now();
    const pollTimestamps = [];
    while (Date.now() - startedAt <= timeout) {
      pollTimestamps.push(new Date().toISOString());
      const { body } = await request(`/history/${encodeURIComponent(promptId)}`);
      const entry = body && (body[promptId] || body);
      const status = entry?.status || {};
      if (status.status_str === 'error' || status.status_str === 'failed' || status.completed === false && status.status_str === 'failure') {
        throw new ComfyUIClientError('ComfyUI workflow failed', 'COMFYUI_WORKFLOW_FAILED', { history: entry, pollTimestamps });
      }
      if (status.completed === true || status.status_str === 'success' || entry?.outputs) {
        return { history: entry, pollTimestamps };
      }
      if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new ComfyUIClientError(`ComfyUI workflow timed out after ${timeout}ms`, 'COMFYUI_TIMEOUT', { promptId, pollTimestamps });
  }

  async function downloadOutput({ history, outputFileName, promptId }) {
    const output = findOutput(history?.outputs || history);
    if (!output) throw new ComfyUIClientError('ComfyUI history did not contain a downloadable output', 'COMFYUI_OUTPUT_MISSING');
    const params = new URLSearchParams({ filename: output.filename });
    if (output.subfolder) params.set('subfolder', output.subfolder);
    if (output.type) params.set('type', output.type);
    const { response } = await request(`/view?${params.toString()}`, { raw: true });
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(outputDir, { recursive: true });
    const artifactPath = path.join(outputDir, outputFileName || output.filename);
    fs.writeFileSync(artifactPath, bytes);
    return {
      artifactPath,
      source: output,
      sha256: sha256Buffer(bytes),
      fileSize: bytes.length,
      promptId,
    };
  }

  async function probeArtifact(artifactPath) {
    if (typeof probeMedia === 'function') return probeMedia(artifactPath);
    try {
      const result = await execFileAsync(ffprobePath, [
        '-v', 'error', '-show_streams', '-show_format', '-of', 'json', artifactPath,
      ], { maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(result.stdout);
    } catch (error) {
      // Some Windows installs ship ffmpeg without the companion ffprobe binary.
      // Preserve the media contract with the structured metadata available from
      // ffmpeg's stderr rather than silently storing null.
      let result;
      try {
        result = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', artifactPath], {
          maxBuffer: 4 * 1024 * 1024,
        });
      } catch (fallbackError) {
        result = fallbackError;
      }
      const parsed = parseFfmpegProbe(`${result.stderr || ''}\n${result.stdout || ''}`);
      if (!parsed.streams.length && !parsed.format.duration) {
        throw new ComfyUIClientError(
          `Media probe failed: ${result.message || error.message}`,
          'FFPROBE_ERROR',
          { artifactPath, ffprobeError: error.message },
        );
      }
      return parsed;
    }
  }

  async function runWorkflow({ registry, workflowId, prompt, inputs = {}, clientId, outputFileName, onSubmitted }) {
    const submitted = await submitWorkflow({ registry, workflowId, prompt, inputs, clientId });
    if (typeof onSubmitted === 'function') onSubmitted(submitted.promptId);
    const polled = await pollHistory(submitted.promptId);
    const downloaded = await downloadOutput({ history: polled.history, promptId: submitted.promptId, outputFileName });
    const ffprobe = await probeArtifact(downloaded.artifactPath);
    return {
      ...downloaded,
      ffprobe,
      promptId: submitted.promptId,
      workflowId: submitted.workflow.id,
      workflowSha256: submitted.workflow.workflowSha256,
      queue: submitted.queue,
      history: polled.history,
      pollTimestamps: polled.pollTimestamps,
    };
  }

  async function cancel(promptId) {
    try {
      await request('/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delete: [promptId] }),
      });
    } catch (_) {
      // A running prompt is no longer present in the queue; interrupt it below.
    }
    await request('/interrupt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt_id: promptId }),
    });
    return { promptId, cancelled: true };
  }

  return {
    submitWorkflow,
    uploadImage,
    deleteImage,
    getSystemStats,
    getQueue,
    getObjectInfo,
    getModels,
    getPromptStatus,
    pollHistory,
    downloadOutput,
    probeArtifact,
    runWorkflow,
    cancel,
  };
}

module.exports = { ComfyUIClientError, createComfyUIClient, findOutput, parseFfmpegProbe, executionTimingFromHistory, executionErrorFromHistory };
