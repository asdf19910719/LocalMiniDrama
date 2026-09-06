const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createUnifiedVideoGenerationService } = require('../src/services/unifiedVideoGenerationService');

function createService({ models, defaultModel, workflows, allowExperimental = false }) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE ai_service_configs (
    id INTEGER PRIMARY KEY, service_type TEXT, provider TEXT, api_protocol TEXT,
    base_url TEXT, api_key TEXT, model TEXT, default_model TEXT, endpoint TEXT,
    query_endpoint TEXT, settings TEXT, is_default INTEGER, is_active INTEGER, deleted_at TEXT
  )`);
  db.prepare(`INSERT INTO ai_service_configs
    (id, service_type, provider, api_protocol, base_url, model, default_model, settings, is_default, is_active)
    VALUES (1, 'video', 'comfyui', 'comfyui', 'http://127.0.0.1:8188', ?, ?, '{}', 1, 1)`)
    .run(JSON.stringify(models), defaultModel);
  const service = createUnifiedVideoGenerationService({
    db,
    log: { info() {}, warn() {}, error() {} },
    providerRegistry: { has() { return false; } },
    workflowRegistry: { workflows },
    allowExperimental,
  });
  return { db, service };
}

function workflow(id, status = 'verified') {
  return {
    id,
    status,
    family: 'video',
    variant: 'v1',
    adapter: null,
    execution: { promptContract: 'free_text_v1', requiresPromptDraft: false },
    capabilities: { modes: ['text_to_video'] },
    workflowSha256: `sha256:${id}`,
  };
}

describe('workflow-aware video capabilities', () => {
  it('exposes the official H3 and TE-Speed pair even when only one is configured', () => {
    const official = workflow('minimax_h3_director_r2v');
    const teSpeed = workflow('minimax_h3_director_r2v_te_speed');
    const { db, service } = createService({
      models: [official.id],
      defaultModel: official.id,
      workflows: [official, teSpeed],
    });
    const result = service.getVideoCapabilities();
    assert.deepEqual(result.workflows.map((item) => item.id), [official.id, teSpeed.id]);
    db.close();
  });

  it('returns diagnostics when the configured default is missing from the registry', () => {
    const { db, service } = createService({ models: ['missing', 'ready'], defaultModel: 'missing', workflows: [workflow('ready')] });
    const result = service.getVideoCapabilities();
    assert.equal(result.defaultWorkflowStatus, 'unavailable');
    assert.equal(result.workflow, null);
    assert.deepEqual(result.workflows.map((item) => [item.id, item.selectable, item.unavailableReason]), [
      ['missing', false, 'WORKFLOW_NOT_FOUND'],
      ['ready', true, null],
    ]);
    db.close();
  });

  it('reports an experimental default without failing capability discovery', () => {
    const { db, service } = createService({ models: ['experimental'], defaultModel: 'experimental', workflows: [workflow('experimental', 'configured')] });
    const result = service.getVideoCapabilities();
    assert.equal(result.defaultWorkflowStatus, 'unavailable');
    assert.equal(result.workflows[0].unavailableReason, 'WORKFLOW_EXPERIMENTAL_REQUIRED');
    db.close();
  });

  it('maps only channel allowlisted workflows and marks the selectable default', () => {
    const { db, service } = createService({ models: ['second', 'first'], defaultModel: 'first', workflows: [workflow('first'), workflow('second'), workflow('hidden')] });
    const result = service.getVideoCapabilities();
    assert.deepEqual(result.workflows.map((item) => item.id), ['second', 'first']);
    assert.equal(result.workflows[1].default, true);
    assert.equal(result.workflow.id, 'first');
    assert.equal(result.defaultWorkflowStatus, 'available');
    db.close();
  });

  it('derives the H3 draft requirement from the selected execution contract', () => {
    const freeText = workflow('minimax_h3_free_text');
    const { db, service } = createService({
      models: [freeText.id],
      defaultModel: freeText.id,
      workflows: [freeText],
    });
    assert.equal(service.getVideoCapabilities().capabilities.requiresStoryboardH3Draft, false);
    db.close();
  });
});
