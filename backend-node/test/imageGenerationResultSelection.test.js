const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const sharp = require('sharp');
const { createExternalJob, createGenerationAttempt } = require('../src/services/externalGenerationService');
const { importExternalResult } = require('../src/services/externalGenerationImportService');
const { batchSelectFirstResults } = require('../src/services/imageGenerationResultSelection');

const TASK_SCHEMA = `CREATE TABLE IF NOT EXISTS image_generation_tasks (
  id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER,
  generation_channel TEXT, status TEXT, batch_id TEXT, queue_position INTEGER,
  prompt_snapshot TEXT, reference_manifest TEXT, aspect_ratio TEXT, frame_type TEXT,
  image_generation_id INTEGER, external_job_id TEXT, error_code TEXT, error_message TEXT,
  created_at TEXT, updated_at TEXT, completed_at TEXT);
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, deleted_at TEXT,
    image_url TEXT, local_path TEXT, extra_images TEXT, updated_at TEXT, image_updated_at TEXT);
  CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);`;

async function pngBytes(color) {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer();
}

function makeTask(db, { id, targetId }) {
  const job = createExternalJob(db, { id: `job-${id}`, dramaId: 7, storyboardId: null, assetType: 'character', site: 'chatgpt', promptSnapshot: 'p', imageGenerationTaskId: id });
  db.prepare(`INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, status, external_job_id, created_at, updated_at)
    VALUES (?, 7, 'character', ?, 'chatgpt_web', 'submitted', ?, datetime('now'), datetime('now'))`).run(id, targetId, job.id);
  return createGenerationAttempt(db, job.id, { id: `attempt-${id}`, status: 'submitted' });
}

describe('batch select first result', () => {
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
    db.prepare("INSERT INTO characters (id, drama_id, name, deleted_at) VALUES (5, 7, 'A', NULL), (6, 7, 'B', NULL), (9, 7, 'C', NULL)").run();
  });
  afterEach(() => db.close());

  it('completes needs_review tasks that have candidates and skips those without', async () => {
    const attempt1 = makeTask(db, { id: 'task-1', targetId: 5 });
    const attempt2 = makeTask(db, { id: 'task-2', targetId: 6 });
    await importExternalResult(db, { attemptId: attempt1.id, assistantMessageId: 'a1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    db.prepare("UPDATE image_generation_tasks SET status='needs_review' WHERE id IN ('task-1','task-2')").run();
    db.prepare("UPDATE external_generation_results SET status='imported', selected=0").run();
    db.prepare("UPDATE image_generations SET character_id=NULL").run();

    const report = batchSelectFirstResults(db, 7);
    assert.deepEqual(report.map((r) => [r.task_id, r.status]), [['task-1', 'selected'], ['task-2', 'skipped']]);
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'completed');
    assert.equal(db.prepare('SELECT character_id FROM image_generations ORDER BY id DESC LIMIT 1').get().character_id, 5);
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-2'").get().status, 'needs_review');
  });

  it('leaves other dramas and other channels untouched', async () => {
    const attempt = makeTask(db, { id: 'task-1', targetId: 5 });
    makeTask(db, { id: 'task-2', targetId: 6 });
    await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'a1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    db.prepare("UPDATE image_generation_tasks SET status='needs_review'").run();
    db.prepare("UPDATE external_generation_results SET status='imported', selected=0").run();
    db.prepare("UPDATE image_generations SET character_id=NULL").run();
    db.prepare("UPDATE image_generation_tasks SET drama_id=8 WHERE id='task-2'").run();

    const report = batchSelectFirstResults(db, 8);
    assert.deepEqual(report, [{ task_id: 'task-2', status: 'skipped', reason: 'no_candidates' }]);
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'needs_review');
  });
});
