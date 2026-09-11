'use strict';
/**
 * V2.1 数据工具 · 迁移与恢复记录只读聚合（Task 4.4 高级数据工具补全）。
 * - list()：读 V2.1 迁移 journal（backup/migrationJournal 的 read API，数据库外崩溃恢复文件）
 *   + 扫描备份目录，返回 { journalPath, journal, backups: [{ dir, createdAt, bytes }] }。
 * - backupRoot 解析方式与 P4.3 backupOpsService 同源：注入优先，否则 dataRoot = dirname(配置 dbPath)；
 *   扫描两根：<dataRoot>/backups/v2.1（V2.1 正式迁移备份）与 <dataRoot>/backups/workspace-migrations（工作区迁移备份）。
 * - 仅统计含 manifest.json 的子目录（无 manifest 的残留目录不计为备份）；createdAt 取 manifest.createdAt
 *   （损坏时退回目录 mtime）；bytes 为目录递归字节数；按 createdAt 倒序限 20。
 * - 只读：不写 journal、不创建目录；journal 不存在时返回 null（前端呈现"无迁移记录"）。
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BACKUPS = 20;

function createMigrationRecordsService({ log = console, dbPath = null, dataDir = null, backupRoots = null } = {}) {
  function resolveDataRoot() {
    if (dataDir) return path.resolve(dataDir);
    let resolvedDb = null;
    if (dbPath) {
      resolvedDb = path.resolve(dbPath);
    } else {
      try {
        const { loadConfig } = require('../../config/index.js');
        const configured = loadConfig().database?.path || './data/drama_generator.db';
        resolvedDb = path.resolve(path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured));
      } catch (_) {
        resolvedDb = path.resolve(process.cwd(), 'data', 'drama_generator.db');
      }
    }
    return path.resolve(path.dirname(resolvedDb), '.');
  }

  function dirBytes(root) {
    let bytes = 0;
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile()) {
          try { bytes += fs.statSync(abs).size; } catch (_) {}
        }
      }
    };
    if (fs.existsSync(root)) walk(root);
    return bytes;
  }

  function scanBackupRoot(root, out) {
    if (!fs.existsSync(root)) return;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const manifestPath = path.join(dir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      let createdAt = null;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.createdAt) {
          const t = new Date(manifest.createdAt).getTime();
          if (!Number.isNaN(t)) createdAt = new Date(t).toISOString();
        }
      } catch (_) { /* manifest 损坏时退回目录 mtime */ }
      if (createdAt === null) {
        try { createdAt = new Date(fs.statSync(dir).mtimeMs).toISOString(); } catch (_) { createdAt = null; }
      }
      out.push({ dir, createdAt, bytes: dirBytes(dir) });
    }
  }

  function list() {
    const dataRoot = resolveDataRoot();
    const { createMigrationJournal } = require('../backup/migrationJournal.js');
    const journal = createMigrationJournal(dataRoot);
    const roots = Array.isArray(backupRoots) && backupRoots.length
      ? backupRoots.map((p) => path.resolve(p))
      : [
        path.join(dataRoot, 'backups', 'v2.1'),
        path.join(dataRoot, 'backups', 'workspace-migrations'),
      ];
    const backups = [];
    for (const root of roots) scanBackupRoot(root, backups);
    backups.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    const result = {
      journalPath: journal.getPath(),
      journal: journal.read(),
      backups: backups.slice(0, MAX_BACKUPS),
    };
    log.info?.('V2.1 迁移与恢复记录读取（只读）', { backups: result.backups.length, hasJournal: Boolean(result.journal) });
    return result;
  }

  return { list, resolveDataRoot };
}

module.exports = { createMigrationRecordsService };
