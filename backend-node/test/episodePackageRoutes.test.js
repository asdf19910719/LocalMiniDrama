const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const createRoutes = require('../src/routes/episodePackage');
const characterRoutes = require('../src/routes/characters');
const { sha256Text } = require('../src/services/episodePackageService');
const { listStoryboardVariantLinks } = require('../src/services/storyboardVariantService');
const { createTaskBundle } = require('../src/services/externalAiTaskBundleService');
const { validExternalAiResult } = require('./fixtures/externalAiResultFixture');

const EXAMPLE_PATH = path.join(__dirname, 'fixtures', 'episodePackageV11.json');
const EXAMPLE_RAW = fs.readFileSync(EXAMPLE_PATH, 'utf8');
const EXTERNAL_EXAMPLE_RAW = fs.readFileSync(
  path.join(__dirname, '..', '..', 'docs', '单集制作包导入', '制作包示例.json'),
  'utf8',
);

// 表结构:01_init.sql 裁剪 + migrations/30_episode_package_import.sql(含唯一索引)
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      genre TEXT,
      style TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
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
      ,audio_plan TEXT
      ,production_profile TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER,
      storyboard_number INTEGER DEFAULT 0,
      title TEXT,
      description TEXT,
      duration REAL,
      location TEXT,
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
      production_metadata TEXT,
      emotion TEXT,
      emotion_intensity INTEGER,
      is_primary INTEGER DEFAULT 0,
      lighting_style TEXT,
      depth_of_field TEXT,
      continuity_snapshot TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT,
      description TEXT,
      personality TEXT,
      appearance TEXT,
      polished_prompt TEXT,
      voice_style TEXT,
      negative_prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      source_key TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episode_characters (
      episode_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      PRIMARY KEY (episode_id, character_id)
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      episode_id INTEGER,
      location TEXT,
      state TEXT,
      description TEXT,
      prompt TEXT,
      atmosphere TEXT,
      negative_prompt TEXT,
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
      type TEXT,
      description TEXT,
      prompt TEXT,
      negative_prompt TEXT,
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
      import_report TEXT,
      imported_at TEXT,
      task_package_id TEXT,
      task_created_at TEXT,
      task_assets_digest TEXT
    );
    CREATE TABLE external_ai_package_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id TEXT NOT NULL UNIQUE,
      drama_id INTEGER NOT NULL,
      target_episode_id INTEGER,
      target_episode_number INTEGER NOT NULL,
      assets_digest TEXT NOT NULL,
      context_markdown TEXT NOT NULL,
      instructions_markdown TEXT NOT NULL,
      asset_manifest_json TEXT NOT NULL,
      asset_snapshot_json TEXT NOT NULL,
      response_schema_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      imported_at TEXT
    );
  `);
  db.prepare(`INSERT INTO dramas (id, title, description, genre, style, metadata) VALUES (1, '雨夜追凶', '记者追查旧案', '悬疑', 'cinematic', ?)`).run(
    JSON.stringify({ external_ai_continuity_notes: '林晚尚不知道顾川身份。' })
  );
  return db;
}

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers ||= {}; this.headers[name.toLowerCase()] = value; },
    send(body) { this.statusCode ||= 200; this.body = body; return this; },
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

function insertEpisode(db, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    overrides.drama_id ?? 1,
    overrides.episode_number ?? 1,
    overrides.title ?? '',
    overrides.script_content ?? null,
    overrides.description ?? null,
    new Date().toISOString(),
    new Date().toISOString(),
    overrides.deleted_at ?? null
  );
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

    it('returns 400 when drama_id is missing', () => {
      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: EXAMPLE_RAW },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.message, 'drama_id 必填');
    });

    it('returns 400 when the target episode belongs to another drama', () => {
      const otherEpisodeId = insertEpisode(db, { drama_id: 2, episode_number: 1 });

      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: EXAMPLE_RAW, drama_id: 1, target_episode_id: otherEpisodeId },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.message, '目标剧集不属于当前剧');
    });

    it('returns 200 when the target episode belongs to the given drama', () => {
      const episodeId = insertEpisode(db, { drama_id: 1, episode_number: 3, title: '空白第三集' });

      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: EXAMPLE_RAW, drama_id: 1, target_episode_id: episodeId },
      });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data.target_status, { status: 'blank', reasons: [] });
    });
  });

  describe('GET /dramas/:dramaId/blank-episodes', () => {
    it('lists only blank episodes of the drama, ordered by episode_number, excluding other dramas and soft-deleted rows', () => {
      const blankFirst = insertEpisode(db, { drama_id: 1, episode_number: 2, title: '第二集' });
      const blankSecond = insertEpisode(db, { drama_id: 1, episode_number: 1, title: '第一集' });
      insertEpisode(db, { drama_id: 1, episode_number: 3, title: '已有剧本', script_content: '剧本内容' });
      insertEpisode(db, { drama_id: 2, episode_number: 9, title: '别剧空白集' });
      insertEpisode(db, { drama_id: 1, episode_number: 4, title: '已删除', deleted_at: new Date().toISOString() });
      const withStoryboard = insertEpisode(db, { drama_id: 1, episode_number: 5, title: '已有分镜' });
      db.prepare('INSERT INTO storyboards (episode_id, storyboard_number, created_at, updated_at) VALUES (?, 1, ?, ?)')
        .run(withStoryboard, new Date().toISOString(), new Date().toISOString());

      const res = callRoute(routes, { method: 'GET', url: '/dramas/1/blank-episodes' });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.deepEqual(res.body.data, [
        { id: blankSecond, episode_number: 1, title: '第一集' },
        { id: blankFirst, episode_number: 2, title: '第二集' },
      ]);
    });

    it('returns an empty list when the drama has no blank episodes', () => {
      insertEpisode(db, { drama_id: 1, episode_number: 1, title: '非空白', script_content: 'x' });

      const res = callRoute(routes, { method: 'GET', url: '/dramas/1/blank-episodes' });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, []);
    });
  });

  describe('external AI task preparation', () => {
    it('returns a new-session context before story discussion', () => {
      insertEpisode(db, {
        drama_id: 1,
        episode_number: 1,
        title: '雨夜来客',
        description: '林晚收到一本账本。',
        script_content: '雨夜里，林晚接过残缺账本。',
      });
      const target = insertEpisode(db, { drama_id: 1, episode_number: 2, title: '第二集' });

      const res = callRoute(routes, { method: 'GET', url: `/dramas/1/external-ai/context?target_episode_id=${target}` });

      assert.equal(res.statusCode, 200);
      assert.match(res.body.data.markdown, /林晚尚不知道顾川身份/);
      assert.match(res.body.data.markdown, /雨夜里，林晚接过残缺账本/);
      assert.equal(res.body.data.target_episode_number, 2);
    });

    it('creates and downloads a persisted three-file task ZIP', () => {
      const target = insertEpisode(db, { drama_id: 1, episode_number: 2, title: '第二集' });
      const created = callRoute(routes, {
        method: 'POST',
        url: '/dramas/1/external-ai/tasks',
        body: { target_episode_id: target },
      });

      assert.equal(created.statusCode, 201);
      assert.match(created.body.data.package_id, /^extai_/);
      assert.equal(created.body.data.target_episode_number, 2);
      assert.equal(created.body.data.asset_snapshot, undefined, 'private database ids are not returned');

      const downloaded = callRoute(routes, {
        method: 'GET',
        url: `/external-ai/tasks/${encodeURIComponent(created.body.data.package_id)}/download`,
      });
      assert.equal(downloaded.statusCode, 200);
      assert.equal(downloaded.headers['content-type'], 'application/zip');
      assert.ok(Buffer.isBuffer(downloaded.body));
      assert.ok(downloaded.body.length > 100);
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

      const sourceRes = callRoute(routes, { method: 'GET', url: `/episodes/${data.episode_id}/import-source` });
      assert.equal(sourceRes.statusCode, 200);
      assert.equal(sourceRes.body.data.raw_json_text, EXAMPLE_RAW);
      assert.equal(sourceRes.body.data.source_filename, 'example.json');
      assert.equal(sourceRes.body.data.import_report.projection.status, 'verified');
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
          drama_id: 1,
          target_episode_id: Number(info.lastInsertRowid),
        },
      });

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'TARGET_NOT_BLANK');
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM storyboards').get().c, 0);
    });

    it('returns 400 when drama_id is missing', () => {
      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: {
          raw_json_text: EXAMPLE_RAW,
          source_sha256: sha256Text(EXAMPLE_RAW),
        },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.message, 'drama_id 必填');
    });

    it('returns 400 when the target episode belongs to another drama', () => {
      const otherEpisodeId = insertEpisode(db, { drama_id: 2, episode_number: 1 });

      const res = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: {
          raw_json_text: EXAMPLE_RAW,
          source_sha256: sha256Text(EXAMPLE_RAW),
          drama_id: 1,
          target_episode_id: otherEpisodeId,
        },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.message, '目标剧集不属于当前剧');
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

    it('previews and imports an incremental external AI result while preserving reused assets and task provenance', () => {
      const target = insertEpisode(db, { drama_id: 1, episode_number: 2, title: '第二集' });
      db.prepare(`
        INSERT INTO characters (
          id, drama_id, source_key, name, role, description, personality, appearance,
          polished_prompt, negative_prompt, voice_style, created_at, updated_at
        ) VALUES (21, 1, 'char_lin_wan', '林晚', 'main', '调查记者', '冷静克制',
          '二十七岁，黑色短发', '林晚定妆照', '避免改脸', '清冷女声', ?, ?)
      `).run(new Date().toISOString(), '2026-09-01T00:00:00.000Z');
      db.prepare(`
        INSERT INTO character_variants (
          id, character_id, source_key, name, description, appearance, image_prompt,
          negative_prompt, is_default, created_at, updated_at
        ) VALUES (31, 21, 'variant_lin_wan_default', '默认状态', '日常状态',
          '深灰风衣', '深灰风衣定妆', '避免改脸', 1, ?, ?)
      `).run(new Date().toISOString(), '2026-09-01T00:00:00.000Z');
      db.prepare(`
        INSERT INTO scenes (id, drama_id, episode_id, source_key, location, state, description, prompt, atmosphere, negative_prompt, created_at, updated_at)
        VALUES (41, 1, 1, 'scene_store', '便利店', '雨夜', '冷白灯便利店', '便利店空镜', '紧张', '人物', ?, ?)
      `).run(new Date().toISOString(), '2026-09-01T00:00:00.000Z');
      db.prepare(`
        INSERT INTO props (id, drama_id, episode_id, source_key, name, type, description, prompt, negative_prompt, created_at, updated_at)
        VALUES (51, 1, 1, 'prop_ledger', '残缺账本', '线索', '缺少末页', '账本棚拍', '手', ?, ?)
      `).run(new Date().toISOString(), '2026-09-01T00:00:00.000Z');
      const task = createTaskBundle(db, 1, { targetEpisodeId: target });
      const result = validExternalAiResult();
      result.package_id = task.package_id;
      const raw = JSON.stringify(result);
      db.prepare(`
        INSERT INTO props (id, drama_id, episode_id, source_key, name, type, description, prompt, negative_prompt, created_at, updated_at)
        VALUES (52, 1, 1, NULL, '任务后新增道具', '普通道具', '不参与本集', '普通道具棚拍', '手', ?, ?)
      `).run(new Date().toISOString(), '2026-09-07T00:00:00.000Z');

      const preview = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: raw, filename: 'episode-2.json', drama_id: 1, target_episode_id: target },
      });
      assert.equal(preview.statusCode, 200);
      assert.deepEqual(preview.body.data.errors, []);
      assert.equal(preview.body.data.package_task.package_id, task.package_id);
      assert.ok(preview.body.data.asset_matches.every((item) => item.decision === 'reuse'));
      assert.equal(db.prepare('SELECT source_key FROM props WHERE id = 52').get().source_key, null, 'preview remains read-only');

      const imported = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: {
          raw_json_text: raw,
          source_sha256: sha256Text(raw),
          filename: 'episode-2.json',
          drama_id: 1,
          target_episode_id: target,
        },
      });
      assert.equal(imported.statusCode, 200);
      assert.equal(db.prepare('SELECT personality FROM characters WHERE id = 21').get().personality, '冷静克制');
      const source = db.prepare('SELECT * FROM episode_imports WHERE episode_id = ?').get(target);
      assert.equal(source.schema_name, 'local-mini-drama.external-ai-result');
      assert.equal(source.task_package_id, task.package_id);
      assert.equal(source.raw_json, raw);
      assert.ok(db.prepare('SELECT imported_at FROM external_ai_package_tasks WHERE package_id = ?').get(task.package_id).imported_at);
    });

    it('creates an unbound task at its frozen episode number and refuses an occupied target', () => {
      const task = createTaskBundle(db, 1, { targetEpisodeNumber: 2 });
      const result = JSON.parse(EXTERNAL_EXAMPLE_RAW);
      result.package_id = task.package_id;
      result.episode.episode_number = 2;
      const raw = JSON.stringify(result);

      const wrongBlankTarget = insertEpisode(db, { drama_id: 1, episode_number: 3, title: '第三集空白' });
      const mismatched = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: raw, drama_id: 1, target_episode_id: wrongBlankTarget },
      });
      assert.equal(mismatched.statusCode, 400);
      assert.equal(mismatched.body.error.code, 'PACKAGE_TARGET_MISMATCH');
      db.prepare('UPDATE episodes SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), wrongBlankTarget);

      insertEpisode(db, { drama_id: 1, episode_number: 2, title: '后来新增的第二集' });
      const occupied = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: raw, drama_id: 1 },
      });
      assert.equal(occupied.statusCode, 409);
      assert.equal(occupied.body.error.code, 'PACKAGE_TARGET_OCCUPIED');

      db.prepare('UPDATE episodes SET deleted_at = ? WHERE episode_number = 2').run(new Date().toISOString());
      const preview = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: raw, drama_id: 1 },
      });
      const imported = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: { raw_json_text: raw, source_sha256: sha256Text(raw), drama_id: 1 },
      });
      assert.equal(preview.statusCode, 200);
      assert.equal(imported.statusCode, 200);
      assert.equal(db.prepare('SELECT episode_number FROM episodes WHERE id = ?').get(imported.body.data.episode_id).episode_number, 2);
    });

    it('rejects reuse of a task after its first successful import', () => {
      const task = createTaskBundle(db, 1, { targetEpisodeNumber: 1 });
      const result = JSON.parse(EXTERNAL_EXAMPLE_RAW);
      result.package_id = task.package_id;
      result.episode.episode_number = 1;
      const raw = JSON.stringify(result);
      const first = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package',
        body: { raw_json_text: raw, source_sha256: sha256Text(raw), drama_id: 1 },
      });
      assert.equal(first.statusCode, 200);

      const second = callRoute(routes, {
        method: 'POST',
        url: '/episodes/import-package/preview',
        body: { raw_json_text: raw, drama_id: 1 },
      });
      assert.equal(second.statusCode, 409);
      assert.equal(second.body.error.code, 'PACKAGE_TASK_ALREADY_IMPORTED');
    });
  });

  describe('GET /episodes/:id/import-source', () => {
    it('未导入的剧集返回 404', () => {
      const episodeId = insertEpisode(db, { episode_number: 9 });
      const res = callRoute(routes, { method: 'GET', url: `/episodes/${episodeId}/import-source` });
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error.code, 'IMPORT_SOURCE_NOT_FOUND');
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
