const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { getDrama } = require('../src/services/dramaService');

describe('drama payload import provenance summary', () => {
  it('每集只携带最新导入摘要，并暴露场景 state/description', () => {
    const db = new Database(':memory:');
    runMigrationsAndEnsure(db);
    const now = '2026-09-06T00:00:00.000Z';
    db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (5, '导入剧', 'draft', ?, ?)").run(now, now);
    db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (6, 5, 1, '第一集', 'draft', ?, ?)").run(now, now);
    db.prepare(`INSERT INTO episode_imports
      (episode_id, schema_name, schema_version, source_filename, source_sha256, raw_json, imported_at)
      VALUES (6, 'local-mini-drama.episode-package', '1.0', 'old.json', 'old', '{"old":true}', '2026-09-05T00:00:00.000Z'),
             (6, 'local-mini-drama.episode-package', '1.1', 'new.json', 'new', '{"new":true}', '2026-09-06T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO scenes
      (drama_id, episode_id, location, state, description, prompt, status, created_at, updated_at)
      VALUES (5, 6, '酒店走廊', 'night', '凌晨的走廊', 'cinematic corridor', 'draft', ?, ?)`).run(now, now);

    const drama = getDrama(db, 5);
    assert.deepEqual(drama.episodes[0].import_source, {
      source_filename: 'new.json',
      schema_name: 'local-mini-drama.episode-package',
      schema_version: '1.1',
      source_sha256: 'new',
      imported_at: '2026-09-06T00:00:00.000Z',
    });
    assert.equal(Object.hasOwn(drama.episodes[0].import_source, 'raw_json_text'), false);
    assert.equal(drama.episodes[0].scenes[0].state, 'night');
    assert.equal(drama.episodes[0].scenes[0].description, '凌晨的走廊');
    db.close();
  });
});
