'use strict';
/**
 * A2 完整性检查扫描器：POST /api/v2/datatools/integrity/run 的服务层合同。
 * 覆盖六类检查：SQLite 一致性 / 媒体存在性 / 引用完整性 / 任务索引 / 受控目录越界 / 孤儿文件。
 * 每项产出 {severity: ok|warn|error, item, detail, recovery}。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createIntegrityService } = require('../src/v21/datatools/integrityService.js');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-11T00:00:00Z';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21int-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '剧', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(NOW, NOW);
  const storageRoot = path.join(tmp, 'data', 'storage');
  fs.mkdirSync(storageRoot, { recursive: true });
  return { db, tmp, storageRoot };
}

function writeStorageFile(storageRoot, rel, bytes = 1024) {
  const abs = path.join(storageRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.alloc(bytes, 7));
  return abs;
}

function item(result, id) {
  return result.items.find((entry) => entry.id === id) || null;
}

test('健康库：全部检查 ok，summary 无警告无错误', () => {
  const { db, storageRoot } = setup();
  const svc = createIntegrityService({ db, log, storageRoot });
  const result = svc.run();
  assert.equal(item(result, 'sqlite-integrity').severity, 'ok');
  assert.equal(item(result, 'sqlite-foreign-keys').severity, 'ok');
  assert.equal(item(result, 'media-existence').severity, 'ok');
  assert.equal(item(result, 'reference-integrity').severity, 'ok');
  assert.equal(item(result, 'task-index').severity, 'ok');
  assert.equal(item(result, 'controlled-root').severity, 'ok');
  assert.equal(item(result, 'orphan-files').severity, 'ok');
  assert.equal(result.summary.error, 0);
  assert.equal(result.summary.warn, 0);
});

test('媒体存在性：local_path 缺失 → error + recovery=relocation；文件正常不计问题', () => {
  const { db, storageRoot } = setup();
  const good = writeStorageFile(storageRoot, 'gen/good.png');
  db.prepare(
    `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (NULL, 1, 'openai', 'p', '/static/a.png', ?, 'completed', ?, ?)`
  ).run(good, NOW, NOW);
  db.prepare(
    `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (NULL, 1, 'openai', 'p', '/static/b.png', ?, 'completed', ?, ?)`
  ).run(path.join(storageRoot, 'gen', 'missing.png'), NOW, NOW);
  const result = createIntegrityService({ db, log, storageRoot }).run();
  const media = item(result, 'media-existence');
  assert.equal(media.severity, 'error');
  assert.equal(media.recovery, 'relocation');
  assert.match(media.detail, /1/);
});

test('引用完整性：episode_characters 悬空 character_id → warn', () => {
  const { db } = setup();
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, 999)').run();
  const result = createIntegrityService({ db, log, storageRoot: os.tmpdir() }).run();
  const refs = item(result, 'reference-integrity');
  assert.equal(refs.severity, 'warn');
  assert.match(refs.detail, /episode_characters/);
});

test('任务索引：v21 视频任务 owner_id 指向不存在的分镜 → warn + recovery=reindex', () => {
  const { db } = setup();
  db.prepare(
    `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, owner_type, owner_id, created_at, updated_at)
     VALUES ('t1', 'v21:mock-video', 'completed', 100, '', '1', 'storyboard_video', '424242', ?, ?)`
  ).run(NOW, NOW);
  const result = createIntegrityService({ db, log, storageRoot: os.tmpdir() }).run();
  const tasks = item(result, 'task-index');
  assert.equal(tasks.severity, 'warn');
  assert.equal(tasks.recovery, 'reindex');
});

test('受控目录越界：媒体路径解析到 data 根之外 → warn + recovery=paths', () => {
  const { db, tmp } = setup();
  const outside = path.join(tmp, 'outside.png');
  fs.writeFileSync(outside, Buffer.alloc(64, 1));
  db.prepare(
    `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (NULL, 1, 'openai', 'p', '/static/x.png', ?, 'completed', ?, ?)`
  ).run(outside, NOW, NOW);
  const result = createIntegrityService({ db, log, storageRoot: path.join(tmp, 'data', 'storage') }).run();
  const root = item(result, 'controlled-root');
  assert.equal(root.severity, 'warn');
  assert.equal(root.recovery, 'paths');
});

test('孤儿文件：storage 中未被任何行引用的文件 → warn + recovery=cleanup', () => {
  const { db, storageRoot } = setup();
  const referenced = writeStorageFile(storageRoot, 'gen/ref.png');
  writeStorageFile(storageRoot, 'tmp/orphan-thumb.png');
  db.prepare(
    `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (NULL, 1, 'openai', 'p', '/static/ref.png', ?, 'completed', ?, ?)`
  ).run(referenced, NOW, NOW);
  const result = createIntegrityService({ db, log, storageRoot }).run();
  const orphans = item(result, 'orphan-files');
  assert.equal(orphans.severity, 'warn');
  assert.equal(orphans.recovery, 'cleanup');
  assert.match(orphans.detail, /orphan-thumb/);
});
