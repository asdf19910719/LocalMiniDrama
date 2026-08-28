const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const targets = require('../src/services/imageGenerationTargetService');

describe('image generation target adapters and binding', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, appearance TEXT, description TEXT, polished_prompt TEXT, ref_image TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, deleted_at TEXT, updated_at TEXT);
      CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER, location TEXT, time TEXT, prompt TEXT, polished_prompt TEXT, polished_prompt_single TEXT, ref_image TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, status TEXT, deleted_at TEXT, updated_at TEXT);
      CREATE TABLE props (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, description TEXT, prompt TEXT, polished_prompt TEXT, ref_image TEXT, image_url TEXT, local_path TEXT, extra_images TEXT, deleted_at TEXT, updated_at TEXT);
      CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER);
      CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, scene_id INTEGER, title TEXT, description TEXT, image_prompt TEXT, polished_prompt TEXT, image_url TEXT, local_path TEXT, first_frame_image_id INTEGER, last_frame_image_id INTEGER, last_frame_image_url TEXT, last_frame_local_path TEXT, deleted_at TEXT, updated_at TEXT);
      CREATE TABLE image_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, drama_id INTEGER, scene_id INTEGER, character_id INTEGER, provider TEXT, prompt TEXT, frame_type TEXT, image_url TEXT, local_path TEXT, status TEXT, updated_at TEXT);
      CREATE TABLE frame_prompts (id INTEGER PRIMARY KEY, storyboard_id INTEGER, frame_type TEXT, prompt TEXT, description TEXT, layout TEXT, created_at TEXT, updated_at TEXT);
    `);
    db.prepare("INSERT INTO characters VALUES (1,7,'林默','黑发少年','角色背景叙事，不应直接作为生图提示词','角色润色','/char-ref.png','/old-char.png','old-char.png',NULL,NULL,NULL)").run();
    db.prepare("INSERT INTO scenes VALUES (2,7,'雨夜街道','夜晚','湿润街道','四宫格','场景单图','/scene-ref.png','/old-scene.png','old-scene.png',NULL,'generated',NULL,NULL)").run();
    db.prepare("INSERT INTO props VALUES (3,7,'钥匙','青铜古钥匙','道具提示','道具润色','/prop-ref.png','/old-prop.png','old-prop.png',NULL,NULL,NULL)").run();
    db.prepare('INSERT INTO episodes VALUES (10,7)').run();
    db.prepare("INSERT INTO storyboards VALUES (4,10,2,'镜头','人物转身','普通提示','分镜润色','/old-main.png','old-main.png',40,41,'/old-last.png','old-last.png',NULL,NULL)").run();
    for (const row of [
      [50, null, 7, null, 1], [51, null, 7, 2, null], [52, null, 7, null, null],
      [53, 4, 7, null, null], [54, 4, 7, null, null], [55, 4, 7, null, null],
    ]) db.prepare("INSERT INTO image_generations (id,storyboard_id,drama_id,scene_id,character_id,provider,prompt,image_url,local_path,status) VALUES (?,?,?,?,?,'external:chatgpt-web','p',?,?,'completed')")
      .run(...row, `/new-${row[0]}.png`, `new-${row[0]}.png`);
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

  it('rejects binding an image or target from another drama', () => {
    assert.throws(() => targets.bindResult(db, { drama_id: 8, target_type: 'character', target_id: 1 }, 50), /drama/i);
  });
});
