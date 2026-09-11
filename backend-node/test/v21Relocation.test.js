'use strict';
/**
 * A5 媒体重定位扫描器：scan(dir) 按 相对路径→文件名→大小→hash 匹配缺失媒体；
 * confirm(items) 才真实 UPDATE 路径（且只接受受控根内、真实存在的文件）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createRelocationService } = require('../src/v21/datatools/relocationService.js');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-11T00:00:00Z';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21reloc-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  const storageRoot = path.join(tmp, 'data', 'storage');
  fs.mkdirSync(storageRoot, { recursive: true });
  return { db, tmp, storageRoot };
}

function writeFile(dir, rel, bytes = 2048) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.alloc(bytes, 9));
  return abs;
}

function insertMissingImage(db, missingAbs) {
  const info = db.prepare(
    `INSERT INTO image_generations (drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (1, 'openai', 'p', '/static/gone.png', ?, 'completed', ?, ?)`
  ).run(missingAbs, NOW, NOW);
  return Number(info.lastInsertRowid);
}

test('scan：缺失媒体按文件名在新目录唯一命中 → unique；同目录未被误判', () => {
  const { db, storageRoot, tmp } = setup();
  const oldAbs = writeOldAndInsert(db, storageRoot);
  const newDir = path.join(tmp, 'new-home');
  const moved = writeFile(newDir, 'shot-01.png');
  const svc = createRelocationService({ db, log, storageRoot });
  const result = svc.scan(newDir);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.table, 'image_generations');
  assert.equal(row.id, Number(oldAbs && db.prepare('SELECT id FROM image_generations WHERE local_path = ?').get(oldAbs).id));
  assert.equal(row.match.status, 'unique');
  assert.equal(row.match.candidates[0], moved);
  void oldAbs;
});

function writeOldAndInsert(db, storageRoot) {
  const oldAbs = path.join(storageRoot, 'gen', 'shot-01.png');
  fs.mkdirSync(path.dirname(oldAbs), { recursive: true });
  fs.writeFileSync(oldAbs, Buffer.alloc(2048, 9));
  fs.unlinkSync(oldAbs); // 模拟文件已被移动走：行仍指向旧路径
  const info = db.prepare(
    `INSERT INTO image_generations (drama_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (1, 'openai', 'p', '/static/gone.png', ?, 'completed', ?, ?)`
  ).run(oldAbs, NOW, NOW);
  void info;
  return oldAbs;
}

test('scan：同名多候选且旧文件不可读 → ambiguous；无同名 → none', () => {
  const { db, storageRoot, tmp } = setup();
  writeOldAndInsert(db, storageRoot);
  insertMissingImage(db, path.join(storageRoot, 'gen', 'never-existed.png'));
  const newDir = path.join(tmp, 'mixed');
  writeFile(newDir, 'a/shot-01.png', 2048);
  writeFile(newDir, 'b/shot-01.png', 4096);
  const svc = createRelocationService({ db, log, storageRoot });
  const result = svc.scan(newDir);
  assert.equal(result.rows.length, 2);
  const statuses = result.rows.map((r) => r.match.status).sort();
  assert.deepEqual(statuses, ['ambiguous', 'none']);
  const shotRow = result.rows.find((r) => r.missingPath.includes('shot-01'));
  assert.equal(shotRow.match.status, 'ambiguous');
  assert.equal(shotRow.match.candidates.length, 2);
});

test('confirm：唯一命中后真实 UPDATE 行路径；越界/不存在路径拒绝', () => {
  const { db, storageRoot, tmp } = setup();
  writeOldAndInsert(db, storageRoot);
  const newDir = path.join(tmp, 'new-home');
  const moved = writeFile(newDir, 'shot-01.png');
  const svc = createRelocationService({ db, log, storageRoot });
  const scan = svc.scan(newDir);
  const row = scan.rows[0];
  const confirmed = svc.confirm([{ table: row.table, id: row.id, newPath: row.match.candidates[0] }]);
  assert.equal(confirmed.updated.length, 1);
  assert.equal(db.prepare('SELECT local_path FROM image_generations WHERE id = ?').get(row.id).local_path, moved);

  const outside = svc.confirm([{ table: row.table, id: row.id, newPath: path.join(tmp, 'elsewhere.png') }]);
  assert.equal(outside.updated.length, 0);
  assert.ok(outside.skipped[0].reason);
});

test('confirm：不存在的新路径被跳过且不写库', () => {
  const { db, storageRoot, tmp } = setup();
  writeOldAndInsert(db, storageRoot);
  const outside = path.join(tmp, 'not-there.png');
  const svc = createRelocationService({ db, log, storageRoot });
  const result = svc.confirm([{ table: 'image_generations', id: 1, newPath: outside }]);
  assert.equal(result.updated.length, 0);
  assert.match(result.skipped[0].reason, /不存在/);
});
