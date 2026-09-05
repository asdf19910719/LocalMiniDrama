const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const targets = require('../src/services/imageGenerationTargetService');

describe('image generation target adapters and binding', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, appearance TEXT, description TEXT, polished_prompt TEXT, ref_image TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, deleted_at TEXT, updated_at TEXT, image_updated_at TEXT);
      CREATE TABLE character_variants (id INTEGER PRIMARY KEY, character_id INTEGER, source_key TEXT, name TEXT, description TEXT, appearance TEXT, image_prompt TEXT, negative_prompt TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, is_default INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT);
      CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER, location TEXT, time TEXT, prompt TEXT, polished_prompt TEXT, polished_prompt_single TEXT, ref_image TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, status TEXT, deleted_at TEXT, updated_at TEXT, image_updated_at TEXT);
      CREATE TABLE props (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, description TEXT, prompt TEXT, polished_prompt TEXT, ref_image TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, deleted_at TEXT, updated_at TEXT, image_updated_at TEXT);
      CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER);
      CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, scene_id INTEGER, title TEXT, description TEXT, image_prompt TEXT, polished_prompt TEXT, image_url TEXT, local_path TEXT, first_frame_image_id INTEGER, last_frame_image_id INTEGER, last_frame_image_url TEXT, last_frame_local_path TEXT, deleted_at TEXT, updated_at TEXT, image_updated_at TEXT);
      CREATE TABLE image_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, drama_id INTEGER, scene_id INTEGER, character_id INTEGER, provider TEXT, prompt TEXT, frame_type TEXT, image_url TEXT, local_path TEXT, status TEXT, updated_at TEXT);
      CREATE TABLE frame_prompts (id INTEGER PRIMARY KEY, storyboard_id INTEGER, frame_type TEXT, prompt TEXT, description TEXT, layout TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE storyboard_character_variants (id INTEGER PRIMARY KEY, storyboard_id INTEGER, character_id INTEGER, variant_id INTEGER, reference_role TEXT, sort_order INTEGER, framing_note TEXT);
      CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER);
      CREATE TABLE external_generation_results (id TEXT PRIMARY KEY, image_generation_id INTEGER);
    `);
    db.prepare("INSERT INTO characters VALUES (1,7,'林默','黑发少年','角色背景叙事，不应直接作为生图提示词','角色润色','/char-ref.png','/old-char.png','old-char.png',NULL,NULL,NULL,NULL)").run();
    db.prepare("INSERT INTO scenes VALUES (2,7,'雨夜街道','夜晚','湿润街道','四宫格','场景单图','/scene-ref.png','/old-scene.png','old-scene.png',NULL,'generated',NULL,NULL,NULL)").run();
    db.prepare("INSERT INTO props VALUES (3,7,'钥匙','青铜古钥匙','道具提示','道具润色','/prop-ref.png','/old-prop.png','old-prop.png',NULL,NULL,NULL,NULL)").run();
    db.prepare('INSERT INTO episodes VALUES (10,7)').run();
    db.prepare("INSERT INTO storyboards VALUES (4,10,2,'镜头','人物转身','普通提示','分镜润色','/old-main.png','old-main.png',40,41,'/old-last.png','old-last.png',NULL,NULL,NULL)").run();
    for (const row of [
      [50, null, 7, null, 1], [51, null, 7, 2, null], [52, null, 7, null, null],
      [53, 4, 7, null, null], [54, 4, 7, null, null], [55, 4, 7, null, null],
    ]) db.prepare("INSERT INTO image_generations (id,storyboard_id,drama_id,scene_id,character_id,provider,prompt,image_url,local_path,status) VALUES (?,?,?,?,?,'external:chatgpt-web','p',?,?,'completed')")
      .run(...row, `/new-${row[0]}.png`, `new-${row[0]}.png`);
    db.exec('ALTER TABLE scenes ADD COLUMN state TEXT; ALTER TABLE storyboards ADD COLUMN characters TEXT;');
  });

  afterEach(() => db.close());

  it('builds authoritative prompts for every resource kind', () => {
    assert.equal(targets.buildGenerationInput(db, { drama_id: 7, target_type: 'character', target_id: 1 }).prompt, '角色润色');
    assert.equal(targets.buildGenerationInput(db, { drama_id: 7, target_type: 'scene', target_id: 2 }).prompt, '场景单图');
    assert.equal(targets.buildGenerationInput(db, { drama_id: 7, target_type: 'prop', target_id: 3 }).prompt, '道具润色');
    assert.equal(targets.buildGenerationInput(db, { drama_id: 7, target_type: 'storyboard_main', target_id: 4 }).prompt, '分镜润色');
  });

  it('never falls back to a character background description when building an image prompt', () => {
    db.prepare('UPDATE characters SET polished_prompt=NULL WHERE id=1').run();
    assert.equal(targets.buildGenerationInput(db, { drama_id: 7, target_type: 'character', target_id: 1 }).prompt, '黑发少年');
  });

  it('does not reuse a character output image as an implicit text-to-image reference', () => {
    const generation = targets.buildGenerationInput(db, {
      drama_id: 7,
      target_type: 'character',
      target_id: 1,
      prompt_snapshot: '新的角色外观提示词',
    });

    assert.equal(generation.prompt, '新的角色外观提示词');
    assert.deepEqual(generation.references, []);
  });

  it('binds character, scene, and prop results while preserving old images', () => {
    targets.bindResult(db, { drama_id: 7, target_type: 'character', target_id: 1 }, 50);
    targets.bindResult(db, { drama_id: 7, target_type: 'scene', target_id: 2 }, 51);
    targets.bindResult(db, { drama_id: 7, target_type: 'prop', target_id: 3 }, 52);

    const character = db.prepare('SELECT * FROM characters WHERE id=1').get();
    const scene = db.prepare('SELECT * FROM scenes WHERE id=2').get();
    const prop = db.prepare('SELECT * FROM props WHERE id=3').get();
    assert.equal(character.image_url, '/new-50.png');
    assert.match(character.extra_images, /old-char\.png/);
    assert.equal(scene.image_url, '/new-51.png');
    assert.match(scene.extra_images, /old-scene\.png/);
    assert.equal(prop.image_url, '/new-52.png');
    assert.match(prop.extra_images, /old-prop\.png/);
  });

  it('binds storyboard main, first, and last to their authoritative fields', () => {
    const before = db.prepare('SELECT first_frame_image_id FROM storyboards WHERE id=4').get().first_frame_image_id;
    targets.bindResult(db, { drama_id: 7, target_type: 'storyboard_main', target_id: 4 }, 53);
    assert.equal(db.prepare('SELECT first_frame_image_id FROM storyboards WHERE id=4').get().first_frame_image_id, before);
    targets.bindResult(db, { drama_id: 7, target_type: 'storyboard_first', target_id: 4 }, 54);
    targets.bindResult(db, { drama_id: 7, target_type: 'storyboard_last', target_id: 4 }, 55);

    const storyboard = db.prepare('SELECT * FROM storyboards WHERE id=4').get();
    assert.equal(storyboard.first_frame_image_id, 54);
    assert.equal(storyboard.last_frame_image_id, 55);
    assert.equal(storyboard.last_frame_image_url, '/new-55.png');
    assert.equal(db.prepare('SELECT frame_type FROM image_generations WHERE id=54').get().frame_type, 'storyboard_first');
    assert.equal(db.prepare('SELECT frame_type FROM image_generations WHERE id=55').get().frame_type, 'storyboard_last');
  });

  it('uses the matching frame prompt for first and last targets', () => {
    db.prepare("INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, updated_at) VALUES (4, 'first', '专业首帧提示', '2026-01-01')").run();
    db.prepare("INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, updated_at) VALUES (4, 'last', '专业尾帧提示', '2026-01-02')").run();
    assert.equal(targets.buildGenerationInput(db, { drama_id: 7, target_type: 'storyboard_first', target_id: 4 }).prompt, '专业首帧提示');
    assert.equal(targets.buildGenerationInput(db, { drama_id: 7, target_type: 'storyboard_last', target_id: 4 }).prompt, '专业尾帧提示');
  });

  it('uses canonical scene, selected character variant, and prop references in slot order', () => {
    db.prepare("UPDATE scenes SET image_url='/ignored-scene.png', local_path='scenes/canonical.png', state='雨夜' WHERE id=2").run();
    db.prepare(`INSERT INTO character_variants
      (id, character_id, source_key, name, image_url, local_path, is_default, updated_at, deleted_at)
      VALUES (8, 1, 'lin_work', '工作状态', '/ignored-variant.png', 'variants/work.png', 0, '2026-09-05', NULL)`).run();
    db.prepare(`INSERT INTO storyboard_character_variants
      (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note)
      VALUES (4, 1, 8, 'supporting', 3, '半身')`).run();
    db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (4, 3)').run();

    const generation = targets.buildGenerationInput(db, {
      drama_id: 7,
      target_type: 'storyboard_main',
      target_id: 4,
    });

    assert.deepEqual(generation.references, [
      { role: 'scene', sourceId: 2, url: '/static/scenes/canonical.png', slotIndex: 1, assetId: 2, variantId: null, name: '雨夜街道·雨夜', referenceRole: null, framingNote: null },
      { role: 'character_variant', sourceId: 8, url: '/static/variants/work.png', slotIndex: 2, assetId: 1, variantId: 8, name: '工作状态', referenceRole: 'supporting', framingNote: '半身' },
      { role: 'prop', sourceId: 3, url: '/static/old-prop.png', slotIndex: 3, assetId: 3, variantId: null, name: '钥匙', referenceRole: null, framingNote: null },
    ]);
    assert.ok(!generation.references.some((item) => item.url === '/char-ref.png' || item.url === '/old-char.png'));
  });

  it('maps an imported absolute variant image path to its extension-fetchable content endpoint', () => {
    const externalPath = 'E:\\project\\LocalMiniDrama\\backend-node\\data\\external-web\\7\\job\\result-abc\\image.png';
    db.prepare(`INSERT INTO character_variants
      (id, character_id, source_key, name, image_url, local_path, is_default, updated_at, deleted_at)
      VALUES (9, 1, 'lin_external', '外部结果状态', 'https://example.invalid/fallback.png', ?, 0, '2026-09-05', NULL)`).run(externalPath);
    db.prepare(`INSERT INTO storyboard_character_variants
      (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note)
      VALUES (4, 1, 9, 'primary', 1, NULL)`).run();
    db.prepare("INSERT INTO image_generations (id, drama_id, image_url, local_path, status) VALUES (99, 7, '/remote.png', ?, 'completed')").run(externalPath);
    db.prepare("INSERT INTO external_generation_results (id, image_generation_id) VALUES ('result-abc', 99)").run();

    const { references } = targets.buildGenerationInput(db, {
      drama_id: 7,
      target_type: 'storyboard_first',
      target_id: 4,
    });

    assert.equal(references[1].url, '/api/v1/external-generation/results/result-abc/content');
    assert.equal(references[1].sourceId, 9);
  });

  it('rejects binding an image or target from another drama', () => {
    assert.throws(() => targets.bindResult(db, { drama_id: 8, target_type: 'character', target_id: 1 }, 50), /drama/i);
  });

  it('builds variant prompts from image_prompt and binds results back to the variant row', () => {
    db.prepare(`INSERT INTO character_variants
      (id, character_id, source_key, name, description, appearance, image_prompt, image_url, local_path, extra_images, is_default, updated_at, deleted_at)
      VALUES (1, 1, 'char_lin_default', '默认状态', '日常造型', '黑发束起', '状态生图提示词', '/old-variant.png', 'old-variant.png', NULL, 1, NULL, NULL)`).run();

    const generation = targets.buildGenerationInput(db, { drama_id: 7, target_type: 'character_variant', target_id: 1 });
    assert.equal(generation.prompt, '状态生图提示词');
    assert.deepEqual(generation.references, [
      { role: 'character_identity', sourceId: 1, url: '/static/old-char.png' },
    ]);

    db.prepare('UPDATE character_variants SET image_prompt=NULL WHERE id=1').run();
    assert.equal(targets.buildGenerationInput(db, { drama_id: 7, target_type: 'character_variant', target_id: 1 }).prompt, '黑发束起');

    targets.bindResult(db, { drama_id: 7, target_type: 'character_variant', target_id: 1 }, 50);
    const variant = db.prepare('SELECT * FROM character_variants WHERE id=1').get();
    assert.equal(variant.image_url, '/new-50.png');
    assert.equal(variant.local_path, 'new-50.png');
    assert.match(variant.extra_images, /old-variant\.png/);
    assert.ok(variant.updated_at);

    assert.throws(() => targets.bindResult(db, { drama_id: 8, target_type: 'character_variant', target_id: 1 }, 50), /drama/i);
  });

  it('records image_updated_at on asset and storyboard rows when binding', () => {
    targets.bindResult(db, { drama_id: 7, target_type: 'character', target_id: 1 }, 50);
    targets.bindResult(db, { drama_id: 7, target_type: 'storyboard_main', target_id: 4 }, 53);
    assert.ok(db.prepare('SELECT image_updated_at FROM characters WHERE id=1').get().image_updated_at);
    assert.ok(db.prepare('SELECT image_updated_at FROM storyboards WHERE id=4').get().image_updated_at);
  });

});
