'use strict';
/**
 * V2.1 数据工具 · 目录状态只读探测（Task 4.3 评审修复）。
 * 与 workspaceCheck（迁移目标目录检查，含 mkdirSync 副作用）不同：
 * 本服务只读探测设置页各目录行的真实状态，绝不创建目录——
 * 存在性用 fs.existsSync，可写性用 fs.accessSync(W_OK)，空间用 fs.statfsSync。
 * 路径解析与 workspaceMigrationService 同源：dataRoot = dirname(配置 dbPath)，
 * storage 优先取注入值（路由传 cfg.storage.local_path 解析结果），否则 <dataRoot>/storage。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createDirStatusService({ log = console, dbPath = null, storageRoot = null } = {}) {
  function resolveDataRoot() {
    if (dbPath) return path.dirname(path.resolve(dbPath));
    try {
      const { loadConfig } = require('../../config/index.js');
      const configured = loadConfig().database?.path || './data/drama_generator.db';
      const resolved = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
      return path.dirname(path.resolve(resolved));
    } catch (_) {
      return path.resolve(process.cwd(), 'data');
    }
  }

  function freeBytesOf(dir) {
    try {
      if (typeof fs.statfsSync === 'function') {
        const stats = fs.statfsSync(dir);
        return stats.bsize * stats.bavail;
      }
    } catch (_) { /* 平台不支持或探测失败 → null */ }
    return null;
  }

  /** 目录不存在时，向上找最近存在的祖先取磁盘剩余空间 */
  function freeBytesOfNearestExisting(dir) {
    let cur = path.resolve(dir);
    for (let i = 0; i < 8; i += 1) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
      if (fs.existsSync(cur)) return freeBytesOf(cur);
    }
    return null;
  }

  function statusOf(key, label, dirPath) {
    const abs = path.resolve(dirPath);
    if (!fs.existsSync(abs)) {
      return { key, label, path: abs, exists: false, writable: false, freeBytes: freeBytesOfNearestExisting(abs), error: '目录不存在' };
    }
    let writable = false;
    let error = null;
    try {
      fs.accessSync(abs, fs.constants.W_OK);
      writable = true;
    } catch (err) {
      error = `目录不可写：${err.message}`;
    }
    return { key, label, path: abs, exists: true, writable, freeBytes: freeBytesOf(abs), error };
  }

  /** 三行目录状态：媒体 / 成片导出 / 系统临时目录 */
  function getDirStatus() {
    const dataRoot = resolveDataRoot();
    const storage = storageRoot ? path.resolve(storageRoot) : path.join(dataRoot, 'storage');
    const rows = [
      statusOf('storage', '媒体目录', storage),
      statusOf('export', '成片导出目录', path.join(storage, 'v21-exports')),
      statusOf('tmp', '临时目录', os.tmpdir()),
    ];
    log.info?.('V2.1 目录状态探测（只读）', { count: rows.length });
    return rows;
  }

  return { getDirStatus };
}

module.exports = { createDirStatusService };
