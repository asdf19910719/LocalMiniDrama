'use strict';
/**
 * V2.1 常规设置 · 创作默认值（§24.5）：默认画幅 / 默认单集时长 / 备份保留天数。
 * KV 存 global_settings（settingsService.getGlobalSetting/setGlobalSetting），
 * 键名 v21:default_aspect_ratio / v21:default_episode_duration_seconds / v21:backup_retention_days。
 * 校验：画幅 ∈ {16:9, 9:16, 1:1}；单集时长整数 30-600 秒；保留天数整数 1-365
 * （0 明确拒绝——规格不允许 0 静默关闭备份保护）。
 */
const { getGlobalSetting, setGlobalSetting } = require('../../services/settingsService.js');

const ASPECT_RATIOS = ['16:9', '9:16', '1:1'];

const SETTINGS_DEFAULT_KEYS = {
  aspectRatio: 'v21:default_aspect_ratio',
  episodeDurationSeconds: 'v21:default_episode_duration_seconds',
  backupRetentionDays: 'v21:backup_retention_days',
};

const SETTINGS_DEFAULT_FALLBACKS = {
  aspectRatio: '16:9',
  episodeDurationSeconds: 90,
  backupRetentionDays: 30,
};

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function createSettingsDefaultsService(db) {
  function getDefaults() {
    return {
      aspectRatio: getGlobalSetting(db, SETTINGS_DEFAULT_KEYS.aspectRatio, SETTINGS_DEFAULT_FALLBACKS.aspectRatio),
      episodeDurationSeconds: getGlobalSetting(
        db,
        SETTINGS_DEFAULT_KEYS.episodeDurationSeconds,
        SETTINGS_DEFAULT_FALLBACKS.episodeDurationSeconds
      ),
      backupRetentionDays: getGlobalSetting(
        db,
        SETTINGS_DEFAULT_KEYS.backupRetentionDays,
        SETTINGS_DEFAULT_FALLBACKS.backupRetentionDays
      ),
    };
  }

  /** 部分字段更新：只校验/写入出现的字段，其余保持现值 */
  function updateDefaults(patch = {}) {
    const next = getDefaults();
    if (patch.aspectRatio !== undefined) {
      if (!ASPECT_RATIOS.includes(patch.aspectRatio)) {
        throw httpError('VALIDATION_ERROR', 400, `画幅仅支持 ${ASPECT_RATIOS.join(' / ')}`);
      }
      next.aspectRatio = patch.aspectRatio;
    }
    if (patch.episodeDurationSeconds !== undefined) {
      const n = patch.episodeDurationSeconds;
      if (!Number.isInteger(n) || n < 30 || n > 600) {
        throw httpError('VALIDATION_ERROR', 400, '默认单集时长需为 30-600 的整数（秒）');
      }
      next.episodeDurationSeconds = n;
    }
    if (patch.backupRetentionDays !== undefined) {
      const n = patch.backupRetentionDays;
      if (n === 0) {
        throw httpError('VALIDATION_ERROR', 400, '不允许关闭备份保护：保留天数至少 1 天');
      }
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        throw httpError('VALIDATION_ERROR', 400, '备份保留天数需为 1-365 的整数');
      }
      next.backupRetentionDays = n;
    }
    setGlobalSetting(db, SETTINGS_DEFAULT_KEYS.aspectRatio, next.aspectRatio);
    setGlobalSetting(db, SETTINGS_DEFAULT_KEYS.episodeDurationSeconds, next.episodeDurationSeconds);
    setGlobalSetting(db, SETTINGS_DEFAULT_KEYS.backupRetentionDays, next.backupRetentionDays);
    return getDefaults();
  }

  return { getDefaults, updateDefaults };
}

module.exports = {
  createSettingsDefaultsService,
  SETTINGS_DEFAULT_KEYS,
  SETTINGS_DEFAULT_FALLBACKS,
  ASPECT_RATIOS,
};
