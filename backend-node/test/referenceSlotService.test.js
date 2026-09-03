const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');

const referenceSlotService = require('../src/services/referenceSlotService');
const storyboardRouteHandlers = require('../src/routes/storyboards');

// 最小表结构:与 01_init.sql / migrations/30_episode_package_import.sql 的相关列保持一致。
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER,
      characters TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      location TEXT,
      state TEXT,
      image_url TEXT,
      local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
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
      updated_at TEXT,
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
    CREATE TABLE props (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER NOT NULL,
      prop_id INTEGER NOT NULL,
      PRIMARY KEY (storyboard_id, prop_id)
    );
  `);
  return db;
}

const T0 = '2026-01-01T00:00:00.000Z';

function insertStoryboard(db, { scene_id = null, characters = null, deleted_at = null } = {}) {
  const info = db.prepare(
    'INSERT INTO storyboards (episode_id, scene_id, characters, updated_at, deleted_at) VALUES (1, ?, ?, ?, ?)'
  ).run(scene_id, characters, T0, deleted_at);
  return Number(info.lastInsertRowid);
}

function insertScene(db, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO scenes (drama_id, location, state, image_url, local_path, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    1,
    overrides.location !== undefined ? overrides.location : '客厅',
    overrides.state !== undefined ? overrides.state : '夜',
    overrides.image_url ?? null,
    overrides.local_path ?? null,
    overrides.updated_at ?? T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function insertCharacter(db, name, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO characters (drama_id, name, image_url, local_path, polished_prompt, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    1,
    name,
    overrides.image_url ?? null,
    overrides.local_path ?? null,
    overrides.polished_prompt ?? null,
    T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function insertVariant(db, characterId, name, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO character_variants (character_id, source_key, name, image_url, local_path, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    characterId,
    overrides.source_key ?? `variant_${name}`,
    name,
    overrides.image_url ?? null,
    overrides.local_path ?? null,
    T0,
    overrides.updated_at ?? T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function linkVariant(db, storyboardId, characterId, variantId, overrides = {}) {
  db.prepare(
    `INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(storyboardId, characterId, variantId, overrides.reference_role ?? null, overrides.sort_order ?? null, overrides.framing_note ?? null);
}

function insertProp(db, name, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO props (drama_id, name, image_url, local_path, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    1,
    name,
    overrides.image_url ?? null,
    overrides.local_path ?? null,
    overrides.updated_at ?? T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function linkProp(db, storyboardId, propId) {
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)').run(storyboardId, propId);
}

/** 把 handler 挂到与 index.js 相同的路径上,直接当 middleware 调用(handler 全同步) */
function buildRouter(db) {
  const log = { info() {}, warn() {}, error() {} };
  const handlers = storyboardRouteHandlers(db, log);
  const r = express.Router();
  r.get('/storyboards/:id/reference-slots', handlers.referenceSlots);
  return r;
}

function callRoute(router, url) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  router({ method: 'GET', url }, res, () => {});
  return res;
}

