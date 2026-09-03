const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  listVariants,
  createVariant,
  updateVariant,
  deleteVariant,
  ensureDefaultVariant,
  variantUsageCount,
} = require('../src/services/characterVariantsService');

// 最小表结构:characters(01_init.sql 裁剪)、character_variants / storyboard_character_variants
// 与 migrations/30_episode_package_import.sql 保持一致(含唯一索引)。
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT,
      appearance TEXT,
      image_url TEXT,
      local_path TEXT,
      extra_images TEXT,
      polished_prompt TEXT,
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
  `);
  return db;
}

function insertCharacter(db, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO characters (drama_id, name, description, appearance, image_url, local_path, extra_images, polished_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    overrides.drama_id ?? 1,
    overrides.name ?? '张三',
    overrides.description ?? '冷静的私家侦探',
    overrides.appearance ?? '穿灰色风衣的高个子男人',
    overrides.image_url ?? null,
    overrides.local_path ?? null,
    overrides.extra_images ?? null,
    overrides.polished_prompt ?? null
  );
  return Number(info.lastInsertRowid);
}

function linkVariant(db, storyboardId, characterId, variantId) {
  db.prepare(
    'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id) VALUES (?, ?, ?)'
  ).run(storyboardId, characterId, variantId);
}

describe('characterVariantsService', () => {
  let db;
  let characterId;

  beforeEach(() => {
    db = createDb();
    characterId = insertCharacter(db);
  });

  describe('createVariant', () => {
    it('first variant of a character defaults source_key to "default"', () => {
      const row = createVariant(db, { character_id: characterId, name: '常态' });
      assert.equal(row.source_key, 'default');
      assert.equal(row.character_id, characterId);
      assert.equal(row.name, '常态');
      assert.ok(row.id > 0);
      assert.ok(row.created_at);
      assert.ok(row.updated_at);
      assert.equal(row.is_default, 0);
    });

    it('subsequent variants get source_key "variant_(count+1)"', () => {
      createVariant(db, { character_id: characterId, name: '常态' });
      const second = createVariant(db, { character_id: characterId, name: '受伤' });
      const third = createVariant(db, { character_id: characterId, name: '礼服' });
      assert.equal(second.source_key, 'variant_2');
      assert.equal(third.source_key, 'variant_3');
    });

    it('soft-deleted variants still count toward source_key numbering (unique index safe)', () => {
      const first = createVariant(db, { character_id: characterId, name: '常态' });
      deleteVariant(db, first.id);
      const next = createVariant(db, { character_id: characterId, name: '受伤' });
      assert.equal(next.source_key, 'variant_2');
    });

    it('accepts an explicit source_key and persists given fields', () => {
      const row = createVariant(db, {
        character_id: characterId,
        source_key: 'imported_state_1',
        name: '雨夜',
        description: '淋湿的样子',
        appearance: '湿透的风衣',
        image_prompt: 'wet coat, night',
        negative_prompt: 'blurry',
      });
      assert.equal(row.source_key, 'imported_state_1');
      assert.equal(row.description, '淋湿的样子');
      assert.equal(row.appearance, '湿透的风衣');
      assert.equal(row.image_prompt, 'wet coat, night');
      assert.equal(row.negative_prompt, 'blurry');
      assert.equal(row.is_default, 0);
    });

    it('creating a new default clears the previous default of the same character', () => {
      const a = createVariant(db, { character_id: characterId, name: '常态', is_default: 1 });
      const b = createVariant(db, { character_id: characterId, name: '受伤', is_default: 1 });
      const rows = listVariants(db, characterId);
      const byId = new Map(rows.map((r) => [r.id, r]));
      assert.equal(byId.get(a.id).is_default, 0);
      assert.equal(byId.get(b.id).is_default, 1);
      assert.equal(rows.filter((r) => r.is_default === 1).length, 1);
    });

    it('default clearing stays within one character', () => {
      const otherId = insertCharacter(db, { name: '李四' });
      const a = createVariant(db, { character_id: characterId, name: '常态', is_default: 1 });
      const b = createVariant(db, { character_id: otherId, name: '常态', is_default: 1 });
      const aRow = listVariants(db, characterId).find((r) => r.id === a.id);
      const bRow = listVariants(db, otherId).find((r) => r.id === b.id);
      assert.equal(aRow.is_default, 1);
      assert.equal(bRow.is_default, 1);
    });
  });

  describe('listVariants', () => {
    it('hides deleted rows, orders default first then by id, and parses extra_images', () => {
      const a = createVariant(db, { character_id: characterId, name: '常态' });
      const b = createVariant(db, { character_id: characterId, name: '受伤' });
      const c = createVariant(db, { character_id: characterId, name: '礼服' });
      updateVariant(db, b.id, { is_default: 1, extra_images: ['/static/x1.png', '/static/x2.png'] });
      deleteVariant(db, a.id);
      const rows = listVariants(db, characterId);
      assert.deepEqual(rows.map((r) => r.id), [b.id, c.id]);
      assert.equal(rows[0].is_default, 1);
      assert.deepEqual(rows[0].extra_images, ['/static/x1.png', '/static/x2.png']);
      assert.equal(rows[1].extra_images, null);
    });

    it('does not leak other characters variants', () => {
      const otherId = insertCharacter(db, { name: '李四' });
      createVariant(db, { character_id: characterId, name: '常态' });
      createVariant(db, { character_id: otherId, name: '常态' });
      assert.equal(listVariants(db, characterId).length, 1);
      assert.equal(listVariants(db, otherId).length, 1);
    });
  });

  describe('updateVariant', () => {
    it('applies only whitelisted fields and returns the updated row', () => {
      const row = createVariant(db, { character_id: characterId, name: '常态' });
      const updated = updateVariant(db, row.id, {
        name: '常态2',
        description: 'desc',
        appearance: 'app',
        image_prompt: 'ip',
        negative_prompt: 'np',
        source_key: 'custom_key',
        character_id: 999, // 非白名单,应被忽略
        id: 12345, // 非白名单,应被忽略
        deleted_at: 'hack', // 非白名单,应被忽略
      });
      assert.equal(updated.id, row.id);
      assert.equal(updated.name, '常态2');
      assert.equal(updated.description, 'desc');
      assert.equal(updated.appearance, 'app');
      assert.equal(updated.image_prompt, 'ip');
      assert.equal(updated.negative_prompt, 'np');
      assert.equal(updated.source_key, 'custom_key');
      assert.equal(updated.character_id, characterId);
      assert.equal(updated.deleted_at, null);
    });

    it('switching is_default clears other defaults of the same character', () => {
      const a = createVariant(db, { character_id: characterId, name: '常态', is_default: 1 });
      const b = createVariant(db, { character_id: characterId, name: '受伤' });
      updateVariant(db, b.id, { is_default: 1 });
      const byId = new Map(listVariants(db, characterId).map((r) => [r.id, r]));
      assert.equal(byId.get(a.id).is_default, 0);
      assert.equal(byId.get(b.id).is_default, 1);
    });

    it('accepts image_url / local_path / extra_images (array is stored as JSON)', () => {
      const row = createVariant(db, { character_id: characterId, name: '常态' });
      const updated = updateVariant(db, row.id, {
        image_url: 'http://example.com/y.png',
        local_path: '/static/y.png',
        extra_images: ['/static/y-1.png'],
      });
      assert.equal(updated.image_url, 'http://example.com/y.png');
      assert.equal(updated.local_path, '/static/y.png');
      assert.deepEqual(updated.extra_images, ['/static/y-1.png']);
    });

    it('returns null for missing or deleted variant', () => {
      const row = createVariant(db, { character_id: characterId, name: '常态' });
      assert.equal(updateVariant(db, 99999, { name: 'x' }), null);
      deleteVariant(db, row.id);
      assert.equal(updateVariant(db, row.id, { name: 'x' }), null);
    });
  });

  describe('deleteVariant', () => {
    it('soft-deletes an unreferenced variant', () => {
      const row = createVariant(db, { character_id: characterId, name: '常态' });
      const result = deleteVariant(db, row.id);
      assert.equal(result.ok, true);
      assert.equal(result.id, row.id);
      assert.equal(listVariants(db, characterId).length, 0);
      const raw = db.prepare('SELECT deleted_at FROM character_variants WHERE id = ?').get(row.id);
      assert.ok(raw.deleted_at);
    });

    it('throws VARIANT_IN_USE when referenced by storyboard_character_variants', () => {
      const row = createVariant(db, { character_id: characterId, name: '常态' });
      linkVariant(db, 11, characterId, row.id);
      assert.throws(() => deleteVariant(db, row.id), (e) => {
        assert.equal(e.code, 'VARIANT_IN_USE');
        return true;
      });
      const raw = db.prepare('SELECT deleted_at FROM character_variants WHERE id = ?').get(row.id);
      assert.equal(raw.deleted_at, null);
    });

    it('returns null for missing variant', () => {
      assert.equal(deleteVariant(db, 99999), null);
    });
  });

  describe('variantUsageCount', () => {
    it('counts storyboard references', () => {
      const row = createVariant(db, { character_id: characterId, name: '常态' });
      assert.equal(variantUsageCount(db, row.id), 0);
      linkVariant(db, 11, characterId, row.id);
      linkVariant(db, 12, characterId, row.id);
      assert.equal(variantUsageCount(db, row.id), 2);
    });
  });

  describe('ensureDefaultVariant', () => {
    it('creates a default variant copied from the characters table', () => {
      const row = ensureDefaultVariant(db, characterId);
      assert.equal(row.source_key, 'default');
      assert.equal(row.name, '默认');
      assert.equal(row.description, '冷静的私家侦探');
      assert.equal(row.appearance, '穿灰色风衣的高个子男人');
      assert.equal(row.is_default, 1);
    });

    it('is idempotent: returns the same row without creating duplicates', () => {
      const first = ensureDefaultVariant(db, characterId);
      const second = ensureDefaultVariant(db, characterId);
      assert.equal(second.id, first.id);
      const rows = listVariants(db, characterId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].is_default, 1);
    });

    it('returns the existing default variant directly', () => {
      const existing = createVariant(db, { character_id: characterId, name: '常态', is_default: 1 });
      const row = ensureDefaultVariant(db, characterId);
      assert.equal(row.id, existing.id);
      assert.equal(listVariants(db, characterId).length, 1);
    });

    it('keeps other characters defaults untouched', () => {
      const otherId = insertCharacter(db, { name: '李四', description: 'd2', appearance: 'a2' });
      const a = ensureDefaultVariant(db, characterId);
      const b = ensureDefaultVariant(db, otherId);
      assert.notEqual(a.id, b.id);
      assert.equal(b.character_id, otherId);
      assert.equal(b.description, 'd2');
    });

    it('revives a soft-deleted "default" variant instead of violating the unique index', () => {
      const first = ensureDefaultVariant(db, characterId);
      deleteVariant(db, first.id);
      const again = ensureDefaultVariant(db, characterId);
      assert.equal(again.id, first.id);
      assert.equal(again.is_default, 1);
      assert.equal(again.name, '默认');
      assert.equal(again.deleted_at, null);
      assert.equal(listVariants(db, characterId).length, 1);
    });

    // --- spec §13:default 状态复用现有人物图片与提示词字段 ---

    it('copies image_url/local_path/extra_images and polished_prompt -> image_prompt on create', () => {
      const cid = insertCharacter(db, {
        name: '李四',
        image_url: 'http://x/li.png',
        local_path: '/static/li.png',
        extra_images: '["/static/li2.png"]',
        polished_prompt: 'masterpiece, grey coat detective',
      });
      const row = ensureDefaultVariant(db, cid);
      assert.equal(row.image_url, 'http://x/li.png');
      assert.equal(row.local_path, '/static/li.png');
      assert.deepEqual(row.extra_images, ['/static/li2.png']); // parseVariantRow 将 JSON 解析为数组
      assert.equal(row.image_prompt, 'masterpiece, grey coat detective');
    });

    it('falls back to appearance+description concat for image_prompt when polished_prompt empty', () => {
      const row = ensureDefaultVariant(db, characterId);
      assert.equal(row.image_prompt, '穿灰色风衣的高个子男人, 冷静的私家侦探');

      const sparse = insertCharacter(db, { name: '王五', appearance: '', description: '只有描述' });
      const row2 = ensureDefaultVariant(db, sparse);
      assert.equal(row2.image_prompt, '只有描述');

      const blank = insertCharacter(db, { name: '赵六', appearance: '', description: '' });
      const row3 = ensureDefaultVariant(db, blank);
      assert.equal(row3.image_prompt, null);
    });

    it('revive fills only empty fields and never overwrites user-modified values', () => {
      const cid = insertCharacter(db, {
        name: '钱七',
        image_url: 'http://x/qian.png',
        local_path: '/static/qian-main.png',
        polished_prompt: 'polished prompt text',
      });
      const first = ensureDefaultVariant(db, cid);
      // 用户在删除前改过 local_path 与 image_prompt
      updateVariant(db, first.id, { local_path: '/static/user-changed.png', image_prompt: 'user custom prompt' });
      deleteVariant(db, first.id);

      const again = ensureDefaultVariant(db, cid);
      assert.equal(again.id, first.id);
      assert.equal(again.local_path, '/static/user-changed.png'); // 用户值保留
      assert.equal(again.image_prompt, 'user custom prompt'); // 用户值保留
      assert.equal(again.image_url, 'http://x/qian.png'); // 空字段补齐
    });

    it('returns an existing default untouched (no image copy over user values)', () => {
      const cid = insertCharacter(db, { name: '孙八', local_path: '/static/sun.png' });
      const created = ensureDefaultVariant(db, cid);
      updateVariant(db, created.id, { image_prompt: '用户手改的提示词', local_path: null });
      const again = ensureDefaultVariant(db, cid);
      assert.equal(again.id, created.id);
      assert.equal(again.image_prompt, '用户手改的提示词');
      assert.equal(again.local_path, null); // 已有默认不回填角色主图
    });
  });
});
