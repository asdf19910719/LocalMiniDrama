const { it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const fs = require('node:fs');
const routes = require('../src/routes/imageGenerationTasks');
const { createGenerationAttempt } = require('../src/services/externalGenerationService');
const taskService = require('../src/services/imageGenerationTaskService');

it('creates a unified task and exposes one drama summary', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, metadata TEXT, deleted_at TEXT, updated_at TEXT);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, appearance TEXT, polished_prompt TEXT, ref_image TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, deleted_at TEXT, updated_at TEXT);
    CREATE TABLE image_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, drama_id INTEGER, scene_id INTEGER, character_id INTEGER, provider TEXT, prompt TEXT, frame_type TEXT, image_url TEXT, local_path TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE image_generation_batches (id TEXT PRIMARY KEY, drama_id INTEGER, resource_scope TEXT, generation_channel TEXT, status TEXT, total_count INTEGER, completed_count INTEGER DEFAULT 0, review_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE image_generation_tasks (id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER, generation_channel TEXT, provider TEXT, model TEXT, prompt_snapshot TEXT, reference_manifest TEXT, aspect_ratio TEXT, frame_type TEXT, status TEXT, batch_id TEXT, queue_position INTEGER, image_generation_id INTEGER, external_job_id TEXT, error_code TEXT, error_message TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT);
    INSERT INTO dramas VALUES (7, '{}', NULL, NULL);
    INSERT INTO characters VALUES (1, 7, '林默', '黑发少年', '角色提示', NULL, NULL, NULL, NULL, NULL, NULL);
  `);
  db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
  db.exec('ALTER TABLE external_generation_results ADD COLUMN selected INTEGER NOT NULL DEFAULT 0');
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
    assert.ok(created.external_job_id);
    assert.equal(db.prepare('SELECT image_generation_task_id FROM external_generation_jobs WHERE id=?').get(created.external_job_id).image_generation_task_id, created.id);
    const detail = (await (await fetch(`${base}/image-generation-tasks/${created.id}`)).json()).data;
    assert.equal(detail.external_job.id, created.external_job_id);
    const prepared = (await (await fetch(`${base}/image-generation-tasks/${created.id}/prepare-send`, { method: 'POST' })).json()).data;
    assert.equal(prepared.task.status, 'preparing');
    const attempt = prepared.attempt;
    const preparedAgain = (await (await fetch(`${base}/image-generation-tasks/${created.id}/prepare-send`, { method: 'POST' })).json()).data;
    assert.equal(preparedAgain.attempt.id, attempt.id);
    const acknowledged = (await (await fetch(`${base}/image-generation-tasks/${created.id}/acknowledge`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attemptId: attempt.id }),
    })).json()).data;
    assert.equal(acknowledged.status, 'submitted');
    taskService.transitionTask(db, created.id, 'needs_review');
    db.prepare("INSERT INTO image_generations (id,drama_id,provider,prompt,image_url,local_path,status) VALUES (50,7,'external:chatgpt-web','p','/new.png','new.png','completed')").run();
    db.prepare("INSERT INTO external_generation_results (id,attempt_id,result_index,image_generation_id,status,selected,created_at,updated_at) VALUES ('result-1',?,0,50,'imported',0,'now','now')").run(attempt.id);
    const selected = (await (await fetch(`${base}/image-generation-tasks/${created.id}/select-result`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resultId: 'result-1' }),
    })).json()).data;
    assert.equal(selected.task.status, 'completed');
    assert.equal(selected.target.image_url, '/new.png');

    const summary = (await (await fetch(`${base}/dramas/7/image-generation-summary`)).json()).data;
    assert.equal(summary.total, 1);
    assert.equal(summary.completed, 1);

    const batch = (await (await fetch(`${base}/image-generation-batches`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dramaId: 7, scope: 'characters', generationChannel: 'chatgpt_web', targets: [{ targetType: 'character', targetId: 1 }] }),
    })).json()).data;
    const paused = (await (await fetch(`${base}/image-generation-batches/${batch.id}/pause`, { method: 'POST' })).json()).data;
    assert.equal(paused.status, 'paused');
    const resumed = (await (await fetch(`${base}/image-generation-batches/${batch.id}/resume`, { method: 'POST' })).json()).data;
    assert.equal(resumed.status, 'queued');
    const next = (await (await fetch(`${base}/image-generation-batches/${batch.id}/run-next`, { method: 'POST' })).json()).data;
    assert.equal(next.status, 'preparing');
    const batchPreparedResponse = await fetch(`${base}/image-generation-tasks/${next.id}/prepare-send`, { method: 'POST' });
    assert.equal(batchPreparedResponse.status, 200);
    const batchPrepared = (await batchPreparedResponse.json()).data;
    assert.ok(batchPrepared.task.external_job_id);
    assert.equal(batchPrepared.external_job.image_generation_task_id, next.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
