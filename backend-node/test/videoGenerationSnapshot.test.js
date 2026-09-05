const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { buildVideoConfigSnapshot } = require('../src/services/videoGenerationSnapshot');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

describe('buildVideoConfigSnapshot', () => {
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

  test('snapshots trusted TE-Speed provenance and ignores request-side acceleration data', () => {
    const snapshot = buildVideoConfigSnapshot({
      config: { id: 9, base_url: 'http://127.0.0.1:8188' },
      provider: 'comfyui',
      model: 'minimax_h3_director_r2v_te_speed',
      acceleration: { binarySha256: 'request-controlled-secret' },
      workflow: {
        id: 'minimax_h3_director_r2v_te_speed',
        acceleration: {
          kind: 'temporal_feature_cache',
          implementation: 'TE-Speed-MiniMaxH3',
          version: '3.3',
          repository: 'https://github.com/tl2012tl/TE-Speed-MiniMaxH3',
          commitSha: 'beda0e4be76367625b5e82500b7c4867c3d8bbd6',
          binarySha256: 'sha256:84bb1ba6f82116c764acfada127c3553b238586a8272315337cea3bcb1d0ee9c',
          mode: 'standard',
          device: 'auto',
          approximate: true,
          apiKey: 'must-not-leak',
        },
      },
    });

    assert.deepEqual(snapshot.acceleration, {
      kind: 'temporal_feature_cache',
      implementation: 'TE-Speed-MiniMaxH3',
      version: '3.3',
      repository: 'https://github.com/tl2012tl/TE-Speed-MiniMaxH3',
      commitSha: 'beda0e4be76367625b5e82500b7c4867c3d8bbd6',
      binarySha256: 'sha256:84bb1ba6f82116c764acfada127c3553b238586a8272315337cea3bcb1d0ee9c',
      mode: 'standard',
      device: 'auto',
      approximate: true,
    });
    assert.equal(JSON.stringify(snapshot).includes('request-controlled-secret'), false);
    assert.equal(JSON.stringify(snapshot).includes('must-not-leak'), false);
  });

  test('records null acceleration for the official Sage workflow', () => {
    const snapshot = buildVideoConfigSnapshot({
      config: { id: 10 }, provider: 'comfyui', model: 'minimax_h3_director_r2v',
      workflow: { id: 'minimax_h3_director_r2v', capabilities: { supportsSage: true } },
    });
    assert.equal(snapshot.acceleration, null);
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
