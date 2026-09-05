const DEFAULT_UPSCALE_CONFIG = Object.freeze({
  enabled: false,
  provider: 'zealman',
  base_url: 'https://uu1119133-7885b7b94296.bjb2.seetacloud.com:8443',
  api_key: '',
  default_method: 'flash',
  workflows: Object.freeze({
    flash: 'M20-视频高清放大-FlashVSR-2倍-分段工作节点',
    seed: 'M19-视频高清放大-SeedVR2-2倍-分段工作节点',
  }),
  expected_source_width: 1312,
  expected_source_height: 736,
  scale: 2,
  segment_frame_cap: 240,
  overlap_frames: 4,
  auto_start_comfy: true,
  offline_wait_hours: 24,
  max_poll_hours: 8,
  poll_interval_seconds: 5,
  tls_verify: true,
});

function positiveInteger(value, fallback, name) {
  const parsed = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function normalizeBaseUrl(value) {
  const text = String(value || DEFAULT_UPSCALE_CONFIG.base_url).trim().replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(text); } catch (_) { throw new Error('video_upscale.base_url must be a valid HTTP URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('video_upscale.base_url must use http or https');
  return text;
}

function normalizeVideoUpscaleConfig(input = {}) {
  const settings = input.settings && typeof input.settings === 'object'
    ? { ...input, ...input.settings }
    : { ...input };
  const defaultMethod = String(settings.default_method || DEFAULT_UPSCALE_CONFIG.default_method).toLowerCase();
  if (!['flash', 'seed'].includes(defaultMethod)) throw new Error('video_upscale.default_method must be flash or seed');
  const frameCap = positiveInteger(settings.segment_frame_cap, DEFAULT_UPSCALE_CONFIG.segment_frame_cap, 'segment_frame_cap');
  const overlap = settings.overlap_frames == null ? DEFAULT_UPSCALE_CONFIG.overlap_frames : Number(settings.overlap_frames);
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= frameCap) {
    throw new Error('video_upscale.overlap_frames must be an integer smaller than segment_frame_cap');
  }
  return {
    enabled: settings.enabled === true || settings.is_active === 1 || settings.is_active === true,
    provider: String(settings.provider || DEFAULT_UPSCALE_CONFIG.provider).toLowerCase(),
    base_url: normalizeBaseUrl(settings.base_url),
    api_key: String(settings.api_key || ''),
    default_method: defaultMethod,
    workflows: {
      flash: String(settings.workflows?.flash || DEFAULT_UPSCALE_CONFIG.workflows.flash),
      seed: String(settings.workflows?.seed || DEFAULT_UPSCALE_CONFIG.workflows.seed),
    },
    expected_source_width: positiveInteger(settings.expected_source_width, DEFAULT_UPSCALE_CONFIG.expected_source_width, 'expected_source_width'),
    expected_source_height: positiveInteger(settings.expected_source_height, DEFAULT_UPSCALE_CONFIG.expected_source_height, 'expected_source_height'),
    scale: positiveInteger(settings.scale, DEFAULT_UPSCALE_CONFIG.scale, 'scale'),
    segment_frame_cap: frameCap,
    overlap_frames: overlap,
    auto_start_comfy: settings.auto_start_comfy !== false,
    offline_wait_hours: positiveInteger(settings.offline_wait_hours, DEFAULT_UPSCALE_CONFIG.offline_wait_hours, 'offline_wait_hours'),
    max_poll_hours: positiveInteger(settings.max_poll_hours, DEFAULT_UPSCALE_CONFIG.max_poll_hours, 'max_poll_hours'),
    poll_interval_seconds: positiveInteger(settings.poll_interval_seconds, DEFAULT_UPSCALE_CONFIG.poll_interval_seconds, 'poll_interval_seconds'),
    tls_verify: settings.tls_verify !== false,
  };
}

function createSafeConfigSnapshot(config) {
  const { api_key: _apiKey, ...safe } = normalizeVideoUpscaleConfig(config);
  return safe;
}

function resolveVideoUpscaleConfig(db, appConfig = {}) {
  let row = null;
  try {
    row = db?.prepare(`SELECT * FROM ai_service_configs
      WHERE service_type = 'video_upscale' AND deleted_at IS NULL AND is_active = 1
      ORDER BY is_default DESC, priority DESC, id ASC LIMIT 1`).get();
  } catch (_) {}
  if (row) {
    let settings = {};
    try { settings = JSON.parse(row.settings || '{}'); } catch (_) {}
    return normalizeVideoUpscaleConfig({ ...settings, ...row, enabled: true });
  }
  return normalizeVideoUpscaleConfig(appConfig.video_upscale || {});
}

module.exports = {
  DEFAULT_UPSCALE_CONFIG,
  normalizeVideoUpscaleConfig,
  createSafeConfigSnapshot,
  resolveVideoUpscaleConfig,
};
