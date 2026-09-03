const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  syncStoryboardVariantLinks,
  listStoryboardVariantLinks,
} = require('../src/services/storyboardVariantService');
const { updateStoryboard } = require('../src/services/storyboardService');

// 最小表结构:storyboards / characters / character_variants / storyboard_character_variants,
// 变体相关表与 migrations/30_episode_package_import.sql 保持一致(含两个唯一索引)。
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER,
      characters TEXT,
      deleted_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT,
      appearance TEXT,
      deleted_at TEXT
    );
    CREATE TABLE character_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      source_key TEXT,
      name TEXT NOT NULL,
      description TEXT,
      appearance TEXT,
      image_prompt TEXT,
      negative_prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      extra_images TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX idx_character_variants_key ON character_variants(character_id, source_key);
    CREATE TABLE storyboard_character_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      reference_role TEXT,
      sort_order INTEGER,
      framing_note TEXT
    );
    CREATE UNIQUE INDEX idx_sbv_variant ON storyboard_character_variants(storyboard_id, variant_id);
    CREATE UNIQUE INDEX idx_sbv_sort ON storyboard_character_variants(storyboard_id, sort_order) WHERE sort_order IS NOT NULL;
  `);
  return db;
}

function insertCharacter(db, name) {
  const info = db.prepare(
    'INSERT INTO characters (drama_id, name, description, appearance) VALUES (?, ?, ?, ?)'
  ).run(1, name, `desc-${name}`, `app-${name}`);
  return Number(info.lastInsertRowid);
}

function insertVariant(db, characterId, name, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO character_variants (character_id, source_key, name, image_url, local_path, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    characterId,
    overrides.source_key ?? `variant_${name}`,
    name,
    overrides.image_url ?? `/img/${name}.png`,
    overrides.local_path ?? `/static/${name}.png`,
    overrides.is_default ?? 0,
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z'
  );
  return Number(info.lastInsertRowid);
}

function insertStoryboard(db, characters = '[]') {
  const info = db.prepare(
    "INSERT INTO storyboards (episode_id, characters, updated_at) VALUES (1, ?, '2026-01-01T00:00:00.000Z')"
  ).run(characters);
  return Number(info.lastInsertRowid);
}

function rawLinks(db, storyboardId) {
  return db.prepare(
    'SELECT * FROM storyboard_character_variants WHERE storyboard_id = ? ORDER BY id'
  ).all(storyboardId);
}

function createLog() {
  const calls = { warn: [] };
  return {
    calls,
    info() {},
    warn(...args) { calls.warn.push(args); },
    error() {},
  };
}

describe('storyboardVariantService', () => {
  let db;
  let c1;
  let c2;
  let sbId;

  beforeEach(() => {
    db = createDb();
    c1 = insertCharacter(db, '张三');
    c2 = insertCharacter(db, '李四');
    sbId = insertStoryboard(db);
  });

  describe('syncStoryboardVariantLinks', () => {
    it('writes links and reads them back ordered by sort_order with joined names', () => {
      const v1 = insertVariant(db, c1, '常态', { is_default: 1 });
      const v2 = insertVariant(db, c1, '受伤');
      const v3 = insertVariant(db, c2, '西装');
      const result = syncStoryboardVariantLinks(db, sbId, [
        { character_id: c1, variant_id: v1, reference_role: '主角', sort_order: 1, framing_note: '正面特写' },
        { character_id: c2, variant_id: v3, reference_role: '配角', sort_order: 2, framing_note: null },
        { character_id: c1, variant_id: v2, reference_role: '主角', sort_order: 3, framing_note: '侧面' },
      ]);
      assert.equal(result.length, 3);
      assert.deepEqual(result.map((r) => r.sort_order), [1, 2, 3]);
      assert.deepEqual(result.map((r) => r.variant_name), ['常态', '西装', '受伤']);
      assert.deepEqual(result.map((r) => r.character_name), ['张三', '李四', '张三']);
      assert.deepEqual(result.map((r) => r.character_id), [c1, c2, c1]);
      assert.deepEqual(result.map((r) => r.variant_id), [v1, v3, v2]);
      assert.deepEqual(result.map((r) => r.reference_role), ['主角', '配角', '主角']);
      assert.deepEqual(result.map((r) => r.framing_note), ['正面特写', null, '侧面']);
      assert.equal(result[0].image_url, '/img/常态.png');
      assert.equal(result[0].local_path, '/static/常态.png');
      assert.equal(result[0].is_default, 1);
      assert.equal(result[1].is_default, 0);
      // 回读结果与 listStoryboardVariantLinks 一致
      assert.deepEqual(listStoryboardVariantLinks(db, sbId), result);
    });

    it('throws VARIANT_CHARACTER_MISMATCH when variant belongs to another character', () => {
      const vOther = insertVariant(db, c2, '西装');
      assert.throws(
        () => syncStoryboardVariantLinks(db, sbId, [
          { character_id: c1, variant_id: vOther, sort_order: 1 },
        ]),
        (e) => {
          assert.equal(e.code, 'VARIANT_CHARACTER_MISMATCH');
          return true;
        }
      );
      // 抛错前既有数据保持不变
      assert.equal(rawLinks(db, sbId).length, 0);
    });

    it('throws VARIANT_CHARACTER_MISMATCH when variant does not exist', () => {
      assert.throws(
        () => syncStoryboardVariantLinks(db, sbId, [{ character_id: c1, variant_id: 99999, sort_order: 1 }]),
        (e) => {
          assert.equal(e.code, 'VARIANT_CHARACTER_MISMATCH');
          return true;
        }
      );
    });

    it('throws VARIANT_SORT_ORDER_DUPLICATE on duplicate sort_order within one call', () => {
      const v1 = insertVariant(db, c1, '常态');
      const v2 = insertVariant(db, c1, '受伤');
      assert.throws(
        () => syncStoryboardVariantLinks(db, sbId, [
          { character_id: c1, variant_id: v1, sort_order: 2 },
          { character_id: c1, variant_id: v2, sort_order: 2 },
        ]),
        (e) => {
          assert.equal(e.code, 'VARIANT_SORT_ORDER_DUPLICATE');
          return true;
        }
      );
      assert.equal(rawLinks(db, sbId).length, 0);
    });

    it('projects storyboards.characters as the id array in links order (duplicates preserved)', () => {
      const v1 = insertVariant(db, c1, '常态');
      const v2 = insertVariant(db, c1, '受伤');
      const v3 = insertVariant(db, c2, '西装');
      syncStoryboardVariantLinks(db, sbId, [
        { character_id: c1, variant_id: v1, sort_order: 1 },
        { character_id: c1, variant_id: v2, sort_order: 2 },
        { character_id: c2, variant_id: v3, sort_order: 3 },
      ]);
      const raw = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(sbId);
      assert.deepEqual(JSON.parse(raw.characters), [c1, c1, c2]);
      assert.equal(raw.characters, JSON.stringify([c1, c1, c2]));
    });

    it('is idempotent: re-sync replaces all rows without residue', () => {
      const v1 = insertVariant(db, c1, '常态');
      const v2 = insertVariant(db, c2, '西装');
      // 预置一条脏数据,验证全删全插会清掉
      db.prepare(
        'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, sort_order) VALUES (?, ?, ?, ?)'
      ).run(sbId, c1, v1, 9);
      syncStoryboardVariantLinks(db, sbId, [
        { character_id: c1, variant_id: v1, sort_order: 1 },
        { character_id: c2, variant_id: v2, sort_order: 2 },
      ]);
      assert.equal(rawLinks(db, sbId).length, 2);
      // 重复调用:结果一致,无残留
      const again = syncStoryboardVariantLinks(db, sbId, [
        { character_id: c1, variant_id: v1, sort_order: 1 },
        { character_id: c2, variant_id: v2, sort_order: 2 },
      ]);
      assert.equal(again.length, 2);
      assert.equal(rawLinks(db, sbId).length, 2);
      // 换一组:旧关联全部消失
      const next = syncStoryboardVariantLinks(db, sbId, [
        { character_id: c2, variant_id: v2, sort_order: 1 },
      ]);
      assert.equal(next.length, 1);
      assert.equal(rawLinks(db, sbId).length, 1);
      assert.equal(next[0].variant_id, v2);
    });

    it('empty links clear all rows and project an empty array', () => {
      const v1 = insertVariant(db, c1, '常态');
      syncStoryboardVariantLinks(db, sbId, [{ character_id: c1, variant_id: v1, sort_order: 1 }]);
      const result = syncStoryboardVariantLinks(db, sbId, []);
      assert.deepEqual(result, []);
      assert.equal(rawLinks(db, sbId).length, 0);
      const raw = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(sbId);
      assert.equal(raw.characters, '[]');
    });

    it('throws on invalid sort_order (null / string)', () => {
      const v1 = insertVariant(db, c1, '常态');
      const v2 = insertVariant(db, c1, '受伤');
      assert.throws(
        () => syncStoryboardVariantLinks(db, sbId, [{ character_id: c1, variant_id: v1, sort_order: null }]),
        (e) => e.code === 'VARIANT_SORT_ORDER_DUPLICATE'
      );
      assert.throws(
        () => syncStoryboardVariantLinks(db, sbId, [{ character_id: c1, variant_id: v2, sort_order: '2' }]),
        (e) => e.code === 'VARIANT_SORT_ORDER_DUPLICATE'
      );
      assert.equal(rawLinks(db, sbId).length, 0);
    });

    it('does not leak rows across storyboards', () => {
      const v1 = insertVariant(db, c1, '常态');
      const otherSb = insertStoryboard(db);
      syncStoryboardVariantLinks(db, sbId, [{ character_id: c1, variant_id: v1, sort_order: 1 }]);
      assert.equal(listStoryboardVariantLinks(db, otherSb).length, 0);
    });
  });

  describe('listStoryboardVariantLinks ordering', () => {
    it('orders non-null sort_order first, nulls last, ties by id', () => {
      const v1 = insertVariant(db, c1, '常态');
      const v2 = insertVariant(db, c1, '受伤');
      const v3 = insertVariant(db, c2, '西装');
      // 直接插入以覆盖 NULL sort_order 分支(sync 要求非空)
      db.prepare(
        'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, sort_order) VALUES (?, ?, ?, 2)'
      ).run(sbId, c1, v2);
      db.prepare(
        'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, sort_order) VALUES (?, ?, ?, 1)'
      ).run(sbId, c1, v1);
      db.prepare(
        'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, sort_order) VALUES (?, ?, ?, NULL)'
      ).run(sbId, c2, v3);
      const rows = listStoryboardVariantLinks(db, sbId);
      assert.deepEqual(rows.map((r) => r.sort_order), [1, 2, null]);
    });
  });

  describe('updateStoryboard with character_variant_links', () => {
    it('syncs links and updates the characters projection', () => {
      const v1 = insertVariant(db, c1, '常态', { is_default: 1 });
      const v2 = insertVariant(db, c2, '西装');
      const log = createLog();
      const updated = updateStoryboard(db, log, sbId, {
        character_variant_links: [
          { character_id: c1, variant_id: v1, reference_role: '主角', sort_order: 1, framing_note: '特写' },
          { character_id: c2, variant_id: v2, reference_role: '配角', sort_order: 2, framing_note: null },
        ],
      });
      assert.equal(log.calls.warn.length, 0);
      assert.deepEqual(updated.characters, [c1, c2]);
      const rows = listStoryboardVariantLinks(db, sbId);
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => r.variant_name), ['常态', '西装']);
      assert.deepEqual(rows.map((r) => r.framing_note), ['特写', null]);
      const raw = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(sbId);
      assert.equal(raw.characters, JSON.stringify([c1, c2]));
    });

    it('warns but does not throw when links are invalid', () => {
      const log = createLog();
      const updated = updateStoryboard(db, log, sbId, {
        character_variant_links: [{ character_id: c1, variant_id: 99999, sort_order: 1 }],
      });
      assert.equal(log.calls.warn.length, 1);
      assert.ok(updated);
      assert.equal(rawLinks(db, sbId).length, 0);
    });

    it('accepts character_variant_links passed as a JSON string', () => {
      const v1 = insertVariant(db, c1, '常态');
      const log = createLog();
      const updated = updateStoryboard(db, log, sbId, {
        character_variant_links: JSON.stringify([{ character_id: c1, variant_id: v1, sort_order: 1 }]),
      });
      assert.equal(log.calls.warn.length, 0);
      assert.deepEqual(updated.characters, [c1]);
    });
  });
});
