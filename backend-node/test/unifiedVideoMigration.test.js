const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrateUnifiedVideo } = require('../scripts/backupAndMigrateUnifiedVideo');

test('backs up, migrates idempotently, and reports only provable historical routing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-video-migration-'));
  const dbPath = path.join(root, 'director.sqlite');
  const backupDir = path.join(root, 'backups');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE video_generations (
    id INTEGER PRIMARY KEY, config_id INTEGER, config_snapshot TEXT,
    provider TEXT, protocol TEXT, prompt TEXT
  );
  INSERT INTO video_generations (id, provider, protocol, prompt)
    VALUES (1, 'cloud', 'cloud-v1', 'legacy');
  INSERT INTO video_generations (id, config_id, config_snapshot, provider, protocol, prompt)
    VALUES (2, 7, '{"provider":"comfyui"}', 'comfyui', 'comfyui', 'linked');`);
  try {
    const first = migrateUnifiedVideo({ db, dbPath, backupDir, now: '2026-08-25T00:00:00.000Z' });
    assert.ok(first.backupPath);
    assert.equal(fs.existsSync(first.backupPath), true);
    assert.equal(first.total, 2);
    assert.deepEqual(first.linked.map((row) => row.id), [2]);
    assert.deepEqual(first.historical_unknown.map((row) => row.id), [1]);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 2);

    const second = migrateUnifiedVideo({ db, dbPath, backupDir, now: '2026-08-25T00:00:00.000Z' });
    assert.notEqual(second.backupPath, first.backupPath);
    assert.equal(fs.existsSync(second.backupPath), true);
    assert.equal(second.total, 2);
    assert.deepEqual(second.linked.map((row) => row.id), [2]);
    assert.deepEqual(second.historical_unknown.map((row) => row.id), [1]);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 2);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
