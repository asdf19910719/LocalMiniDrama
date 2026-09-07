const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const sceneService = require('../src/services/sceneService');

describe('scene imported fields', () => {
  it('update/get/list 对 state、description、atmosphere、negative_prompt 对称', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE scenes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, location TEXT, time TEXT,
      state TEXT, description TEXT, prompt TEXT, atmosphere TEXT, negative_prompt TEXT, asset_mode TEXT DEFAULT 'NORMAL',
      polished_prompt TEXT, polished_prompt_single TEXT, image_url TEXT, local_path TEXT,
      extra_images TEXT, ref_image TEXT, storyboard_count INTEGER, status TEXT, error_msg TEXT,
      created_at TEXT, updated_at TEXT, deleted_at TEXT
    )`);
    db.prepare("INSERT INTO scenes (id, drama_id, location, status) VALUES (1, 5, '走廊', 'draft')").run();
    const log = { info() {} };
    const out = sceneService.updateScene(db, log, 1, {
      state: 'night', description: '凌晨走廊', atmosphere: '压抑', negative_prompt: 'daylight',
    });
    assert.equal(out.ok, true);
    const expected = { state: 'night', description: '凌晨走廊', atmosphere: '压抑', negative_prompt: 'daylight' };
    const detail = sceneService.getSceneById(db, 1);
    assert.deepEqual({ state: detail.state, description: detail.description, atmosphere: detail.atmosphere, negative_prompt: detail.negative_prompt }, expected);
    const listed = sceneService.listByDramaId(db, 5)[0];
    assert.deepEqual({ state: listed.state, description: listed.description, atmosphere: listed.atmosphere, negative_prompt: listed.negative_prompt }, expected);
  });

  it('createScene 不丢失场景语义字段', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, episode_id INTEGER, location TEXT, time TEXT,
      state TEXT, description TEXT, prompt TEXT, atmosphere TEXT, negative_prompt TEXT, asset_mode TEXT DEFAULT 'NORMAL',
      polished_prompt TEXT, polished_prompt_single TEXT, image_url TEXT, local_path TEXT,
      extra_images TEXT, ref_image TEXT, storyboard_count INTEGER, status TEXT, error_msg TEXT,
      created_at TEXT, updated_at TEXT, deleted_at TEXT
    )`);
    sceneService.createScene(db, { info() {} }, 5, {
      episode_id: 7, location: '天台', time: '凌晨', state: 'night', description: '湿冷天台',
      atmosphere: '紧张', prompt: 'cinematic rooftop', negative_prompt: 'sunny', asset_mode: 'QUAD_GRID',
    });
    assert.deepEqual(db.prepare('SELECT state, description, atmosphere, prompt, negative_prompt, asset_mode FROM scenes').get(), {
      state: 'night', description: '湿冷天台', atmosphere: '紧张', prompt: 'cinematic rooftop', negative_prompt: 'sunny', asset_mode: 'QUAD_GRID',
    });
    assert.throws(
      () => sceneService.createScene(db, { info() {} }, 5, { location: '非法场景', asset_mode: 'TURNAROUND' }),
      (error) => error.code === 'INVALID_ASSET_MODE'
    );
  });

  it('updateScene 拒绝人物专用模式且保留原场景模式', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE scenes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, location TEXT, asset_mode TEXT DEFAULT 'NORMAL',
      updated_at TEXT, deleted_at TEXT
    )`);
    db.prepare("INSERT INTO scenes (id, drama_id, location) VALUES (1, 5, '走廊')").run();
    assert.throws(
      () => sceneService.updateScene(db, { info() {} }, 1, { asset_mode: 'TURNAROUND' }),
      (error) => error.code === 'INVALID_ASSET_MODE'
    );
    assert.equal(db.prepare('SELECT asset_mode FROM scenes WHERE id=1').get().asset_mode, 'NORMAL');
  });
});
