const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  createUnifiedVideoGenerationService,
  isH3VideoConfig,
} = require('../src/services/unifiedVideoGenerationService');
const { createH3PromptDraftService } = require('../src/services/h3PromptDraftService');
const storyboardRoutes = require('../src/routes/storyboards');
const directorRoutes = require('../src/routes/director');

// 与 h3PromptDraftService.test.js 相同的合法六段 Ref2VA 文本(通过 validateH3Prompt)。
const VALID_REF_PROMPT = [
  'subject_definitions:',
  '<Subject 1> is a woman in <Picture 1>.',
  'summary:',
  '[reference generation] The target video follows <Subject 1>.',
  'retention_analysis:',
  '<Subject 1>: fully_preserved - identity retained.',
  'detailed_description:',
  '[Shot 1] <Subject 1> walks toward the door.',
  'overall_soundscape: Footsteps and rain.',
  'non_diegetic_music: N/A',
].join('\n');

const INVALID_PROMPT = '只是一段没有 H3 结构的普通文本';

const T0 = '2026-01-01T00:00:00.000Z';
const nullLog = { info() {}, warn() {}, error() {} };

// 完整最小表:草稿服务需要的槽位表 + unified 服务需要的 video_generations/async_tasks。
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER,
      duration REAL,
      video_prompt TEXT,
      universal_segment_text TEXT,
      characters TEXT,
      video_url TEXT,
      local_path TEXT,
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
      image_url TEXT,
      local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE character_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      source_key TEXT,
      name TEXT NOT NULL,
      image_url TEXT,
      local_path TEXT,
      is_default INTEGER DEFAULT 0,
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
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      provider TEXT DEFAULT '',
      api_protocol TEXT DEFAULT '',
      name TEXT DEFAULT '',
      base_url TEXT DEFAULT '',
      api_key TEXT,
      model TEXT,
      default_model TEXT,
      endpoint TEXT,
      query_endpoint TEXT,
      settings TEXT,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_h3_prompt_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      video_config_id TEXT,
      source_prompt TEXT,
      source_fingerprint TEXT,
      ai_compiled_prompt TEXT,
      final_compiled_prompt TEXT,
      compiled_prompt_hash TEXT,
      prompt_format TEXT,
      skill_version TEXT,
      skill_provenance TEXT,
      reference_snapshot TEXT,
      generation_params TEXT,
      manually_edited INTEGER DEFAULT 0,
      status TEXT DEFAULT 'valid',
      validation_errors TEXT,
      workflow_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX idx_h3_draft_lookup ON storyboard_h3_prompt_drafts(storyboard_id, video_config_id, updated_at DESC);
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      storyboard_id INTEGER,
      provider TEXT,
      protocol TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      model TEXT,
      source_prompt TEXT,
      compiled_prompt TEXT,
      prompt_format TEXT,
      prompt_compiler_version TEXT,
      prompt_compile_status TEXT,
      h3_skill_name TEXT,
      h3_skill_sha256 TEXT,
      h3_skill_provenance TEXT,
      config_id INTEGER,
      config_snapshot TEXT,
      duration REAL,
      aspect_ratio TEXT,
      resolution TEXT,
      width INTEGER,
      height INTEGER,
      frame_rate REAL,
      seed INTEGER,
      camera_fixed INTEGER,
      watermark INTEGER,
      continuity_mode TEXT,
      anchor_id TEXT,
      candidate_group_id TEXT,
      image_url TEXT,
      first_frame_url TEXT,
      last_frame_url TEXT,
      reference_image_urls TEXT,
      video_url TEXT,
      local_path TEXT,
      status TEXT,
      task_id TEXT,
      provider_task_id TEXT,
      completed_at TEXT,
      error_msg TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function insertScene(db, { imageUrl = '/static/scene.png' } = {}) {
  return Number(db.prepare(
    'INSERT INTO scenes (drama_id, location, state, image_url, updated_at) VALUES (1, ?, ?, ?, ?)'
  ).run('巷子', '夜', imageUrl, T0).lastInsertRowid);
}

