const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const createDramaRoutes = require('../src/routes/drama');

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function setup() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-route-delete-'));
  const now = '2026-09-07T00:00:00.000Z';
  db.prepare(`INSERT INTO dramas (id, title, metadata, status, created_at, updated_at)
    VALUES (1, '路由删除目标', ?, 'draft', ?, ?)`)
    .run(JSON.stringify({ storage_folder_label: 'route-target' }), now, now);
  db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (11, 1, 1, '第一集', 'draft', ?, ?)").run(now, now);
  const projectDir = path.join(storageRoot, 'projects', '0001_20260907_route-target');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'target.txt'), 'target');
  return { db, storageRoot, projectDir };
}

test('DELETE drama returns the permanent-deletion summary', (t) => {
  const { db, storageRoot, projectDir } = setup();
  t.after(() => { db.close(); fs.rmSync(storageRoot, { recursive: true, force: true }); });
  const routes = createDramaRoutes(db, { storage: { local_path: storageRoot } }, { error() {}, info() {} });
  const res = responseCapture();

  routes.deleteDrama({ params: { id: '1' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.deleted, true);
  assert.equal(res.body.data.counts.episodes, 1);
  assert.equal(res.body.data.storage.cleanup_status, 'deleted');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM dramas WHERE id = 1').get().total, 0);
  assert.equal(fs.existsSync(projectDir), false);
});

test('DELETE drama returns 404 when the project does not exist', (t) => {
  const { db, storageRoot } = setup();
  t.after(() => { db.close(); fs.rmSync(storageRoot, { recursive: true, force: true }); });
  const routes = createDramaRoutes(db, { storage: { local_path: storageRoot } }, { error() {}, info() {} });
  const res = responseCapture();

  routes.deleteDrama({ params: { id: '404' } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('DELETE drama returns 404 for a soft-deleted project', (t) => {
  const { db, storageRoot, projectDir } = setup();
  t.after(() => { db.close(); fs.rmSync(storageRoot, { recursive: true, force: true }); });
  db.prepare("UPDATE dramas SET deleted_at = '2026-09-07T00:00:00.000Z' WHERE id = 1").run();
  const routes = createDramaRoutes(db, { storage: { local_path: storageRoot } }, { error() {}, info() {} });
  const res = responseCapture();

  routes.deleteDrama({ params: { id: '1' } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM dramas WHERE id = 1').get().total, 1);
  assert.equal(fs.existsSync(projectDir), true);
});
