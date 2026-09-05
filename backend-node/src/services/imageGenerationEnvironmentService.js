const settingsService = require('./settingsService');
const targets = require('./imageGenerationTargetService');

const CHANNELS = new Set(['api', 'chatgpt_web']);

function check(key, status, code = null, message = '') {
  return { key, status, code, message };
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function parseModels(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [String(parsed)];
  } catch (_) { return [String(value)]; }
}

function checkImageGenerationEnvironment(db, input = {}) {
  const dramaId = Number(input.dramaId ?? input.drama_id);
  const channel = String(input.channel || input.generationChannel || 'api').trim();
  if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('dramaId is required');
  if (!CHANNELS.has(channel)) throw new Error(`Unsupported image generation channel: ${channel}`);

  const checks = [];
  const drama = db.prepare('SELECT id FROM dramas WHERE id=? AND deleted_at IS NULL').get(dramaId);
  if (!drama) throw new Error('Drama not found');
  checks.push(check('backend', 'ok', null, '后端服务可用'));

  if (channel === 'chatgpt_web') {
    const enabled = settingsService.getGlobalSetting(db, 'chatgpt_web_enabled', true) !== false;
    checks.push(enabled
      ? check('chatgpt_web_enabled', 'ok', null, 'ChatGPT 网页生图已启用')
      : check('chatgpt_web_enabled', 'failed', 'CHATGPT_WEB_DISABLED', 'ChatGPT 网页生图通道未启用'));
  } else {
    let configs = [];
    if (hasTable(db, 'ai_service_configs')) {
      configs = db.prepare(`SELECT provider, base_url, api_key, default_model, model
        FROM ai_service_configs
        WHERE deleted_at IS NULL AND is_active=1 AND service_type IN ('image','storyboard_image')`).all();
    }
    const usable = configs.find((config) => String(config.base_url || '').trim() && (String(config.api_key || '').trim() || String(config.provider || '').toLowerCase() === 'comfyui')
      && (String(config.default_model || '').trim() || parseModels(config.model).length));
    checks.push(usable
      ? check('api_config', 'ok', null, '默认生图服务配置可用')
      : check('api_config', 'failed', 'IMAGE_CONFIG_MISSING', '未找到可用的默认生图服务配置'));
  }

  if (input.targetType || input.target_type || input.targetId || input.target_id) {
    try {
      const generation = targets.buildGenerationInput(db, {
        dramaId,
        targetType: input.targetType ?? input.target_type,
        targetId: input.targetId ?? input.target_id,
      });
      const invalidReference = generation.references.find((reference) => !reference?.url || !/^(?:https?:|data:|blob:|\/(?:api|static)\/)/i.test(String(reference.url)));
      checks.push(invalidReference
        ? check('task_references', 'failed', 'REFERENCE_URL_INVALID', '任务参考图地址无效')
        : check('task_references', 'ok', null, `任务目标和 ${generation.references.length} 个参考图已解析`));
    } catch (error) {
      checks.push(check('task_target', 'failed', 'TARGET_INVALID', error.message));
    }
  }

  return {
    canProceed: checks.every((item) => item.status !== 'failed'),
    channel,
    checkedAt: new Date().toISOString(),
    checks,
  };
}

module.exports = { checkImageGenerationEnvironment };
