const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildUniversalSegmentUserPromptBundle } = require('../src/services/universalSegmentPromptBundle');
const { createUnifiedVideoGenerationService } = require('../src/services/unifiedVideoGenerationService');

const T0 = '2026-01-01T00:00:00.000Z';
const log = { info() {}, warn() {}, error() {} };

// ---------------------------------------------------------------------------
// 万能提示词 bundle:最小内存库(列与 01_init.sql / ensureColumns 相关子集一致)
// ---------------------------------------------------------------------------
function createBundleDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      storyboard_number INTEGER,
      scene_id INTEGER,
      title TEXT, description TEXT, location TEXT, time TEXT,
      action TEXT, dialogue TEXT, narration TEXT, result TEXT, atmosphere TEXT,
      image_prompt TEXT, polished_prompt TEXT, video_prompt TEXT, universal_segment_text TEXT,
      shot_type TEXT, angle TEXT, angle_h TEXT, angle_v TEXT, angle_s TEXT,
      movement TEXT, lighting_style TEXT, depth_of_field TEXT, layout_description TEXT,
      characters TEXT, local_path TEXT, duration REAL,
      segment_index INTEGER, segment_title TEXT,
      updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      title TEXT, script_content TEXT,
      deleted_at TEXT
    );
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, genre TEXT, style TEXT, metadata TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      location TEXT, state TEXT, time TEXT, prompt TEXT,
      image_url TEXT, local_path TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      image_url TEXT, local_path TEXT,
      updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE character_libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
    );
    CREATE TABLE storyboard_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL
    );
    CREATE TABLE character_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      source_key TEXT,
      name TEXT NOT NULL,
      image_url TEXT,
      local_path TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_character_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      reference_role TEXT,
      sort_order INTEGER,
      framing_note TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      image_url TEXT, local_path TEXT,
      updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER NOT NULL,
      prop_id INTEGER NOT NULL,
      PRIMARY KEY (storyboard_id, prop_id)
    );
  `);
  db.prepare('INSERT INTO dramas (id, title, genre) VALUES (1, ?, ?)').run('测试剧', '都市');
  db.prepare('INSERT INTO episodes (id, drama_id, title, script_content) VALUES (1, 1, ?, ?)').run('第1集', '剧本正文。');
  return db;
}

function insertStoryboard(db, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO storyboards (
       episode_id, storyboard_number, scene_id, title, action, location, duration, characters,
       updated_at, deleted_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    overrides.storyboard_number ?? 1,
    overrides.scene_id ?? null,
    overrides.title ?? '旧标题',
    overrides.action ?? '旧动作',
    overrides.location ?? null,
    overrides.duration ?? null,
    overrides.characters ?? null,
    T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function insertScene(db, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO scenes (drama_id, location, state, image_url, local_path, updated_at, deleted_at) VALUES (1, ?, ?, ?, ?, ?, ?)'
  ).run(
    overrides.location ?? '客厅',
    overrides.state ?? '',
    overrides.image_url ?? null,
    overrides.local_path ?? null,
    T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function insertCharacter(db, name) {
  const info = db.prepare('INSERT INTO characters (drama_id, name, updated_at) VALUES (1, ?, ?)').run(name, T0);
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
    T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function linkVariant(db, storyboardId, characterId, variantId, overrides = {}) {
  db.prepare(
    'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(storyboardId, characterId, variantId, overrides.reference_role ?? null, overrides.sort_order ?? null, overrides.framing_note ?? null);
}

function insertProp(db, name, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO props (drama_id, name, image_url, local_path, updated_at, deleted_at) VALUES (1, ?, ?, ?, ?, ?)'
  ).run(name, overrides.image_url ?? null, overrides.local_path ?? null, T0, overrides.deleted_at ?? null);
  return Number(info.lastInsertRowid);
}

function linkProp(db, storyboardId, propId) {
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)').run(storyboardId, propId);
}

describe('buildUniversalSegmentUserPromptBundle: reference slots from resolveStoryboardSlots', () => {
  let db;

  beforeEach(() => {
    db = createBundleDb();
  });

  it('keeps numbered placeholders for imageless slots: 3 slots -> @图片1/2/3 with @图片2 marked missing', () => {
    const sceneId = insertScene(db, { location: '客厅', local_path: '/static/scene.png' });
    const sbId = insertStoryboard(db, { scene_id: sceneId, action: '她走进客厅' });
    const c1 = insertCharacter(db, '张三');
    const v1 = insertVariant(db, c1, '常态'); // 缺图状态槽,必须保留占位
    linkVariant(db, sbId, c1, v1, { sort_order: 1 });
    const propId = insertProp(db, '手枪', { local_path: '/static/prop.png' });
    linkProp(db, sbId, propId);

    const built = buildUniversalSegmentUserPromptBundle(db, sbId, {}, {});

    assert.equal(built.ok, true);
    const prompt = built.userPrompt;
    // 三个槽位编号固定:场景=1,缺图角色状态=2(占位),道具=3(不前移)
    assert.match(prompt, /@图片1 = 场景「客厅」/);
    assert.match(prompt, /@图片2 = 角色「张三·常态」[^\n]*缺参考图/);
    assert.match(prompt, /@图片3 = 道具「手枪」/);
    // 缺图槽不得被跳过重排:现状(只有 2 槽)下道具会占 @图片2,新行为必须占 @图片3
    assert.doesNotMatch(prompt, /@图片2 = 道具/);
    // 角色绑定块使用 variant 语义显示名
    assert.match(prompt, /「张三·常态」→ @图片2/);
  });

  it('all slots imageless + force -> placeholder map; without force -> bad_request', () => {
    const sceneId = insertScene(db, { location: '客厅' }); // 无图场景
    const sbId = insertStoryboard(db, { scene_id: sceneId, action: '她走进客厅' });
    const c1 = insertCharacter(db, '张三');
    const v1 = insertVariant(db, c1, '常态'); // 无图状态
    linkVariant(db, sbId, c1, v1, { sort_order: 1 });

    const blocked = buildUniversalSegmentUserPromptBundle(db, sbId, {}, {});
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'bad_request');

    const forced = buildUniversalSegmentUserPromptBundle(db, sbId, { force_without_reference_images: true }, {});
    assert.equal(forced.ok, true);
    assert.match(forced.userPrompt, /@图片1 = 场景「客厅」[^\n]*缺参考图/);
    assert.match(forced.userPrompt, /@图片2 = 角色「张三·常态」[^\n]*缺参考图/);
  });

  it('no bound slots at all + force keeps legacy no-image mode blocks', () => {
    const sbId = insertStoryboard(db, { action: '她走进客厅' });
    const forced = buildUniversalSegmentUserPromptBundle(db, sbId, { force_without_reference_images: true }, {});
    assert.equal(forced.ok, true);
    assert.match(forced.userPrompt, /无图强制模式/);

    const blocked = buildUniversalSegmentUserPromptBundle(db, sbId, {}, {});
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'bad_request');
  });
});

describe('buildUniversalSegmentUserPromptBundle: field_overrides', () => {
  let db;

  beforeEach(() => {
    db = createBundleDb();
    // 邻镜:确认邻镜上下文查询不受 overrides 影响
    db.prepare(
      'INSERT INTO storyboards (episode_id, storyboard_number, action, updated_at) VALUES (1, 0, ?, ?)'
    ).run('邻镜动作', T0);
  });

  it('overrides ACTION/TITLE chunks; neighbor context still reads DB values', () => {
    const sceneId = insertScene(db, { location: '客厅', local_path: '/static/scene.png' });
    const sbId = insertStoryboard(db, { scene_id: sceneId, storyboard_number: 1 });

    const built = buildUniversalSegmentUserPromptBundle(
      db,
      sbId,
      { field_overrides: { action: '新动作', title: '新标题' } },
      {}
    );

    assert.equal(built.ok, true);
    assert.match(built.userPrompt, /^ACTION: 新动作$/m);
    assert.match(built.userPrompt, /^TITLE: 新标题$/m);
    assert.doesNotMatch(built.userPrompt, /旧动作/);
    assert.doesNotMatch(built.userPrompt, /旧标题/);
    // 邻镜上下文不受 overrides 影响
    assert.match(built.userPrompt, /邻镜动作/);
  });

  it('ignores invalid shapes (string/null) and non-whitelisted keys', () => {
    const sceneId = insertScene(db, { location: '客厅', local_path: '/static/scene.png' });
    const sbId = insertStoryboard(db, { scene_id: sceneId, action: '旧动作', location: '客厅' });

    for (const bad of ['oops', null]) {
      const built = buildUniversalSegmentUserPromptBundle(db, sbId, { field_overrides: bad }, {});
      assert.equal(built.ok, true);
      assert.match(built.userPrompt, /^ACTION: 旧动作$/m);
    }

    // location 不在白名单,即使传了也不覆盖
    const built = buildUniversalSegmentUserPromptBundle(
      db,
      sbId,
      { field_overrides: { location: '黑屋', action: '  ' } },
      {}
    );
    assert.equal(built.ok, true);
    assert.match(built.userPrompt, /^LOCATION: 客厅$/m);
    assert.match(built.userPrompt, /^ACTION: 旧动作$/m); // 空白串不覆盖
  });

  it('duration override applies only with a valid number; body.duration still wins', () => {
    const sceneId = insertScene(db, { location: '客厅', local_path: '/static/scene.png' });
    const sbId = insertStoryboard(db, { scene_id: sceneId, duration: 8 });

    const overridden = buildUniversalSegmentUserPromptBundle(db, sbId, { field_overrides: { duration: 6 } }, {});
    assert.equal(overridden.ok, true);
    assert.match(overridden.userPrompt, /^TOTAL_CLIP_SECONDS: 6$/m);

    const invalid = buildUniversalSegmentUserPromptBundle(db, sbId, { field_overrides: { duration: 'abc' } }, {});
    assert.equal(invalid.ok, true);
    assert.match(invalid.userPrompt, /^TOTAL_CLIP_SECONDS: 8$/m);

    const bodyWins = buildUniversalSegmentUserPromptBundle(
      db,
      sbId,
      { duration: 10, field_overrides: { duration: 6 } },
      {}
    );
    assert.equal(bodyWins.ok, true);
    assert.match(bodyWins.userPrompt, /^TOTAL_CLIP_SECONDS: 10$/m);
  });
});

// ---------------------------------------------------------------------------
// 统一参考图上限:H3(plan 构建)>9 报错;非 H3 不设新上限
// ---------------------------------------------------------------------------
function createServiceDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      provider TEXT, api_protocol TEXT, base_url TEXT, api_key TEXT,
      model TEXT, default_model TEXT, endpoint TEXT, query_endpoint TEXT,
      settings TEXT, is_default INTEGER, is_active INTEGER, deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY, type TEXT, status TEXT, progress INTEGER DEFAULT 0,
      message TEXT, error TEXT, result TEXT, resource_id TEXT,
      created_at TEXT, updated_at TEXT, completed_at TEXT, deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER, storyboard_id INTEGER, provider TEXT, protocol TEXT,
      prompt TEXT, negative_prompt TEXT, model TEXT,
      h3_skill_name TEXT, h3_skill_sha256 TEXT, h3_skill_provenance TEXT,
      config_id INTEGER, config_snapshot TEXT,
      duration REAL, aspect_ratio TEXT, resolution TEXT,
      width INTEGER, height INTEGER, frame_rate REAL, seed INTEGER,
      camera_fixed INTEGER, watermark INTEGER, continuity_mode TEXT,
      anchor_id TEXT, candidate_group_id TEXT, image_gen_id INTEGER,
      image_url TEXT, first_frame_url TEXT, last_frame_url TEXT,
      reference_image_urls TEXT,
      video_url TEXT, local_path TEXT, status TEXT, task_id TEXT, provider_task_id TEXT,
      completed_at TEXT, error_msg TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT,
      metadata TEXT, deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, duration REAL, video_url TEXT, local_path TEXT,
      updated_at TEXT, deleted_at TEXT
    );
  `);
  return db;
}

