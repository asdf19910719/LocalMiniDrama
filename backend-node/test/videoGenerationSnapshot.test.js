const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { buildVideoConfigSnapshot } = require('../src/services/videoGenerationSnapshot');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

describe('buildVideoConfigSnapshot', () => {
  test('freezes the complete workflow contract and final effective parameters', () => {
    const execution = {
      promptContract: 'free_text_v1',
      requiresPromptDraft: false,
      dimensions: { minWidth: 64, maxWidth: 2048, minHeight: 64, maxHeight: 2048, multipleOf: 8 },
      references: { min: 0, max: 2 },
      vramPolicy: 'none',
      defaults: { width: 640, height: 360, durationSeconds: 4, frameRate: 20, seed: 3 },
    };
    const snapshot = buildVideoConfigSnapshot({
      config: { id: 7, provider: 'comfyui', default_model: 'free-text-v1', settings: {} },
      provider: 'comfyui',
      protocol: 'comfyui',
      model: 'free-text-v1',
      workflow: {
        id: 'free-text-v1', status: 'verified', workflowPath: 'E:/workflows/free-text.json',
        workflowSha256: 'sha256:abc', variant: 'official', family: 'video',
        adapter: 'free_text_adapter', adapterVersion: 'v2', execution,
      },
      effectiveParameters: { width: 1280, height: 704, durationSeconds: 6, frameRate: 24, seed: 99 },
      planHash: 'sha256:plan',
    });

    assert.equal(snapshot.workflowSnapshotVersion, 1);
    assert.equal(snapshot.workflowPath, 'E:/workflows/free-text.json');
    assert.equal(snapshot.workflowStatus, 'verified');
    assert.equal(snapshot.workflowFamily, 'video');
    assert.deepEqual(snapshot.workflowExecution, execution);
    assert.notEqual(snapshot.workflowExecution, execution);
    assert.deepEqual(snapshot.effectiveParameters, {
      width: 1280, height: 704, durationSeconds: 6, frameRate: 24, seed: 99,
    });
    assert.equal(snapshot.planHash, 'sha256:plan');
  });

  test('keeps only resolved routing and allowlisted non-secret settings', () => {
    const snapshot = buildVideoConfigSnapshot({
      config: {
        id: 7,
        api_key: 'secret',
        base_url: 'http://user:password@127.0.0.1:8188/api?token=secret',
        endpoint: '/prompt',
        query_endpoint: '/history/{taskId}',
        settings: {
          width: 1280,
          height: 704,
          frame_rate: 24,
          workflow_id: 'h3-continuity-v1',
          workflow_version: '2026-08-25',
          api_key: 'nested-secret',
          access_token: 'nested-token',
          arbitrary_value: 'must-not-be-snapshotted',
        },
      },
      provider: 'comfyui',
      protocol: 'comfyui',
      model: 'h3-continuity-v1',
    });

    assert.equal(snapshot.configId, 7);
    assert.equal(snapshot.provider, 'comfyui');
    assert.equal(snapshot.protocol, 'comfyui');
    assert.equal(snapshot.model, 'h3-continuity-v1');
    assert.equal(snapshot.api_key, undefined);
    assert.equal(snapshot.baseUrl, 'http://127.0.0.1:8188/api');
    assert.deepEqual(snapshot.settings, {
      width: 1280,
      height: 704,
      frame_rate: 24,
      workflow_id: 'h3-continuity-v1',
      workflow_version: '2026-08-25',
    });
    assert.equal(JSON.stringify(snapshot).includes('secret'), false);
    assert.equal(JSON.stringify(snapshot).includes('arbitrary_value'), false);
  });

  test('does not leak secrets through nominally safe settings or endpoint URLs', () => {
    const snapshot = buildVideoConfigSnapshot({
      config: {
        id: 8,
        endpoint: 'https://endpoint-key@provider.example.test/v1/generate?api_key=secret',
        query_endpoint: 'https://query-key@provider.example.test/v1/jobs/{taskId}?access_token=secret',
        settings: { workflow_id: { api_key: 'secret' } },
      },
      provider: 'comfyui',
      protocol: 'comfyui',
      model: 'h3-continuity-v1',
    });

    assert.equal(snapshot.endpoint, 'https://provider.example.test/v1/generate');
    assert.equal(snapshot.queryEndpoint, 'https://provider.example.test/v1/jobs/{taskId}');
    assert.deepEqual(snapshot.settings, {});
    assert.equal(JSON.stringify(snapshot).includes('secret'), false);
    assert.equal(JSON.stringify(snapshot).includes('endpoint-key'), false);
    assert.equal(JSON.stringify(snapshot).includes('query-key'), false);
  });
});

describe('video generation snapshot migration', () => {
  test('adds nullable snapshot columns idempotently without changing old rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE video_generations (
        id INTEGER PRIMARY KEY,
        provider TEXT,
        model TEXT
      );
      INSERT INTO video_generations (id, provider, model) VALUES (42, 'legacy-provider', 'legacy-model');
    `);

    runMigrationsAndEnsure(db);
    runMigrationsAndEnsure(db);

    const row = db.prepare(`
      SELECT id, provider, model, config_id, config_snapshot, protocol,
        width, height, frame_rate, negative_prompt, continuity_mode,
        anchor_id, candidate_group_id, started_at
      FROM video_generations WHERE id = 42
    `).get();

    assert.deepEqual(row, {
      id: 42,
      provider: 'legacy-provider',
      model: 'legacy-model',
      config_id: null,
      config_snapshot: null,
      protocol: null,
      width: null,
      height: null,
      frame_rate: null,
      negative_prompt: null,
      continuity_mode: null,
      anchor_id: null,
      candidate_group_id: null,
      started_at: null,
    });
  });
});
