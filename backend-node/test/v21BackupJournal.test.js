'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createBackup, verifyBackup } = require('../src/v21/backup/backupService.js');
const { createMigrationJournal } = require('../src/v21/backup/migrationJournal.js');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeSourceDb(dir) {
  const dbPath = path.join(dir, 'minidrama.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
  db.close();
  return dbPath;
}

test('createBackup：复制主库并生成 manifest 与 hash 清单', () => {
  const tmp = makeTempDir('v21bk-');
  const dbPath = makeSourceDb(tmp);
  const backupRoot = path.join(tmp, 'backups', 'v2.1');
  const result = createBackup(dbPath, backupRoot, { migrationId: 'mg-1' });

  assert.ok(fs.existsSync(result.backupDir));
  assert.ok(fs.existsSync(path.join(result.backupDir, 'manifest.json')));
  const dbFile = path.join(result.backupDir, 'minidrama.db');
  assert.ok(fs.existsSync(dbFile), '备份目录中存在主库文件');

  const check = new Database(dbFile, { readonly: true });
  const row = check.prepare('SELECT v FROM t').get();
  check.close();
  assert.equal(row.v, 'hello');

  assert.equal(verifyBackup(result.backupDir), true, '校验 hash 通过');
});

test('verifyBackup：文件被篡改时校验失败', () => {
  const tmp = makeTempDir('v21bk2-');
  const dbPath = makeSourceDb(tmp);
  const result = createBackup(dbPath, path.join(tmp, 'backups'), { migrationId: 'mg-2' });
  const dbFile = path.join(result.backupDir, 'minidrama.db');
  const db = new Database(dbFile);
  db.prepare("UPDATE t SET v = 'tampered'").run();
  db.close();
  assert.equal(verifyBackup(result.backupDir), false);
});

test('journal：原子写入并可读取', () => {
  const tmp = makeTempDir('v21jn-');
  const journal = createMigrationJournal(tmp);
  journal.update({ status: 'PRECHECK', migrationId: 'mg-3' });
  const state = journal.read();
  assert.equal(state.status, 'PRECHECK');
  assert.equal(state.migrationId, 'mg-3');
  assert.equal(state.targetVersion, '2.1.0');
  assert.ok(fs.existsSync(journal.getPath()));
});

test('journal：状态机流转 PRECHECK→BACKED_UP→MIGRATING→VERIFYING→COMMITTED', () => {
  const tmp = makeTempDir('v21jn2-');
  const journal = createMigrationJournal(tmp);
  for (const status of ['PRECHECK', 'BACKED_UP', 'MIGRATING', 'VERIFYING', 'COMMITTED']) {
    journal.update({ status, migrationId: 'mg-4' });
  }
  const state = journal.read();
  assert.equal(state.status, 'COMMITTED');
  assert.ok(journal.isCommitted(), 'COMMITTED 且目标版本 2.1.0 判定为已完成');
});

test('journal：失败写 FAILED', () => {
  const tmp = makeTempDir('v21jn3-');
  const journal = createMigrationJournal(tmp);
  journal.update({ status: 'PRECHECK', migrationId: 'mg-5' });
  journal.markFailed({ reason: '对账失败：剧集计数不一致' });
  const state = journal.read();
  assert.equal(state.status, 'FAILED');
  assert.match(state.failureReason, /对账失败/);
});

test('journal：重启时发现 MIGRATING/VERIFYING 拒绝重跑', () => {
  const tmp = makeTempDir('v21jn4-');
  const journal = createMigrationJournal(tmp);
  journal.update({ status: 'MIGRATING', migrationId: 'mg-6' });
  assert.throws(() => journal.assertFreshStart(), /MIGRATING|VERIFYING/);
  journal.update({ status: 'VERIFYING', migrationId: 'mg-6' });
  assert.throws(() => journal.assertFreshStart(), /VERIFYING/);
});

test('journal：COMMITTED 后幂等（isCommitted 为 true，不要求重跑）', () => {
  const tmp = makeTempDir('v21jn5-');
  const journal = createMigrationJournal(tmp);
  journal.update({ status: 'COMMITTED', migrationId: 'mg-7' });
  assert.doesNotThrow(() => journal.assertFreshStart());
});

test('journal：数据库版本与 journal 不一致时进入恢复路径（isConsistentWith 为 false）', () => {
  const tmp = makeTempDir('v21jn6-');
  const journal = createMigrationJournal(tmp);
  journal.update({ status: 'COMMITTED', migrationId: 'mg-8' });
  assert.equal(journal.isConsistentWith('2.0.0'), false, '库版本 2.0.0 与 COMMITTED journal 不一致');
  assert.equal(journal.isConsistentWith('2.1.0'), true);
});