function insertStoryboard(db, { sceneId = null, universalSegmentText = '雨夜中两人追逐穿过巷子', duration = 5 } = {}) {
  return Number(db.prepare(
    `INSERT INTO storyboards (episode_id, scene_id, duration, universal_segment_text, updated_at)
     VALUES (1, ?, ?, ?, ?)`
  ).run(sceneId, duration, universalSegmentText, T0).lastInsertRowid);
}

function insertVariantLink(db, { storyboardId, imageUrl = '/static/variant.png' } = {}) {
  const characterId = Number(db.prepare(
    'INSERT INTO characters (drama_id, name, updated_at) VALUES (1, ?, ?)'
  ).run('张三', T0).lastInsertRowid);
  const variantId = Number(db.prepare(
    'INSERT INTO character_variants (character_id, source_key, name, image_url, is_default, updated_at) VALUES (?, ?, ?, ?, 1, ?)'
  ).run(characterId, 'default', '常态', imageUrl, T0).lastInsertRowid);
  db.prepare(
    'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order) VALUES (?, ?, ?, ?, 1)'
  ).run(storyboardId, characterId, variantId, 'subject');
  return variantId;
}

/** H3 默认配置(comfyui + minimax_h3 协议 + minimax-h3 模型) */
function insertH3Config(db, {
  id = 7,
  isDefault = 1,
  models = ['minimax-h3'],
  defaultModel = models[0],
} = {}) {
  db.prepare(
    `INSERT INTO ai_service_configs (id, service_type, provider, api_protocol, name, base_url, model, default_model, settings, is_default, is_active, updated_at)
     VALUES (?, 'video', 'comfyui', 'minimax_h3', 'H3 本地工作流', 'http://127.0.0.1:8188', ?, ?, '{"width":864,"height":480}', ?, 1, ?)`
  ).run(id, JSON.stringify(models), defaultModel, isDefault, T0);
  return id;
}

/** 非 H3 默认配置(旧路径) */
function insertLegacyConfig(db, { isDefault = 1 } = {}) {
  return Number(db.prepare(
    `INSERT INTO ai_service_configs (service_type, provider, api_protocol, base_url, api_key, model, default_model, endpoint, query_endpoint, settings, is_default, is_active)
     VALUES ('video', 'fake', 'fake-protocol', 'https://old-provider.example.test/v1', 'secret', '["old-model"]', 'old-model', '/generate', '/tasks/{taskId}', '{"width":1280,"height":704}', ?, 1)`
  ).run(isDefault).lastInsertRowid);
}

function makeDefaultConfigExclusive(db) {
  db.prepare("UPDATE ai_service_configs SET is_default = 0 WHERE service_type = 'video'").run();
}

/** 技能替身:记录调用次数,返回固定六段文本与出处 */
function makeStubCompileFn() {
  const calls = [];
  const compileFn = async (_db, _log, input) => {
    calls.push({ input });
    return {
      sourcePrompt: input.prompt,
      compiledPrompt: VALID_REF_PROMPT,
      promptFormat: 'Ref2VA',
      compilerVersion: 'h3-skill-agent-v1',
      skillProvenance: {
        skillName: 'h3-prompt-writing',
        skillSha256: 'c'.repeat(64),
        skillResources: ['SKILL.md'],
        toolCallId: 'call-stub-1',
      },
    };
  };
  return { calls, compileFn };
}

function createHarness() {
  const calls = { submit: [] };
  const provider = {
    async submit(context) {
      calls.submit.push(context);
      return { providerTaskId: 'upstream-1', status: 'queued', progress: 5 };
    },
  };
  const registry = {
    has: (name) => name === 'comfyui' || name === 'fake',
    get: (name) => (name === 'comfyui' || name === 'fake' ? provider : null),
  };
  return { calls, registry, jobs: [] };
}

function buildService(db, harness, overrides = {}) {
  return createUnifiedVideoSignatureService(db, harness, overrides);
}

