'use strict';
/**
 * V2.1 AI 配置页聚合服务（Task 4.2，§13.3 最小闭环）。
 * - getOverview：Provider 脱敏聚合（api_key 永不出现在响应，只回尾 4 位与是否已配置）
 *   + 默认生图通道解析（全局 / 项目，query.projectId 可选）+ 8 类业务映射当前生效 provider/模型；
 * - setImageDefault：默认生图通道写入真实存储——global → global_settings KV，
 *   project → dramas.metadata（复用 imageGenerationTaskService 的 setDefaultChannel），
 *   读取侧 getDefaultChannel 消费全局默认（项目默认优先，安装默认 api 兜底）；
 * - testProviderConnection：复用 V1 aiConfigService.testConnection（密钥只在本机服务端参与请求），
 *   失败给原因与恢复建议（hint，§12.3）。
 * 事实边界：Provider 测试之外的环境检测（浏览器/登录/桥接）未接入，不在此伪造数据。
 */

const settingsService = require('../../services/settingsService');
const aiConfigService = require('../../services/aiConfigService');
const videoConfigResolver = require('../../services/videoConfigResolver');
const imageGenerationTaskService = require('../../services/imageGenerationTaskService');

const IMAGE_CHANNELS = ['api', 'chatgpt_web'];
const GLOBAL_CHANNEL_KEY = 'default_image_generation_channel';

function validationError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'VALIDATION_ERROR' });
}

function notFoundError(message) {
  return Object.assign(new Error(message), { status: 404, code: 'NOT_FOUND' });
}

function parseModels(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [String(parsed)];
  } catch (_) {
    return [String(value)];
  }
}

function isComfyui(row) {
  return String(row.provider || '').toLowerCase() === 'comfyui';
}

/** ComfyUI 为本地通道不需要 Key；其余配置以 Key 非空为可用（与 providerRouter.hasUsableKey 同口径） */
function hasUsableKey(row) {
  return Boolean(String((row && row.api_key) || '').trim()) || isComfyui(row);
}

/** 地址脱敏为域名（host[:port]），不含路径与查询；解析失败返回空串 */
function hostOf(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch (_) {
    return '';
  }
}

function keyTail(row) {
  const key = String((row && row.api_key) || '').trim();
  return key ? key.slice(-4) : '';
}

function configStatus(row) {
  if (row.is_active === 0 || row.is_active === false) return 'disabled';
  return hasUsableKey(row) ? 'ok' : 'missing_key';
}

function providerSummary(row) {
  const models = parseModels(row.model);
  return {
    id: row.id,
    name: row.name,
    serviceType: row.service_type,
    provider: row.provider,
    baseUrlDomain: hostOf(row.base_url),
    hasKey: Boolean(String(row.api_key || '').trim()),
    keyTail: keyTail(row),
    isDefault: !!row.is_default,
    isActive: row.is_active == null ? true : !!row.is_active,
    status: configStatus(row),
    defaultModel: row.default_model ? String(row.default_model) : (models[0] || null),
    modelCount: models.length,
    updatedAt: row.updated_at || null,
  };
}

function chatgptWebEnabled(db) {
  return settingsService.getGlobalSetting(db, 'chatgpt_web_enabled', true) !== false;
}

function resolveGlobalImageDefault(db) {
  const stored = settingsService.getGlobalSetting(db, GLOBAL_CHANNEL_KEY, '');
  if (IMAGE_CHANNELS.includes(stored)) return { channel: stored, source: 'global_default' };
  return { channel: 'api', source: 'install_default' };
}

function resolveProjectImageDefault(db, projectIdRaw) {
  const projectId = Number(projectIdRaw);
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  const row = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(projectId);
  if (!row) return null;
  let stored = '';
  try {
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    stored = metadata && metadata.default_image_generation_channel;
  } catch (_) {
    stored = '';
  }
  if (IMAGE_CHANNELS.includes(stored)) {
    return { projectId, channel: stored, source: 'project_default' };
  }
  const global = resolveGlobalImageDefault(db);
  return { projectId, channel: global.channel, source: global.source };
}