describe('resolveStoryboardSlots', () => {
  let db;

  beforeEach(() => {
    db = createDb();
  });

  it('fixed order: scene -> variants by sort_order -> props, with 1-based indexes', () => {
    const sceneId = insertScene(db, { location: '客厅', state: '夜', local_path: '/static/scene.png', image_url: 'http://x/scene.png' });
    const sbId = insertStoryboard(db, { scene_id: sceneId });
    const c1 = insertCharacter(db, '张三');
    // 乱序插入:sort_order 2 先插入,1 后插入 → 解析必须按 sort_order 升序
    const v2 = insertVariant(db, c1, '受伤', { local_path: '/static/v2.png' });
    const v1 = insertVariant(db, c1, '常态', { local_path: '/static/v1.png' });
    linkVariant(db, sbId, c1, v2, { sort_order: 2, reference_role: '主角', framing_note: '侧面' });
    linkVariant(db, sbId, c1, v1, { sort_order: 1, reference_role: '主角', framing_note: '正面' });
    const propId = insertProp(db, '手枪', { local_path: '/static/prop.png' });
    linkProp(db, sbId, propId);

    const { slots, total, overflow } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 4);
    assert.deepEqual(overflow, []);
    assert.deepEqual(slots.map((s) => s.index), [1, 2, 3, 4]);
    assert.deepEqual(slots.map((s) => s.type), ['scene', 'character_variant', 'character_variant', 'prop']);

    // 场景槽位:名称 = location·state,图片 local_path 优先
    assert.equal(slots[0].type, 'scene');
    assert.equal(slots[0].asset_id, sceneId);
    assert.equal(slots[0].variant_id, null);
    assert.equal(slots[0].name, '客厅·夜');
    assert.equal(slots[0].image_url, '/static/scene.png');
    assert.equal(slots[0].image_available, true);
    assert.equal(slots[0].image_version, T0);
    assert.equal(slots[0].reference_role, null);

    // 状态槽位:按 sort_order 升序,透传 reference_role/framing_note
    assert.equal(slots[1].variant_id, v1);
    assert.equal(slots[1].name, '常态');
    assert.equal(slots[1].reference_role, '主角');
    assert.equal(slots[1].framing_note, '正面');
    assert.equal(slots[2].variant_id, v2);
    assert.equal(slots[2].framing_note, '侧面');

    // 道具槽位
    assert.equal(slots[3].asset_id, propId);
    assert.equal(slots[3].name, '手枪');
    assert.equal(slots[3].variant_id, null);
    assert.equal(slots[3].image_available, true);
  });

  it('missing image occupies its slot (image_available=false) and later slots keep their indexes', () => {
    const sbId = insertStoryboard(db); // 无 scene_id → 从状态开始编号 1
    const c1 = insertCharacter(db, '张三');
    const vNoImg = insertVariant(db, c1, '受伤'); // 无任何图片
    linkVariant(db, sbId, c1, vNoImg, { sort_order: 1 });
    const propId = insertProp(db, '手枪', { local_path: '/static/prop.png' });
    linkProp(db, sbId, propId);

    const { slots, total } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 2);
    assert.equal(slots[0].index, 1);
    assert.equal(slots[0].type, 'character_variant');
    assert.equal(slots[0].image_url, null);
    assert.equal(slots[0].image_available, false);
    // 缺图不跳过:道具不前移,仍占 index 2
    assert.equal(slots[1].index, 2);
    assert.equal(slots[1].type, 'prop');
    assert.equal(slots[1].asset_id, propId);
    assert.equal(slots[1].image_available, true);
  });

  it('soft-deleted scene is skipped', () => {
    const sceneId = insertScene(db, { deleted_at: T0 });
    const sbId = insertStoryboard(db, { scene_id: sceneId });
    const c1 = insertCharacter(db, '张三');
    const v1 = insertVariant(db, c1, '常态', { local_path: '/static/v1.png' });
    linkVariant(db, sbId, c1, v1, { sort_order: 1 });

    const { slots, total } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 1);
    assert.equal(slots[0].index, 1);
    assert.equal(slots[0].type, 'character_variant');
  });

  it('soft-deleted variant still occupies its slot with image_available=false', () => {
    const sbId = insertStoryboard(db);
    const c1 = insertCharacter(db, '张三');
    const vDeleted = insertVariant(db, c1, '受伤', { local_path: '/static/v-del.png', deleted_at: T0 });
    const vAlive = insertVariant(db, c1, '常态', { local_path: '/static/v1.png' });
    linkVariant(db, sbId, c1, vDeleted, { sort_order: 1 });
    linkVariant(db, sbId, c1, vAlive, { sort_order: 2 });

    const { slots, total } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 2);
    assert.equal(slots[0].variant_id, vDeleted);
    // 图片地址仍取关联查询出的值,但软删状态标记为不可用
    assert.equal(slots[0].image_url, '/static/v-del.png');
    assert.equal(slots[0].image_available, false);
    assert.equal(slots[1].index, 2);
    assert.equal(slots[1].image_available, true);
  });

  it('soft-deleted prop is skipped', () => {
    const sbId = insertStoryboard(db);
    const pDeleted = insertProp(db, '旧道具', { local_path: '/static/p0.png', deleted_at: T0 });
    const pAlive = insertProp(db, '手枪', { local_path: '/static/p1.png' });
    linkProp(db, sbId, pDeleted);
    linkProp(db, sbId, pAlive);

    const { slots, total } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 1);
    assert.equal(slots[0].asset_id, pAlive);
    assert.equal(slots[0].type, 'prop');
  });

  it('overflow: 11 slots with maxSlots=9 -> total=11, overflow holds slots 10 and 11, slots intact', () => {
    const sbId = insertStoryboard(db);
    const c1 = insertCharacter(db, '张三');
    for (let i = 1; i <= 10; i++) {
      const v = insertVariant(db, c1, `状态${i}`, { source_key: `sk_${i}`, local_path: `/static/v${i}.png` });
      linkVariant(db, sbId, c1, v, { sort_order: i });
    }
    const propId = insertProp(db, '手枪', { local_path: '/static/prop.png' });
    linkProp(db, sbId, propId);

    const { slots, total, overflow } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 11);
    assert.equal(slots.length, 11);
    assert.deepEqual(slots.map((s) => s.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal(overflow.length, 2);
    assert.equal(overflow[0].index, 10);
    assert.equal(overflow[0].type, 'character_variant');
    assert.equal(overflow[1].index, 11);
    assert.equal(overflow[1].type, 'prop');
    // slots 本身完整返回(不静默截断)
    assert.deepEqual(slots[9], overflow[0]);
    assert.deepEqual(slots[10], overflow[1]);
  });

  it('respects a custom maxSlots option', () => {
    const sbId = insertStoryboard(db);
    const c1 = insertCharacter(db, '张三');
    for (let i = 1; i <= 3; i++) {
      const v = insertVariant(db, c1, `状态${i}`, { source_key: `sk_${i}` });
      linkVariant(db, sbId, c1, v, { sort_order: i });
    }
    const { total, overflow } = referenceSlotService.resolveStoryboardSlots(db, sbId, { maxSlots: 2 });
    assert.equal(total, 3);
    assert.equal(overflow.length, 1);
    assert.equal(overflow[0].index, 3);
  });

  it('scene name falls back to the single non-empty field', () => {
    const sceneId = insertScene(db, { location: '客厅', state: null, local_path: '/static/scene.png' });
    const sbId = insertStoryboard(db, { scene_id: sceneId });
    const { slots } = referenceSlotService.resolveStoryboardSlots(db, sbId);
    assert.equal(slots[0].name, '客厅');
  });

  // --- spec §13:旧版 sb.characters JSON 绑定的存量分镜 → 懒加载 default 状态合成人物槽 ---

  it('legacy storyboard (no variant links) synthesizes character slots from sb.characters JSON order', () => {
    const zhangId = insertCharacter(db, '张三', { local_path: '/static/zhang.png', polished_prompt: 'zhang prompt' });
    const liId = insertCharacter(db, '李四', { image_url: 'http://x/li.png' });
    // 插入顺序与 JSON 序相反,验证槽位按 JSON 序
    const sbId = insertStoryboard(db, {
      characters: JSON.stringify([{ id: zhangId, name: '张三' }, { id: liId, name: '李四' }]),
    });

    const { slots, total } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 2);
    assert.deepEqual(slots.map((s) => s.type), ['character_variant', 'character_variant']);
    assert.equal(slots[0].name, '张三·默认');
    assert.equal(slots[0].asset_id, zhangId);
    assert.equal(slots[0].image_url, '/static/zhang.png');
    assert.equal(slots[0].image_available, true);
    assert.equal(slots[1].name, '李四·默认');
    assert.equal(slots[1].image_url, 'http://x/li.png');
    // 懒加载:default 状态确实落库
    const defaults = db.prepare('SELECT character_id, is_default, deleted_at FROM character_variants').all();
    assert.equal(defaults.length, 2);
    assert.ok(defaults.every((r) => r.is_default === 1 && r.deleted_at === null));
    // 只读合成:不写 storyboard_character_variants 关联
    const links = db.prepare('SELECT COUNT(*) AS c FROM storyboard_character_variants').get().c;
    assert.equal(links, 0);
  });

  it('legacy fallback skips soft-deleted characters; imageless ones keep placeholder slots', () => {
    const aliveWithImage = insertCharacter(db, '张三', { local_path: '/static/zhang.png' });
    const imageless = insertCharacter(db, '李四');
    const dead = insertCharacter(db, '王五', { local_path: '/static/wang.png', deleted_at: T0 });
    const sbId = insertStoryboard(db, {
      characters: JSON.stringify([{ id: aliveWithImage }, { id: imageless }, { id: dead }]),
    });

    const { slots, total } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 2);
    assert.equal(slots[0].name, '张三·默认');
    assert.equal(slots[0].image_available, true);
    assert.equal(slots[1].name, '李四·默认');
    assert.equal(slots[1].image_available, false); // 无图仍占位
    assert.equal(slots[1].image_url, null);
  });

  it('supports plain id arrays in sb.characters JSON', () => {
    const c1 = insertCharacter(db, '张三', { local_path: '/static/zhang.png' });
    const sbId = insertStoryboard(db, { characters: JSON.stringify([c1]) });
    const { slots } = referenceSlotService.resolveStoryboardSlots(db, sbId);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].name, '张三·默认');
  });

  it('formal variant links win: legacy JSON characters are ignored, no extra defaults created', () => {
    const linked = insertCharacter(db, '张三');
    const jsonOnly = insertCharacter(db, '李四', { local_path: '/static/li.png' });
    const v1 = insertVariant(db, linked, '常态', { local_path: '/static/v1.png' });
    const sbId = insertStoryboard(db, {
      characters: JSON.stringify([{ id: jsonOnly }]),
    });
    linkVariant(db, sbId, linked, v1, { sort_order: 1 });

    const { slots, total } = referenceSlotService.resolveStoryboardSlots(db, sbId);

    assert.equal(total, 1);
    assert.equal(slots[0].variant_id, v1);
    assert.equal(slots[0].name, '常态');
    const defaults = db.prepare('SELECT COUNT(*) AS c FROM character_variants WHERE character_id = ?').get(jsonOnly).c;
    assert.equal(defaults, 0); // 未为 JSON-only 角色懒加载
  });

  it('throws STORYBOARD_NOT_FOUND for missing or soft-deleted storyboard', () => {
    assert.throws(
      () => referenceSlotService.resolveStoryboardSlots(db, 99999),
      (e) => e.code === 'STORYBOARD_NOT_FOUND'
    );
    const sbId = insertStoryboard(db, { deleted_at: T0 });
    assert.throws(
      () => referenceSlotService.resolveStoryboardSlots(db, sbId),
      (e) => e.code === 'STORYBOARD_NOT_FOUND'
    );
  });
});

