const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const sharp = require('sharp');
const { createExternalJob, createGenerationAttempt } = require('../src/services/externalGenerationService');
const { importExternalResult } = require('../src/services/externalGenerationImportService');

describe('external generation recovery', () => {
  it('reuses an on-disk same-hash result after a persistence retry', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE image_generations (id INTEGER PRIMARY KEY AUTOINCREMENT, storyboard_id INTEGER, drama_id INTEGER, provider TEXT, prompt TEXT, image_url TEXT, local_path TEXT, width INTEGER, height INTEGER, status TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, name TEXT, type TEXT, category TEXT, url TEXT, local_path TEXT, file_size INTEGER, mime_type TEXT, width INTEGER, height INTEGER, image_gen_id INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER);
      CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, image_url TEXT, local_path TEXT, status TEXT, updated_at TEXT, deleted_at TEXT);`);
    db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
    db.exec(fs.readFileSync('migrations/25_external_web_generation_hardening.sql', 'utf8'));
    const job = createExternalJob(db, { id: 'recovery-job', dramaId: 1, storyboardId: 2, site: 'chatgpt', promptSnapshot: 'prompt' });
    const attempt = createGenerationAttempt(db, job.id, { id: 'recovery-attempt', status: 'submitted' });
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00ff00' } }).png().toBuffer();
    const root = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'external-recovery-'));
    const identity = { conversationId: 'conversation-1', assistantMessageId: 'assistant-1' };
    const first = await importExternalResult(db, { ...identity, attemptId: attempt.id, resultIndex: 0, resultId: 'recovery-result', storageRoot: root, bytes });
    db.prepare('DELETE FROM external_generation_results').run();
    db.prepare('DELETE FROM image_generations').run();
    db.prepare('DELETE FROM assets').run();
    const second = await importExternalResult(db, { ...identity, attemptId: attempt.id, resultIndex: 0, resultId: 'recovery-result', storageRoot: root, bytes });
    assert.equal(second.status, 'imported');
    assert.equal(second.sha256, first.sha256);
    require('node:fs').rmSync(root, { recursive: true, force: true });
    db.close();
  });
});
