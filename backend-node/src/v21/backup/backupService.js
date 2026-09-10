'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * 创建 V2.1 迁移备份：checkpoint WAL 后复制主库（及存在的 WAL/SHM），
 * 写入 manifest.json（含逐文件 SHA-256 与原始字节大小）。
 * 备份目录：<backupRoot>/<migrationId>/
 */
function createBackup(dbPath, backupRoot, { migrationId } = {}) {
  if (!migrationId) throw new Error('createBackup 需要 migrationId');
  if (!fs.existsSync(dbPath)) throw new Error(`源数据库不存在: ${dbPath}`);

  const backupDir = path.join(backupRoot, migrationId);
  fs.mkdirSync(backupDir, { recursive: true });

  // checkpoint WAL：把 -wal 内容合并进主库，保证单文件副本完整
  try {
    const walDb = new (require('better-sqlite3'))(dbPath);
    walDb.pragma('wal_checkpoint(TRUNCATE)');
    walDb.close();
  } catch {
    // 只读或锁场景下由下方文件复制兜底（WAL 文件会一并复制）
  }

  const files = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const src = dbPath + suffix;
    if (!fs.existsSync(src)) continue;
    const dest = path.join(backupDir, path.basename(dbPath) + suffix);
    fs.copyFileSync(src, dest);
    files.push({
      file: path.basename(dest),
      bytes: fs.statSync(dest).size,
      sha256: sha256File(dest),
    });
  }

  const manifest = {
    migrationId,
    createdAt: new Date().toISOString(),
    source: dbPath,
    schemaVersionTarget: '2.1.0',
    files,
  };
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { backupDir, manifest };
}

/** 校验备份完整性：manifest 中每个文件的字节数与 SHA-256 与磁盘一致 */
function verifyBackup(backupDir) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return false;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return false;
  }
  for (const entry of manifest.files || []) {
    const filePath = path.join(backupDir, entry.file);
    if (!fs.existsSync(filePath)) return false;
    if (fs.statSync(filePath).size !== entry.bytes) return false;
    if (sha256File(filePath) !== entry.sha256) return false;
  }
  return (manifest.files || []).length > 0;
}

module.exports = { createBackup, verifyBackup, sha256File };
