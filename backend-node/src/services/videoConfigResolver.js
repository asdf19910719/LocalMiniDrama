function normalizeModelList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch (_) {
    return [String(value)];
  }
}

function normalizeVideoConfig(row) {
  return { ...row, model: normalizeModelList(row.model) };
}

function inferVideoProtocol(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'dashscope') return 'dashscope';
  if (p === 'gemini' || p === 'google') return 'gemini';
  if (p === 'volces' || p === 'volcengine' || p === 'volc') return 'volcengine';
  if (p === 'vidu') return 'vidu';
  if (p === 'ffir') return 'kling_omni';
  if (p === 'kling' || p === 'klingai') return 'kling';
  if (p === 'jimeng_ai_api') return 'jimeng_ai_api';
  if (p === 'xai' || p === 'grok') return 'xai';
  if (p === 'agnes') return 'agnes';
  if (p === 'minimax_h3') return 'minimax_h3';
  return 'openai';
}

function isMinimaxH3Model(name) {
  const model = String(name || '').trim().toLowerCase();
  return model === 'minimax-h3' || model === 'minimax_h3' || /^minimax[-_]?h3\b/.test(model);
}

function resolveVideoProtocol(config, modelHint) {
  const provider = String(config.provider || '').toLowerCase();
  const explicit = String(config.api_protocol || '').trim();
  let protocol = explicit.toLowerCase() || inferVideoProtocol(provider);
  const baseLower = String(config.base_url || '').toLowerCase();
  const model = modelHint || config.default_model || (Array.isArray(config.model) ? config.model[0] : config.model) || '';
  const modelLower = String(model || '').toLowerCase();
  if (!explicit && protocol === 'openai') {
    if (/api\.x\.ai(\/|$)/.test(baseLower)) protocol = 'xai';
    else if (/grok-imagine|grok.*video/.test(modelLower)) protocol = 'xai';
    else if (provider === 'agnes' || /agnes-video|apihub\.agnes-ai\.com/i.test(baseLower)) protocol = 'agnes';
  }
  if ((!explicit || protocol === 'openai') && (provider === 'minimax_h3' || isMinimaxH3Model(model))) {
    protocol = 'minimax_h3';
  }
  return protocol;
}

function resolveDefaultVideoConfig(db, { requestedModel } = {}) {
  const rows = db.prepare(
    `SELECT * FROM ai_service_configs
     WHERE service_type = 'video'
       AND deleted_at IS NULL
       AND is_active = 1
       AND is_default = 1`
  ).all();

  if (rows.length === 0) throw new Error('VIDEO_CONFIG_MISSING');
  if (rows.length > 1) throw new Error('VIDEO_CONFIG_AMBIGUOUS');

  const config = normalizeVideoConfig(rows[0]);
  const requested = requestedModel == null ? '' : String(requestedModel).trim();
  const model = requested ||
    (config.model.includes(config.default_model) ? config.default_model : config.model[0] || '');
  if (requested && !config.model.includes(requested)) throw new Error('VIDEO_MODEL_NOT_ALLOWED');

  const provider = String(config.provider || '').toLowerCase();
  return { config, model, provider, protocol: resolveVideoProtocol(config, model) };
}

module.exports = {
  resolveDefaultVideoConfig,
  resolveVideoProtocol,
  isMinimaxH3Model,
};
