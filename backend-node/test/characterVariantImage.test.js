// Task 9:characters.stages 废弃 + 变体生图(generateVariantImage)
// 生图走与 propImageGenerationService 相同的底层通道(imageClient.callImageApi),
// 测试通过 deps 注入 imageClient/uploadService 测试替身。
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const Database = require('better-sqlite3');

const characterLibraryService = require('../src/services/characterLibraryService');
const {
  createVariant,
  updateVariant,
  generateVariantImage,
} = require('../src/services/characterVariantsService');

// 最小表结构:characters(含将废弃的 stages 列)、dramas、character_variants
// 与 migrations 保持一致(字段裁剪到被测路径所需)。
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      style TEXT,
      metadata TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT,
      appearance TEXT,
      personality TEXT,
      description TEXT,
      voice_style TEXT,
      image_url TEXT,
      local_path TEXT,
      polished_prompt TEXT,
      stages TEXT,
      negative_prompt TEXT,
      seedance2_asset TEXT,
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
  `);
  return db;
}

function insertDrama(db, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO dramas (title, style, metadata, created_at) VALUES (?, ?, ?, ?)'
  ).run(overrides.title ?? '测试剧', overrides.style ?? null, overrides.metadata ?? null, '2026-01-01T00:00:00.000Z');
  return Number(info.lastInsertRowid);
}

function insertCharacter(db, overrides = {}) {
  const info = db.prepare(
    'INSERT INTO characters (drama_id, name, appearance, description, negative_prompt, stages) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    overrides.drama_id ?? 1,
    overrides.name ?? '张三',
    overrides.appearance ?? '穿灰色风衣的高个子男人',
    overrides.description ?? '冷静的私家侦探',
    overrides.negative_prompt ?? null,
    overrides.stages ?? null
  );
  return Number(info.lastInsertRowid);
}

const log = { info() {}, warn() {}, error() {} };
const cfg = { storage: { local_path: os.tmpdir() } };

describe('character stages deprecation', () => {
  it('updateCharacter ignores stages: legacy column value stays untouched', () => {
    const db = createDb();
    insertDrama(db);
    const charId = insertCharacter(db, { stages: '[{"legacy":true}]' });
    const out = characterLibraryService.updateCharacter(db, log, charId, {
      name: '改名后的张三',
      stages: '[{"hacked":1}]',
    });
    assert.equal(out.ok, true);
    const row = db.prepare('SELECT name, stages FROM characters WHERE id = ?').get(charId);
    assert.equal(row.name, '改名后的张三');
    assert.equal(row.stages, '[{"legacy":true}]');
  });

  it('updateCharacter 可保存并清空导入角色字段', () => {
    const db = createDb();
    insertDrama(db);
    const charId = insertCharacter(db);
    characterLibraryService.updateCharacter(db, log, charId, {
      role: 'lead', personality: '冷静', voice_style: '低沉', appearance: '黑色短发',
    });
    assert.deepEqual(db.prepare('SELECT role, personality, voice_style, appearance FROM characters WHERE id = ?').get(charId), {
      role: 'lead', personality: '冷静', voice_style: '低沉', appearance: '黑色短发',
    });
    characterLibraryService.updateCharacter(db, log, charId, {
      role: null, personality: null, voice_style: null,
    });
    assert.deepEqual(db.prepare('SELECT role, personality, voice_style FROM characters WHERE id = ?').get(charId), {
      role: null, personality: null, voice_style: null,
    });
  });
});

describe('generateVariantImage', () => {
  let db;
  beforeEach(() => {
    db = createDb();
    insertDrama(db);
  });

  function makeStubs() {
    const calls = { imageApi: [], download: [] };
    const imageClient = {
      resolveAssetUserNegativeForApi: (model, neg) => neg || '',
      callImageApi: async (dbArg, logArg, params) => {
        calls.imageApi.push(params);
        return { image_url: 'https://cdn.example.com/variant-gen.png' };
      },
    };
    const uploadService = {
      downloadImageToLocal: async (storagePath, imageUrl, category, logArg, prefix, projectSubdir) => {
        calls.download.push({ storagePath, imageUrl, category, prefix, projectSubdir });
        return 'projects/0001_20260101_测试剧/characters/variant-gen-local.png';
      },
    };
    return { deps: { imageClient, uploadService }, calls };
  }

  it('throws VARIANT_PROMPT_MISSING when variant has no image_prompt and character has no usable prompt', async () => {
    // 空串（而非 null）：helper 的 ?? 兜底会把 null 替换成默认值
    const charId = insertCharacter(db, { appearance: '', description: '' });
    const variant = createVariant(db, { character_id: charId, name: '常态' });
    const { deps } = makeStubs();
    await assert.rejects(
      () => generateVariantImage(db, cfg, log, variant.id, {}, deps),
      (e) => {
        assert.equal(e.code, 'VARIANT_PROMPT_MISSING');
        return true;
      }
    );
  });

  it('falls back to character appearance when variant image_prompt is empty', async () => {
    const charId = insertCharacter(db, { appearance: '红衣少女', description: null });
    const variant = createVariant(db, { character_id: charId, name: '常态' });
    const { deps, calls } = makeStubs();
    const row = await generateVariantImage(db, cfg, log, variant.id, {}, deps);
    assert.equal(calls.imageApi.length, 1);
    assert.ok(calls.imageApi[0].prompt.includes('红衣少女'));
    assert.equal(row.image_url, 'https://cdn.example.com/variant-gen.png');
  });

  it('uses variant image_prompt as main path, passes model through, and writes back image_url/local_path/extra_images', async () => {
    const charId = insertCharacter(db);
    db.prepare("UPDATE characters SET local_path='characters/base-identity.png' WHERE id=?").run(charId);
    const variant = createVariant(db, {
      character_id: charId,
      name: '雨夜',
      image_prompt: 'wet coat, night',
      negative_prompt: 'blurry',
    });
    // 预置旧图,验证旧图被追加进 extra_images
    updateVariant(db, variant.id, {
      image_url: 'https://old.example.com/a.png',
      local_path: 'characters/old.png',
      extra_images: ['/static/e0.png'],
    });
    // 固定旧 updated_at,避免同毫秒导致 notEqual 偶发相等
    db.prepare("UPDATE character_variants SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(variant.id);
    const { deps, calls } = makeStubs();

    const row = await generateVariantImage(db, cfg, log, variant.id, { model: 'test-image-model' }, deps);

    // 底层调用参数:image_prompt 为主路径,风格/尺寸/负向词/model 透传
    assert.equal(calls.imageApi.length, 1);
    const apiParams = calls.imageApi[0];
    assert.ok(apiParams.prompt.includes('wet coat, night'));
    assert.equal(apiParams.model, 'test-image-model');
    assert.equal(apiParams.size, '1920x1920');
    assert.equal(apiParams.drama_id, 1);
    assert.equal(apiParams.user_negative_prompt, 'blurry');
    assert.deepEqual(apiParams.reference_image_urls, ['characters/base-identity.png']);

    // 下载保存:characters 分类 + 工程子目录
    assert.equal(calls.download.length, 1);
    assert.equal(calls.download[0].category, 'characters');
    assert.equal(calls.download[0].imageUrl, 'https://cdn.example.com/variant-gen.png');
    assert.equal(calls.download[0].prefix, 'char_variant_' + variant.id);

    // 行写回
    assert.equal(row.id, variant.id);
    assert.equal(row.image_url, 'https://cdn.example.com/variant-gen.png');
    assert.equal(row.local_path, 'projects/0001_20260101_测试剧/characters/variant-gen-local.png');
    assert.deepEqual(row.extra_images, ['/static/e0.png', 'characters/old.png']);
    const raw = db.prepare('SELECT image_url, local_path, updated_at FROM character_variants WHERE id = ?').get(variant.id);
    assert.equal(raw.image_url, 'https://cdn.example.com/variant-gen.png');
    assert.equal(raw.local_path, 'projects/0001_20260101_测试剧/characters/variant-gen-local.png');
    assert.ok(raw.updated_at);
    assert.notEqual(raw.updated_at, '2020-01-01T00:00:00.000Z');
  });
});
