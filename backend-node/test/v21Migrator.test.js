'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { buildV21MigrationFixture, runV21Migration, verifyV21Data } = require('../src/v21/migration/migrator.js');
const { createMigrationJournal } = require('../src/v21/backup/migrationJournal.js');

const log = { info() {}, warn() {}, error() {} };

function makeEnv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21mig-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'minidrama.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  runFixtureSchema(db);
  buildV21MigrationFixture(db);
  db.close();
  return { tmp, dataDir, dbPath };
}

function runFixtureSchema(db) {
  const { runMigrationsAndEnsure } = require('../src/db/migrate');
  runMigrationsAndEnsure(db);
  const { ensureV21Domain, ensureStoryboardV21Columns, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
  ensureStoryboardV21Columns(db);
  ensureAsyncTaskV21Columns(db);
  ensureV21Domain(db);
}

function openCounts(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const counts = {
    episodes: db.prepare('SELECT COUNT(*) AS n FROM episodes').get().n,
    revisions: db.prepare('SELECT COUNT(*) AS n FROM episode_script_revisions').get().n,
    storyboards: db.prepare('SELECT COUNT(*) AS n FROM storyboards').get().n,
    segments: db.prepare('SELECT COUNT(*) AS n FROM storyboard_segments').get().n,
    candidates: db.prepare('SELECT COUNT(*) AS n FROM director_candidates').get().n,
    groups: db.prepare('SELECT COUNT(*) AS n FROM director_candidate_groups').get().n,
    version: db.prepare("SELECT value FROM app_meta WHERE key = 'app_schema_version'").get().value,
  };
  db.close();
  return counts;
}

test('副本迁移演练：旧数据迁移为 V2.1 事实源且对账通过', () => {
  const env = makeEnv();
  const before = openCounts(env.dbPath);
  assert.equal(before.episodes, 2);
  assert.equal(before.storyboards, 3);
  assert.equal(before.revisions, 0, '迁移前无剧本版本');
  assert.equal(before.segments, 0, '迁移前无时段');

  const result = runV21Migration({ dbPath: env.dbPath, dataDir: env.dataDir, log });
  assert.equal(result.committed, true);

  const after = openCounts(env.dbPath);
  assert.equal(after.version, '2.1.0');
  assert.equal(after.revisions, 2, '每集迁出剧本版本');
  assert.equal(after.segments, 3, '旧分镜迁出覆盖原时长的单时段');
  assert.equal(after.candidates, 1, '旧 video_url 迁为候选');
  assert.equal(after.groups, 1, '候选组建于有视频的分镜');

  // 对账独立验证
  const verifyDb = new Database(env.dbPath, { readonly: true });
  const reconciliation = verifyV21Data(verifyDb);
  verifyDb.close();
  assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation.issues));

  // journal COMMITTED
  const journal = createMigrationJournal(env.dataDir);
  assert.equal(journal.isCommitted(), true);

  // 幂等：重复执行直接退出
  const again = runV21Migration({ dbPath: env.dbPath, dataDir: env.dataDir, log });
  assert.equal(again.committed, true);
  assert.equal(again.skipped, true, '已迁移库幂等跳过');
});

test('迁移失败恢复：校验失败时事务回滚并从备份恢复，journal 记 FAILED', () => {
  const env = makeEnv();
  const before = openCounts(env.dbPath);

  assert.throws(
    () => runV21Migration({ dbPath: env.dbPath, dataDir: env.dataDir, log, injectFailureAt: 'verify' }),
    /注入/
  );

  const after = openCounts(env.dbPath);
  assert.equal(after.revisions, before.revisions, '回滚后无剧本版本（零部分写入）');
  assert.equal(after.segments, before.segments, '回滚后无时段');
  assert.equal(after.version, before.version, '版本号未推进');

  const journal = createMigrationJournal(env.dataDir);
  const state = journal.read();
  assert.equal(state.status, 'FAILED');
  assert.ok(fs.existsSync(state.backupDir), '备份目录保留');

  // 失败后允许重试（先恢复再重试的路径）：重新执行迁移成功
  const retry = runV21Migration({ dbPath: env.dbPath, dataDir: env.dataDir, log });
  assert.equal(retry.committed, true);
  assert.equal(retry.skipped, false);
});

test('冻结预检：存在活动任务时拒绝迁移', () => {
  const env = makeEnv();
  const db = new Database(env.dbPath);
  db.prepare(
    "INSERT INTO async_tasks (id, type, status, created_at, updated_at) VALUES ('t1', 'video', 'running', datetime('now'), datetime('now'))"
  ).run();
  db.close();
  assert.throws(
    () => runV21Migration({ dbPath: env.dbPath, dataDir: env.dataDir, log }),
    (err) => err.code === 'TASKS_ACTIVE'
  );
  const journal = createMigrationJournal(env.dataDir);
  assert.equal(journal.read().status, 'FAILED');
});