// 独立小包装,避免测试文件顶部与实现细节耦合
function createUnifiedVideoSignatureService(db, harness, overrides = {}) {
  return createUnifiedVideoGenerationService({
    db,
    log: nullLog,
    providerRegistry: harness.registry,
    schedule: (job) => harness.jobs.push(job),
    pollIntervalMs: 0,
    ...overrides,
  });
}

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('h3 draft gating for candidate generation', () => {
  let db;
  let harness;
  let draftService;
  let compileStub;

  beforeEach(() => {
    db = createDb();
    harness = createHarness();
    compileStub = makeStubCompileFn();
    draftService = createH3PromptDraftService({ compileFn: compileStub.compileFn });
  });

  it('isH3VideoConfig is exported for the compile route gate', () => {
    assert.equal(typeof isH3VideoConfig, 'function');
    assert.equal(isH3VideoConfig({ provider: 'comfyui', protocol: 'minimax_h3', model: 'minimax-h3' }), true);
    assert.equal(isH3VideoConfig({ provider: 'fake', protocol: 'fake-protocol', model: 'old-model' }), false);
  });

  it('rejects projectless H3 candidate generation with H3_STORYBOARD_REQUIRED and never invokes the skill', async () => {
    insertH3Config(db, { id: 7 });
    const service = buildService(db, harness);

    await assert.rejects(
      service.createVideoGeneration({ prompt: 'a woman walks', duration: 5 }),
      (e) => e.code === 'H3_STORYBOARD_REQUIRED'
    );

    assert.equal(compileStub.calls.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_generations').get().n, 0);
    assert.equal(harness.jobs.length, 0);
  });

  it('rejects a stale draft (universal prompt changed since compile) with H3_DRAFT_STALE', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });
    assert.equal(compileStub.calls.length, 1);

    db.prepare('UPDATE storyboards SET universal_segment_text = ? WHERE id = ?').run('剧情已经改写', sbId);

    const service = buildService(db, harness);
    await assert.rejects(
      service.createVideoGeneration({ prompt: 'a woman walks', storyboard_id: sbId, h3_prompt_draft_id: draft.id }),
      (e) => e.code === 'H3_DRAFT_STALE' && Array.isArray(e.details?.reasons) && e.details.reasons.includes('prompt')
    );
    assert.equal(compileStub.calls.length, 1, '候选生成不得重新编译');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_generations').get().n, 0);
  });

  it('rejects a draft bound to a different video config with H3_DRAFT_CONFIG_MISMATCH', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });

    // 换一个 H3 配置为默认:草稿仍指向配置 7 → 不匹配
    makeDefaultConfigExclusive(db);
    insertH3Config(db, { id: 8, isDefault: 1 });

    const service = buildService(db, harness);
    await assert.rejects(
      service.createVideoGeneration({ prompt: 'a woman walks', storyboard_id: sbId, h3_prompt_draft_id: draft.id }),
      (e) => e.code === 'H3_DRAFT_CONFIG_MISMATCH'
    );
    assert.equal(compileStub.calls.length, 1);
  });

  it('rejects a candidate whose request duration differs from the compiled draft duration with 409 H3_DRAFT_STALE', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId, duration: 5 });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });
    assert.equal(JSON.parse(draft.generation_params).durationSeconds, 5);

    const service = buildService(db, harness);
    await assert.rejects(
      service.createVideoGeneration({ prompt: 'a woman walks', storyboard_id: sbId, duration: 8, h3_prompt_draft_id: draft.id }),
      (e) => {
        assert.equal(e.code, 'H3_DRAFT_STALE');
        assert.equal(e.status, 409);
        assert.equal(e.details?.draft_duration, 5);
        assert.equal(e.details?.request_duration, 8);
        assert.match(e.message, /候选时长\(8秒\)与草稿编译时长\(5秒\)不一致/);
        return true;
      }
    );
    assert.equal(compileStub.calls.length, 1, '候选生成不得重新编译');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_generations').get().n, 0);
    assert.equal(harness.jobs.length, 0);
  });

  it('lets a candidate through when the request duration matches the draft duration', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId, duration: 5 });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });

    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({
      prompt: 'a woman walks',
      storyboard_id: sbId,
      duration: 5,
      h3_prompt_draft_id: draft.id,
    });
    assert.equal(created.status, 'waiting');
    const row = db.prepare('SELECT duration FROM video_generations WHERE id = ?').get(created.id);
    assert.equal(Number(row.duration), 5);
  });

  it('does not block H3 candidates when input.duration is omitted (storyboard duration applies)', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId, duration: 5 });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });

    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({
      prompt: 'a woman walks',
      storyboard_id: sbId,
      h3_prompt_draft_id: draft.id,
    });
    assert.equal(created.status, 'waiting');
  });

  it('rejects a draft from another storyboard with H3_DRAFT_STORYBOARD_MISMATCH', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });

    const otherSbId = insertStoryboard(db, { sceneId });
    const service = buildService(db, harness);
    await assert.rejects(
      service.createVideoGeneration({ prompt: 'a woman walks', storyboard_id: otherSbId, h3_prompt_draft_id: draft.id }),
      (e) => e.code === 'H3_DRAFT_STORYBOARD_MISMATCH'
    );
  });

  it('rejects a structurally invalid draft with H3_DRAFT_INVALID and surfaces validation errors', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });

    const saved = draftService.saveDraftText(db, { draftId: draft.id, finalText: INVALID_PROMPT, manuallyEdited: true });
    assert.equal(saved.status, 'invalid');

    const service = buildService(db, harness);
    await assert.rejects(
      service.createVideoGeneration({ prompt: 'a woman walks', storyboard_id: sbId, h3_prompt_draft_id: draft.id }),
      (e) => {
        assert.equal(e.code, 'H3_DRAFT_INVALID');
        assert.equal(e.status, 409);
        assert.ok(e.details?.validation_errors?.message, 'validation_errors 应透传');
        return true;
      }
    );
    assert.equal(compileStub.calls.length, 1);
  });

  it('rejects a draft whose final text no longer matches its hash with H3_DRAFT_HASH_MISMATCH', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });

    db.prepare('UPDATE storyboard_h3_prompt_drafts SET final_compiled_prompt = final_compiled_prompt || ? WHERE id = ?')
      .run('\ntampered', draft.id);

    const service = buildService(db, harness);
    await assert.rejects(
      service.createVideoGeneration({ prompt: 'a woman walks', storyboard_id: sbId, h3_prompt_draft_id: draft.id }),
      (e) => e.code === 'H3_DRAFT_HASH_MISMATCH'
    );
  });

  it('submits draft.final_compiled_prompt byte-for-byte, persists draft skill columns and never recompiles', async () => {
    insertH3Config(db, { id: 7 });
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId });
    insertVariantLink(db, { storyboardId: sbId });
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });
    assert.equal(compileStub.calls.length, 1);

    const service = buildService(db, harness);
    const created = await service.createVideoGeneration({
      prompt: '这个业务提示词会被草稿文本覆盖',
      storyboard_id: sbId,
      duration: 5,
      h3_prompt_draft_id: draft.id,
    });

    assert.equal(created.status, 'waiting');
    const row = db.prepare(
      `SELECT prompt, source_prompt, compiled_prompt, prompt_format, prompt_compiler_version,
              prompt_compile_status, h3_skill_name, h3_skill_sha256, h3_skill_provenance, config_id, storyboard_id
       FROM video_generations WHERE id = ?`
    ).get(created.id);

    assert.equal(row.prompt, draft.final_compiled_prompt, '提交的 prompt 必须与 final_compiled_prompt 逐字节一致');
    assert.equal(row.source_prompt, draft.source_prompt);
    assert.equal(row.compiled_prompt, draft.final_compiled_prompt);
    assert.equal(row.prompt_format, 'Ref2VA');
    assert.equal(row.prompt_compiler_version, 'h3-skill-agent-v1');
    assert.equal(row.prompt_compile_status, 'compiled');
    assert.equal(row.h3_skill_name, 'h3-prompt-writing');
    assert.equal(row.h3_skill_sha256, 'c'.repeat(64));
    assert.equal(JSON.parse(row.h3_skill_provenance).toolCallId, 'call-stub-1');
    assert.equal(Number(row.config_id), 7);
    assert.equal(Number(row.storyboard_id), sbId);

    assert.equal(compileStub.calls.length, 1, '候选生成不得再次调用 H3 技能');
  });

  it('keeps the legacy path fully intact for non-H3 configs even when a draft id is present', async () => {
    const legacyConfigId = insertLegacyConfig(db, { isDefault: 1 });
    const service = buildService(db, harness);

    const created = await service.createVideoGeneration({
      prompt: '旧路径提示词',
      duration: 5,
      h3_prompt_draft_id: 99999,
    });

    const row = db.prepare('SELECT prompt, config_id, prompt_compile_status FROM video_generations WHERE id = ?').get(created.id);
    assert.equal(row.prompt, '旧路径提示词');
    assert.equal(Number(row.config_id), legacyConfigId);
    assert.equal(row.prompt_compile_status, null);
    assert.equal(compileStub.calls.length, 0);
  });
});

