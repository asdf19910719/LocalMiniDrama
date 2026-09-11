'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createAssetQueryService } = require('../src/v21/assets/assetQueryService.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-11T00:00:00Z';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21assetdetail-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (2, 1, 2, 'EP02', 'draft', ?, ?)`
  ).run(NOW, NOW);
  const assets = createAssetQueryService(db, {
    log,
    mockProvider: createMockProvider({ db, log, storageDir: path.join(tmp, 'storage') }),
  });
  return { db, assets };
}

function insertCharacter(db, { id, name, imageUrl }) {
  db.prepare(
    `INSERT INTO characters (id, drama_id, name, image_url, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)`
  ).run(id, name, imageUrl || null, NOW, NOW);
}

function insertScene(db, { id, location, episodeId }) {
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, image_url, created_at, updated_at) VALUES (?, 1, ?, ?, NULL, ?, ?)`
  ).run(id, episodeId == null ? null : Number(episodeId), location, NOW, NOW);
}

function insertProp(db, { id, name, type }) {
  db.prepare(
    `INSERT INTO props (id, drama_id, name, type, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)`
  ).run(id, name, type || null, NOW, NOW);
}

function insertVariant(db, { id, characterId, name, imageUrl, isDefault, deleted }) {
  db.prepare(
    `INSERT INTO character_variants (id, character_id, name, image_url, is_default, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, characterId, name, imageUrl || null, isDefault ? 1 : 0, NOW, NOW, deleted ? NOW : null);
}

