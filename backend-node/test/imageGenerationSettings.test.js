const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const settingsRoutes = require('../src/routes/settings');

function responseCapture() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('persists global ChatGPT web image channel settings', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const routes = settingsRoutes(db, {}, console);
  const saved = responseCapture();
  routes.updateImageGenerationSettings({ body: { chatgpt_web: { enabled: false, executable: ' chrome.exe ', profile: ' profile ' } } }, saved);
  assert.equal(saved.body.data.chatgpt_web.enabled, false);
  assert.equal(saved.body.data.chatgpt_web.executable, 'chrome.exe');
  assert.equal(saved.body.data.chatgpt_web.profile, 'profile');

  const loaded = responseCapture();
  routes.getImageGenerationSettings({}, loaded);
  assert.deepEqual(loaded.body.data.channels, { api: true, chatgpt_web: false });
  db.close();
});