describe('storyboard h3 draft routes', () => {
  let db;
  let routes;
  let compileStub;
  let draftService;

  beforeEach(() => {
    db = createDb();
    compileStub = makeStubCompileFn();
  });

  function setup({ workflowRegistry = null } = {}) {
    draftService = createH3PromptDraftService({ compileFn: compileStub.compileFn, workflowRegistry });
    routes = storyboardRoutes(db, nullLog, { workflowRegistry, h3DraftCompileFn: compileStub.compileFn });
  }

  function seedStoryboardWithSlots() {
    const sceneId = insertScene(db);
    const sbId = insertStoryboard(db, { sceneId });
    insertVariantLink(db, { storyboardId: sbId });
    return sbId;
  }

  it('compile returns 200 with a fresh draft and GET restores it with matching freshness', async () => {
    setup();
    insertH3Config(db, { id: 7 });
    const sbId = seedStoryboardWithSlots();

    const compileRes = responseCapture();
    await routes.h3PromptDraftCompile({ params: { id: String(sbId) }, body: { video_config_id: '7' } }, compileRes);

    assert.equal(compileRes.statusCode, 200);
    assert.equal(compileRes.body.success, true);
    const compiledDraft = compileRes.body.data.draft;
    assert.equal(compiledDraft.final_compiled_prompt, VALID_REF_PROMPT);
    assert.equal(compiledDraft.status, 'valid');
    assert.equal(compiledDraft.validation_errors, null);
    assert.deepEqual(compileRes.body.data.freshness, { stale: false, reasons: [] });

    const getRes = responseCapture();
    routes.h3PromptDraftGet({ params: { id: String(sbId) }, query: { video_config_id: '7' } }, getRes);

    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.data.draft.id, compiledDraft.id);
    assert.equal(getRes.body.data.draft.final_compiled_prompt, VALID_REF_PROMPT);
    assert.deepEqual(getRes.body.data.freshness, { stale: false, reasons: [] });
  });

  it('compiles and retrieves drafts for the explicitly selected TE-Speed workflow', async () => {
    setup();
    insertH3Config(db, {
      id: 7,
      models: ['minimax_h3_director_r2v'],
      defaultModel: 'minimax_h3_director_r2v',
    });
    const sbId = seedStoryboardWithSlots();

    const compileRes = responseCapture();
    await routes.h3PromptDraftCompile({
      params: { id: String(sbId) },
      body: { video_config_id: '7', workflow_id: 'minimax_h3_director_r2v_te_speed' },
    }, compileRes);

    assert.equal(compileRes.statusCode, 200);
    assert.equal(compileRes.body.data.draft.workflow_id, 'minimax_h3_director_r2v_te_speed');

    const teRes = responseCapture();
    routes.h3PromptDraftGet({
      params: { id: String(sbId) },
      query: { video_config_id: '7', workflow_id: 'minimax_h3_director_r2v_te_speed' },
    }, teRes);
    assert.equal(teRes.body.data.draft.id, compileRes.body.data.draft.id);
    assert.deepEqual(teRes.body.data.freshness, { stale: false, reasons: [] });

    const officialRes = responseCapture();
    routes.h3PromptDraftGet({
      params: { id: String(sbId) },
      query: { video_config_id: '7', workflow_id: 'minimax_h3_director_r2v' },
    }, officialRes);
    assert.equal(officialRes.body.data.draft, null);
  });

  it('GET returns draft=null with non-stale freshness when no draft exists', () => {
    setup();
    insertH3Config(db, { id: 7 });
    const sbId = seedStoryboardWithSlots();

    const res = responseCapture();
    routes.h3PromptDraftGet({ params: { id: String(sbId) }, query: { video_config_id: '7' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.draft, null);
    assert.deepEqual(res.body.data.freshness, { stale: false, reasons: [] });
  });

  it('GET reports stale reasons after the source prompt drifted', async () => {
    setup();
    insertH3Config(db, { id: 7 });
    const sbId = seedStoryboardWithSlots();
    await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });
    db.prepare('UPDATE storyboards SET universal_segment_text = ? WHERE id = ?').run('新的剧情', sbId);

    const res = responseCapture();
    routes.h3PromptDraftGet({ params: { id: String(sbId) }, query: { video_config_id: '7' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.freshness.stale, true);
    assert.ok(res.body.data.freshness.reasons.includes('prompt'));
  });

  it('GET returns 404 when the storyboard does not exist', () => {
    setup();
    const res = responseCapture();
    routes.h3PromptDraftGet({ params: { id: '424242' }, query: { video_config_id: '7' } }, res);
    assert.equal(res.statusCode, 404);
  });

  it('GET without video_config_id returns 400', () => {
    setup();
    const sbId = seedStoryboardWithSlots();
    const res = responseCapture();
    routes.h3PromptDraftGet({ params: { id: String(sbId) }, query: {} }, res);
    assert.equal(res.statusCode, 400);
  });

  it('compile with a non-H3 config is rejected with 400 H3_CONFIG_REQUIRED', async () => {
    setup();
    const legacyConfigId = insertLegacyConfig(db, { isDefault: 1 });
    const sbId = seedStoryboardWithSlots();

    const res = responseCapture();
    await routes.h3PromptDraftCompile({ params: { id: String(sbId) }, body: { video_config_id: String(legacyConfigId) } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'H3_CONFIG_REQUIRED');
    assert.equal(compileStub.calls.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM storyboard_h3_prompt_drafts').get().n, 0);
  });

  it('compile for a missing storyboard returns 404', async () => {
    setup();
    insertH3Config(db, { id: 7 });
    const res = responseCapture();
    await routes.h3PromptDraftCompile({ params: { id: '424242' }, body: { video_config_id: '7' } }, res);
    assert.equal(res.statusCode, 404);
  });

  it('PUT saves manual edits, passes validation_errors through and recomputes freshness', async () => {
    setup();
    insertH3Config(db, { id: 7 });
    const sbId = seedStoryboardWithSlots();
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });

    const invalidRes = responseCapture();
    await routes.h3PromptDraftSave(
      { params: { id: String(sbId) }, body: { draft_id: draft.id, final_text: INVALID_PROMPT, manually_edited: true } },
      invalidRes
    );

    assert.equal(invalidRes.statusCode, 200);
    const invalidDraft = invalidRes.body.data.draft;
    assert.equal(invalidDraft.status, 'invalid');
    assert.equal(invalidDraft.manually_edited, 1);
    assert.ok(invalidDraft.validation_errors && typeof invalidDraft.validation_errors === 'object', 'validation_errors 应解析为对象透传');
    assert.ok(invalidDraft.validation_errors.message);
    assert.deepEqual(invalidRes.body.data.freshness, { stale: false, reasons: [] });

    const validRes = responseCapture();
    await routes.h3PromptDraftSave(
      { params: { id: String(sbId) }, body: { draft_id: draft.id, final_text: VALID_REF_PROMPT, manually_edited: true } },
      validRes
    );

    assert.equal(validRes.statusCode, 200);
    assert.equal(validRes.body.data.draft.status, 'valid');
    assert.equal(validRes.body.data.draft.validation_errors, null);
    assert.equal(validRes.body.data.draft.final_compiled_prompt, VALID_REF_PROMPT);
  });

  it('PUT rejects a draft from another storyboard with 404 DRAFT_NOT_FOUND', async () => {
    setup();
    insertH3Config(db, { id: 7 });
    const sbId = seedStoryboardWithSlots();
    const draft = await draftService.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });
    const otherSbId = seedStoryboardWithSlots();

    const res = responseCapture();
    await routes.h3PromptDraftSave(
      { params: { id: String(otherSbId) }, body: { draft_id: draft.id, final_text: VALID_REF_PROMPT } },
      res
    );

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'DRAFT_NOT_FOUND');
  });

  it('PUT with an unknown draft id returns 404 DRAFT_NOT_FOUND', async () => {
    setup();
    insertH3Config(db, { id: 7 });
    const sbId = seedStoryboardWithSlots();
    const res = responseCapture();
    await routes.h3PromptDraftSave(
      { params: { id: String(sbId) }, body: { draft_id: 987654, final_text: VALID_REF_PROMPT } },
      res
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'DRAFT_NOT_FOUND');
  });

  it('routes forward the injected workflow registry into draft compilation snapshots', async () => {
    const workflowRegistry = {
      workflows: [
        { id: 'minimax-h3', status: 'verified', variant: 'r2v', workflowSha256: 'sha256:route-registry' },
      ],
    };
    setup({ workflowRegistry });
    insertH3Config(db, { id: 7 });
    const sbId = seedStoryboardWithSlots();

    const res = responseCapture();
    await routes.h3PromptDraftCompile({ params: { id: String(sbId) }, body: { video_config_id: '7' } }, res);

    assert.equal(res.statusCode, 200);
    const params = JSON.parse(res.body.data.draft.generation_params);
    assert.equal(params.workflowSha, 'sha256:route-registry');
    assert.equal(params.videoConfigSnapshot.workflowSha256, 'sha256:route-registry');
  });
});

