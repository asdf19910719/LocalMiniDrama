const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const taskService = require('../src/services/imageGenerationTaskService');
const apiTaskService = require('../src/services/imageGenerationApiTaskService');
const orchestrator = require('../src/services/imageGenerationOrchestrator');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, style_id TEXT, metadata TEXT, deleted_at TEXT, updated_at TEXT);
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, appearance TEXT, description TEXT,
      polished_prompt TEXT, negative_prompt TEXT, asset_mode TEXT DEFAULT 'TURNAROUND',
      image_url TEXT, local_path TEXT, extra_images TEXT, deleted_at TEXT, updated_at TEXT, image_updated_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY, drama_id INTEGER, character_id INTEGER, scene_id INTEGER, storyboard_id INTEGER,
      provider TEXT, prompt TEXT, image_url TEXT, local_path TEXT, status TEXT, error_msg TEXT, updated_at TEXT
    );
    CREATE TABLE image_generation_tasks (
      id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER, generation_channel TEXT,
      provider TEXT, model TEXT, prompt_snapshot TEXT, reference_manifest TEXT, aspect_ratio TEXT, frame_type TEXT,
      asset_mode TEXT, negative_prompt_snapshot TEXT, style_snapshot TEXT, status TEXT, batch_id TEXT,
      queue_position INTEGER, image_generation_id INTEGER, external_job_id TEXT, error_code TEXT, error_message TEXT,
      created_at TEXT, updated_at TEXT, completed_at TEXT
    );
    CREATE TABLE image_generation_batches (
      id TEXT PRIMARY KEY, drama_id INTEGER, resource_scope TEXT, generation_channel TEXT, status TEXT,
      total_count INTEGER, completed_count INTEGER DEFAULT 0, review_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT
    );
    INSERT INTO dramas (id, style_id, metadata) VALUES (7, 'rh-101-cinematic', '{}');
    INSERT INTO characters (id, drama_id, name, appearance, image_url, local_path)
      VALUES (1, 7, '林默', '黑发少年', '/old.png', 'old.png');
  `);
  return db;
}

function linkedGeneratingTask(db, imageGenerationId) {
  let task = taskService.createTask(db, {
    dramaId: 7,
    targetType: 'character',
    targetId: 1,
    generationChannel: 'api',
    promptSnapshot: 'immutable character prompt',
    assetMode: 'TURNAROUND',
    negativePromptSnapshot: 'duplicate face',
    styleSnapshot: { id: 'rh-101-cinematic' },
  });
  task = taskService.transitionTask(db, task.id, 'preparing');
  return taskService.transitionTask(db, task.id, 'generating', { imageGenerationId });
}

describe('API unified image task reconciliation', () => {
  it('submits the immutable task snapshots without recompiling mode or style', async () => {
    const db = createDb();
    const task = taskService.createTask(db, {
      dramaId: 7,
      targetType: 'character',
      targetId: 1,
      generationChannel: 'api',
      promptSnapshot: 'already compiled immutable prompt',
      assetMode: 'TURNAROUND',
      negativePromptSnapshot: 'duplicate face',
      styleSnapshot: { id: 'rh-101-cinematic' },
    });
    let submittedInput;

    const generating = await orchestrator.submitTask(db, console, task.id, {
      createImage: (_db, _log, input) => {
        submittedInput = input;
        return { id: 49 };
      },
    });

    assert.equal(generating.status, 'generating');
    assert.equal(generating.image_generation_id, 49);
    assert.equal(submittedInput.prompt, 'already compiled immutable prompt');
    assert.equal(submittedInput.negative_prompt, 'duplicate face');
    assert.deepEqual(submittedInput.reference_images, []);
    db.close();
  });

  it('binds a completed API result to its immutable target and completes the task', () => {
    const db = createDb();
    db.prepare(`INSERT INTO image_generations
      (id, drama_id, provider, prompt, image_url, local_path, status)
      VALUES (50, 7, 'openai', 'actual prompt', '/new.png', 'new.png', 'completed')`).run();
    const task = linkedGeneratingTask(db, 50);

    const completed = apiTaskService.reconcileTask(db, task);

    assert.equal(completed.status, 'completed');
    assert.equal(completed.prompt_snapshot, 'immutable character prompt');
    assert.equal(completed.asset_mode, 'TURNAROUND');
    assert.equal(db.prepare('SELECT image_url FROM characters WHERE id=1').get().image_url, '/new.png');
    assert.equal(db.prepare('SELECT character_id FROM image_generations WHERE id=50').get().character_id, 1);
    assert.equal(apiTaskService.reconcileTask(db, completed).status, 'completed');
    db.close();
  });

  it('copies an API generation failure into the unified task', () => {
    const db = createDb();
    db.prepare(`INSERT INTO image_generations
      (id, drama_id, provider, prompt, status, error_msg)
      VALUES (51, 7, 'openai', 'actual prompt', 'failed', 'provider rejected request')`).run();
    const task = linkedGeneratingTask(db, 51);

    const failed = apiTaskService.reconcileTask(db, task);

    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'IMAGE_GENERATION_FAILED');
    assert.equal(failed.error_message, 'provider rejected request');
    assert.equal(db.prepare('SELECT image_url FROM characters WHERE id=1').get().image_url, '/old.png');
    db.close();
  });
});
