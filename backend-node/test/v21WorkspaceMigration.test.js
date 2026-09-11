'use strict';
/**
 * A4 工作区迁移执行器：活动任务阻断 → 目录/空间检查 → 备份 → 复制 db+storage →
 * 原子改写 config.yaml（保留注释）→ 写迁移记录；配置改写失败回滚为原文。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createWorkspaceMigrationService } = require('../src/v21/datatools/workspaceMigrationService.js');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-11T00:00:00Z';

function setup({ withActiveTask = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21ws-'));
  const dataRoot = path.join(tmp, 'old-workspace', 'data');
  const dbPath = path.join(dataRoot, 'drama_generator.db');
  fs.mkdirSync(dataRoot, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '剧', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(NOW, NOW);
  const storageRoot = path.join(dataRoot, 'storage');
  fs.mkdirSync(path.join(storageRoot, 'gen'), { recursive: true });
  fs.writeFileSync(path.join(storageRoot, 'gen', 'a.png'), Buffer.alloc(4096, 1));
  const configPath = path.join(tmp, 'config.yaml');
  fs.writeFileSync(configPath, [
    'app:',
    '  name: LocalMiniDrama API',
    'database:',
    '  type: sqlite',
    '  path: ./data/drama_generator.db # 主库注释保留',
    'storage:',
    '  type: local',
    '  local_path: ./data/storage',
    '  base_url: http://localhost:5679/static',
  ].join('\n'));
  if (withActiveTask) {
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES ('t-live', 'v21:mock-video', 'running', 30, '生成中', '1', ?, ?)`
    ).run(NOW, NOW);
  }
  const svc = createWorkspaceMigrationService({
    db,
    log,
    dbPath,
    storageRoot,
    configPath,
    backupRoot: path.join(dataRoot, 'backups', 'workspace-migrations'),
  });
  return { db, tmp, dataRoot, dbPath, storageRoot, configPath, svc };
}

test('check：活动任务运行中 → 阻断；空闲且目录可用 → 通过', async () => {
  const ctx = setup({ withActiveTask: true });
  const newDir = path.join(ctx.tmp, 'new-home');
  const blocked = await ctx.svc.check(newDir);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.some((b) => b.code === 'ACTIVE_TASKS_RUNNING'));

  ctx.db.prepare("UPDATE async_tasks SET status = 'completed' WHERE id = 't-live'").run();
  const ok = await ctx.svc.check(newDir);
  assert.equal(ok.ok, true);
});

test('check：新目录等于或位于当前工作区内 → 阻断', async () => {
  const ctx = setup();
  const nested = await ctx.svc.check(path.join(ctx.dataRoot, 'nested'));
  assert.equal(nested.ok, false);
  const same = await ctx.svc.check(ctx.dataRoot);
  assert.equal(same.ok, false);
});

test('preview：输出数据库与媒体的迁移范围（字节数/文件数）', async () => {
  const ctx = setup();
  const preview = await ctx.svc.preview(path.join(ctx.tmp, 'new-home'));
  assert.ok(preview.database.bytes >= 4096);
  assert.ok(preview.storage.bytes >= 4096);
  assert.equal(preview.storage.files, 1);
});

test('migrate：完整六步——备份/复制/原子改配置/记录，注释保留', async () => {
  const ctx = setup();
  const newDir = path.join(ctx.tmp, 'new-home');
  await assert.rejects(() => ctx.svc.migrate(newDir, '错的'), (err) => err.code === 'CONFIRM_TEXT_REQUIRED');
  const result = await ctx.svc.migrate(newDir, '确认迁移');
  assert.equal(result.ok, true);
  // 备份落盘
  assert.ok(fs.existsSync(result.backupDir));
  assert.ok(fs.existsSync(path.join(result.backupDir, 'manifest.json')));
  // db + storage 已复制
  assert.ok(fs.existsSync(path.join(newDir, 'data', 'drama_generator.db')));
  assert.ok(fs.existsSync(path.join(newDir, 'data', 'storage', 'gen', 'a.png')));
  // 新库可打开且包含数据
  const copied = new Database(path.join(newDir, 'data', 'drama_generator.db'), { readonly: true });
  assert.equal(copied.prepare('SELECT COUNT(*) AS n FROM dramas').get().n, 1);
  copied.close();
  // 配置原子改写（相对路径指向新工作区）且注释保留
  const text = fs.readFileSync(ctx.configPath, 'utf8');
  assert.match(text, /path: \.\/data\/drama_generator\.db/); // 相对路径形式不变
  assert.match(text, /# 主库注释保留/);
  assert.match(text, /local_path: \.\/data\/storage/);
  // 迁移记录
  assert.ok(fs.existsSync(path.join(result.backupDir, 'migration-record.json')));
});

test('migrate：配置写失败 → 返回失败并保留原配置内容', async () => {
  const ctx = setup();
  // 用只读配置文件制造写失败
  const svc = createWorkspaceMigrationService({
    db: ctx.db,
    log,
    dbPath: ctx.dbPath,
    storageRoot: ctx.storageRoot,
    configPath: path.join(ctx.tmp, 'not-exist-dir', 'config.yaml'),
    backupRoot: path.join(ctx.dataRoot, 'backups', 'workspace-migrations'),
  });
  const before = fs.readFileSync(ctx.configPath, 'utf8');
  await assert.rejects(() => svc.migrate(path.join(ctx.tmp, 'new-home'), '确认迁移'));
  assert.equal(fs.readFileSync(ctx.configPath, 'utf8'), before);
});
