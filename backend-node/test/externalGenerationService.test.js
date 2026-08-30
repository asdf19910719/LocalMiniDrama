const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');

const {
  createExternalJob,
  getExternalJob,
  createGenerationAttempt,
  recordAttemptEvent,
  getProjectSession,
  attachProjectSession,
  sha256,
} = require('../src/services/externalGenerationService');

describe('external generation service', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
  });

  afterEach(() => db.close());

  it('freezes the prompt and records its hash', () => {
    const job = createExternalJob(db, {
      dramaId: 7, storyboardId: 11, site: 'jimeng', provider: 'external',
      promptSnapshot: 'a precise prompt', now: '2026-08-25T00:00:00Z',
    });
    assert.equal(job.prompt_snapshot, 'a precise prompt');
    assert.equal(job.prompt_hash, sha256('a precise prompt'));
    assert.equal(getExternalJob(db, job.id).id, job.id);
    assert.throws(() => createExternalJob(db, { dramaId: 7, site: 'jimeng', promptSnapshot: 'x', promptHash: 'wrong' }), /does not match/i);
  });

  it('allocates attempt sequence in the job transaction and makes events idempotent', () => {
    const job = createExternalJob(db, { dramaId: 1, site: 'site-a', promptSnapshot: 'prompt' });
    const first = createGenerationAttempt(db, job.id, { requestId: 'req-1' });
    const second = createGenerationAttempt(db, job.id, { requestId: 'req-2' });
    assert.deepEqual([first.sequence, second.sequence], [1, 2]);
    const event = recordAttemptEvent(db, first.id, { idempotencyKey: 'evt-1', eventType: 'sent', payload: { ok: true } });
    const duplicate = recordAttemptEvent(db, first.id, { idempotencyKey: 'evt-1', eventType: 'sent', payload: { changed: true } });
    assert.equal(duplicate.id, event.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM external_generation_events').get().count, 1);
    assert.throws(() => recordAttemptEvent(db, second.id, { idempotencyKey: 'evt-1', eventType: 'received' }), /belongs to attempt/i);
  });

  it('upserts one browser session per project and site', () => {
    const attached = attachProjectSession(db, 9, { site: 'jimeng', browserProfileId: 'profile', tabId: 'tab' });
    const updated = attachProjectSession(db, 9, { site: 'jimeng', conversationId: 'conversation', status: 'busy' });
    assert.equal(updated.id, attached.id);
    assert.equal(getProjectSession(db, 9, 'jimeng').conversation_id, 'conversation');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM external_generation_sessions').get().count, 1);
  });

  it('rejects duplicate result indexes for one attempt', () => {
    const job = createExternalJob(db, { dramaId: 1, site: 'site-a', promptSnapshot: 'prompt' });
    const attempt = createGenerationAttempt(db, job.id);
    const sql = `INSERT INTO external_generation_results (id, attempt_id, result_index, status, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, ?)`;
    const timestamp = new Date().toISOString();
    db.prepare(sql).run('result-1', attempt.id, 0, timestamp, timestamp);
    assert.throws(() => db.prepare(sql).run('result-2', attempt.id, 0, timestamp, timestamp), /UNIQUE/i);
  });

  it('adds a workbench preview URL for imported results', () => {
    const job = createExternalJob(db, { dramaId: 1, site: 'site-a', promptSnapshot: 'prompt' });
    const attempt = createGenerationAttempt(db, job.id);
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT INTO external_generation_results
      (id, attempt_id, result_index, status, created_at, updated_at)
      VALUES (?, ?, 0, 'imported', ?, ?)`).run('result-preview', attempt.id, timestamp, timestamp);
    const result = getExternalJob(db, job.id).attempts[0].results[0];
    assert.equal(result.preview_url, '/api/v1/external-generation/results/result-preview/content');
  });

  it('mirrors adapter errors onto the unified task and clears them on the next submit', () => {
    db.exec(`CREATE TABLE image_generation_tasks (id TEXT PRIMARY KEY, status TEXT, error_code TEXT, error_message TEXT, updated_at TEXT)`);
    const job = createExternalJob(db, { dramaId: 3, site: 'chatgpt', promptSnapshot: 'mirror', imageGenerationTaskId: 'task-1' });
    db.prepare("INSERT INTO image_generation_tasks (id, status) VALUES ('task-1', 'submitted')").run();
    const attempt = createGenerationAttempt(db, job.id);
    recordAttemptEvent(db, attempt.id, { idempotencyKey: 'evt-err-1', eventType: 'ADAPTER_ERROR', payload: { code: 'RESULT_CAPTURE_FAILED', message: 'ORIGINAL_URL_NOT_ALLOWED' } });
    const errored = db.prepare("SELECT status, error_code, error_message FROM image_generation_tasks WHERE id='task-1'").get();
    assert.equal(errored.status, 'needs_review');
    assert.equal(errored.error_code, 'RESULT_CAPTURE_FAILED');
    assert.equal(errored.error_message, 'ORIGINAL_URL_NOT_ALLOWED');
    recordAttemptEvent(db, attempt.id, { idempotencyKey: 'evt-sub-1', eventType: 'SUBMITTED', payload: {} });
    const cleared = db.prepare("SELECT error_code, error_message FROM image_generation_tasks WHERE id='task-1'").get();
    assert.equal(cleared.error_message, null);
    assert.equal(cleared.error_code, null);
  });
});
