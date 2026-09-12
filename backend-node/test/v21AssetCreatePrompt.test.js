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
const NOW = '2026-09-12T08:00:00Z';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21assetcreate-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, '创建素材项目', 'draft', ?, ?)`
  ).run(NOW, NOW);
  const assets = createAssetQueryService(db, {
    log,
    mockProvider: createMockProvider({ db, log, storageDir: path.join(tmp, 'storage') }),
  });
  return { db, assets };
}

test('createAsset：三类素材均接受生图提示词与负向提示词（对齐旧版 v1 创建输入）', () => {
  const { db, assets } = setup();
  const character = assets.createAsset(1, {
    type: 'character',
    fields: { name: '林夏', role: '主角', prompt: '短发女孩，高定礼服草图师气质', negativePrompt: '塑料感，磨皮' },
  });
  const scene = assets.createAsset(1, {
    type: 'scene',
    fields: { name: '青石巷', time: '夜', prompt: '雨夜青石板巷，霓虹灯漫反射', negativePrompt: '过曝' },
  });
  const prop = assets.createAsset(1, {
    type: 'prop',
    fields: { name: '设计草图', type: '纸张', prompt: '铅笔手绘高定礼服草图，纸面有超市小票', negativePrompt: '模糊' },
  });
  const row = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  const c = row('characters', character.id);
  assert.equal(c.polished_prompt, '短发女孩，高定礼服草图师气质');
  assert.equal(c.negative_prompt, '塑料感，磨皮');
  assert.equal(c.role, '主角');
  const s = row('scenes', scene.id);
  assert.equal(s.prompt, '雨夜青石板巷，霓虹灯漫反射');
  assert.equal(s.negative_prompt, '过曝');
  assert.equal(s.time, '夜');
  const p = row('props', prop.id);
  assert.equal(p.prompt, '铅笔手绘高定礼服草图，纸面有超市小票');
  assert.equal(p.negative_prompt, '模糊');
  assert.equal(p.type, '纸张');
});

test('getDetail 透出已保存的生图提示词（characters 读 polished_prompt，scenes/props 读 prompt）', () => {
  const { assets } = setup();
  const character = assets.createAsset(1, {
    type: 'character',
    fields: { name: '林夏', prompt: '短发女孩，礼服草图师', negativePrompt: '塑料感' },
  });
  const detail = assets.getDetail('character', character.id);
  assert.equal(detail.prompt, '短发女孩，礼服草图师');
  assert.equal(detail.negativePrompt, '塑料感');
});

test('generateCandidate：调用方未传提示词时回退素材已保存提示词，再回退素材名', async () => {
  const { assets } = setup();
  const named = assets.createAsset(1, { type: 'character', fields: { name: '林夏' } });
  const withPrompt = assets.createAsset(1, {
    type: 'character',
    fields: { name: '陈默', prompt: '中年男性，考究西装' },
  });
  await assets.generateCandidate(1, { type: 'character', assetId: named.id, prompt: '' });
  await assets.generateCandidate(1, { type: 'character', assetId: withPrompt.id, prompt: '' });
  // 经 getDetail 的生成记录校验落库提示词
  const detailNamed = assets.getDetail('character', named.id);
  const detailPrompt = assets.getDetail('character', withPrompt.id);
  assert.equal((detailNamed.records[0] || {}).prompt, '林夏', '无提示词素材回退素材名');
  assert.equal((detailPrompt.records[0] || {}).prompt, '中年男性，考究西装', '有提示词素材优先已保存提示词');
});
