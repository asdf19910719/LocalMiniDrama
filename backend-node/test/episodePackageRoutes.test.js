const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const createRoutes = require('../src/routes/episodePackage');
const characterRoutes = require('../src/routes/characters');
const { sha256Text } = require('../src/services/episodePackageService');
const { listStoryboardVariantLinks } = require('../src/services/storyboardVariantService');

const EXAMPLE_PATH = path.join(__dirname, '..', '..', 'docs', 'superpowers', 'specs', 'episode-package.example.json');
const EXAMPLE_RAW = fs.readFileSync(EXAMPLE_PATH, 'utf8');

// 表结构:01_init.sql 裁剪 + migrations/30_episode_package_import.sql(含唯一索引)
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      episode_number INTEGER DEFAULT 0,
      title TEXT DEFAULT '',
      script_content TEXT,
      description TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER,
      storyboard_number INTEGER DEFAULT 0,
      title TEXT,
      description TEXT,
      duration REAL,
      dialogue TEXT,
      action TEXT,
      image_prompt TEXT,
      narration TEXT,
      layout_description TEXT,
      universal_segment_text TEXT,
      characters TEXT,
      shot_type TEXT,
      angle TEXT,
      movement TEXT,
      image_url TEXT,
      local_path TEXT,
      video_url TEXT,
      creation_mode TEXT DEFAULT 'classic',
      status TEXT DEFAULT 'draft',
      source_key TEXT,
      audio_description TEXT,
      transition TEXT,
      created_at TEXT,
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
      source_key TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      episode_id INTEGER,
      location TEXT,
      state TEXT,
      prompt TEXT,
      source_key TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      episode_id INTEGER,
      name TEXT NOT NULL DEFAULT '',
      description TEXT,
      prompt TEXT,
      source_key TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER NOT NULL,
      prop_id INTEGER NOT NULL,
      PRIMARY KEY (storyboard_id, prop_id)
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
    CREATE TABLE episode_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      schema_name TEXT,
      schema_version TEXT,
      source_filename TEXT,
      source_sha256 TEXT,
      raw_json TEXT,
      normalized_json TEXT,
      match_decisions TEXT,
      generator_metadata TEXT,
      imported_at TEXT
    );
  `);
  return db;
}

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

/** 把 Express Router 实例当 middleware 直接调用(handler 全同步,返回后 body 已就绪) */
function callRoute(router, { method = 'GET', url, body }) {
  const res = responseCapture();
  router({ method, url, body }, res, () => {});
  return res;
}

/** 直接调用 characters 工厂导出的 handler(directorRoutes.test.js 模式) */
function callHandler(handler, { params = {}, body = {} } = {}) {
  const res = responseCapture();
  handler({ params, body }, res);
  return res;
}

function insertCharacter(db, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO characters (drama_id, name, description, appearance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(overrides.drama_id ?? 1, overrides.name ?? '林晚', overrides.description ?? null, overrides.appearance ?? null,
    new Date().toISOString(), new Date().toISOString());
  return Number(info.lastInsertRowid);
}

describe('Episode package routes', () => {
  let db;
  let routes;
  const log = { error() {}, info() {}, warn() {} };

  beforeEach(() => {
    db = createDb();
    routes = createRoutes(db, {}, log);
  });

  describe('POST /episodes/import-package/preview', () => {
    it('returns 200 with normalized package, hash, target status, asset matches and stats', () => {
      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: EXAMPLE_RAW, filename: 'example.json', drama_id: 1 },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      const data = res.body.data;
      assert.equal(data.source_sha256, sha256Text(EXAMPLE_RAW));
      assert.deepEqual(data.target_status, { status: 'new_episode' });
      assert.deepEqual(data.errors, []);
      assert.ok(Array.isArray(data.warnings));
      assert.equal(data.normalized_package.schema, 'local-mini-drama.episode-package');
      assert.equal(typeof data.normalized_package.storyboards[0].action, 'string');
      assert.equal(data.asset_matches.length, 4); // 1 character + 2 scenes + 1 prop
      assert.ok(data.asset_matches.every((m) => m.decision === 'create'));
      assert.equal(data.stats.characters_created, 1);
      assert.equal(data.stats.variants_created, 2);
      assert.equal(data.stats.scenes_created, 2);
      assert.equal(data.stats.props_created, 1);
      assert.equal(data.stats.storyboards_created, 2);
    });

    it('returns 400 when raw_json_text is missing', () => {
      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { drama_id: 1 },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
    });
  });

  describe('POST /episodes/import-package', () => {
    it('imports a valid package into a new episode and writes all related tables', () => {
      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: {
          raw_json_text: EXAMPLE_RAW,
          source_sha256: sha256Text(EXAMPLE_RAW),
          drama_id: 1,
          filename: 'example.json',
        },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      const data = res.body.data;
      assert.ok(Number.isInteger(data.episode_id));
      assert.equal(data.stats.storyboards_created, 2);
      assert.equal(data.stats.characters_created, 1);
      assert.equal(data.stats.variants_created, 2);
      assert.ok(Array.isArray(data.warnings));

      const character = db.prepare('SELECT * FROM characters WHERE source_key = ?').get('char_lin_wan');
      assert.ok(character, 'character row written');
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM character_variants WHERE character_id = ?').get(character.id).c, 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM scenes').get().c, 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM props').get().c, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM storyboards').get().c, 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM storyboard_character_variants').get().c, 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM storyboard_props').get().c, 2);
      const imported = db.prepare('SELECT * FROM episode_imports').get();
      assert.equal(imported.episode_id, data.episode_id);
      assert.equal(imported.source_sha256, sha256Text(EXAMPLE_RAW));
      const firstSb = db.prepare('SELECT * FROM storyboards WHERE source_key = ?').get('sb_01');
      assert.equal(firstSb.creation_mode, 'universal');
      assert.deepEqual(JSON.parse(firstSb.characters), [character.id]);
    });

    it('rejects import with 409 TARGET_NOT_BLANK when the target episode is not blank', () => {
      const info = db.prepare(
        "INSERT INTO episodes (drama_id, episode_number, title, script_content, created_at, updated_at) VALUES (1, 1, '旧集', '已有剧本', ?, ?)"
      ).run(new Date().toISOString(), new Date().toISOString());

      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: {
          raw_json_text: EXAMPLE_RAW,
          source_sha256: sha256Text(EXAMPLE_RAW),
          target_episode_id: Number(info.lastInsertRowid),
        },
      });

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'TARGET_NOT_BLANK');
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM storyboards').get().c, 0);
    });

    it('rejects import with 409 PACKAGE_HASH_MISMATCH when content hash differs', () => {
      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: {
          raw_json_text: EXAMPLE_RAW,
          source_sha256: '0'.repeat(64),
          drama_id: 1,
        },
      });

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'PACKAGE_HASH_MISMATCH');
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM episodes').get().c, 0);
    });

    it('maps invalid package JSON to 400 PACKAGE_INVALID', () => {
      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: { raw_json_text: '{oops', source_sha256: 'x', drama_id: 1 },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'PACKAGE_INVALID');
    });
  });

  describe('PUT /storyboards/:id/character-variant-links', () => {
    it('saves links and the storyboards.characters projection', () => {
      const characterId = insertCharacter(db);
      const variantInfo = db.prepare(
        "INSERT INTO character_variants (character_id, source_key, name, is_default, created_at, updated_at) VALUES (?, 'default', '默认', 1, ?, ?)"
      ).run(characterId, new Date().toISOString(), new Date().toISOString());
      const sbInfo = db.prepare(
        'INSERT INTO storyboards (episode_id, storyboard_number, created_at, updated_at) VALUES (1, 1, ?, ?)'
      ).run(new Date().toISOString(), new Date().toISOString());
      const storyboardId = Number(sbInfo.lastInsertRowid);

      const res = callRoute(routes, {
        method: 'PUT',
        url: `/storyboards/${storyboardId}/character-variant-links`,
        body: {
          links: [{
            character_id: characterId,
            variant_id: Number(variantInfo.lastInsertRowid),
            reference_role: 'primary',
            sort_order: 1,
            framing_note: '中景',
          }],
        },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.length, 1);

      const links = listStoryboardVariantLinks(db, storyboardId);
      assert.equal(links.length, 1);
      assert.equal(links[0].character_id, characterId);
      assert.equal(links[0].variant_name, '默认');
      assert.equal(links[0].sort_order, 1);
      assert.deepEqual(JSON.parse(db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(storyboardId).characters), [characterId]);
    });

    it('maps a variant belonging to another character to 400 VARIANT_CHARACTER_MISMATCH', () => {
      const characterId = insertCharacter(db);
      const otherId = insertCharacter(db, { name: '路人' });
      const variantInfo = db.prepare(
        "INSERT INTO character_variants (character_id, source_key, name, created_at, updated_at) VALUES (?, 'default', '默认', ?, ?)"
      ).run(otherId, new Date().toISOString(), new Date().toISOString());
      const sbInfo = db.prepare(
        'INSERT INTO storyboards (episode_id, storyboard_number, created_at, updated_at) VALUES (1, 1, ?, ?)'
      ).run(new Date().toISOString(), new Date().toISOString());

      const res = callRoute(routes, {
        method: 'PUT',
        url: `/storyboards/${sbInfo.lastInsertRowid}/character-variant-links`,
        body: {
          links: [{
            character_id: characterId,
            variant_id: Number(variantInfo.lastInsertRowid),
            sort_order: 1,
          }],
        },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'VARIANT_CHARACTER_MISMATCH');
    });
  });
});

describe('Character variant routes', () => {
  let db;
  let characters;
  let characterId;
  const log = { error() {}, info() {}, warn() {} };

  beforeEach(() => {
    db = createDb();
    characters = characterRoutes(db, {}, log, null);
    characterId = insertCharacter(db);
  });

  it('goes through list → create → list → update → delete', () => {
    let res = callHandler(characters.listVariants, { params: { characterId: String(characterId) } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, []);

    res = callHandler(characters.createVariant, {
      params: { characterId: String(characterId) },
      body: { source_key: 'battle', name: '战损', description: '战斗后破损状态' },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    const variantId = res.body.data.id;
    assert.equal(res.body.data.source_key, 'battle');

    res = callHandler(characters.listVariants, { params: { characterId: String(characterId) } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].name, '战损');

    res = callHandler(characters.updateVariant, {
      params: { variantId: String(variantId) },
      body: { name: '战损改' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.name, '战损改');

    res = callHandler(characters.deleteVariant, { params: { variantId: String(variantId) } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    res = callHandler(characters.listVariants, { params: { characterId: String(characterId) } });
    assert.deepEqual(res.body.data, []);
  });

  it('rejects deleting a variant referenced by a storyboard with 409 VARIANT_IN_USE', () => {
    const created = callHandler(characters.createVariant, {
      params: { characterId: String(characterId) },
      body: { source_key: 'battle', name: '战损' },
    });
    const variantId = created.body.data.id;
    db.prepare(
      'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, sort_order) VALUES (1, ?, ?, 1)'
    ).run(characterId, variantId);

    const res = callHandler(characters.deleteVariant, { params: { variantId: String(variantId) } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VARIANT_IN_USE');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM character_variants WHERE deleted_at IS NULL').get().c, 1);
  });

  it('maps a duplicate source_key update to 409 VARIANT_KEY_CONFLICT', () => {
    const first = callHandler(characters.createVariant, {
      params: { characterId: String(characterId) },
      body: { source_key: 'a', name: '状态A' },
    });
    callHandler(characters.createVariant, {
      params: { characterId: String(characterId) },
      body: { source_key: 'b', name: '状态B' },
    });

    const res = callHandler(characters.updateVariant, {
      params: { variantId: String(first.body.data.id) },
      body: { source_key: 'b' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VARIANT_KEY_CONFLICT');
  });

  // Task 9:generate-image 已从 501 占位替换为真实调用(异步 handler,直接 await 断言)
  it('generate-image maps missing variant to 400 VARIANT_NOT_FOUND', async () => {
    const res = responseCapture();
    await characters.generateVariantImage({ params: { variantId: '999' }, body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VARIANT_NOT_FOUND');
  });

  it('generate-image maps missing prompt to 400 VARIANT_PROMPT_MISSING', async () => {
    const charId = insertCharacter(db); // 裁剪 schema:appearance/description 为空
    const info = db.prepare(
      "INSERT INTO character_variants (character_id, source_key, name, created_at, updated_at) VALUES (?, 'default', '默认', ?, ?)"
    ).run(charId, new Date().toISOString(), new Date().toISOString());
    const res = responseCapture();
    await characters.generateVariantImage({ params: { variantId: String(info.lastInsertRowid) }, body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VARIANT_PROMPT_MISSING');
  });
});
