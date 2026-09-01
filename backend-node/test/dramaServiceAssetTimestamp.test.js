const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const dramaService = require('../src/services/dramaService');

describe('drama asset lists expose image_updated_at', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dramas (id INTEGER PRIMARY KEY, title TEXT, metadata TEXT, deleted_at TEXT, updated_at TEXT, created_at TEXT);
      CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, title TEXT, episode_number INTEGER, sort_order INTEGER, synopsis TEXT, status TEXT, deleted_at TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE image_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, drama_id INTEGER, scene_id INTEGER, character_id INTEGER, provider TEXT, prompt TEXT, image_url TEXT, local_path TEXT, status TEXT, error_msg TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, role TEXT, appearance TEXT, description TEXT,
        personality TEXT, voice_style TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, ref_image TEXT, reference_images TEXT,
        seed_value TEXT, sort_order INTEGER, error_msg TEXT, polished_prompt TEXT, negative_prompt TEXT, four_view_image_url TEXT,
        seedance2_asset TEXT, seedance2_voice_asset TEXT, image_updated_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
      CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER, location TEXT, time TEXT, prompt TEXT, polished_prompt TEXT,
        negative_prompt TEXT, storyboard_count INTEGER, image_url TEXT, local_path TEXT, extra_images TEXT, ref_image TEXT,
        status TEXT, error_msg TEXT, image_updated_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
      CREATE TABLE props (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, type TEXT, description TEXT, prompt TEXT,
        image_url TEXT, local_path TEXT, extra_images TEXT, ref_image TEXT, negative_prompt TEXT, error_msg TEXT,
        image_updated_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
      INSERT INTO dramas (id, title, created_at, updated_at) VALUES (7, 'D7', datetime('now'), datetime('now'));
      INSERT INTO characters (id, drama_id, name, image_updated_at, created_at, updated_at) VALUES (1, 7, 'A', '2026-09-01T03:42:54.566Z', datetime('now'), datetime('now'));
      INSERT INTO scenes (id, drama_id, location, image_updated_at, created_at, updated_at) VALUES (2, 7, 'S', '2026-09-01T03:47:14.000Z', datetime('now'), datetime('now'));
      INSERT INTO props (id, drama_id, name, image_updated_at, created_at, updated_at) VALUES (3, 7, 'P', '2026-09-01T03:44:00.000Z', datetime('now'), datetime('now'));
    `);
  });
  afterEach(() => db.close());

  it('passes image_updated_at through character, scene and prop lists', () => {
    const chars = dramaService.getCharacters(db, 7);
    assert.equal(chars[0].image_updated_at, '2026-09-01T03:42:54.566Z');
    const drama = dramaService.getDrama(db, 7);
    assert.equal(drama.scenes[0].image_updated_at, '2026-09-01T03:47:14.000Z');
    assert.equal(drama.props[0].image_updated_at, '2026-09-01T03:44:00.000Z');
  });
});