/** 与 providerRouter.resolveImageChannel 同序：is_default DESC → priority DESC → created_at DESC，取首个 Key 可用配置 */
function defaultRowFor(db, serviceTypes) {
  const placeholders = serviceTypes.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM ai_service_configs
     WHERE deleted_at IS NULL AND (is_active = 1 OR is_active IS NULL)
       AND service_type IN (${placeholders})
     ORDER BY is_default DESC, priority DESC, created_at DESC`
  ).all(...serviceTypes);
  return rows.find(hasUsableKey) || null;
}

function providerEntry(db, key, label, group, serviceTypes) {
  const row = defaultRowFor(db, serviceTypes);
  if (!row) {
    return {
      key, label, group, providerBacked: true, configured: false,
      provider: null, model: null, configId: null,
      note: '未配置可用 Provider（无 Key 时该业务走 mock 通道，可在 AI 配置·高级页添加）',
    };
  }
  const models = parseModels(row.model);
  return {
    key, label, group, providerBacked: true, configured: true,
    provider: row.provider,
    model: (row.default_model ? String(row.default_model) : models[0]) || null,
    configId: row.id,
    note: '',
  };
}

function videoEntry(db) {
  const base = { key: 'video', label: '视频', group: '图片、视频与声音', providerBacked: true };
  let resolved = null;
  try {
    resolved = videoConfigResolver.resolveDefaultVideoConfig(db);
  } catch (err) {
    return { ...base, configured: false, provider: null, model: null, configId: null, note: `未配置唯一默认视频配置（${err.message}），无可用配置时走 mock 通道` };
  }
  if (!hasUsableKey(resolved.config)) {
    return { ...base, configured: false, provider: resolved.provider, model: resolved.model || null, configId: resolved.config.id, note: '默认视频配置缺少 Key，当前走 mock 通道' };
  }
  return { ...base, configured: true, provider: resolved.provider, model: resolved.model || null, configId: resolved.config.id, note: '' };
}

function localEntry(key, label, group, note) {
  return { key, label, group, providerBacked: false, configured: false, provider: null, model: null, configId: null, note };
}

function buildBusinessMapping(db) {
  return [
    providerEntry(db, 'script', '剧本', '创作与协作', ['text']),
    localEntry('external_ai', '外部 AI', '创作与协作', '外部 AI 经制作包向导协作，不绑定 Provider 配置'),
    providerEntry(db, 'image', '图片', '图片、视频与声音', ['storyboard_image', 'image']),
    videoEntry(db),
    providerEntry(db, 'tts', 'TTS', '图片、视频与声音', ['tts']),
    localEntry('merge', '基础合片', '后期处理', '本机执行合成，无需 Provider 配置'),
    localEntry('upscale', '超分', '后期处理', '经视频超分模块单独配置，不经 Provider 通道'),
    localEntry('audio_post', '音频后期', '后期处理', '本机执行音频后期，无需 Provider 配置'),
  ];
}

/** §12.3：失败必须给恢复动作。按常见失败类别给恢复建议文案。 */
function hintForFailure(message) {
  const m = String(message || '');
  if (/API Key 无效|401|403|unauthorized|invalid api key|authentication|forbidden/i.test(m)) {
    return '请检查 API Key 是否正确、是否已过期或未开通对应模型权限；可在「编辑」抽屉重新保存密钥后再测。';
  }
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|无法解析|地址/i.test(m)) {
    return '服务地址无法解析：请检查 Base URL 拼写与协议（通常为 https://）。';
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|aborted|超时|timeout|fetch failed/i.test(m)) {
    return '无法建立连接：请确认服务地址可达、本机代理或防火墙未拦截，然后重试。';
  }
  if (/certificate|TLS|SSL|证书/i.test(m)) {
    return '证书校验失败：请确认地址为 https 且证书有效，或检查系统代理设置。';
  }
  if (/429|限流|rate limit/i.test(m)) {
    return '触发服务限流：请稍后重试，或联系服务商确认额度。';
  }
  return '请检查服务地址与密钥是否匹配；也可到 AI 配置·高级页核对该通道完整配置后重试。';
}

function createAiConfigOverviewService({ db, log = console } = {}) {
  function getOverview(projectIdRaw) {
    const providers = db.prepare(
      'SELECT * FROM ai_service_configs WHERE deleted_at IS NULL ORDER BY is_default DESC, priority DESC, created_at DESC'
    ).all().map(providerSummary);
    return {
      providers,
      imageDefault: {
        channels: IMAGE_CHANNELS,
        chatgptWebEnabled: chatgptWebEnabled(db),
        global: resolveGlobalImageDefault(db),
        project: resolveProjectImageDefault(db, projectIdRaw),
      },
      businessMapping: buildBusinessMapping(db),
    };
  }

  function setImageDefault(body = {}) {
    const scope = String(body.scope || '').trim();
    const channel = String(body.channel || '').trim();
    if (!IMAGE_CHANNELS.includes(channel)) {
      throw validationError(`channel 需为 ${IMAGE_CHANNELS.join(' 或 ')}（当前实际支持的生图通道）`);
    }
    if (channel === 'chatgpt_web' && !chatgptWebEnabled(db)) {
      throw validationError('ChatGPT 网页生图通道未启用：请先在 设置 · 生成设置 中启用后再设为默认');
    }
    if (scope === 'global') {
      settingsService.setGlobalSetting(db, GLOBAL_CHANNEL_KEY, channel);
      log.info && log.info('v2 image default channel set (global)', { channel });
      return { scope, channel, ...resolveGlobalImageDefault(db) };
    }
    if (scope === 'project') {
      const projectId = Number(body.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        throw validationError('scope 为 project 时必须提供有效的 projectId');
      }
      try {
        imageGenerationTaskService.setDefaultChannel(db, projectId, channel);
      } catch (err) {
        if (err && err.message === 'Drama not found') throw notFoundError('项目不存在或已删除');
        throw err;
      }
      log.info && log.info('v2 image default channel set (project)', { projectId, channel });
      const resolved = resolveProjectImageDefault(db, projectId);
      return { scope, projectId, channel, ...(resolved || {}) };
    }
    throw validationError("scope 需为 'global' 或 'project'");
  }

  async function testProviderConnection(idRaw, body = {}) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) throw notFoundError('配置不存在');
    const row = db.prepare('SELECT * FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!row) throw notFoundError('配置不存在');
    if (isComfyui(row)) {
      throw validationError('ComfyUI 为本地通道：请通过其工作流设置执行连接检查，此处不做密钥测试');
    }
    const baseUrl = body.baseUrl != null && String(body.baseUrl).trim()
      ? String(body.baseUrl).trim()
      : String(row.base_url || '').trim();
    const apiKey = body.apiKey != null && String(body.apiKey).trim()
      ? String(body.apiKey).trim()
      : String(row.api_key || '').trim();
    if (!baseUrl) throw validationError('缺少 base_url：请先在「编辑」抽屉填写服务地址');
    if (!apiKey) throw validationError('缺少 api_key：请先在「编辑」抽屉保存密钥后再测试');
    try {
      await aiConfigService.testConnection({
        base_url: baseUrl,
        api_key: apiKey,
        model: parseModels(row.model),
        provider: row.provider,
        endpoint: row.endpoint,
        service_type: row.service_type,
        settings: row.settings,
      });
    } catch (err) {
      log.warn && log.warn('v2 provider connection test failed', { configId: id, error: err.message });
      throw Object.assign(
        new Error('连接测试失败: ' + (err.message || '未知错误')),
        { status: 400, code: 'CONNECTION_TEST_FAILED', hint: hintForFailure(err.message) }
      );
    }
    return { ok: true, message: '连接测试成功', testedAt: new Date().toISOString() };
  }

  return { getOverview, setImageDefault, testProviderConnection };
}

module.exports = { createAiConfigOverviewService };
