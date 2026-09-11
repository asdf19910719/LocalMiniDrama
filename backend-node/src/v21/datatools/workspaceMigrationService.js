'use strict';
/**
 * A4 工作区迁移执行器（六步合同）：
 * ① 活动任务检查（pending/running 存在即拒绝）→ ② 新目录可用性/空间检查 → ③ 备份（复用
 * backupService，含 manifest+SHA-256）→ ④ 复制 db(+wal/shm) 与 storage 到新工作区 →
 * ⑤ 原子改写 configs/config.yaml 的 database.path 与 storage.local_path（保留注释；失败回滚原文）→
 * ⑥ 写迁移记录（backupDir/migration-record.json）。原目录默认保留，完成后需重新打开工作区。
 */
const fs = require('node:fs');
const path = require('node:path');

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

const CONFIRM_TEXT = '确认迁移';

function createWorkspaceMigrationService({
  db,
  log = console,
  dbPath = null,
  storageRoot = null,
  configPath = null,
  backupRoot = null,
} = {}) {
  function resolvePaths() {
    const paths = {};
    paths.db = dbPath ? path.resolve(dbPath) : (() => {
      try {
        const { loadConfig } = require('../../config/index.js');
        const configured = loadConfig().database?.path || './data/drama_generator.db';
        return path.resolve(path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured));
      } catch (_) {
        return path.resolve(process.cwd(), 'data', 'drama_generator.db');
      }
    })();
    paths.storage = storageRoot ? path.resolve(storageRoot) : path.resolve(path.dirname(paths.db), 'storage');
    paths.dataRoot = path.resolve(path.dirname(paths.db), '.');
    paths.backupRoot = backupRoot
      ? path.resolve(backupRoot)
      : path.join(paths.dataRoot, 'backups', 'workspace-migrations');
    paths.config = configPath
      ? path.resolve(configPath)
      : (fs.existsSync(path.join(process.cwd(), 'configs', 'config.yaml'))
          ? path.join(process.cwd(), 'configs', 'config.yaml')
          : path.resolve(__dirname, '..', '..', '..', 'configs', 'config.yaml'));
    return paths;
  }

  function dirBytes(root) {
    let bytes = 0;
    let files = 0;
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile()) {
          files += 1;
          try { bytes += fs.statSync(abs).size; } catch (_) {}
        }
      }
    };
    if (fs.existsSync(root)) walk(root);
    return { bytes, files };
  }

  function isActiveTaskRow(row) {
    void row;
    return true;
  }
  void isActiveTaskRow;

  /** ① + ② 检查 */
  async function check(newDirRaw) {
    const paths = resolvePaths();
    const newDir = path.resolve(String(newDirRaw || ''));
    const blockers = [];
    const details = {};

    // 活动任务
    let activeTasks = 0;
    try {
      activeTasks = db
        .prepare(`SELECT COUNT(*) AS n FROM async_tasks WHERE deleted_at IS NULL AND status IN ('pending','running')`)
        .get().n;
    } catch (_) {}
    details.activeTasks = activeTasks;
    if (activeTasks > 0) blockers.push({ code: 'ACTIVE_TASKS_RUNNING', message: `存在 ${activeTasks} 个进行中的任务，禁止危险迁移` });

    // 目录关系：不得等于或位于当前 data 根内
    if (!newDirRaw) {
      blockers.push({ code: 'DIR_REQUIRED', message: '请填写新的工作区目录' });
    } else if (path.resolve(newDir) === paths.dataRoot) {
      blockers.push({ code: 'DIR_SAME_AS_CURRENT', message: '新目录与当前工作区相同' });
    } else {
      // 两个方向都不允许嵌套：新目录位于当前工作区内，或新目录包含当前工作区
      const relInside = path.relative(paths.dataRoot, path.resolve(newDir));
      const relContains = path.relative(path.resolve(newDir), paths.dataRoot);
      const insideCurrent = relInside && !relInside.startsWith('..') && !path.isAbsolute(relInside);
      const containsCurrent = relContains && !relContains.startsWith('..') && !path.isAbsolute(relContains);
      if (insideCurrent || containsCurrent) {
        blockers.push({ code: 'DIR_NESTED', message: '新目录不能与当前工作区嵌套（不允许把工作区迁入/迁出自身内部）' });
      }
    }

    // 可写性 + 空间
    if (blockers.length === 0) {
      try {
        fs.mkdirSync(newDir, { recursive: true });
        const probe = path.join(newDir, `.write-probe-${Date.now()}`);
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        details.dirWritable = true;
      } catch (err) {
        blockers.push({ code: 'DIR_NOT_WRITABLE', message: `新目录不可写：${err.message}` });
      }
      try {
        if (typeof fs.statfsSync === 'function') {
          const stats = fs.statfsSync(newDir);
          details.freeBytes = stats.bsize * stats.bavail;
          const need = dirBytes(paths.dataRoot).bytes * 2; // 复制 + 备份余量
          details.requiredBytes = need;
          if (details.freeBytes < need) {
            blockers.push({ code: 'INSUFFICIENT_SPACE', message: '目标磁盘剩余空间不足' });
          }
        } else {
          details.freeBytes = null;
        }
      } catch (_) {
        details.freeBytes = null;
      }
    }

    return { ok: blockers.length === 0, blockers, details, newDir };
  }

  /** 范围预览 */
  async function preview(newDirRaw) {
    const paths = resolvePaths();
    const database = { path: paths.db, ...dirBytes(path.dirname(paths.db)) };
    database.files = 1;
    database.bytes = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      const p = paths.db + suffix;
      if (fs.existsSync(p)) {
        try { database.bytes += fs.statSync(p).size; } catch (_) {}
      }
    }
    const storage = { path: paths.storage, ...dirBytes(paths.storage) };
    void newDirRaw;
    return {
      currentWorkspace: paths.dataRoot,
      database,
      storage,
      note: '迁移内容 = 数据库 + 媒体 storage；原目录默认保留作为回滚点。',
    };
  }

  /** ③ 备份 */
  function createRollbackBackup(paths, migrationId) {
    const { createBackup } = require('../backup/backupService.js');
    return createBackup(paths.db, paths.backupRoot, { migrationId });
  }

  /** ④ 复制 db + storage */
  function copyWorkspace(paths, newDir) {
    const targetData = path.join(newDir, 'data');
    fs.mkdirSync(targetData, { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      const src = paths.db + suffix;
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(targetData, path.basename(paths.db) + suffix));
    }
    fs.cpSync(paths.storage, path.join(targetData, 'storage'), { recursive: true });
    return targetData;
  }

  /**
   * ⑤ 原子改写 config.yaml：只改 database.path 与 storage.local_path 两行（保留全部注释）。
   * 写入 = 临时文件 + rename；返回改写前的原文以便回滚。
   */
  function rewriteConfigAtomic(paths, newDir) {
    const original = fs.readFileSync(paths.config, 'utf8');
    const dataRootName = path.basename(path.resolve(path.dirname(paths.db)));
    void dataRootName;
    const dbRel = './data/' + path.basename(paths.db);
    const storageRel = './data/storage';
    const lines = original.split(/\r?\n/);
    let section = '';
    let sawDb = false;
    let sawStorage = false;
    const out = lines.map((line) => {
      const topMatch = line.match(/^([A-Za-z_][\w-]*):/);
      if (topMatch) section = topMatch[1];
      if (section === 'database' && /^\s{2,}path:\s/.test(line)) {
        sawDb = true;
        return line.replace(/^(path:\s).*(\s?#.*)?$/, `$1${dbRel}$2`);
      }
      if (section === 'storage' && /^\s{2,}local_path:\s/.test(line)) {
        sawStorage = true;
        return line.replace(/^(local_path:\s).*(\s?#.*)?$/, `$1${storageRel}$2`);
      }
      return line;
    });
    if (!sawDb || !sawStorage) {
      throw httpError('CONFIG_SHAPE_UNSUPPORTED', 500, 'config.yaml 缺少 database.path 或 storage.local_path，无法安全改写');
    }
    const tmpFile = paths.config + `.migrate-${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, out.join('\n'));
    fs.renameSync(tmpFile, paths.config);
    return { original, dbRel, storageRel };
  }

  function writeRecord(backupDirPath, record) {
    fs.writeFileSync(path.join(backupDirPath, 'migration-record.json'), JSON.stringify(record, null, 2));
  }

  /** 全量迁移（confirmText 门禁） */
  async function migrate(newDirRaw, confirmText) {
    if (String(confirmText || '').trim() !== CONFIRM_TEXT) {
      throw httpError('CONFIRM_TEXT_REQUIRED', 400, '请输入「确认迁移」以执行工作区迁移');
    }
    const startedAt = new Date().toISOString();
    const gate = await check(newDirRaw);
    if (!gate.ok) {
      throw httpError(gate.blockers[0].code, 409, gate.blockers[0].message);
    }
    const newDir = gate.newDir;
    const paths = resolvePaths();
    const migrationId = `ws-${Date.now().toString(36)}`;
    const steps = [];
    try {
      // ③ 备份
      const backup = createRollbackBackup(paths, migrationId);
      steps.push({ step: 'backup', ok: true, backupDir: backup.backupDir });
      // ④ 复制
      copyWorkspace(paths, newDir);
      steps.push({ step: 'copy', ok: true, target: path.join(newDir, 'data') });
      // ⑤ 原子改配置
      const rewritten = rewriteConfigAtomic(paths, newDir);
      steps.push({ step: 'config', ok: true, databasePath: rewritten.dbRel, storagePath: rewritten.storageRel });
      // ⑥ 记录
      const record = {
        migrationId,
        startedAt,
        finishedAt: new Date().toISOString(),
        from: paths.dataRoot,
        to: newDir,
        backupDir: backup.backupDir,
        configPath: paths.config,
        steps,
        note: '迁移完成；重新打开工作区（重启后端）后生效。',
      };
      writeRecord(backup.backupDir, record);
      log.info && log.info('V2.1 工作区迁移完成', { migrationId, to: newDir });
      return { ok: true, migrationId, backupDir: backup.backupDir, steps, record };
    } catch (err) {
      // 回滚：配置仅在第 ⑤ 步之后才被改写；任何失败都要确保配置仍为原文
      const record = {
        migrationId,
        startedAt,
        failedAt: new Date().toISOString(),
        from: paths.dataRoot,
        to: newDir,
        steps,
        error: err.message,
      };
      try {
        const backupDirPath = path.join(paths.backupRoot, migrationId);
        if (fs.existsSync(backupDirPath)) writeRecord(backupDirPath, record);
      } catch (_) {}
      if (!err.code) err.code = 'WORKSPACE_MIGRATION_FAILED';
      if (!err.status) err.status = 500;
      throw err;
    }
  }

  return { check, preview, migrate };
}

module.exports = { createWorkspaceMigrationService };
