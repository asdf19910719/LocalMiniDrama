const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const {
  createH3PromptDraftService,
  computeSourceFingerprint,
  getLatestDraft,
  saveDraftText,
  H3_MAX_SLOTS,
} = require('../src/services/h3PromptDraftService');

// 与 h3PromptCompiler.test.js 相同的合法六段 Ref2VA 文本(通过 validateH3Prompt)。
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

const ALT_VALID_REF_PROMPT = VALID_REF_PROMPT.replace('walks toward the door', 'runs across the yard');

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

const T0 = '2026-01-01T00:00:00.000Z';

// 最小表结构:与 01_init.sql / migrations/30、31 的相关列保持一致。
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER,
      duration REAL,
      video_prompt TEXT,
      characters TEXT,
      universal_segment_text TEXT,
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
      priority INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      settings TEXT,
      created_at TEXT,
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
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX idx_h3_draft_lookup ON storyboard_h3_prompt_drafts(storyboard_id, video_config_id, updated_at DESC);
  `);
  return db;
}

const nullLog = { info() {}, warn() {}, error() {} };

function insertStoryboard(db, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO storyboards (episode_id, scene_id, duration, video_prompt, universal_segment_text, characters, updated_at, deleted_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    overrides.scene_id !== undefined ? overrides.scene_id : null,
    overrides.duration !== undefined ? overrides.duration : 5,
    overrides.video_prompt !== undefined ? overrides.video_prompt : null,
    overrides.universal_segment_text !== undefined ? overrides.universal_segment_text : '雨夜中两人追逐穿过巷子',
    overrides.characters !== undefined ? overrides.characters : null,
    T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function insertScene(db, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO scenes (drama_id, location, state, image_url, local_path, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    1,
    overrides.location !== undefined ? overrides.location : '巷子',
    overrides.state !== undefined ? overrides.state : '夜',
    overrides.image_url !== undefined ? overrides.image_url : '/static/scene.png',
    overrides.local_path ?? null,
    overrides.updated_at ?? T0,
    overrides.deleted_at ?? null
  );
  return Number(info.lastInsertRowid);
}

function insertVariantLink(db, { storyboardId, name = '常态', imageUrl = '/static/variant.png', deletedAt = null } = {}) {
  const charInfo = db.prepare(
    'INSERT INTO characters (drama_id, name, updated_at) VALUES (?, ?, ?)'
  ).run(1, '张三', T0);
  const characterId = Number(charInfo.lastInsertRowid);
  const variantInfo = db.prepare(
    'INSERT INTO character_variants (character_id, source_key, name, image_url, is_default, updated_at, deleted_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).run(characterId, 'default', name, imageUrl, T0, deletedAt);
  const variantId = Number(variantInfo.lastInsertRowid);
  db.prepare(
    'INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(storyboardId, characterId, variantId, 'subject', 1);
  // 槽位 name 取 character_variants.name(resolver 的 variant_name),不带角色前缀。
  return { characterId, variantId, name };
}

function insertProp(db, storyboardId, { name, imageUrl } = {}) {
  const info = db.prepare(
    'INSERT INTO props (drama_id, name, image_url, updated_at) VALUES (?, ?, ?, ?)'
  ).run(1, name, imageUrl, T0);
  const propId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)').run(storyboardId, propId);
  return propId;
}

function insertVideoConfig(db, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO ai_service_configs (id, service_type, provider, api_protocol, name, base_url, model, default_model, settings, is_default, is_active, updated_at)
     VALUES (?, 'video', 'comfyui', 'minimax_h3', 'H3 本地工作流', 'http://127.0.0.1:8188', ?, ?, ?, 1, 1, ?)`
  ).run(
    overrides.id ?? 7,
    overrides.model ?? '["minimax-h3"]',
    overrides.default_model ?? 'minimax-h3',
    overrides.settings ?? '{"width":864,"height":480}',
    T0
  );
  return Number(info.lastInsertRowid);
}

