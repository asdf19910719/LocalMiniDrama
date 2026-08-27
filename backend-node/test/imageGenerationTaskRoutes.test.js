const { it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const routes = require('../src/routes/imageGenerationTasks');

it('creates a unified task and exposes one drama summary', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, metadata TEXT, deleted_at TEXT, updated_at TEXT);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, appearance TEXT, polished_prompt TEXT, ref_image TEXT, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE image_generation_batches (id TEXT PRIMARY KEY, drama_id INTEGER, resource_scope TEXT, generation_channel TEXT, status TEXT, total_count INTEGER, completed_count INTEGER DEFAULT 0, review_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE image_generation_tasks (id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER, generation_channel TEXT, provider TEXT, model TEXT, prompt_snapshot TEXT, reference_manifest TEXT, aspect_ratio TEXT, frame_type TEXT, status TEXT, batch_id TEXT, queue_position INTEGER, image_generation_id INTEGER, external_job_id TEXT, error_code TEXT, error_message TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT);
    INSERT INTO dramas VALUES (7, '{}', NULL, NULL);
    INSERT INTO characters VALUES (1, 7, '林默', '黑发少年', '角色提示', NULL, NULL, NULL, NULL);
  `);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', routes(db, console));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const createdResponse = await fetch(`${base}/image-generation-tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web' }),
    });
    assert.equal(createdResponse.status, 200);
    const created = (await createdResponse.json()).data;
    assert.equal(created.prompt_snapshot, '角色提示');
    assert.equal(created.status, 'draft');

    const summary = (await (await fetch(`${base}/dramas/7/image-generation-summary`)).json()).data;
    assert.equal(summary.total, 1);
    assert.equal(summary.draft, 1);

    const batch = (await (await fetch(`${base}/image-generation-batches`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dramaId: 7, scope: 'characters', generationChannel: 'chatgpt_web', targets: [{ targetType: 'character', targetId: 1 }] }),
    })).json()).data;
    const paused = (await (await fetch(`${base}/image-generation-batches/${batch.id}/pause`, { method: 'POST' })).json()).data;
    assert.equal(paused.status, 'paused');
    const resumed = (await (await fetch(`${base}/image-generation-batches/${batch.id}/resume`, { method: 'POST' })).json()).data;
    assert.equal(resumed.status, 'queued');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
