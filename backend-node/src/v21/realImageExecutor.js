'use strict';
/**
 * V2.1 真实图片执行器（A1）：委托既有 imageService.create（真实 Provider 选择与轮询），
 * 产出仍写 image_generations；本执行器负责等待终态并映射回 V2.1 候选契约。
 * 测试可注入 imageServiceImpl 替身（不发真实请求）。
 */

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(filePath) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(require('node:fs').readFileSync(filePath)).digest('hex');
}

function createRealImageExecutor({
  db,
  log = console,
  pollIntervalMs = 1500,
  pollTimeoutMs = 3 * 60 * 1000,
  imageServiceImpl = null,
} = {}) {
  function svc() {
    return imageServiceImpl || require('../services/imageService.js');
  }

  function loadRow(id) {
    return db.prepare('SELECT * FROM image_generations WHERE id = ?').get(Number(id));
  }

  async function generate({ dramaId, shotId, prompt, serviceType, config, referenceUrls = [] } = {}) {
    if (!config) throw httpError('PROVIDER_UNAVAILABLE', 503, '图片通道配置缺失');
    const refs = (referenceUrls || []).filter(Boolean);
    const created = svc().create(db, log, {
      drama_id: Number(dramaId),
      storyboard_id: shotId == null ? undefined : Number(shotId),
      prompt: String(prompt || ''),
      provider: config.provider || undefined,
      model: config.default_model || (Array.isArray(config.model) ? config.model[0] : config.model) || undefined,
      target_type: 'storyboard',
      asset_mode: 'FRAME',
      reference_images: refs.length ? refs : undefined,
    }, {
      promptAlreadyCompiled: true,
      sections: { source: 'v21_storyboard_image', channel: 'v21-real' },
    });
    const imageId = created && (created.id ?? created.image_generation_id);
    if (!imageId) throw httpError('IMAGE_GENERATION_SUBMIT_FAILED', 502, '图片服务未返回生成记录');
    const deadline = Date.now() + pollTimeoutMs;
    for (;;) {
      const row = loadRow(imageId);
      if (!row) throw httpError('IMAGE_GENERATION_SUBMIT_FAILED', 502, '图片生成记录不存在');
      if (row.status === 'completed') {
        return {
          candidateId: Number(imageId),
          url: row.image_url || null,
          localPath: row.local_path || null,
          sha256: row.local_path ? sha256File(row.local_path) : null,
          provider: row.provider || null,
        };
      }
      if (row.status === 'failed') {
        throw httpError('IMAGE_GENERATION_FAILED', 502, row.error_msg || '图片生成失败');
      }
      if (Date.now() > deadline) {
        throw httpError('IMAGE_GENERATION_TIMEOUT', 504, '图片生成超时，请稍后在生成历史查看结果');
      }
      await sleep(pollIntervalMs);
    }
  }

  return { generate };
}

module.exports = { createRealImageExecutor };
