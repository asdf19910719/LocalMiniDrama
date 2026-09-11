'use strict';
/**
 * A3 物理清理执行器：dry-run 清单（引用计数/活动任务占用/受控根校验）与真实执行（confirmText 门禁 + 报告落盘）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createCleanupService } = require('../src/v21/datatools/cleanupService.js');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-11T00:00:00Z';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21clean-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  const storageRoot = path.join(tmp, 'data', 'storage');
  fs.mkdirSync(storageRoot, { recursive: true });
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '剧', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(NOW, NOW);
  return { db, tmp, storageRoot };
}

function write(storageRoot, rel, bytes = 1024) {
  const abs = path.join(storageRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.alloc(bytes, 3));
  return abs;
}

function byRel(result, rel) {
  return result.files.find((f) => f.path.replace(/\\/g, '/') === rel);
}

test('dry-run：无引用文件可清理；有引用/任务占用阻断并给出原因', () => {
  const { db, storageRoot } = setup();
  const orphan = write(storageRoot, 'tmp/orphan.png');
  const referenced = write(storageRoot, 'gen/ref.png');
  const busy = write(storageRoot, 'v21-mock/busy.mp4');
  db.prepare(
    `INSERT INTO image_generations (drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (1, 'openai', 'p', '/static/ref.png', ?, 'completed', ?, ?)`
  ).run(referenced, NOW, NOW);
  db.prepare(
    `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, result, created_at, updated_at)
     VALUES ('task-live', 'v21:mock-video', 'running', 40, '生成中', '1', ?, ?, ?)`
  ).run(JSON.stringify({ artifactPath: busy, url: '/static/v21-mock/busy.mp4' }), NOW, NOW);
  const svc = createCleanupService({ db, log, storageRoot });
  const result = svc.dryRun();
  assert.equal(byRel(result, 'tmp/orphan.png').eligible, true);
  assert.equal(byRel(result, 'gen/ref.png').eligible, false);
  assert.match(byRel(result, 'gen/ref.png').reason, /引用/);
  assert.equal(byRel(result, 'v21-mock/busy.mp4').eligible, false);
  assert.match(byRel(result, 'v21-mock/busy.mp4').reason, /任务/);
  assert.equal(result.summary.eligible, 1);
  assert.ok(result.summary.reclaimableBytes >= 1024);
  void orphan;
});

test('execute：confirmText 必须为「永久清理」；真实删除可清理文件；报告落盘', async () => {
  const { db, storageRoot, tmp } = setup();
  const orphan = write(storageRoot, 'tmp/orphan.png');
  const referenced = write(storageRoot, 'gen/ref.png');
  db.prepare(
    `INSERT INTO image_generations (drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (1, 'openai', 'p', '/static/ref.png', ?, 'completed', ?, ?)`
  ).run(referenced, NOW, NOW);
  const svc = createCleanupService({ db, log, storageRoot, reportDir: path.join(tmp, 'data', 'backups', 'cleanup-reports') });
  await assert.rejects(() => svc.execute(['tmp/orphan.png'], '确认删除'), (err) => err.code === 'CONFIRM_TEXT_REQUIRED');
  const result = await svc.execute(['tmp/orphan.png'], '永久清理');
  assert.deepEqual(result.deleted, ['tmp/orphan.png']);
  assert.equal(fs.existsSync(orphan), false);
  assert.ok(fs.existsSync(result.reportPath));
  const report = JSON.parse(fs.readFileSync(result.reportPath, 'utf8'));
  assert.equal(report.deleted.length, 1);
});

test('execute：清单中仍被引用的路径拒绝执行；文件已被删则记 failed 不中断', async () => {
  const { db, storageRoot, tmp } = setup();
  const referenced = write(storageRoot, 'gen/ref.png');
  db.prepare(
    `INSERT INTO image_generations (drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (1, 'openai', 'p', '/static/ref.png', ?, 'completed', ?, ?)`
  ).run(referenced, NOW, NOW);
  const svc = createCleanupService({ db, log, storageRoot, reportDir: path.join(tmp, 'data', 'backups', 'cleanup-reports') });
  const result = await svc.execute(['gen/ref.png', 'tmp/gone.png'], '永久清理');
  assert.equal(result.deleted.length, 0);
  assert.ok(result.failed.some((f) => f.path === 'gen/ref.png' && /引用/.test(f.reason)));
  assert.ok(result.failed.some((f) => f.path === 'tmp/gone.png'));
});
