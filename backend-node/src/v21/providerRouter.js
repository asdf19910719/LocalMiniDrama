'use strict';
/**
 * V2.1 Provider 通道解析器（A1）。
 * 职责：按「本次覆盖 → 全局默认 → mock 回落」解析图片/视频生成通道（交互规格 §13.3），
 * 估算费用与模型能力，并把真实执行委托注入的 executor。无 Key 时一律回落 mock（铁律 6）。
 * 本模块不发起任何真实网络请求；真实媒体生成由注入的 executor 完成（测试用 fake adapter）。
 */

function parseSettingsObject(settings) {
  if (settings && typeof settings === 'object') return settings;
  if (typeof settings !== 'string' || !settings.trim()) return null;
    try {
      const parsed = JSON.parse(settings);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
    return null;
  }
}

function hasUsableKey(config) {
  return Boolean(String((config && config.api_key) || '').trim());
}

function rowToConfigLike(row) {
  let model = [];
  try {
    const parsed = JSON.parse(row.model || '[]');
    model = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch (_) {
    model = row.model ? [String(row.model)] : [];
  }
  return {
    id: row.id,
    service_type: row.service_type,
    provider: row.provider,
    api_protocol: row.api_protocol || '',
    name: row.name,
    base_url: row.base_url,
    api_key: row.api_key,
    model,
    default_model: row.default_model ? String(row.default_model) : null,
    endpoint: row.endpoint,
    query_endpoint: row.query_endpoint,
    priority: row.priority ?? 0,
    is_default: !!row.is_default,
    is_active: row.is_active == null ? true : !!row.is_active,
    settings: row.settings,
  };
}

function executorError(message) {
  const err = new Error(message);
  err.code = 'PROVIDER_EXECUTOR_UNAVAILABLE';
  err.status = 503;
  return err;
}

function createProviderRouter({ db, log = console, imageExecutor = null, videoExecutor = null, h3Executor = null } = {}) {
  const videoConfigResolver = require('../services/videoConfigResolver.js');

  function configById(id) {
    const row = db.prepare('SELECT * FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL').get(Number(id));
    return row ? rowToConfigLike(row) : null;
  }

  /** 解析顺序第 1 位：本次覆盖（显式指定 config id） */
  function overrideConfig({ overrideConfigId } = {}) {
    if (overrideConfigId == null) return null;
    const config = configById(overrideConfigId);
    return config && config.is_active !== false ? config : null;
  }

  /** 图片通道：全局默认 = storyboard_image 默认配置优先，其次 image 默认/高优先级配置 */
  function resolveImageChannel(options = {}) {
    const override = overrideConfig(options);
    if (override && ['storyboard_image', 'image'].includes(String(override.service_type))) {
      return { channel: 'real', channelKind: 'image', serviceType: override.service_type, config: override };
    }
    const rows = db
      .prepare(
        `SELECT * FROM ai_service_configs
         WHERE deleted_at IS NULL AND (is_active = 1 OR is_active IS NULL)
           AND service_type IN ('storyboard_image', 'image')
         ORDER BY is_default DESC, priority DESC, created_at DESC`
      )
      .all();
    const withKey = rows.map(rowToConfigLike).find(hasUsableKey);
    if (!withKey) return { channel: 'mock', reason: 'IMAGE_CHANNEL_NOT_CONFIGURED' };
    return { channel: 'real', channelKind: 'image', serviceType: withKey.service_type, config: withKey };
  }

  function resolveVideoConfigById(id) {
    const config = configById(id);
    if (!config) return null;
    const modelList = Array.isArray(config.model) ? config.model : [];
    const model = config.default_model || modelList[0] || '';
    return {
      config: { ...config, model: modelList },
      model,
      provider: String(config.provider || '').toLowerCase(),
      protocol: videoConfigResolver.resolveVideoProtocol(config, model),
    };
  }

  /** 视频通道：全局默认 = ai_service_configs 的唯一 is_default 视频配置 */
  function resolveVideoChannel(options = {}) {
    const override = overrideConfig(options);
    let resolved = null;
    if (override && String(override.service_type) === 'video') {
      resolved = resolveVideoConfigById(override.id);
      if (!resolved) return { channel: 'mock', reason: 'VIDEO_OVERRIDE_CONFIG_MISSING' };
    } else {
      try {
        resolved = videoConfigResolver.resolveDefaultVideoConfig(db);
      } catch (err) {
        return { channel: 'mock', reason: err.message === 'VIDEO_CONFIG_AMBIGUOUS' ? err.message : 'VIDEO_CHANNEL_NOT_CONFIGURED' };
      }
    }
    // ComfyUI 是本地通道不需要 Key；云端 Provider 缺 Key 视为未配置（回落 mock）
    if (!hasUsableKey(resolved.config) && resolved.provider !== 'comfyui') {
      return { channel: 'mock', reason: 'VIDEO_CHANNEL_NO_KEY' };
    }
    return { channel: 'real', channelKind: 'video', resolved };
  }

  function isH3Video(resolved) {
    if (!resolved) return false;
    if (String(resolved.protocol || '') === 'minimax_h3') return true;
    return videoConfigResolver.isMinimaxH3Model(resolved.model);
  }

  const PRICE_KEYS = ['perVideoPrice', 'perClipPrice', 'perImagePrice', 'price', 'unitPrice'];

  function estimateCost(config) {
    const settings = parseSettingsObject(config && config.settings) || {};
    for (const key of PRICE_KEYS) {
      const value = Number(settings[key]);
      if (Number.isFinite(value) && value > 0) {
        return { estimated: value, currency: settings.currency || 'CNY', note: '按 Provider 配置单价估算' };
      }
    }
    return { estimated: null, currency: null, note: 'Provider 未返回价格' };
  }

  function videoCapabilities(resolved) {
    const settings = parseSettingsObject(resolved && resolved.config && resolved.config.settings);
    const caps = settings && settings.capabilities;
    if (!caps || typeof caps !== 'object') return null;
    const out = {};
    if (Number.isFinite(Number(caps.maxDurationSeconds))) out.maxDurationSeconds = Number(caps.maxDurationSeconds);
    if (Number.isFinite(Number(caps.minReferences))) out.minReferences = Number(caps.minReferences);
    if (Number.isFinite(Number(caps.maxReferences))) out.maxReferences = Number(caps.maxReferences);
    if (Array.isArray(caps.resolutions)) out.resolutions = caps.resolutions.map(String);
    return Object.keys(out).length ? out : null;
  }

  function requireExecutor(executor, label) {
    if (!executor) throw executorError(`真实 ${label} 执行器不可用`);
    return executor;
  }

  // ---------- 执行委托（调用方：storyboardService；无真实通道一律返回 null → 调用方回落 mock） ----------

  async function generateImage(req = {}) {
    const channel = resolveImageChannel(req.channelOptions || {});
    if (channel.channel !== 'real') return null;
    return requireExecutor(imageExecutor, '图片').generate({ ...req, serviceType: channel.serviceType, config: channel.config });
  }

  async function submitVideo(req = {}) {
    const channel = resolveVideoChannel(req.channelOptions || {});
    if (channel.channel !== 'real') return null;
    return requireExecutor(videoExecutor, '视频').submit({ ...req, resolved: channel.resolved });
  }

  async function waitForVideoTask(taskId) {
    if (resolveVideoChannel().channel !== 'real') return null;
    return requireExecutor(videoExecutor, '视频').waitForTask(taskId);
  }

  async function cancelVideoTask(taskId) {
    if (resolveVideoChannel().channel !== 'real') return null;
    return requireExecutor(videoExecutor, '视频').cancel(taskId);
  }

  async function retryVideoTask(taskId) {
    if (resolveVideoChannel().channel !== 'real') return null;
    return requireExecutor(videoExecutor, '视频').retry(taskId);
  }

  async function compileH3Draft(req = {}) {
    const channel = resolveVideoChannel(req.channelOptions || {});
    if (channel.channel !== 'real' || !isH3Video(channel.resolved)) return null;
    return requireExecutor(h3Executor, 'H3 编译').compile({ ...req, resolved: channel.resolved });
  }

  async function saveH3DraftText({ draftId, text } = {}) {
    const channel = resolveVideoChannel();
    if (channel.channel !== 'real' || !isH3Video(channel.resolved)) return null;
    return requireExecutor(h3Executor, 'H3 编译').saveText({ draftId, text });
  }

  /** 生成 Sheet 的通道说明（quote.provider 的真实来源） */
  function videoChannelInfo() {
    const channel = resolveVideoChannel();
    if (channel.channel !== 'real') return { provider: 'mock', protocol: null, model: null };
    return {
      provider: channel.resolved.provider,
      protocol: channel.resolved.protocol,
      model: channel.resolved.model,
      h3: isH3Video(channel.resolved),
    };
  }

  log.info && log.info('V2.1 providerRouter 就绪', {
    image: resolveImageChannel().channel,
    video: resolveVideoChannel().channel,
  });

  return {
    resolveImageChannel,
    resolveVideoChannel,
    isH3Video,
    estimateImageCost: (config) => estimateCost(config),
    estimateVideoCost: (resolved) => estimateCost(resolved && resolved.config),
    videoCapabilities,
    videoChannelInfo,
    generateImage,
    submitVideo,
    waitForVideoTask,
    cancelVideoTask,
    retryVideoTask,
    compileH3Draft,
    saveH3DraftText,
  };
}

module.exports = { createProviderRouter };
