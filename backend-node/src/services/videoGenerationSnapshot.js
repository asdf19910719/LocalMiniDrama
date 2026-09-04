const SAFE_SETTING_KEYS = [
  'width',
  'height',
  'frame_rate',
  'seed',
  'continuity_mode',
  'workflow_id',
  'workflow_version',
  'workflow_sha',
  'workflow_sha256',
  'workflow_registry_version',
  'vram_policy',
  'vram_budget_mb',
];

function parseSettings(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function snapshotSettings(value) {
  const settings = parseSettings(value);
  return SAFE_SETTING_KEYS.reduce((snapshot, key) => {
    const setting = settings[key];
    if (Object.prototype.hasOwnProperty.call(settings, key)
      && (setting == null || ['string', 'number', 'boolean'].includes(typeof setting))) {
      snapshot[key] = setting;
    }
    return snapshot;
  }, {});
}

function nonSensitivePath(value) {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
    return `${url.protocol}//${url.host}${pathname}`;
  } catch (_) {
    return raw.split(/[?#]/, 1)[0];
  }
}

function nonSensitiveBaseUrl(value) {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (_) {
    return raw.replace(/\/\/[^/]*@/, '//').split(/[?#]/, 1)[0];
  }
}

function cloneJson(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function snapshotParameters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ['width', 'height', 'durationSeconds', 'frameRate', 'seed']) {
    const number = Number(value[key]);
    if (Number.isFinite(number)) result[key] = number;
  }
  return Object.keys(result).length ? result : null;
}

function buildVideoConfigSnapshot(resolved = {}) {
  const config = resolved.config || {};
  const workflow = resolved.workflow || config.workflow || null;
  const workflowId = resolved.workflowId || workflow?.id || config.workflow_id || resolved.model || config.default_model || null;
  const workflowSha256 = resolved.workflowSha256 || workflow?.workflowSha256 || config.workflow_sha256 || null;
  const mode = resolved.generationMode || resolved.mode || config.generation_mode || 'single_reference';
  return {
    configId: config.id ?? null,
    provider: resolved.provider ?? config.provider ?? null,
    protocol: resolved.protocol ?? config.api_protocol ?? null,
    model: resolved.model ?? config.default_model ?? null,
    workflowId,
    workflowSha256,
    workflowSnapshotVersion: workflow ? 1 : null,
    workflowPath: workflow?.workflowPath || null,
    workflowStatus: workflow?.status || null,
    workflowFamily: workflow?.family || null,
    workflowVariant: resolved.workflowVariant || workflow?.variant || null,
    adapter: resolved.adapter || workflow?.adapter || null,
    adapterVersion: resolved.adapterVersion || workflow?.adapterVersion || null,
    workflowExecution: cloneJson(workflow?.execution),
    workflowCapabilities: cloneJson(workflow?.capabilities),
    effectiveParameters: snapshotParameters(resolved.effectiveParameters || resolved.parameters),
    generationMode: mode === 'single_segment_r2v' ? 'single_reference' : mode,
    sage: resolved.sage || workflow?.sage || (workflow?.capabilities?.supportsSage ? {
      node: 'PathchSageAttentionKJ', attention: 'auto', allowCompile: false,
    } : null),
    planHash: resolved.planHash || null,
    baseUrl: nonSensitiveBaseUrl(config.base_url),
    endpoint: nonSensitivePath(config.endpoint),
    queryEndpoint: nonSensitivePath(config.query_endpoint),
    settings: snapshotSettings(config.settings),
  };
}

module.exports = { buildVideoConfigSnapshot };
