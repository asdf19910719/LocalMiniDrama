const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const sceneService = require('../src/services/sceneService');

describe('scene imported fields', () => {
  it('update/get/list 对 state、description、atmosphere、negative_prompt 对称', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE scenes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, location TEXT, time TEXT,
      state TEXT, description TEXT, prompt TEXT, atmosphere TEXT, negative_prompt TEXT,
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
});