describe('slotsFingerprint', () => {
  const slots = [
    { index: 1, type: 'scene', asset_id: 1, variant_id: null, name: '客厅·夜', image_url: '/a.png', image_available: true, image_version: T0 },
    { index: 2, type: 'character_variant', asset_id: 5, variant_id: 9, name: '常态', image_url: null, image_available: false, image_version: T0 },
  ];

  it('is deterministic for identical slots (key order independent)', () => {
    const a = referenceSlotService.slotsFingerprint(slots);
    const b = referenceSlotService.slotsFingerprint(slots);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
    // 键插入顺序不同也应得到同一指纹(canonical JSON)
    const reordered = slots.map((s) => ({
      image_version: s.image_version,
      image_available: s.image_available,
      image_url: s.image_url,
      name: s.name,
      variant_id: s.variant_id,
      asset_id: s.asset_id,
      type: s.type,
      index: s.index,
    }));
    assert.equal(referenceSlotService.slotsFingerprint(reordered), a);
  });

  it('changes when image_url changes', () => {
    const base = referenceSlotService.slotsFingerprint(slots);
    const changed = JSON.parse(JSON.stringify(slots));
    changed[0].image_url = '/b.png';
    assert.notEqual(referenceSlotService.slotsFingerprint(changed), base);
  });

  it('changes when image_version changes', () => {
    const base = referenceSlotService.slotsFingerprint(slots);
    const changed = JSON.parse(JSON.stringify(slots));
    changed[1].image_version = '2026-02-02T00:00:00.000Z';
    assert.notEqual(referenceSlotService.slotsFingerprint(changed), base);
  });
});

describe('GET /storyboards/:id/reference-slots', () => {
  let db;
  let router;

  beforeEach(() => {
    db = createDb();
    router = buildRouter(db);
  });

  it('returns 200 with slots, total, overflow and fingerprint', () => {
    const sceneId = insertScene(db, { local_path: '/static/scene.png' });
    const sbId = insertStoryboard(db, { scene_id: sceneId });
    const c1 = insertCharacter(db, '张三');
    const v1 = insertVariant(db, c1, '常态', { local_path: '/static/v1.png' });
    linkVariant(db, sbId, c1, v1, { sort_order: 1 });

    const res = callRoute(router, `/storyboards/${sbId}/reference-slots`);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    const data = res.body.data;
    assert.equal(data.total, 2);
    assert.deepEqual(data.overflow, []);
    assert.deepEqual(data.slots.map((s) => s.type), ['scene', 'character_variant']);
    assert.equal(data.fingerprint, referenceSlotService.slotsFingerprint(data.slots));
  });

  it('returns 404 when storyboard does not exist', () => {
    const res = callRoute(router, '/storyboards/99999/reference-slots');
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});
