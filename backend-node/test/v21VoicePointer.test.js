'use strict';
/**
 * B4 人物音色真实来源：updateSelection 持久化音色指针（voice_json），
 * 引用投影回读 voice；音色文件本身走既有 /api/v1/characters/:id/sd2-voice-upload。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createEpisodeAssetsService } = require('../src/v21/assets/episodeAssetsService.js');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-11T00:00:00Z';

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '剧', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(NOW, NOW);
  const info = db.prepare(
    `INSERT INTO characters (drama_id, name, image_url, created_at, updated_at) VALUES (1, '林夏', '/static/c.png', ?, ?)`
  ).run(NOW, NOW);
  const characterId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, ?)').run(characterId);
  const svc = createEpisodeAssetsService(db, { log });
  return { db, svc, characterId };
}

test('音色指针：updateSelection 保存 voice，投影回读；undefined 保持不变；null 清除', () => {
  const { db, svc, characterId } = setup();
  svc.updateSelection(1, { assetType: 'character', assetId: characterId, voice: { source: 'upload', url: '/static/voice.mp3', name: '林夏配音' } });
  let data = { referenced: svc.getReferencedAssets(1) };
  assert.deepEqual(data.referenced.characters[0].voice, { source: 'upload', url: '/static/voice.mp3', name: '林夏配音' });

  // 不带 voice 的普通更新（切换状态）不得清掉音色
  svc.updateSelection(1, { assetType: 'character', assetId: characterId, stateId: 'v9' });
  data = { referenced: svc.getReferencedAssets(1) };
  assert.equal(data.referenced.characters[0].voice.url, '/static/voice.mp3');

  // 显式 voice=null 清除
  svc.updateSelection(1, { assetType: 'character', assetId: characterId, voice: null });
  data = { referenced: svc.getReferencedAssets(1) };
  assert.equal(data.referenced.characters[0].voice, null);
  const row = db.prepare('SELECT voice_json FROM episode_asset_selections WHERE episode_id = 1').get();
  assert.equal(row.voice_json, null);
});
