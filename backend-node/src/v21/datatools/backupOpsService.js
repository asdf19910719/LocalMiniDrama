'use strict';
/**
 * V2.1 数据工具 · 手动备份执行与备份目录统计（Task 4.3 常规设置真实化）。
 * - runBackup：复用 backup/backupService.createBackup（checkpoint WAL + 逐文件 SHA-256
 *   + manifest.json），migrationId 用 manual-<ts>；返回 { ok, path, sha256, bytes }。
 * - backupStats：扫描备份根（含 manifest.json 的子目录计为一次备份），返回
 *   { backupDir, backupCount, lastBackupAt|null, estimatedUsageBytes }。
 * dbPath/backupRoot 解析与 workspaceMigrationService 同源：注入优先，否则读
 * configs/config.yaml 的 database.path，backupRoot = <dataRoot>/backups/workspace-migrations。
 */
const fs = require('node:fs');
const path = require('node:path');

function createBackupOpsService({ log = console, dbPath = null, backupRoot = null } = {}) {
  function resolvePaths() {
    let resolvedDb = dbPath ? path.resolve(dbPath) : null;
    if (!resolvedDb) {
      try {
        const { loadConfig } = require('../../config/index.js');
        const configured = loadConfig().database?.path || './data/drama_generator.db';
        resolvedDb = path.resolve(path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured));
      } catch (_) {
        resolvedDb = path.resolve(process.cwd(), 'data', 'drama_generator.db');
      }
    }
    const dataRoot = path.resolve(path.dirname(resolvedDb), '.');
    const resolvedBackupRoot = backupRoot
      ? path.resolve(backupRoot)
      : path.join(dataRoot, 'backups', 'workspace-migrations');
    return { db: resolvedDb, backupRoot: resolvedBackupRoot };
  }

  /** 立即创建备份（同步执行；失败抛错由路由层转 500 带消息） */
  function runBackup() {
    const { db: resolvedDb, backupRoot: resolvedRoot } = resolvePaths();
    const migrationId = `manual-${Date.now().toString(36)}`;
    const { createBackup } = require('../backup/backupService.js');
    const { backupDir, manifest } = createBackup(resolvedDb, resolvedRoot, { migrationId });
    const files = manifest.files || [];
    const main = files.find((f) => f.file === path.basename(resolvedDb)) || files[0] || {};
    const bytes = files.reduce((sum, f) => sum + (Number(f.bytes) || 0), 0);
    log.info?.('V2.1 手动备份完成', { backupDir, bytes });
    return { ok: true, path: backupDir, migrationId, sha256: main.sha256 || null, bytes };
  }

  function dirBytes(dir) {
    let bytes = 0;
    const walk = (root) => {
      let entries;
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const abs = path.join(root, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile()) {
          try { bytes += fs.statSync(abs).size; } catch (_) {}
        }
      }
    };
    if (fs.existsSync(dir)) walk(dir);
    return bytes;
  }

  /** 备份目录统计（目录不存在视为空；无 manifest 的残留目录不计为备份） */
  function backupStats() {
    const { backupRoot: resolvedRoot } = resolvePaths();
    const result = {
      backupDir: resolvedRoot,
      backupCount: 0,
      lastBackupAt: null,
      estimatedUsageBytes: 0,
    };
    if (!fs.existsSync(resolvedRoot)) return result;
    let entries;
    try { entries = fs.readdirSync(resolvedRoot, { withFileTypes: true }); } catch (_) { return result; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(resolvedRoot, entry.name);
      const manifestPath = path.join(dir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      result.backupCount += 1;
      result.estimatedUsageBytes += dirBytes(dir);
      let seenAt = null;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.createdAt) {
          const t = new Date(manifest.createdAt).getTime();
          if (!Number.isNaN(t)) seenAt = t;
        }
      } catch (_) { /* manifest 损坏时退回目录 mtime */ }
      if (seenAt === null) {
        try { seenAt = fs.statSync(dir).mtimeMs; } catch (_) { seenAt = null; }
      }
      if (seenAt !== null && (result.lastBackupAt === null || seenAt > new Date(result.lastBackupAt).getTime())) {
        result.lastBackupAt = new Date(seenAt).toISOString();
      }
    }
    return result;
  }

  return { runBackup, backupStats, resolvePaths };
}

module.exports = { createBackupOpsService };
