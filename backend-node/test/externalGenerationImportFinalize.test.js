const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const sharp = require('sharp');
const { createExternalJob, createGenerationAttempt } = require('../src/services/externalGenerationService');
const { importExternalResult } = require('../src/services/externalGenerationImportService');

const TASK_SCHEMA = `CREATE TABLE IF NOT EXISTS image_generation_tasks (
  id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER,
  generation_channel TEXT, status TEXT, batch_id TEXT, queue_position INTEGER,
  prompt_snapshot TEXT, reference_manifest TEXT, aspect_ratio TEXT, frame_type TEXT,
  image_generation_id INTEGER, external_job_id TEXT, error_code TEXT, error_message TEXT,
  created_at TEXT, updated_at TEXT, completed_at TEXT);
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, deleted_at TEXT,
    image_url TEXT, local_path TEXT, extra_images TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);`;

async function pngBytes(color) {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer();
}

function makeCharacterTask(db, { id = 'task-1', targetId = 5 } = {}) {
  db.prepare("INSERT INTO characters (id, drama_id, name, deleted_at) VALUES (?, 7, '林晚晴', NULL)").run(targetId);
  const job = createExternalJob(db, { id: `job-${id}`, dramaId: 7, storyboardId: null, assetType: 'character', site: 'chatgpt', promptSnapshot: 'p', imageGenerationTaskId: id });
  db.prepare(`INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, status, external_job_id, created_at, updated_at)
    VALUES (?, 7, 'character', ?, 'chatgpt_web', 'submitted', ?, datetime('now'), datetime('now'))`).run(id, targetId, job.id);
  const attempt = createGenerationAttempt(db, job.id, { id: `attempt-${id}`, status: 'submitted' });
  return { job, attempt };
}

describe('chatgpt candidate auto finalize', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE image_generations (id INTEGER PRIMARY KEY AUTOINCREMENT, storyboard_id INTEGER, drama_id INTEGER, scene_id INTEGER, character_id INTEGER, provider TEXT, prompt TEXT, image_url TEXT, local_path TEXT, width INTEGER, height INTEGER, status TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, name TEXT, type TEXT, category TEXT, url TEXT, local_path TEXT, file_size INTEGER, mime_type TEXT, width INTEGER, height INTEGER, image_gen_id INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER);
      CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, image_url TEXT, local_path TEXT, status TEXT, updated_at TEXT, deleted_at TEXT);
    `);
    db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
    db.exec(fs.readFileSync('migrations/25_external_web_generation_hardening.sql', 'utf8'));
    db.exec(TASK_SCHEMA);
  });
  afterEach(() => db.close());

  it('auto-selects the first imported candidate and completes the task', async () => {
    const { attempt } = makeCharacterTask(db);
    const result = await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    const task = db.prepare("SELECT status, image_generation_id FROM image_generation_tasks WHERE id='task-1'").get();
    assert.equal(task.status, 'completed');
    assert.equal(Number(task.image_generation_id), Number(result.imageGenerationId));
    const image = db.prepare('SELECT character_id FROM image_generations WHERE id=?').get(result.imageGenerationId);
    assert.equal(image.character_id, 5);
    const row = db.prepare('SELECT status, selected FROM external_generation_results WHERE id=?').get(result.resultId);
    assert.equal(row.status, 'bound');
    assert.equal(row.selected, 1);
  });

  it('keeps later candidates switchable without stealing the primary', async () => {
    const { attempt } = makeCharacterTask(db);
    const first = await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    const second = await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 1, sourceUrl: 'https://example.invalid/b.png', bytes: await pngBytes('#00ff00') });
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'completed');
    assert.equal(db.prepare('SELECT selected FROM external_generation_results WHERE id=?').get(first.resultId).selected, 1);
    assert.equal(db.prepare('SELECT selected FROM external_generation_results WHERE id=?').get(second.resultId).selected, 0);
    assert.equal(db.prepare('SELECT status FROM external_generation_results WHERE id=?').get(second.resultId).status, 'imported');
  });

  it('falls back to needs_review when the setting is off', async () => {
    db.prepare("INSERT INTO global_settings (key, value, updated_at) VALUES ('chatgpt_web_auto_select', 'false', datetime('now'))").run();
    const { attempt } = makeCharacterTask(db);
    await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'needs_review');
    assert.equal(db.prepare('SELECT character_id FROM image_generations ORDER BY id DESC LIMIT 1').get().character_id, null);
  });

  it('falls back to needs_review when the target is gone', async () => {
    const { attempt } = makeCharacterTask(db);
    db.prepare('DELETE FROM characters WHERE id=5').run();
    await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'needs_review');
  });

  it('routes a preparing task through submitted before completing', async () => {
    const { attempt } = makeCharacterTask(db);
    db.prepare("UPDATE image_generation_tasks SET status='preparing' WHERE id='task-1'").run();
    await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'completed');
  });
});
