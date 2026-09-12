'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createAssetQueryService } = require('../src/v21/assets/assetQueryService.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-12T08:00:00Z';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21assetrecycle-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, '回收站项目', 'draft', ?, ?)`
  ).run(NOW, NOW);
  const assets = createAssetQueryService(db, {
    log,
    mockProvider: createMockProvider({ db, log, storageDir: path.join(tmp, 'storage') }),
  });
  return { db, assets };
}

test('listAssets recycled：软删素材只在回收站口径可见并带 deletedAt，恢复端点使其回到默认口径', () => {
  const { assets } = setup();
  const created = assets.createAsset(1, { type: 'character', fields: { name: '林夏' } });
  assets.deleteAsset({ type: 'character', assetId: created.id });
  assert.equal(assets.listAssets(1, {}).items.length, 0, '默认口径不含软删素材');
  const bin = assets.listAssets(1, { recycled: true });
  assert.equal(bin.items.length, 1);
  assert.equal(bin.items[0].id, created.id);
  assert.ok(bin.items[0].deletedAt, '回收站行带删除时间');
  assets.restoreAsset({ type: 'character', assetId: created.id });
  assert.equal(assets.listAssets(1, {}).items.length, 1, '恢复后回到默认口径');
  assert.equal(assets.listAssets(1, { recycled: true }).items.length, 0);
});

test('listAssets recycled：回收站口径与类型筛选、搜索组合生效', () => {
  const { assets } = setup();
  const c1 = assets.createAsset(1, { type: 'character', fields: { name: '林夏' } });
  const c2 = assets.createAsset(1, { type: 'character', fields: { name: '陈默' } });
  const scene = assets.createAsset(1, { type: 'scene', fields: { name: '青石巷' } });
  assets.deleteAsset({ type: 'character', assetId: c1.id });
  assets.deleteAsset({ type: 'scene', assetId: scene.id });
  const binAll = assets.listAssets(1, { recycled: true });
  assert.equal(binAll.items.length, 2);
  const binChar = assets.listAssets(1, { recycled: true, type: 'character' });
  assert.deepEqual(binChar.items.map((i) => i.id), [c1.id]);
  const binSearched = assets.listAssets(1, { recycled: true, q: '林' });
  assert.deepEqual(binSearched.items.map((i) => i.id), [c1.id]);
});

test('listAssets recycled：HTTP query 字符串口径安全——"false" 不得被误判为回收站（回归防护）', () => {
  const { assets } = setup();
  assets.createAsset(1, { type: 'character', fields: { name: '林夏' } });
  // routes 透传 req.query，recycled 以字符串到达：'false' 必须等同默认口径，'true' 才是回收站
  assert.equal(assets.listAssets(1, { recycled: 'false' }).items.length, 1, "字符串 'false' 是 truthy，必须显式按 'true' 判定");
  assert.equal(assets.listAssets(1, { recycled: 'true' }).items.length, 0);
  assert.equal(assets.listAssets(1, { recycled: false }).items.length, 1);
  assert.equal(assets.listAssets(1, {}).items.length, 1);
});