function insertGeneration(db, { characterId = null, sceneId = null, prompt = '', provider = 'mock', status = 'succeeded', url = null }) {
  const info = db.prepare(
    `INSERT INTO image_generations (drama_id, character_id, scene_id, provider, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(characterId, sceneId, provider, prompt, url, url ? '/tmp/x.png' : null, status, NOW, NOW);
  return Number(info.lastInsertRowid);
}

// ---- PATCH /assets/:type/:assetId ----

test('updateAsset：更新 name/description（scene 名=location、prop type 白名单），getDetail 反映', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  const r = assets.updateAsset('character', 1, { name: '林夏·改', description: '夜班服务员', role: '主角' });
  assert.equal(r.name, '林夏·改');
  let detail = assets.getDetail('character', 1);
  assert.equal(detail.name, '林夏·改');
  assert.equal(detail.description, '夜班服务员');

  insertScene(db, { id: 5, location: '208 走廊', episodeId: 1 });
  assets.updateAsset('scene', 5, { name: '天台', time: '黄昏', description: '俯瞰城市' });
  detail = assets.getDetail('scene', 5);
  assert.equal(detail.name, '天台', '场景 name 落到 location 列');
  const sceneRow = db.prepare('SELECT location, time, description FROM scenes WHERE id = 5').get();
  assert.equal(sceneRow.location, '天台');
  assert.equal(sceneRow.time, '黄昏');
  assert.equal(sceneRow.description, '俯瞰城市');

  insertProp(db, { id: 9, name: '门卡', type: '钥匙' });
  assets.updateAsset('prop', 9, { name: '13 层门卡', type: '门禁卡' });
  detail = assets.getDetail('prop', 9);
  assert.equal(detail.name, '13 层门卡');
  assert.equal(db.prepare('SELECT type FROM props WHERE id = 9').get().type, '门禁卡');
});

test('updateAsset：软删 404；空 name 400；未知类型 400；仅改 description 合法', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  db.prepare('UPDATE characters SET deleted_at = ? WHERE id = 1').run(NOW);
  assert.throws(
    () => assets.updateAsset('character', 1, { name: '任意' }),
    (e) => e.code === 'NOT_FOUND' && e.status === 404
  );
  insertCharacter(db, { id: 2, name: '经理' });
  for (const bad of ['', '   ']) {
    assert.throws(
      () => assets.updateAsset('character', 2, { name: bad }),
      (e) => e.code === 'VALIDATION_ERROR' && e.status === 400,
      `空名称 "${bad}" 应 400`
    );
  }
  assert.throws(
    () => assets.updateAsset('vehicle', 2, { name: 'x' }),
    (e) => e.status === 400,
    '未知素材类型 400'
  );
  // 仅更新 description（不带 name）合法，name 原样保留
  const r = assets.updateAsset('character', 2, { description: '只改描述' });
  assert.equal(db.prepare('SELECT description FROM characters WHERE id = 2').get().description, '只改描述');
  assert.equal(r.name, '经理');
});

// ---- getDetail 扩展：states[].imageUrl/isDefault ----

test('getDetail：states 每项带 imageUrl 与 isDefault，软删状态不出现', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏', imageUrl: 'http://x/cur.png' });
  insertVariant(db, { id: 11, characterId: 1, name: '常服', imageUrl: 'http://x/a.png', isDefault: 1 });
  insertVariant(db, { id: 12, characterId: 1, name: '夜班服', imageUrl: null, isDefault: 0 });
  insertVariant(db, { id: 13, characterId: 1, name: '已删状态', imageUrl: 'http://x/gone.png', isDefault: 0, deleted: true });
  const detail = assets.getDetail('character', 1);
  assert.equal(detail.states.length, 2, '软删状态不出现');
  const def = detail.states.find((st) => st.id === 11);
  assert.equal(def.imageUrl, 'http://x/a.png');
  assert.equal(def.isDefault, true);
  const night = detail.states.find((st) => st.id === 12);
  assert.equal(night.imageUrl, null);
  assert.equal(night.isDefault, false);
  assert.ok(detail.createdAt, 'getDetail 返回创建时间（高级标签只读信息）');
  assert.equal(detail.assetType, 'character');
});

// ---- getDetail 扩展：usage ----

test('getDetail：usage 按集汇总引用（出演/场景/道具/本集引用），同集多分镜去重', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, 1)').run();
  db.prepare(
    `INSERT INTO episode_asset_selections (episode_id, asset_type, asset_id, selected_at, updated_at) VALUES (1, 'character', 1, ?, ?)`
  ).run(NOW, NOW);
  let usage = assets.getDetail('character', 1).usage;
  assert.ok(usage.some((u) => u.episodeId === 1 && u.kind === 'cast' && u.episodeNumber === 1), 'episode_characters → cast');
  assert.ok(usage.some((u) => u.episodeId === 1 && u.kind === 'selection'), 'episode_asset_selections → selection');

  // 同一集多个分镜引用同一道具 → 按集去重为一条
  insertProp(db, { id: 9, name: '门卡' });
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, created_at, updated_at) VALUES (10, 1, 1, ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, created_at, updated_at) VALUES (11, 1, 2, ?, ?)`
  ).run(NOW, NOW);
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (10, 9)').run();
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (11, 9)').run();
  usage = assets.getDetail('prop', 9).usage;
  const propEntries = usage.filter((u) => u.kind === 'prop');
  assert.equal(propEntries.length, 1, '同一集多个分镜引用去重为一条');
  assert.equal(propEntries[0].episodeId, 1);
  assert.equal(propEntries[0].episodeNumber, 1);

  // 场景：scenes.episode_id
  insertScene(db, { id: 5, location: '208 走廊', episodeId: 2 });
  usage = assets.getDetail('scene', 5).usage;
  assert.ok(usage.some((u) => u.episodeId === 2 && u.kind === 'scene' && u.episodeNumber === 2), 'scenes.episode_id → scene');

  // 未被引用的素材 usage 为空
  insertCharacter(db, { id: 3, name: '路人' });
  assert.deepEqual(assets.getDetail('character', 3).usage, []);
});

// ---- getDetail 扩展：records ----

