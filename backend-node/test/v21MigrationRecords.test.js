'use strict';
/**
 * Task 4.4 高级数据工具补全 · 迁移与恢复记录端点：
 * GET /api/v2/datatools/migrations 读真实 migration journal + 扫描备份目录
 * （backups/v2.1 与 backups/workspace-migrations，解析方式同 backupOpsService），
 * 返回 { journalPath, journal, backups:[{ dir, createdAt, bytes }]（createdAt 倒序限 20）}。
 * 只读：不写 journal、不建目录。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createV21Router } = require('../src/v21/routes.js');
const { createMigrationJournal } = require('../src/v21/backup/migrationJournal.js');
const { createMigrationRecordsService } = require('../src/v21/datatools/migrationRecordsService.js');

const log = { info() {}, warn() {}, error() {} };

function makeDataRoot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21migrec-'));
  const dataRoot = path.join(tmp, 'data');
  fs.mkdirSync(dataRoot, { recursive: true });
  return { tmp, dataRoot, dbPath: path.join(dataRoot, 'drama_generator.db') };
}

function makeBackup(root, id, createdAt, bytes = 2048) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'drama_generator.db'), Buffer.alloc(bytes, 7));
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ migrationId: id, createdAt, files: [{ file: 'drama_generator.db', bytes, sha256: 'x' }] })
  );
  return dir;
}

function flatBytes(dir) {
  return fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
}

async function startServer(dataRoot, dbPath) {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/v2', createV21Router({
    db,
    cfg: {
      storage: { local_path: path.join(dataRoot, 'storage') },
      database: { path: dbPath },
    },
    log,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/api/v2`, db };
}

async function api(base, url) {
  const res = await fetch(base + url);
  const data = await res.json().catch(() => null);
  const unwrapped = data && data.data !== undefined ? data.data : data;
  return { status: res.status, body: unwrapped, error: data && data.error ? data.error : null };
}

test('GET /datatools/migrations：journal 与备份列表（倒序、含 v2.1 与 workspace-migrations 两根）真实返回', async () => {
  const { dataRoot, dbPath } = makeDataRoot();
  const journal = createMigrationJournal(dataRoot);
  journal.update({ status: 'COMMITTED', migrationId: 'v21_t1', sourceVersion: '2.0.0' });
  const v21Root = path.join(dataRoot, 'backups', 'v2.1');
  const wsRoot = path.join(dataRoot, 'backups', 'workspace-migrations');
  const oldDir = makeBackup(v21Root, 'v21_old', '2026-09-01T00:00:00.000Z', 100);
  const newDir = makeBackup(v21Root, 'v21_new', '2026-09-09T00:00:00.000Z', 200);
  const wsDir = makeBackup(wsRoot, 'ws_1', '2026-09-05T00:00:00.000Z', 300);
  fs.mkdirSync(path.join(v21Root, 'junk-no-manifest')); // 无 manifest 的残留目录不计为备份

  const { server, base, db } = await startServer(dataRoot, dbPath);
  try {
    const res = await api(base, '/datatools/migrations');
    assert.equal(res.status, 200);
    assert.equal(res.body.journal.status, 'COMMITTED');
    assert.equal(res.body.journal.migrationId, 'v21_t1');
    assert.equal(res.body.journal.targetVersion, '2.1.0');
    assert.ok(res.body.journalPath.endsWith(path.join('migrations', 'v2.1', 'migration-state.json')));
    assert.deepEqual(res.body.backups.map((b) => b.dir), [newDir, wsDir, oldDir], '按 createdAt 倒序');
    assert.equal(res.body.backups[0].bytes, flatBytes(newDir));
    assert.equal(res.body.backups[0].createdAt, '2026-09-09T00:00:00.000Z');
    assert.ok(!res.body.backups.some((b) => b.dir.includes('junk-no-manifest')), '无 manifest 目录不计为备份');
  } finally {
    server.close();
    db.close();
  }
});

test('migrations：journal 不存在时返回 null，且 limit 20 倒序截断', () => {
  const { dataRoot, dbPath } = makeDataRoot();
  const v21Root = path.join(dataRoot, 'backups', 'v2.1');
  for (let i = 0; i < 25; i += 1) {
    makeBackup(v21Root, `v21_b${String(i).padStart(2, '0')}`, new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(), 10);
  }
  const svc = createMigrationRecordsService({ log, dbPath });
  const result = svc.list();
  assert.equal(result.journal, null);
  assert.equal(result.backups.length, 20, '最多返回 20 条');
  const times = result.backups.map((b) => new Date(b.createdAt).getTime());
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i - 1] >= times[i], '严格倒序');
  }
  assert.ok(result.backups[0].dir.includes('v21_b24'), '最新备份在前');
  void dbPath;
});
