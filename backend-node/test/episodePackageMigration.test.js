const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

describe('episode package migration', () => {
  it('creates package tables and columns', () => {
    const db = new Database(':memory:');
    runMigrationsAndEnsure(db);
    for (const t of ['character_variants', 'storyboard_character_variants', 'episode_imports']) {
      assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t), t);
    }
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    assert.ok(cols('characters').includes('source_key'));
    assert.ok(cols('scenes').includes('state'));
    assert.ok(cols('storyboards').includes('audio_description'));
    assert.ok(cols('storyboards').includes('transition'));
  });
});
