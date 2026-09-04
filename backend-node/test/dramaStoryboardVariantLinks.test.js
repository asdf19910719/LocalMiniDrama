const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaService = require('../src/services/dramaService');

describe('drama storyboard payload exposes persisted character variant links', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrationsAndEnsure(db);
    const now = '2026-09-05T00:00:00.000Z';
    db.prepare("INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (7, 'D7', 'draft', ?, ?)").run(now, now);
    db.prepare("INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (10, 7, 1, 'E1', 'draft', ?, ?)").run(now, now);
    db.prepare("INSERT INTO storyboards (id, episode_id, storyboard_number, title, characters, status, created_at, updated_at) VALUES (4, 10, 1, 'S1', '[1,2]', 'pending', ?, ?)").run(now, now);
    db.prepare("INSERT INTO characters (id, drama_id, name, sort_order, created_at, updated_at) VALUES (1, 7, 'A', 1, ?, ?)").run(now, now);
    db.prepare("INSERT INTO characters (id, drama_id, name, sort_order, created_at, updated_at) VALUES (2, 7, 'B', 2, ?, ?)").run(now, now);
    db.prepare(`INSERT INTO character_variants
      (id, character_id, source_key, name, image_url, local_path, is_default, created_at, updated_at)
      VALUES (11, 1, 'a_work', '工作状态', '/a-remote.png', 'variants/a-work.png', 1, ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO character_variants
      (id, character_id, source_key, name, image_url, local_path, is_default, created_at, updated_at)
      VALUES (22, 2, 'b_home', '居家状态', '/b-remote.png', 'variants/b-home.png', 1, ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO storyboard_character_variants
      (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note)
      VALUES (4, 1, 11, 'lead', 2, '近景')`).run();
    db.prepare(`INSERT INTO storyboard_character_variants
      (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note)
      VALUES (4, 2, 22, 'supporting', 1, '半身')`).run();
  });

  afterEach(() => db.close());

  function expectedLinks() {
    return [
      { id: 2, storyboard_id: 4, character_id: 2, variant_id: 22, reference_role: 'supporting', sort_order: 1, framing_note: '半身', variant_name: '居家状态', character_name: 'B', image_url: '/b-remote.png', local_path: 'variants/b-home.png', is_default: 1 },
      { id: 1, storyboard_id: 4, character_id: 1, variant_id: 11, reference_role: 'lead', sort_order: 2, framing_note: '近景', variant_name: '工作状态', character_name: 'A', image_url: '/a-remote.png', local_path: 'variants/a-work.png', is_default: 1 },
    ];
  }

  it('includes ordered link identity, metadata, and selected-state images in getDrama', () => {
    const storyboard = dramaService.getDrama(db, 7).episodes[0].storyboards[0];
    assert.deepEqual(storyboard.character_variant_links, expectedLinks());
  });

  it('includes the same ordered links in listDramas payloads', () => {
    const storyboard = dramaService.listDramas(db, {}).dramas[0].episodes[0].storyboards[0];
    assert.deepEqual(storyboard.character_variant_links, expectedLinks());
  });
});
