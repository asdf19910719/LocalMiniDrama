const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const createStyleRoutes = require('../src/routes/styles');

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE custom_styles (id TEXT PRIMARY KEY, owner_id TEXT, version INTEGER, spec_json TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, style_id TEXT, deleted_at TEXT);`);
  const log = { error() {} };
  return { db, routes: createStyleRoutes(db, log) };
}

function call(handler, { body = {}, params = {}, query = {} } = {}) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  handler({ body, params, query }, res);
  return res;
}

function customInput() {
  return {
    labelZh: '我的电影风', labelEn: 'My Cinema', descriptionZh: '克制的电影摄影风格',
    promptZh: '克制的电影摄影，自然光，真实材质。',
    promptEn: 'Restrained cinematic photography with natural light, truthful materials, controlled contrast, and coherent visual continuity.',
  };
}

test('style routes expose 169 system styles and custom style lifecycle', () => {
  const { db, routes } = setup();
  const listed = call(routes.list);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.data.items.length, 169);

  const created = call(routes.create, { body: customInput() });
  assert.equal(created.statusCode, 201);
  assert.match(created.body.data.id, /^custom:/);
  assert.equal(created.body.data.version, 1);

  const id = created.body.data.id;
  const detail = call(routes.get, { params: { id } });
  assert.equal(detail.body.data.labelZh, '我的电影风');

  const updated = call(routes.update, { params: { id }, body: { labelZh: '我的电影风二版' } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.data.version, 2);

  db.prepare('INSERT INTO dramas (id, style_id) VALUES (1, ?)').run(id);
  const blocked = call(routes.remove, { params: { id } });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.error.code, 'CUSTOM_STYLE_IN_USE');
  db.prepare('DELETE FROM dramas').run();
  assert.equal(call(routes.remove, { params: { id } }).statusCode, 200);
  assert.equal(call(routes.get, { params: { id } }).statusCode, 404);
});
