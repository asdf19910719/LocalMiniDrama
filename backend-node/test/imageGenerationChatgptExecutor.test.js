const { it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const { createExternalJob } = require('../src/services/externalGenerationService');
const { markUnifiedTaskNeedsReview } = require('../src/services/externalGenerationImportService');

it('links an external job to one unified image task', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
  const job = createExternalJob(db, {
    id: 'job-linked', dramaId: 7, storyboardId: 11, site: 'chatgpt',
    provider: 'chatgpt-web', promptSnapshot: 'prompt', imageGenerationTaskId: 'task-1',
  });
  assert.equal(job.image_generation_task_id, 'task-1');
  db.close();
});

it('moves a linked unified task to review when a candidate imports', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE image_generation_tasks (id TEXT PRIMARY KEY, status TEXT, updated_at TEXT);
    CREATE TABLE external_generation_jobs (id TEXT PRIMARY KEY, image_generation_task_id TEXT);
    CREATE TABLE external_generation_attempts (id TEXT PRIMARY KEY, job_id TEXT);
    INSERT INTO image_generation_tasks VALUES ('task-1','submitted',NULL);
    INSERT INTO external_generation_jobs VALUES ('job-1','task-1');
    INSERT INTO external_generation_attempts VALUES ('attempt-1','job-1');`);
  assert.equal(markUnifiedTaskNeedsReview(db, 'attempt-1'), true);
  assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'needs_review');
  db.close();
});
