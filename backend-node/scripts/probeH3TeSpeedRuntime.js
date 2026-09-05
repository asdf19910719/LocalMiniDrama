'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPOSITORY = 'https://github.com/tl2012tl/TE-Speed-MiniMaxH3';
const NODE_CLASS = 'TESpeedMiniMaxH3';

function probeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) throw probeError('TE_SPEED_PLUGIN_FILE_MISSING', `Missing TE-Speed file: ${filePath}`);
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sanitizeBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (cause) {
    throw probeError('TE_SPEED_BASE_URL_INVALID', 'TE-Speed ComfyUI base URL is invalid', cause);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw probeError('TE_SPEED_BASE_URL_INVALID', 'TE-Speed ComfyUI URL must use HTTP or HTTPS');
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString();
}

function requestBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function gitCommit(pluginDir) {
  try {
    return execFileSync('git', ['-C', pluginDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch (_) {
    return null;
  }
}

async function fetchJson(fetchImpl, url) {
  let response;
  try { response = await fetchImpl(url); } catch (cause) {
    throw probeError('TE_SPEED_RUNTIME_UNAVAILABLE', `Cannot reach TE-Speed runtime: ${cause.message}`, cause);
  }
  if (!response?.ok) throw probeError('TE_SPEED_RUNTIME_UNAVAILABLE', `TE-Speed runtime returned HTTP ${response?.status || 0}`);
  try { return await response.json(); } catch (cause) {
    throw probeError('TE_SPEED_RUNTIME_INVALID_RESPONSE', 'TE-Speed runtime returned invalid JSON', cause);
  }
}

function normalizeType(value) {
  if (Array.isArray(value)) return normalizeType(value[0]);
  return typeof value === 'string' ? value : null;
}

function validateNode(payload) {
  const node = payload?.[NODE_CLASS];
  if (!node) throw probeError('TE_SPEED_NODE_MISSING', `${NODE_CLASS} is not registered by ComfyUI`);
  const required = node?.input?.required || {};
  const modelType = normalizeType(required.model);
  const outputs = Array.isArray(node.output) ? node.output.map(normalizeType) : [];
  if (modelType !== 'MODEL' || outputs.length !== 1 || outputs[0] !== 'MODEL') {
    throw probeError('TE_SPEED_SCHEMA_INVALID', `${NODE_CLASS} must accept one MODEL and return one MODEL`);
  }
  return {
    classType: NODE_CLASS,
    displayName: node.display_name || node.name || NODE_CLASS,
    requiredInputs: required,
    optionalInputs: node?.input?.optional || {},
    outputs,
    outputNames: Array.isArray(node.output_name) ? node.output_name : [],
  };
}

function runtimeSummary(systemStats = {}) {
  const system = systemStats.system || {};
  const device = Array.isArray(systemStats.devices) ? systemStats.devices[0] || {} : {};
  return {
    comfyuiVersion: system.comfyui_version || null,
    pythonVersion: system.python_version || null,
    pytorchVersion: system.pytorch_version || null,
    device: {
      name: device.name || null,
      type: device.type || null,
      vramTotal: Number(device.vram_total || device.torch_vram_total || 0) || null,
    },
  };
}

async function probeRuntime({ baseUrl, pluginDir, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  if (typeof fetchImpl !== 'function') throw probeError('TE_SPEED_FETCH_REQUIRED', 'A fetch implementation is required');
  const resolvedPluginDir = path.resolve(String(pluginDir || ''));
  const base = requestBaseUrl(baseUrl);
  const nodePayload = await fetchJson(fetchImpl, `${base}/object_info/${NODE_CLASS}`);
  const node = validateNode(nodePayload);
  const stats = await fetchJson(fetchImpl, `${base}/system_stats`);
  return {
    schemaVersion: 1,
    capturedAt: now(),
    compatible: true,
    baseUrl: sanitizeBaseUrl(baseUrl),
    plugin: {
      repository: REPOSITORY,
      commit: gitCommit(resolvedPluginDir),
      files: {
        nodesPyd: { sha256: sha256File(path.join(resolvedPluginDir, 'nodes.pyd')) },
        initPy: { sha256: sha256File(path.join(resolvedPluginDir, '__init__.py')) },
      },
    },
    runtime: runtimeSummary(stats),
    node,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const baseUrl = argument('--base-url');
  const pluginDir = argument('--plugin-dir');
  const output = argument('--output');
  const manifest = await probeRuntime({ baseUrl, pluginDir });
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), json);
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.code || 'TE_SPEED_PROBE_FAILED'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  NODE_CLASS,
  probeRuntime,
  sanitizeBaseUrl,
  validateNode,
};
