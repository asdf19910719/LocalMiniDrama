const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isStorageSafe, run } = require('../scripts/cleanup-deleted-project');

function makeDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-cleanup-'));
  const db = new Database(path.join(directory, 'test.db'));
  db.exec(`CREATE TABLE dramas (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    deleted_at TEXT
  )`);
  db.prepare('INSERT INTO dramas (id, title, deleted_at) VALUES (?, ?, ?)').run(1, 'old', '2026-09-01T00:00:00Z');
  db.prepare('INSERT INTO dramas (id, title, deleted_at) VALUES (?, ?, ?)').run(2, 'live', null);
  return { db, directory };
}

function invoke(argv, fixture, service) {
  const output = [];
  const errors = [];
  return run(argv, {
    db: fixture.db,
    cfg: { storage: { local_path: path.join(fixture.directory, 'storage') } },
    service,
    stdout: { write: (value) => output.push(String(value)) },
    stderr: { write: (value) => errors.push(String(value)) },
    log: { error() {} },
  }).then((code) => ({ code, output: output.join(''), error: errors.join('') }));
}

function closeFixture(fixture) {
  fixture.db.close();
  fs.rmSync(fixture.directory, { recursive: true, force: true });
}

test('default invocation previews an already soft-deleted project', async () => {
  const fixture = makeDb();
  const calls = [];
  const result = await invoke(['--drama-id', '1'], fixture, {
    previewProjectDeletion(database, cfg, id, options) {
      calls.push({ method: 'preview', database, cfg, id, options });
      return { project: { id: 1, deleted_at: '2026-09-01' }, counts: { dramas: 1 }, storage: { directory: path.join(fixture.directory, 'storage', 'projects', '1-old'), cleanup_status: 'missing' } };
    },
    deleteProjectPermanently() { throw new Error('must not execute'); },
  });
  assert.equal(result.code, 0);
  assert.match(result.output, /preview/i);
  assert.deepEqual(calls.map((call) => call.options), [{ includeDeleted: true }]);
  closeFixture(fixture);
});

test('refuses execution for a live project without calling deletion service', async () => {
  const fixture = makeDb();
  let called = false;
  const result = await invoke(['--drama-id', '2', '--execute'], fixture, {
    previewProjectDeletion() { called = true; },
    deleteProjectPermanently() { called = true; },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.error, /soft-deleted|live/i);
  assert.equal(called, false);
  closeFixture(fixture);
});

test('refuses a missing or invalid drama id', async () => {
  const fixture = makeDb();
  const result = await invoke(['--execute'], fixture, {
    previewProjectDeletion() { throw new Error('must not call service'); },
    deleteProjectPermanently() { throw new Error('must not call service'); },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.error, /drama-id|required/i);
  closeFixture(fixture);
});

test('explicit execution permanently cleans the verified soft-deleted project', async () => {
  const fixture = makeDb();
  const calls = [];
  const result = await invoke(['--drama-id', '1', '--execute'], fixture, {
    previewProjectDeletion(database, cfg, id, options) {
      calls.push({ method: 'preview', id, options });
      return { project: { id: 1, deleted_at: '2026-09-01' }, counts: { dramas: 1 }, storage: { directory: path.join(fixture.directory, 'storage', 'projects', '1-old'), cleanup_status: 'missing' } };
    },
    deleteProjectPermanently(database, cfg, log, id, options) {
      calls.push({ method: 'delete', id, options });
      return { deleted: true, counts: { dramas: 1 }, storage: {} };
    },
  });
  assert.equal(result.code, 0);
  assert.match(result.output, /deleted|execute/i);
  assert.deepEqual(calls.map((call) => call.method), ['preview', 'delete']);
  assert.deepEqual(calls.map((call) => call.options), [{ includeDeleted: true }, { includeDeleted: true }]);
  closeFixture(fixture);
});

test('refuses execution when the deletion preview reports unsafe storage', async () => {
  const fixture = makeDb();
  let deleteCalled = false;
  const result = await invoke(['--drama-id', '1', '--execute'], fixture, {
    previewProjectDeletion() {
      return { project: { id: 1 }, counts: { dramas: 1 }, storage: { cleanup_status: 'unsafe' } };
    },
    deleteProjectPermanently() {
      deleteCalled = true;
      throw new Error('must not execute');
    },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.error, /unsafe|storage/i);
  assert.equal(deleteCalled, false);
  assert.equal(fixture.db.prepare('SELECT id FROM dramas WHERE id = 1').get().id, 1);
  closeFixture(fixture);
});

test('rechecks soft-deleted state after preview before execution', async () => {
  const fixture = makeDb();
  let deleteCalled = false;
  const result = await invoke(['--drama-id', '1', '--execute'], fixture, {
    previewProjectDeletion() {
      fixture.db.prepare('UPDATE dramas SET deleted_at = NULL WHERE id = 1').run();
      return { project: { id: 1 }, storage: { directory: path.join(fixture.directory, 'storage', 'projects', '1-old'), cleanup_status: 'missing' } };
    },
    deleteProjectPermanently() { deleteCalled = true; },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.error, /no longer soft-deleted/i);
  assert.equal(deleteCalled, false);
  closeFixture(fixture);
});

test('detects an existing project-directory symlink that resolves outside projects root', () => {
  const fixture = makeDb();
  const projectsRoot = path.join(fixture.directory, 'storage', 'projects');
  const outside = path.join(fixture.directory, 'outside');
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const linkedDirectory = path.join(projectsRoot, '1-old');
  try {
    fs.symlinkSync(outside, linkedDirectory, 'junction');
  } catch (error) {
    closeFixture(fixture);
    if (error.code === 'EPERM' || error.code === 'EACCES') return;
    throw error;
  }
  assert.equal(isStorageSafe({ directory: linkedDirectory, cleanup_status: 'pending' }, { storage: { local_path: path.join(fixture.directory, 'storage') } }), false);
  closeFixture(fixture);
});
