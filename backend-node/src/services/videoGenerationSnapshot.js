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

function buildVideoConfigSnapshot(resolved = {}) {
  const config = resolved.config || {};
  return {
    configId: config.id ?? null,
    provider: resolved.provider ?? config.provider ?? null,
    protocol: resolved.protocol ?? config.api_protocol ?? null,
    model: resolved.model ?? config.default_model ?? null,
    baseUrl: nonSensitiveBaseUrl(config.base_url),
    endpoint: nonSensitivePath(config.endpoint),
    queryEndpoint: nonSensitivePath(config.query_endpoint),
    settings: snapshotSettings(config.settings),
  };
}

module.exports = { buildVideoConfigSnapshot };