describe('director generationInput h3_prompt_draft_id passthrough', () => {
  const shot = { id: 5, drama_id: 1 };
  const baseArgs = { db: null, shot, groupId: 'group-1', storageRoot: '/tmp/storage' };

  it('passes structured.h3_prompt_draft_id through to the generation input', () => {
    const input = directorRoutes.generationInput(
      { structured: { prompt: 'p', h3_prompt_draft_id: 42 }, inputs: {} },
      { ...baseArgs, structured: { prompt: 'p', h3_prompt_draft_id: 42 }, inputs: {} }
    );
    assert.equal(input.h3_prompt_draft_id, 42);
  });

  it('passes inputs.h3_prompt_draft_id through as well', () => {
    const input = directorRoutes.generationInput(
      {},
      { ...baseArgs, structured: { prompt: 'p' }, inputs: { h3_prompt_draft_id: '7' } }
    );
    assert.equal(input.h3_prompt_draft_id, '7');
  });

  it('omits the key entirely when no draft id is provided (legacy callers untouched)', () => {
    const input = directorRoutes.generationInput(
      {},
      { ...baseArgs, structured: { prompt: 'p' }, inputs: {} }
    );
    assert.equal(Object.prototype.hasOwnProperty.call(input, 'h3_prompt_draft_id'), false);
  });
});
