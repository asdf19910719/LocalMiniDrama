const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const settingsRoutes = require('../src/routes/settings');

function capture(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    handler(req || {}, res);
    if (res.body === undefined) return resolve(undefined);
    const payload = res.body?.data !== undefined ? res.body.data : res.body;
    if (res.statusCode >= 400) reject(new Error(typeof payload === 'string' ? payload : JSON.stringify(payload)));
    else resolve(payload);
  });
}

describe('image generation settings expose auto select', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  });
  afterEach(() => db.close());

  it('defaults auto_select to true and round-trips the value', async () => {
    const routes = settingsRoutes(db, {}, console);
    const first = await capture(routes.getImageGenerationSettings);
    assert.equal(first.chatgpt_web.auto_select, true);
    await capture(routes.updateImageGenerationSettings, { body: { chatgpt_web: { auto_select: false } } });
    const second = await capture(routes.getImageGenerationSettings);
    assert.equal(second.chatgpt_web.auto_select, false);
    await capture(routes.updateImageGenerationSettings, { body: { chatgpt_web: { auto_select: true } } });
    const third = await capture(routes.getImageGenerationSettings);
    assert.equal(third.chatgpt_web.auto_select, true);
  });
});
