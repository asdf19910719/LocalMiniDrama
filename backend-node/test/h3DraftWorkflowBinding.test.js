const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createH3PromptDraftService } = require('../src/services/h3PromptDraftService');

function setup() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY, service_type TEXT, provider TEXT, api_protocol TEXT,
      model TEXT, default_model TEXT, settings TEXT, is_active INTEGER, deleted_at TEXT
    );
    CREATE TABLE storyboard_h3_prompt_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, storyboard_id INTEGER, video_config_id TEXT,
      workflow_id TEXT, source_fingerprint TEXT, generation_params TEXT,
      updated_at TEXT, created_at TEXT
    );
    INSERT INTO ai_service_configs
      (id, service_type, provider, api_protocol, model, default_model, settings, is_active)
      VALUES (7, 'video', 'comfyui', 'comfyui', '["wf-a","wf-b"]', 'wf-b', '{}', 1);
  `);
  const registry = { workflows: [
    { id: 'wf-a', status: 'verified', workflowSha256: 'sha256:a' },
    { id: 'wf-b', status: 'verified', workflowSha256: 'sha256:b' },
  ] };
  return { db, service: createH3PromptDraftService({ workflowRegistry: registry }), registry };
}

function insert(db, { workflowId = null, workflowSha = null, updatedAt = '2026-01-01' } = {}) {
  return Number(db.prepare(`INSERT INTO storyboard_h3_prompt_drafts
    (storyboard_id, video_config_id, workflow_id, source_fingerprint, generation_params, created_at, updated_at)
    VALUES (1, '7', ?, 'fingerprint', ?, ?, ?)`)
    .run(workflowId, JSON.stringify({ workflowSha }), updatedAt, updatedAt).lastInsertRowid);
}

describe('H3 draft workflow binding', () => {
  it('prefers an exact workflow id even when another workflow is the channel default', () => {
    const { db, service } = setup();
    const exactId = insert(db, { workflowId: 'wf-a', workflowSha: 'sha256:a', updatedAt: '2026-01-01' });
    insert(db, { workflowId: 'wf-b', workflowSha: 'sha256:b', updatedAt: '2026-02-01' });
    assert.equal(service.getLatestDraftResult(db, 1, '7', 'wf-a').draft.id, exactId);
    db.close();
  });

  it('lazily backfills a legacy NULL row only when its workflow SHA uniquely matches', () => {
    const { db, service } = setup();
    const legacyId = insert(db, { workflowSha: 'sha256:a' });
    const result = service.getLatestDraftResult(db, 1, '7', 'wf-a');
    assert.equal(result.draft.id, legacyId);
    assert.equal(result.freshness.stale, false);
    assert.equal(db.prepare('SELECT workflow_id FROM storyboard_h3_prompt_drafts WHERE id = ?').get(legacyId).workflow_id, 'wf-a');
    db.close();
  });

  it('refuses an unidentifiable legacy row instead of assigning the current default', () => {
    const { db, service } = setup();
    insert(db, { workflowSha: null });
    const result = service.getLatestDraftResult(db, 1, '7', 'wf-a');
    assert.equal(result.draft, null);
    assert.deepEqual(result.freshness, { stale: true, reasons: ['legacy_workflow_unknown'] });
    db.close();
  });
});