/** 替身编译:记录调用并返回固定六段文本 */
function makeStubCompile() {
  const calls = [];
  const compileFn = async (db, log, input) => {
    calls.push({ db, log, input });
    return {
      sourcePrompt: input.prompt,
      compiledPrompt: VALID_REF_PROMPT,
      promptFormat: 'Ref2VA',
      compilerVersion: 'h3-skill-agent-v1',
      skillProvenance: {
        skillName: 'h3-prompt-writing',
        skillSha256: 'c'.repeat(64),
        skillResources: ['SKILL.md', 'references/ref-en.txt'],
        toolCallId: 'call-stub-1',
      },
    };
  };
  return { calls, compileFn };
}

function makeService(deps = {}) {
  return createH3PromptDraftService(deps);
}

let db;
beforeEach(() => {
  db = createDb();
});

describe('computeSourceFingerprint', () => {
  const base = {
    sourcePrompt: '雨夜追逐',
    slotsFingerprint: 'a'.repeat(64),
    durationSeconds: 5,
    width: 864,
    height: 480,
    audioEnabled: true,
    videoConfigSnapshot: { configId: 7, model: 'minimax-h3' },
    workflowSha: 'sha256:abc',
    skillVersion: 'h3-skill-agent-v1',
  };

  it('is deterministic and independent of key insertion order', () => {
    const a = computeSourceFingerprint(base);
    const b = computeSourceFingerprint({ ...base, videoConfigSnapshot: { model: 'minimax-h3', configId: 7 } });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('changes when any fingerprint dimension changes', () => {
    const reference = computeSourceFingerprint(base);
    const variants = [
      { ...base, sourcePrompt: '另一段提示词' },
      { ...base, slotsFingerprint: 'b'.repeat(64) },
      { ...base, durationSeconds: 8 },
      { ...base, width: 1080 },
      { ...base, height: 1920 },
      { ...base, audioEnabled: false },
      { ...base, videoConfigSnapshot: { configId: 8, model: 'minimax-h3' } },
      { ...base, workflowSha: 'sha256:def' },
      { ...base, skillVersion: 'h3-skill-agent-v2' },
    ];
    for (const variant of variants) {
      assert.notEqual(computeSourceFingerprint(variant), reference);
    }
  });
});

describe('getLatestDraft', () => {
  it('returns null when no draft exists', () => {
    assert.equal(getLatestDraft(db, 1, '7'), null);
  });

  it('returns the row with the newest updated_at for the storyboard+config pair', () => {
    insertStoryboard(db, {});
    const insert = db.prepare(
      `INSERT INTO storyboard_h3_prompt_drafts (storyboard_id, video_config_id, source_prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    insert.run(1, '7', 'old', T0, T0);
    insert.run(1, '7', 'new', T0, '2026-02-01T00:00:00.000Z');
    insert.run(1, '8', 'other config', T0, '2026-03-01T00:00:00.000Z');
    insert.run(2, '7', 'other storyboard', T0, '2026-04-01T00:00:00.000Z');
    const latest = getLatestDraft(db, 1, '7');
    assert.equal(latest.source_prompt, 'new');
    assert.equal(getLatestDraft(db, 1, '8').source_prompt, 'other config');
    assert.equal(getLatestDraft(db, 2, '7').source_prompt, 'other storyboard');
  });
});

describe('compileDraft', () => {
  it('compiles a valid storyboard into a complete draft row and passes available slot urls to the compiler', async () => {
    const sceneId = insertScene(db, {});
    const sbId = insertStoryboard(db, { scene_id: sceneId, duration: 5, universal_segment_text: '雨夜追逐' });
    insertVariantLink(db, { storyboardId: sbId, name: '常态', imageUrl: '/static/variant.png' });
    insertVideoConfig(db, { id: 7 });
    const { calls, compileFn } = makeStubCompile();
    const service = makeService({ compileFn });

    const draft = await service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });

    // 编译入参:业务提示词 + 可用槽位 image_url 列表
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.prompt, '雨夜追逐');
    assert.equal(calls[0].input.durationSeconds, 5);
    assert.deepEqual(calls[0].input.referenceUrls, ['/static/scene.png', '/static/variant.png']);

    // 行字段齐全
    assert.equal(draft.storyboard_id, sbId);
    assert.equal(draft.video_config_id, '7');
    assert.equal(draft.source_prompt, '雨夜追逐');
    assert.equal(draft.status, 'valid');
    assert.equal(draft.validation_errors, null);
    assert.equal(draft.manually_edited, 0);
    assert.match(draft.source_fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(draft.ai_compiled_prompt, VALID_REF_PROMPT);
    assert.equal(draft.final_compiled_prompt, VALID_REF_PROMPT);
    assert.equal(draft.compiled_prompt_hash, sha256Hex(VALID_REF_PROMPT));
    assert.equal(draft.prompt_format, 'Ref2VA');
    assert.equal(draft.skill_version, 'h3-skill-agent-v1');
    const provenance = JSON.parse(draft.skill_provenance);
    assert.equal(provenance.skillName, 'h3-prompt-writing');

    const snapshotRef = JSON.parse(draft.reference_snapshot);
    assert.equal(snapshotRef.slots.length, 2);
    assert.equal(snapshotRef.slots[0].type, 'scene');
    assert.equal(snapshotRef.slots[0].image_url, '/static/scene.png');
    assert.equal(snapshotRef.slots[1].type, 'character_variant');

    const params = JSON.parse(draft.generation_params);
    assert.equal(params.durationSeconds, 5);
    assert.equal(params.width, 864);
    assert.equal(params.height, 480);
    assert.equal(params.audioEnabled, true);
    assert.equal(params.videoConfigSnapshot.configId, 7);
    assert.equal(params.videoConfigSnapshot.provider, 'comfyui');
    assert.equal(params.videoConfigSnapshot.model, 'minimax-h3');
    assert.equal(params.videoConfigSnapshot.protocol, 'minimax_h3');
    assert.equal(params.workflowSha, null);

    // 指纹可由同输入重算复现
    const { slotsFingerprint } = require('../src/services/referenceSlotService');
    assert.equal(
      draft.source_fingerprint,
      computeSourceFingerprint({
        sourcePrompt: '雨夜追逐',
        slotsFingerprint: slotsFingerprint(snapshotRef.slots),
        durationSeconds: 5,
        width: 864,
        height: 480,
        audioEnabled: true,
        videoConfigSnapshot: params.videoConfigSnapshot,
        workflowSha: null,
        skillVersion: 'h3-skill-agent-v1',
      })
    );

    // getLatestDraft 能取到该行
    assert.equal(getLatestDraft(db, sbId, '7').id, draft.id);
  });

  it('falls back to video_prompt when universal_segment_text is empty', async () => {
    const sceneId = insertScene(db, {});
    const sbId = insertStoryboard(db, { scene_id: sceneId, universal_segment_text: '', video_prompt: '经典模式提示词' });
    insertVideoConfig(db, { id: 7 });
    const { calls, compileFn } = makeStubCompile();
    const service = makeService({ compileFn });
    const draft = await service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });
    assert.equal(draft.source_prompt, '经典模式提示词');
    assert.equal(calls[0].input.prompt, '经典模式提示词');
  });

  it('rejects with UNIVERSAL_PROMPT_EMPTY when both prompts are blank and never calls the compiler', async () => {
    const sceneId = insertScene(db, {});
    const sbId = insertStoryboard(db, { scene_id: sceneId, universal_segment_text: '   ', video_prompt: null });
    insertVideoConfig(db, { id: 7 });
    const { calls, compileFn } = makeStubCompile();
    const service = makeService({ compileFn });
    await assert.rejects(
      () => service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' }),
      (error) => error.code === 'UNIVERSAL_PROMPT_EMPTY'
    );
    assert.equal(calls.length, 0);
  });

  it('rejects with MISSING_REFERENCE_IMAGE when a slot has no image (soft-deleted variant with url still blocks) and never calls the compiler', async () => {
    const sceneId = insertScene(db, {});
    const sbId = insertStoryboard(db, { scene_id: sceneId });
    // 软删状态槽:可能带 url 但 image_available=false
    const variant = insertVariantLink(db, { storyboardId: sbId, name: '常态', imageUrl: '/static/gone.png', deletedAt: T0 });
    insertProp(db, sbId, { name: '匕首', imageUrl: '/static/knife.png' });
    insertVideoConfig(db, { id: 7 });
    const { calls, compileFn } = makeStubCompile();
    const service = makeService({ compileFn });
    await assert.rejects(
      () => service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' }),
      (error) => {
        assert.equal(error.code, 'MISSING_REFERENCE_IMAGE');
        assert.match(String(error.message), new RegExp(variant.name));
        assert.ok(
          (error.details?.slots || []).some((slot) => slot.index === 2 && slot.name === variant.name),
          'details should list the offending slot with index and name'
        );
        return true;
      }
    );
    assert.equal(calls.length, 0);
  });

  it('rejects with REFERENCE_COUNT_INVALID when zero slots have images', async () => {
    const sbId = insertStoryboard(db, { scene_id: null });
    insertVideoConfig(db, { id: 7 });
    const { calls, compileFn } = makeStubCompile();
    const service = makeService({ compileFn });
    await assert.rejects(
      () => service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' }),
      (error) => error.code === 'REFERENCE_COUNT_INVALID'
    );
    assert.equal(calls.length, 0);
  });

  it(`rejects with REFERENCE_COUNT_OVERFLOW when total slots exceed ${H3_MAX_SLOTS}`, async () => {
    const sbId = insertStoryboard(db, { scene_id: null });
    for (let i = 0; i < H3_MAX_SLOTS + 1; i += 1) {
      insertProp(db, sbId, { name: `道具${i}`, imageUrl: `/static/prop-${i}.png` });
    }
    insertVideoConfig(db, { id: 7 });
    const { calls, compileFn } = makeStubCompile();
    const service = makeService({ compileFn });
    await assert.rejects(
      () => service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' }),
      (error) => error.code === 'REFERENCE_COUNT_OVERFLOW'
    );
    assert.equal(calls.length, 0);
  });

  it('rejects with H3_PROMPT_FORMAT_INVALID when the compiler output fails deterministic validation and inserts nothing', async () => {
    const sceneId = insertScene(db, {});
    const sbId = insertStoryboard(db, { scene_id: sceneId });
    insertVideoConfig(db, { id: 7 });
    const service = makeService({
      compileFn: async () => ({
        sourcePrompt: 'x',
        compiledPrompt: '这是一段不符合 H3 结构的文本',
        promptFormat: 'Ref2VA',
        compilerVersion: 'h3-skill-agent-v1',
        skillProvenance: null,
      }),
    });
    await assert.rejects(
      () => service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' }),
      (error) => error.code === 'H3_PROMPT_FORMAT_INVALID'
    );
    const count = db.prepare('SELECT COUNT(*) AS n FROM storyboard_h3_prompt_drafts').get();
    assert.equal(count.n, 0);
  });

  it('rejects with VIDEO_CONFIG_NOT_FOUND when the video config does not exist', async () => {
    const sceneId = insertScene(db, {});
    const sbId = insertStoryboard(db, { scene_id: sceneId });
    const { compileFn } = makeStubCompile();
    const service = makeService({ compileFn });
    await assert.rejects(
      () => service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '404' }),
      (error) => error.code === 'VIDEO_CONFIG_NOT_FOUND'
    );
  });
});

describe('saveDraftText', () => {
  async function createDraft() {
    const sceneId = insertScene(db, {});
    const sbId = insertStoryboard(db, { scene_id: sceneId });
    insertVideoConfig(db, { id: 7 });
    const { compileFn } = makeStubCompile();
    const service = makeService({ compileFn });
    return service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });
  }

  it('stores valid manual text, keeps source_prompt and source_fingerprint unchanged, and updates the hash', async () => {
    const draft = await createDraft();
    const updated = saveDraftText(db, { draftId: draft.id, finalText: ALT_VALID_REF_PROMPT, manuallyEdited: true });
    assert.equal(updated.status, 'valid');
    assert.equal(updated.validation_errors, null);
    assert.equal(updated.final_compiled_prompt, ALT_VALID_REF_PROMPT);
    assert.equal(updated.compiled_prompt_hash, sha256Hex(ALT_VALID_REF_PROMPT));
    assert.equal(updated.manually_edited, 1);
    assert.equal(updated.source_prompt, draft.source_prompt, 'source_prompt must not change');
    assert.equal(updated.source_fingerprint, draft.source_fingerprint, 'source_fingerprint must not change');
    assert.equal(updated.ai_compiled_prompt, draft.ai_compiled_prompt, 'ai_compiled_prompt must not change');
  });

  it('marks the draft invalid with validation_errors when the text fails deterministic validation', async () => {
    const draft = await createDraft();
    const updated = saveDraftText(db, { draftId: draft.id, finalText: '随手改的一段中文', manuallyEdited: true });
    assert.equal(updated.status, 'invalid');
    const errors = JSON.parse(updated.validation_errors);
    assert.ok(errors.message, 'validation_errors should carry a message');
    assert.ok((errors.missing || []).length > 0, 'validation_errors should list missing sections');
    assert.equal(updated.compiled_prompt_hash, draft.compiled_prompt_hash, 'hash must not change on invalid text');
    assert.equal(updated.final_compiled_prompt, draft.final_compiled_prompt, 'final text must not change on invalid text');
    assert.equal(updated.source_fingerprint, draft.source_fingerprint);
    assert.equal(updated.manually_edited, 1);
  });

  it('throws DRAFT_NOT_FOUND for an unknown draft id', () => {
    assert.throws(() => saveDraftText(db, { draftId: 999, finalText: VALID_REF_PROMPT }), (error) => error.code === 'DRAFT_NOT_FOUND');
  });
});

describe('evaluateDraftFreshness', () => {
  async function createDraft() {
    const sceneId = insertScene(db, {});
    const sbId = insertStoryboard(db, { scene_id: sceneId, duration: 5, universal_segment_text: '雨夜追逐' });
    insertVideoConfig(db, { id: 7 });
    const { compileFn } = makeStubCompile();
    const service = makeService({ compileFn });
    const draft = await service.compileDraft(db, {}, nullLog, { storyboardId: sbId, videoConfigId: '7' });
    // 用未注入替身的服务评估,证明评估路径不依赖编译器
    return { draft, freshService: makeService() };
  }

  it('returns stale=false with empty reasons when nothing changed', async () => {
    const { draft, freshService } = await createDraft();
    const result = freshService.evaluateDraftFreshness(db, draft);
    assert.deepEqual(result, { stale: false, reasons: [] });
  });

  it('reports stale with reason "prompt" after the universal prompt changes', async () => {
    const { draft, freshService } = await createDraft();
    db.prepare('UPDATE storyboards SET universal_segment_text = ? WHERE id = ?').run('改写后的剧情', draft.storyboard_id);
    const result = freshService.evaluateDraftFreshness(db, draft);
    assert.equal(result.stale, true);
    assert.ok(result.reasons.includes('prompt'));
  });

  it('reports stale with reason "slots" after a reference image url changes', async () => {
    const { draft, freshService } = await createDraft();
    db.prepare('UPDATE scenes SET image_url = ? WHERE id = (SELECT scene_id FROM storyboards WHERE id = ?)')
      .run('/static/scene-new.png', draft.storyboard_id);
    const result = freshService.evaluateDraftFreshness(db, draft);
    assert.equal(result.stale, true);
    assert.ok(result.reasons.includes('slots'));
  });

  it('reports stale with reason "skill" when the stored compiler version differs from the current one', async () => {
    const { draft, freshService } = await createDraft();
    db.prepare('UPDATE storyboard_h3_prompt_drafts SET skill_version = ? WHERE id = ?').run('h3-skill-agent-v0', draft.id);
    const updated = getLatestDraft(db, draft.storyboard_id, '7');
    const result = freshService.evaluateDraftFreshness(db, updated);
    assert.equal(result.stale, true);
    assert.ok(result.reasons.includes('skill'));
  });

  it('reports stale with reason "config" (not "params") when only the config snapshot input changes', async () => {
    const { draft, freshService } = await createDraft();
    db.prepare('UPDATE ai_service_configs SET settings = ? WHERE id = 7')
      .run('{"width":864,"height":480,"seed":99}');
    const result = freshService.evaluateDraftFreshness(db, draft);
    assert.equal(result.stale, true);
    assert.ok(result.reasons.includes('config'));
    assert.ok(!result.reasons.includes('params'), 'resolution-only config change must not be reported as params');
  });

  it('reports stale with reason "params" when the storyboard duration changes', async () => {
    const { draft, freshService } = await createDraft();
    db.prepare('UPDATE storyboards SET duration = ? WHERE id = ?').run(8, draft.storyboard_id);
    const result = freshService.evaluateDraftFreshness(db, draft);
    assert.equal(result.stale, true);
    assert.ok(result.reasons.includes('params'));
  });
});