test('getDetail：records 生成/上传记录倒序（含失败与上传），限 50 条', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  insertGeneration(db, { characterId: 1, prompt: '第一条', provider: 'mock', status: 'succeeded', url: 'http://x/1.png' });
  insertGeneration(db, { characterId: 1, prompt: '失败尝试', provider: 'mock', status: 'failed', url: null });
  insertGeneration(db, { characterId: 1, prompt: '', provider: 'upload', status: 'succeeded', url: 'http://x/2.png' });
  const records = assets.getDetail('character', 1).records;
  assert.equal(records.length, 3);
  assert.equal(records[0].prompt, '', '倒序：最新在上');
  assert.equal(records[2].prompt, '第一条');
  for (const r of records) {
    assert.ok('candidateId' in r && 'provider' in r && 'createdAt' in r && 'prompt' in r && 'status' in r);
  }
  assert.equal(records.find((r) => r.status === 'failed').prompt, '失败尝试', '失败记录也可见');
  // prop 记录经 image_generation_tasks 关联可见
  insertProp(db, { id: 9, name: '门卡' });
  const genId = insertGeneration(db, { prompt: '门卡特写', provider: 'mock', status: 'succeeded', url: 'http://x/k.png' });
  db.prepare(
    `INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, provider, prompt_snapshot, status, image_generation_id, created_at, updated_at)
     VALUES ('t1', 1, 'prop', 9, 'mock', 'mock', '门卡特写', 'succeeded', ?, ?, ?)`
  ).run(genId, NOW, NOW);
  const propRecords = assets.getDetail('prop', 9).records;
  assert.equal(propRecords.length, 1);
  assert.equal(propRecords[0].prompt, '门卡特写');
});

// ---- POST /assets/:type/:assetId/states/:stateId/image ----

test('setStateImage：设置状态当前图并反映到 states；scene 类型 400；软删素材/未知状态 404；空 URL 400', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  insertVariant(db, { id: 11, characterId: 1, name: '常服', imageUrl: null, isDefault: 1 });
  const r = assets.setStateImage({ type: 'character', assetId: 1, stateId: 11, imageUrl: 'http://x/state.png' });
  assert.equal(r.state.imageUrl, 'http://x/state.png');
  assert.equal(assets.getDetail('character', 1).states[0].imageUrl, 'http://x/state.png');
  // 人物当前图不受影响（端点只改状态图）
  assert.equal(db.prepare('SELECT image_url FROM characters WHERE id = 1').get().image_url, null);

  insertScene(db, { id: 5, location: '走廊', episodeId: null });
  assert.throws(
    () => assets.setStateImage({ type: 'scene', assetId: 5, stateId: 11, imageUrl: 'http://x/a.png' }),
    (e) => e.status === 400,
    '仅人物素材支持状态图，其他类型 400'
  );
  db.prepare('UPDATE characters SET deleted_at = ? WHERE id = 1').run(NOW);
  assert.throws(
    () => assets.setStateImage({ type: 'character', assetId: 1, stateId: 11, imageUrl: 'http://x/a.png' }),
    (e) => e.status === 404,
    '软删素材 404'
  );
  insertCharacter(db, { id: 2, name: '经理' });
  assert.throws(
    () => assets.setStateImage({ type: 'character', assetId: 2, stateId: 11, imageUrl: 'http://x/a.png' }),
    (e) => e.status === 404,
    '状态不属于该人物 404'
  );
  assert.throws(
    () => assets.setStateImage({ type: 'character', assetId: 2, stateId: 11, imageUrl: '  ' }),
    (e) => e.status === 400,
    '空 imageUrl 400（requireAsset 在先，用未删除素材校验）'
  );
});

// ---- generateCandidate 支持 stateId（可选顺手项） ----

test('generateCandidate：stateId 注入状态名前缀（仅提示词组装，不改表）', async () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  insertVariant(db, { id: 11, characterId: 1, name: '夜班服', imageUrl: null, isDefault: 0 });
  const c = await assets.generateCandidate(1, { type: 'character', assetId: 1, prompt: '站在走廊尽头', stateId: 11 });
  const gen = db.prepare('SELECT prompt FROM image_generations WHERE id = ?').get(c.candidateId);
  assert.match(gen.prompt, /夜班服/, '提示词包含状态名');
  assert.match(gen.prompt, /站在走廊/, '提示词包含原始内容');
  assert.equal(db.prepare('SELECT image_url FROM character_variants WHERE id = 11').get().image_url, null, '不改状态表');
  assert.equal(db.prepare('SELECT image_url FROM characters WHERE id = 1').get().image_url, null, '不改当前图');
  await assert.rejects(
    () => assets.generateCandidate(1, { type: 'character', assetId: 1, prompt: 'x', stateId: 999 }),
    (e) => e.status === 404,
    '状态不存在 404'
  );
});
