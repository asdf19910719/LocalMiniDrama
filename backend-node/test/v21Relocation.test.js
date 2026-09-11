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
const crypto = require('node:crypto');
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
  // 受控根内的新目录（根外候选属 path_escape 阻断，见下）
  const newDir = path.join(storageRoot, '..', 'new-home');
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
  const newDir = path.join(storageRoot, '..', 'mixed');
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

test('confirm：受控根内唯一命中后真实 UPDATE 行路径', () => {
  const { db, storageRoot, tmp } = setup();
  writeOldAndInsert(db, storageRoot);
  // 候选必须位于受控工作区根（dataRoot = storageRoot/..）内；根外候选走 path_escape 阻断
  const newDir = path.join(storageRoot, '..', 'new-home');
  const moved = writeFile(newDir, 'shot-01.png');
  const svc = createRelocationService({ db, log, storageRoot });
  const scan = svc.scan(newDir);
  const row = scan.rows[0];
  assert.equal(row.match.status, 'unique');
  assert.ok(row.evidence, '候选带 evidence 匹配证据');
  const confirmed = svc.confirm([{ table: row.table, id: row.id, newPath: row.match.candidates[0] }]);
  assert.equal(confirmed.updated.length, 1);
  assert.equal(db.prepare('SELECT local_path FROM image_generations WHERE id = ?').get(row.id).local_path, moved);
});

test('scan：候选越出受控 data 根 → path_escape（阻断）+ evidence；confirm 拒绝（VALIDATION）且不写库', () => {
  const { db, storageRoot, tmp } = setup();
  writeOldAndInsert(db, storageRoot);
  const id = db.prepare('SELECT id FROM image_generations').get().id;
  const outsideDir = path.join(tmp, 'relocated-outside'); // dataRoot = tmp/data 之外
  const outsideFile = writeFile(outsideDir, 'shot-01.png');
  const svc = createRelocationService({ db, log, storageRoot });
  const result = svc.scan(outsideDir);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.match.status, 'path_escape');
  assert.deepEqual(row.match.candidates, [outsideFile]);
  assert.match(row.evidence, /受控|越出/);
  assert.equal(result.summary.pathEscape, 1);

  // confirm 携带越界路径：整体拒绝（VALIDATION），零写入
  assert.throws(
    () => svc.confirm([{ table: 'image_generations', id, newPath: outsideFile }]),
    (err) => err && err.code === 'VALIDATION_ERROR' && err.status === 400
  );
  assert.match(
    db.prepare('SELECT local_path FROM image_generations WHERE id = ?').get(id).local_path,
    /storage/,
    '被拒后数据库路径保持原值'
  );
});

test('confirm：越界项使整批全有或全无——合法项也不写入', () => {
  const { db, storageRoot, tmp } = setup();
  writeOldAndInsert(db, storageRoot);
  const id = db.prepare('SELECT id FROM image_generations').get().id;
  const insideDir = path.join(storageRoot, '..', 'in-root');
  const insideFile = writeFile(insideDir, 'shot-01.png');
  const outsideFile = writeFile(path.join(tmp, 'out-root'), 'other.png');
  const svc = createRelocationService({ db, log, storageRoot });
  assert.throws(
    () => svc.confirm([
      { table: 'image_generations', id, newPath: insideFile },
      { table: 'image_generations', id, newPath: outsideFile },
    ]),
    /重定位确认被拒绝|阻断/
  );
  assert.equal(db.prepare('SELECT local_path FROM image_generations WHERE id = ?').get(id).local_path, path.join(storageRoot, 'gen', 'shot-01.png'));
});

test('scan：文件名命中但内容 hash 与记录 sha256 不一致 → hash_mismatch（阻断）；hash 一致 → unique；confirm 拒绝阻断项', () => {
  const { db, storageRoot } = setup();
  const oldAbs = path.join(storageRoot, 'gen', 'cut-01.mp4');
  const matchedHash = crypto.createHash('sha256').update(Buffer.alloc(2048, 1)).digest('hex');
  const otherHash = crypto.createHash('sha256').update(Buffer.alloc(2048, 2)).digest('hex');
  fs.mkdirSync(path.dirname(oldAbs), { recursive: true });
  fs.writeFileSync(oldAbs, Buffer.alloc(2048, 1));
  fs.unlinkSync(oldAbs); // 文件已被移动走，但记录仍保存其内容 sha256 基线
  db.prepare(
    `INSERT INTO director_artifacts (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size, manifest_json, created_at)
     VALUES ('da-ok', 'job-1', 1, 1, 'ready', ?, ?, 2048, '{}', ?)`
  ).run(oldAbs, matchedHash, NOW);

  const movedDir = path.join(storageRoot, '..', 'moved-in-root');
  const sameContent = writeFile(movedDir, 'cut-01.mp4', 2048);
  fs.writeFileSync(sameContent, Buffer.alloc(2048, 1));
  // 第二行：记录 hash 与目录内容不一致（记录路径已不存在，同名候选内容不同）
  db.prepare(
    `INSERT INTO director_artifacts (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size, manifest_json, created_at)
     VALUES ('da-bad', 'job-1', 1, 2, 'ready', ?, ?, 2048, '{}', ?)`
  ).run(path.join(storageRoot, 'gen', 'cut-01-missing.mp4'), otherHash, NOW);
  fs.writeFileSync(path.join(movedDir, 'cut-01-missing.mp4'), Buffer.alloc(2048, 9)); // 同名但内容不同

  const svc = createRelocationService({ db, log, storageRoot });
  const result = svc.scan(movedDir);
  const okRow = result.rows.find((r) => r.missingPath.includes('cut-01.mp4'));
  const badRow = result.rows.find((r) => r.missingPath.includes('cut-01-missing.mp4'));
  assert.equal(okRow.match.status, 'unique');
  assert.match(okRow.evidence, /hash 一致/);
  assert.equal(badRow.match.status, 'hash_mismatch');
  assert.match(badRow.evidence, /hash 不一致/);
  assert.equal(result.summary.hashMismatch, 1);

  assert.throws(
    () => svc.confirm([{ table: 'director_artifacts', id: 'da-bad', newPath: path.join(movedDir, 'cut-01-missing.mp4') }]),
    (err) => err && err.code === 'VALIDATION_ERROR' && err.status === 400,
    'confirm 携带 hash_mismatch 项被整体拒绝'
  );
  // hash 一致项 confirm 正常写入
  const ok = svc.confirm([{ table: 'director_artifacts', id: 'da-ok', newPath: sameContent }]);
  assert.equal(ok.updated.length, 1);
});

test('confirm：受控根内不存在的新路径被跳过且不写库', () => {
  const { db, storageRoot } = setup();
  writeOldAndInsert(db, storageRoot);
  const insideMissing = path.join(storageRoot, 'not-there.png');
  const svc = createRelocationService({ db, log, storageRoot });
  const result = svc.confirm([{ table: 'image_generations', id: 1, newPath: insideMissing }]);
  assert.equal(result.updated.length, 0);
  assert.match(result.skipped[0].reason, /不存在/);
});
