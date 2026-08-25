const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const sharp = require('sharp');
const { createExternalJob, createGenerationAttempt, runIdempotent } = require('../src/services/externalGenerationService');
const { importExternalResult, rebindExternalResult } = require('../src/services/externalGenerationImportService');

describe('external generation hardening', () => {
  let db;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE image_generations (id INTEGER PRIMARY KEY AUTOINCREMENT, storyboard_id INTEGER, drama_id INTEGER, provider TEXT, prompt TEXT, image_url TEXT, local_path TEXT, width INTEGER, height INTEGER, status TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, name TEXT, type TEXT, category TEXT, url TEXT, local_path TEXT, file_size INTEGER, mime_type TEXT, width INTEGER, height INTEGER, image_gen_id INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER);
      CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, image_url TEXT, local_path TEXT, status TEXT, updated_at TEXT, deleted_at TEXT);
    `);
    db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
    db.exec(fs.readFileSync('migrations/25_external_web_generation_hardening.sql', 'utf8'));
    db.prepare('INSERT INTO episodes (id, drama_id) VALUES (1, 7), (2, 8)').run();
    db.prepare('INSERT INTO storyboards (id, episode_id, deleted_at) VALUES (11, 1, NULL), (22, 2, NULL)').run();
  });
  afterEach(() => db.close());

  it('persists idempotent responses and rejects operation reuse', () => {
    const first = runIdempotent(db, 'key-1', 'create-job', () => ({ id: 'job-1' }));
    const second = runIdempotent(db, 'key-1', 'create-job', () => ({ id: 'job-2' }));
    assert.deepEqual(second, first);
    assert.throws(() => runIdempotent(db, 'key-1', 'other', () => ({})), /another operation/i);
  });

  it('serializes concurrent async retries onto one persisted response', async () => {
    let calls = 0;
    const callback = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { id: 'job-concurrent' };
    };
    const [first, second] = await Promise.all([
      runIdempotent(db, 'key-concurrent', 'create-job', callback),
      runIdempotent(db, 'key-concurrent', 'create-job', callback),
    ]);
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
  });

  it('imports once and binds only to a storyboard in the same drama', async () => {
    const job = createExternalJob(db, { id: 'job-1', dramaId: 7, storyboardId: 11, site: 'chatgpt', promptSnapshot: 'prompt' });
    const attempt = createGenerationAttempt(db, job.id, { id: 'attempt-1', status: 'submitted' });
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const identity = { conversationId: 'conversation-1', assistantMessageId: 'assistant-1' };
    const first = await importExternalResult(db, { ...identity, attemptId: attempt.id, resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes });
    const duplicate = await importExternalResult(db, { ...identity, attemptId: attempt.id, resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes });
    assert.equal(duplicate.duplicate, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_generations').get().n, 1);
    await assert.rejects(() => importExternalResult(db, { ...identity, attemptId: attempt.id, resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: Buffer.from('not-the-same-image') }), /different image bytes|invalid image/i);
    await assert.rejects(() => importExternalResult(db, { ...identity, attemptId: attempt.id, resultIndex: -1, bytes }), /non-negative integer/i);
    await assert.rejects(() => importExternalResult(db, { ...identity, attemptId: attempt.id, resultIndex: 1, resultId: '../escape', bytes }), /safe identifier/i);
    assert.throws(() => rebindExternalResult(db, first.resultId, 22), /another drama/i);
    const bound = rebindExternalResult(db, first.resultId, 11);
    assert.equal(bound.selected, 1);
    assert.equal(db.prepare('SELECT image_url FROM storyboards WHERE id=11').get().image_url, 'https://example.invalid/a.png');
  });
});
