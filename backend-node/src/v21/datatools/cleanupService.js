'use strict';
/**
 * A3 物理清理执行器：
 * - dryRun()：扫描 storage 下文件，逐文件判定引用计数（image_generations/director_artifacts/
 *   characters/scenes/props/assets 行引用）、活动任务占用（pending/running 任务的 result 内路径）、
 *   受控根校验；输出可清理/阻断 + 原因。
 * - execute(items, confirmText)：confirmText 必须为「永久清理」；执行时逐文件重新校验后真实删除；
 *   报告写入 data/backups/cleanup-reports/（含已删除与未删除原因）。
 */
const fs = require('node:fs');
const path = require('node:path');

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function createCleanupService({ db, log = console, storageRoot = null, reportDir = null } = {}) {
  function resolveStorageRoot() {
    if (storageRoot) return path.resolve(storageRoot);
    try {
      const { loadConfig } = require('../../config/index.js');
      const configured = loadConfig().storage?.local_path;
      if (configured) {
        return path.resolve(path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured));
      }
    } catch (_) {}
    return path.resolve(process.cwd(), 'data', 'storage');
  }

  function resolveReportDir() {
    if (reportDir) return path.resolve(reportDir);
    return path.join(resolveStorageRoot(), '..', 'backups', 'cleanup-reports');
  }

  /** 被行引用的文件集合（绝对路径小写） */
  function referencedPaths(dataRoot) {
    const known = new Set();
    const add = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return;
      known.add(path.resolve(path.isAbsolute(raw) ? raw : path.join(dataRoot, raw)).toLowerCase());
    };
    const scan = (sql, column) => {
      try {
        for (const row of db.prepare(sql).all()) add(row[column]);
      } catch (_) {}
    };
    scan(`SELECT local_path AS p FROM image_generations WHERE local_path IS NOT NULL AND TRIM(local_path) != '' AND deleted_at IS NULL`, 'p');
    scan(`SELECT artifact_path AS p FROM director_artifacts WHERE artifact_path IS NOT NULL AND TRIM(artifact_path) != ''`, 'p');
    scan(`SELECT local_path AS p FROM characters WHERE local_path IS NOT NULL AND TRIM(local_path) != '' AND deleted_at IS NULL`, 'p');
    scan(`SELECT local_path AS p FROM scenes WHERE local_path IS NOT NULL AND TRIM(local_path) != '' AND deleted_at IS NULL`, 'p');
    scan(`SELECT local_path AS p FROM props WHERE local_path IS NOT NULL AND TRIM(local_path) != '' AND deleted_at IS NULL`, 'p');
    scan(`SELECT local_path AS p FROM assets WHERE local_path IS NOT NULL AND TRIM(local_path) != '' AND deleted_at IS NULL`, 'p');
    scan(`SELECT output_path AS p FROM cut_versions WHERE output_path IS NOT NULL AND TRIM(output_path) != ''`, 'p');
    return known;
  }

  /** 活动任务占用中的文件集合 */
  function busyPaths(dataRoot) {
    const busy = new Set();
    try {
      const rows = db
        .prepare(`SELECT result, input_json FROM async_tasks WHERE deleted_at IS NULL AND status IN ('pending','running')`)
        .all();
      const pick = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of ['artifactPath', 'artifact_path', 'localPath', 'local_path']) {
          const raw = String(obj[key] || '').trim();
          if (raw) busy.add(path.resolve(path.isAbsolute(raw) ? raw : path.join(dataRoot, raw)).toLowerCase());
        }
      };
      for (const row of rows) {
        for (const raw of [row.result, row.input_json]) {
          try { pick(JSON.parse(raw)); } catch (_) {}
        }
      }
    } catch (_) {}
    return busy;
  }

  function walkFiles(root) {
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile()) out.push(abs);
      }
    };
    if (fs.existsSync(root)) walk(root);
    return out;
  }

  function dryRun() {
    const storage = resolveStorageRoot();
    const dataRoot = path.resolve(storage, '..');
    const referenced = referencedPaths(dataRoot);
    const busy = busyPaths(dataRoot);
    const files = [];
    for (const abs of walkFiles(storage)) {
      const rel = path.relative(storage, abs).replace(/\\/g, '/');
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(abs).size; } catch (_) {}
      const key = abs.toLowerCase();
      let eligible = true;
      let reason = '';
      if (referenced.has(key)) {
        eligible = false;
        reason = '有引用（媒体行或候选 artifact 占用）';
      } else if (busy.has(key)) {
        eligible = false;
        reason = '任务占用（存在 pending/running 任务）';
      }
      files.push({ path: rel, sizeBytes, eligible, reason });
    }
    const eligibleFiles = files.filter((f) => f.eligible);
    return {
      storageRoot: storage,
      files,
      summary: {
        total: files.length,
        eligible: eligibleFiles.length,
        blocked: files.length - eligibleFiles.length,
        reclaimableBytes: eligibleFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
      },
    };
  }

  function writeReport(report) {
    const dir = resolveReportDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    return file;
  }

  async function execute(items, confirmText) {
    if (String(confirmText || '').trim() !== '永久清理') {
      throw httpError('CONFIRM_TEXT_REQUIRED', 400, '请输入「永久清理」以确认执行');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw httpError('VALIDATION_ERROR', 400, '清理清单为空');
    }
    const storage = resolveStorageRoot();
    const dataRoot = path.resolve(storage, '..');
    const referenced = referencedPaths(dataRoot);
    const busy = busyPaths(dataRoot);
    const deleted = [];
    const failed = [];
    for (const raw of items) {
      const rel = String(raw || '').replace(/\\/g, '/');
      const abs = path.resolve(storage, rel);
      const insideStorage = path.relative(storage, abs) && !path.relative(storage, abs).startsWith('..') && !path.isAbsolute(path.relative(storage, abs));
      if (!insideStorage) {
        failed.push({ path: rel, reason: '路径越出受控存储根' });
        continue;
      }
      if (referenced.has(abs.toLowerCase())) {
        failed.push({ path: rel, reason: '有引用（媒体行或候选 artifact 占用）' });
        continue;
      }
      if (busy.has(abs.toLowerCase())) {
        failed.push({ path: rel, reason: '任务占用（存在 pending/running 任务）' });
        continue;
      }
      try {
        fs.unlinkSync(abs);
        deleted.push(rel);
      } catch (err) {
        failed.push({ path: rel, reason: err.code === 'ENOENT' ? '文件不存在（可能已删除）' : err.message });
      }
    }
    const report = { executedAt: new Date().toISOString(), confirmText: '永久清理', deleted, failed };
    const reportPath = writeReport(report);
    log.info && log.info('V2.1 物理清理执行完成', { deleted: deleted.length, failed: failed.length, reportPath });
    return { deleted, failed, reportPath };
  }

  return { dryRun, execute };
}

module.exports = { createCleanupService };
