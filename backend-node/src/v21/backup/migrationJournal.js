'use strict';
const fs = require('fs');
const path = require('path');

const V21_TARGET_VERSION = '2.1.0';
const TERMINAL_STATUSES = ['COMMITTED', 'FAILED'];

/**
 * 迁移 journal（数据库外崩溃恢复文件）。
 * 位置：<dataDir>/migrations/v2.1/migration-state.json
 * 状态机：PRECHECK → BACKED_UP → MIGRATING → VERIFYING → COMMITTED；失败写 FAILED。
 * 全部写入采用"临时文件 + 原子 rename"，避免断电留下半截文件。
 */
function createMigrationJournal(dataDir) {
  const journalDir = path.join(dataDir, 'migrations', 'v2.1');
  const journalPath = path.join(journalDir, 'migration-state.json');

  function read() {
    if (!fs.existsSync(journalPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    } catch {
      return null;
    }
  }

  function writeAtomic(state) {
    fs.mkdirSync(journalDir, { recursive: true });
    const tmpPath = journalPath + '.tmp-' + process.pid;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, journalPath);
  }

  function update(patch) {
    const current = read() || {};
    const next = {
      migrationId: null,
      status: 'PRECHECK',
      sourceVersion: null,
      targetVersion: V21_TARGET_VERSION,
      pid: process.pid,
      startedAt: current.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      backupDir: null,
      dbSha256: null,
      walSha256: null,
      shmSha256: null,
      precheckReportPath: null,
      verifyReportPath: null,
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    writeAtomic(next);
    return next;
  }

  function markFailed({ reason } = {}) {
    return update({ status: 'FAILED', failureReason: reason || 'unknown' });
  }

  function assertFreshStart() {
    const state = read();
    if (!state) return;
    if (state.status === 'MIGRATING' || state.status === 'VERIFYING') {
      const err = new Error(
        `检测到未完成的迁移 journal（${state.status}）。不得猜测成功或重新执行；` +
          '请先验证正式库与备份，恢复到备份后才允许重试。'
      );
      err.code = 'MIGRATION_IN_PROGRESS';
      throw err;
    }
  }

  function isCommitted() {
    const state = read();
    return Boolean(state && state.status === 'COMMITTED' && state.targetVersion === V21_TARGET_VERSION);
  }

  /**
   * 校验 journal 与数据库内记录的版本是否一致。
   * COMMITTED 但 dbSchemaVersion 不是目标版本 → 恢复界面。
   */
  function isConsistentWith(dbSchemaVersion) {
    const state = read();
    if (!state || state.status !== 'COMMITTED') return true;
    return dbSchemaVersion === V21_TARGET_VERSION;
  }

  return {
    getPath: () => journalPath,
    read,
    update,
    markFailed,
    assertFreshStart,
    isCommitted,
    isConsistentWith,
    V21_TARGET_VERSION,
  };
}

module.exports = { createMigrationJournal, V21_TARGET_VERSION, TERMINAL_STATUSES };
