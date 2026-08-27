const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('node:path');
const { loadRegistry } = require('../src/director/workflowRegistry');
const { createUnifiedVideoGenerationService } = require('../src/services/unifiedVideoGenerationService');

describe('video capabilities service', () => {
  it('loads the API workflow graph before asking the adapter for capabilities', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_type TEXT, provider TEXT,
      api_protocol TEXT, base_url TEXT, api_key TEXT, model TEXT, default_model TEXT,
      endpoint TEXT, query_endpoint TEXT, settings TEXT, is_default INTEGER,
      is_active INTEGER, deleted_at TEXT
    )`);
    db.prepare(`INSERT INTO ai_service_configs
      (service_type, provider, api_protocol, base_url, api_key, model, default_model, settings, is_default, is_active)
      VALUES ('video', 'comfyui', 'comfyui', 'http://127.0.0.1:8188', '', ?, ?, '{}', 1, 1)`)
      .run(JSON.stringify(['minimax_h3_director_r2v']), 'minimax_h3_director_r2v');
    const registry = loadRegistry(path.resolve(__dirname, '..', 'configs', 'director-workflows.json'));
    const service = createUnifiedVideoGenerationService({
      db,
      log: { info() {}, warn() {}, error() {} },
      providerRegistry: { has() { return false; } },
      workflowRegistry: registry,
    });
    assert.doesNotThrow(() => service.getVideoCapabilities());
    assert.equal(service.getVideoCapabilities().workflow.id, 'minimax_h3_director_r2v');
    db.close();
  });
});