function seedVideoConfig(db, overrides = {}) {
  const config = {
    provider: 'fake',
    api_protocol: 'fake-protocol',
    base_url: 'https://provider.example.test/v1',
    api_key: 'secret',
    model: JSON.stringify(['old-model']),
    default_model: 'old-model',
    endpoint: '/generate',
    query_endpoint: '/tasks/{taskId}',
    settings: JSON.stringify({}),
    is_default: 1,
    is_active: 1,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO ai_service_configs
      (service_type, provider, api_protocol, base_url, api_key, model, default_model,
       endpoint, query_endpoint, settings, is_default, is_active)
    VALUES ('video', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    config.provider, config.api_protocol, config.base_url, config.api_key,
    config.model, config.default_model, config.endpoint, config.query_endpoint,
    config.settings, config.is_default, config.is_active
  );
}

function buildTestService(db, overrides = {}) {
  return createUnifiedVideoGenerationService({
    db,
    log,
    providerRegistry: { has: () => false },
    schedule: () => {},
    pollIntervalMs: 0,
    ...overrides,
  });
}

describe('unified video generation: reference count limit unification', () => {
  it('H3 config with plan build rejects more than 9 refs with VIDEO_REFERENCE_COUNT_INVALID', async () => {
    const db = createServiceDb();
    seedVideoConfig(db, {
      provider: 'comfyui',
      model: JSON.stringify(['h3-continuity-v1']),
      default_model: 'h3-continuity-v1',
    });
    const workflow = {
      id: 'h3-continuity-v1',
      adapter: 'comfyui',
      capabilities: { modes: ['single_reference'], maxReferenceImages: 9, supportsContinuity: false },
    };
    const service = buildTestService(db, {
      h3PromptCompiler: { async compile() { return { compiledPrompt: 'compiled prompt', sourcePrompt: 'raw', compilerVersion: 'test-v1' }; } },
      workflowRegistry: { workflows: [workflow] },
    });

    await assert.rejects(
      service.createVideoGeneration({
        prompt: 'a woman walks',
        duration: 5,
        reference_image_urls: Array.from({ length: 10 }, (_, i) => `/static/ref${i}.png`),
      }),
      (e) => e.code === 'VIDEO_REFERENCE_COUNT_INVALID' && /1-9/.test(e.message)
    );
    db.close();
  });

  it('H3 config with 9 refs passes the limit check and persists all refs', async () => {
    const db = createServiceDb();
    seedVideoConfig(db, {
      provider: 'comfyui',
      model: JSON.stringify(['h3-continuity-v1']),
      default_model: 'h3-continuity-v1',
    });
    const workflow = {
      id: 'h3-continuity-v1',
      adapter: 'comfyui',
      capabilities: { modes: ['single_reference'], maxReferenceImages: 9, supportsContinuity: false },
    };
    const service = buildTestService(db, {
      h3PromptCompiler: { async compile() { return { compiledPrompt: 'compiled prompt', sourcePrompt: 'raw', compilerVersion: 'test-v1' }; } },
      workflowRegistry: { workflows: [workflow] },
    });

    const created = await service.createVideoGeneration({
      prompt: 'a woman walks',
      duration: 5,
      reference_image_urls: Array.from({ length: 9 }, (_, i) => `/static/ref${i}.png`),
    });
    const row = db.prepare('SELECT reference_image_urls FROM video_generations WHERE id = ?').get(created.id);
    assert.equal(JSON.parse(row.reference_image_urls).length, 9);
    db.close();
  });

  it('non-H3 config keeps legacy semantics: 12 refs are neither rejected nor truncated', async () => {
    const db = createServiceDb();
    seedVideoConfig(db);
    const service = buildTestService(db);

    const created = await service.createVideoGeneration({
      prompt: 'a woman walks',
      duration: 5,
      reference_image_urls: Array.from({ length: 12 }, (_, i) => `/static/ref${i}.png`),
    });
    const row = db.prepare('SELECT reference_image_urls FROM video_generations WHERE id = ?').get(created.id);
    assert.equal(JSON.parse(row.reference_image_urls).length, 12);
    db.close();
  });
});
