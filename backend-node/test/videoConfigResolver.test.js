const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { resolveDefaultVideoConfig } = require('../src/services/videoConfigResolver');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      api_protocol TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT,
      default_model TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    );
  `);
  return db;
}

function seed(db, overrides = {}) {
  const config = {
    service_type: 'video',
    provider: 'openai',
    api_protocol: '',
    base_url: 'https://video.example.test/v1',
    model: ['default-model'],
    default_model: 'default-model',
    is_default: 0,
    is_active: 1,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO ai_service_configs
      (service_type, provider, api_protocol, base_url, model, default_model, is_default, is_active, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    config.service_type,
    config.provider,
    config.api_protocol,
    config.base_url,
    JSON.stringify(config.model),
    config.default_model,
    config.is_default,
    config.is_active,
    config.deleted_at || null
  );
}

describe('resolveDefaultVideoConfig', () => {
  test('requires one active default', () => {
    const db = createTestDb();
    assert.throws(() => resolveDefaultVideoConfig(db), /VIDEO_CONFIG_MISSING/);
    seed(db, { is_default: 1 });
    seed(db, { is_default: 1 });
    assert.throws(() => resolveDefaultVideoConfig(db), /VIDEO_CONFIG_AMBIGUOUS/);
  });

  test('model cannot select another config', () => {
    const db = createTestDb();
    seed(db, { is_default: 1, model: ['default-model'] });
    seed(db, { is_default: 0, model: ['other-model'] });
    assert.throws(
      () => resolveDefaultVideoConfig(db, { requestedModel: 'other-model' }),
      /VIDEO_MODEL_NOT_ALLOWED/
    );
  });

  test('returns the default configuration routing identity', () => {
    const db = createTestDb();
    seed(db, {
      provider: 'gemini',
      model: ['default-model', 'allowed-model'],
      default_model: 'default-model',
      is_default: 1,
    });

    const resolved = resolveDefaultVideoConfig(db, { requestedModel: 'allowed-model' });

    assert.equal(resolved.config.provider, 'gemini');
    assert.deepEqual(resolved.config.model, ['default-model', 'allowed-model']);
    assert.equal(resolved.model, 'allowed-model');
    assert.equal(resolved.provider, 'gemini');
    assert.equal(resolved.protocol, 'gemini');
  });

  test('uses the first allowed model when the configured default is no longer allowed', () => {
    const db = createTestDb();
    seed(db, {
      model: ['allowed-model'],
      default_model: 'removed-model',
      is_default: 1,
    });

    const resolved = resolveDefaultVideoConfig(db);

    assert.equal(resolved.model, 'allowed-model');
  });
});
