const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { deleteCharacter } = require('../src/services/characterLibraryService');
const { deleteScene } = require('../src/services/sceneService');
const { deleteById: deleteProp } = require('../src/services/propService');

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE character_variants (id INTEGER PRIMARY KEY, character_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE episode_characters (episode_id INTEGER NOT NULL, character_id INTEGER NOT NULL);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE props (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, scene_id INTEGER, characters TEXT, deleted_at TEXT);
    CREATE TABLE storyboard_character_variants (storyboard_id INTEGER NOT NULL, character_id INTEGER NOT NULL, variant_id INTEGER NOT NULL);
    CREATE TABLE storyboard_characters (storyboard_id INTEGER NOT NULL, character_id INTEGER NOT NULL);
    CREATE TABLE storyboard_props (storyboard_id INTEGER NOT NULL, prop_id INTEGER NOT NULL);
  `);
  return db;
}

function insertFixture(db) {
  db.exec(`
    INSERT INTO dramas (id) VALUES (1), (2);
    INSERT INTO characters (id, drama_id) VALUES (11, 1), (12, 1), (21, 2);
    INSERT INTO character_variants (id, character_id) VALUES (111, 11), (112, 12), (121, 21);
    INSERT INTO episode_characters (episode_id, character_id) VALUES (101, 11), (101, 12), (201, 21);
    INSERT INTO scenes (id, drama_id) VALUES (31, 1), (32, 1), (41, 2);
    INSERT INTO props (id, drama_id) VALUES (51, 1), (52, 1), (61, 2);
    INSERT INTO storyboards (id, scene_id, characters) VALUES
      (1001, 31, '[11,12]'),
      (1002, 32, '[12]'),
      (2001, 41, '[21]');
    INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id) VALUES
      (1001, 11, 111), (1001, 12, 112), (2001, 21, 121);
    INSERT INTO storyboard_characters (storyboard_id, character_id) VALUES (1001, 11);
    INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (1001, 51), (1001, 52), (2001, 61);
  `);
}

test('character deletion clears only its episode, storyboard, and variant associations', () => {
  const db = createDb();
  insertFixture(db);

  assert.deepEqual(deleteCharacter(db, log, 11), { ok: true });

  assert.ok(db.prepare('SELECT deleted_at FROM characters WHERE id = 11').get().deleted_at);
  assert.deepEqual(db.prepare('SELECT character_id FROM episode_characters ORDER BY character_id').all(), [
    { character_id: 12 }, { character_id: 21 },
  ]);
  assert.deepEqual(JSON.parse(db.prepare('SELECT characters FROM storyboards WHERE id = 1001').get().characters), [12]);
  assert.equal(db.prepare('SELECT scene_id FROM storyboards WHERE id = 1001').get().scene_id, 31);
  assert.deepEqual(db.prepare('SELECT character_id FROM storyboard_character_variants ORDER BY character_id').all(), [
    { character_id: 12 }, { character_id: 21 },
  ]);
  assert.ok(db.prepare('SELECT deleted_at FROM character_variants WHERE id = 111').get().deleted_at);
  assert.equal(db.prepare('SELECT deleted_at FROM character_variants WHERE id = 112').get().deleted_at, null);
  assert.deepEqual(db.prepare('SELECT * FROM storyboard_characters').all(), [{ storyboard_id: 1001, character_id: 11 }]);
});

test('character deletion rolls back association cleanup when asset deletion fails', () => {
  const db = createDb();
  insertFixture(db);
  db.exec(`
    CREATE TRIGGER reject_character_delete BEFORE UPDATE OF deleted_at ON characters
    WHEN NEW.id = 11 BEGIN SELECT RAISE(ABORT, 'reject character delete'); END;
  `);

  assert.throws(() => deleteCharacter(db, log, 11), /reject character delete/);

  assert.deepEqual(db.prepare('SELECT character_id FROM episode_characters WHERE character_id = 11').all(), [{ character_id: 11 }]);
  assert.deepEqual(JSON.parse(db.prepare('SELECT characters FROM storyboards WHERE id = 1001').get().characters), [11, 12]);
  assert.deepEqual(db.prepare('SELECT character_id FROM storyboard_character_variants WHERE character_id = 11').all(), [{ character_id: 11 }]);
  assert.equal(db.prepare('SELECT deleted_at FROM character_variants WHERE id = 111').get().deleted_at, null);
});

test('scene deletion nulls only matching storyboard scene references', () => {
  const db = createDb();
  insertFixture(db);

  assert.deepEqual(deleteScene(db, log, 31), { ok: true });

  assert.ok(db.prepare('SELECT deleted_at FROM scenes WHERE id = 31').get().deleted_at);
  assert.equal(db.prepare('SELECT scene_id FROM storyboards WHERE id = 1001').get().scene_id, null);
  assert.equal(db.prepare('SELECT scene_id FROM storyboards WHERE id = 1002').get().scene_id, 32);
  assert.equal(db.prepare('SELECT scene_id FROM storyboards WHERE id = 2001').get().scene_id, 41);
});

test('prop deletion removes only matching storyboard prop links', () => {
  const db = createDb();
  insertFixture(db);

  assert.equal(deleteProp(db, log, 51), true);

  assert.ok(db.prepare('SELECT deleted_at FROM props WHERE id = 51').get().deleted_at);
  assert.deepEqual(db.prepare('SELECT prop_id FROM storyboard_props ORDER BY prop_id').all(), [
    { prop_id: 52 }, { prop_id: 61 },
  ]);
});

test('production asset deletion rejects an asset whose parent project is deleted without touching links', () => {
  const db = createDb();
  insertFixture(db);
  db.prepare("UPDATE dramas SET deleted_at = '2026-09-07T00:00:00.000Z' WHERE id = 1").run();

  assert.deepEqual(deleteCharacter(db, log, 11), { ok: false, error: 'unauthorized' });
  assert.deepEqual(deleteScene(db, log, 31), { ok: false, error: 'unauthorized' });
  assert.equal(deleteProp(db, log, 51), false);

  assert.equal(db.prepare('SELECT deleted_at FROM characters WHERE id = 11').get().deleted_at, null);
  assert.equal(db.prepare('SELECT deleted_at FROM scenes WHERE id = 31').get().deleted_at, null);
  assert.equal(db.prepare('SELECT deleted_at FROM props WHERE id = 51').get().deleted_at, null);
  assert.deepEqual(db.prepare('SELECT character_id FROM episode_characters WHERE character_id = 11').all(), [{ character_id: 11 }]);
  assert.equal(db.prepare('SELECT scene_id FROM storyboards WHERE id = 1001').get().scene_id, 31);
  assert.deepEqual(db.prepare('SELECT prop_id FROM storyboard_props WHERE prop_id = 51').all(), [{ prop_id: 51 }]);
});
