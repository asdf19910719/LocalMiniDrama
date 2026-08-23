const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { selectWorkflow } = require('./workflowRegistry');

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

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function createComfyUIClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  outputDir = process.cwd(),
  pollIntervalMs = 1000,
  timeoutMs = 30 * 60 * 1000,
  allowExperimental = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required for ComfyUI client');
  const root = normalizeBaseUrl(baseUrl);

  async function request(endpoint, { raw = false, ...options } = {}) {
    let response;
    try {
      response = await fetchImpl(`${root}${endpoint}`, options);
    } catch (error) {
      throw new ComfyUIClientError(`ComfyUI request failed: ${error.message}`, 'COMFYUI_NETWORK_ERROR', { cause: error });
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

  async function runWorkflow({ registry, workflowId, prompt, inputs = {}, clientId, outputFileName }) {
    const submitted = await submitWorkflow({ registry, workflowId, prompt, inputs, clientId });
    const polled = await pollHistory(submitted.promptId);
    const downloaded = await downloadOutput({ history: polled.history, promptId: submitted.promptId, outputFileName });
    return {
      ...downloaded,
      promptId: submitted.promptId,
      workflowId: submitted.workflow.id,
      workflowSha256: submitted.workflow.workflowSha256,
      queue: submitted.queue,
      history: polled.history,
      pollTimestamps: polled.pollTimestamps,
    };
  }

  async function cancel(promptId) {
    await request('/interrupt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt_id: promptId }),
    });
    return { promptId, cancelled: true };
  }

  return { submitWorkflow, pollHistory, downloadOutput, runWorkflow, cancel };
}

module.exports = { ComfyUIClientError, createComfyUIClient, findOutput };
