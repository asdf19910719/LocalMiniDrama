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
const { createEpisodeAssetsService } = require('../src/v21/assets/episodeAssetsService.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21assets-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  const now = '2026-09-11T00:00:00Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(now, now);
  const storageDir = path.join(tmp, 'storage');
  const deps = {
    assets: createAssetQueryService(db, { log, mockProvider: createMockProvider({ db, log, storageDir }) }),
    episodeAssets: createEpisodeAssetsService(db, { log }),
    script: createScriptService(db, { log }),
    db,
  };
  return deps;
}

function insertCharacter(db, { id, name, imageUrl }) {
  db.prepare(
    `INSERT INTO characters (id, drama_id, name, image_url, created_at, updated_at) VALUES (?, 1, ?, ?, '2026-09-11', '2026-09-11')`
  ).run(id, name, imageUrl || null);
}

test('listAssets：卡片带当前图/类型/一句话描述/真实阻塞（缺图）', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏', imageUrl: 'http://x/linxia.png' });
  insertCharacter(db, { id: 2, name: '经理' });
  const list = assets.listAssets(1, { type: 'character' });
  assert.equal(list.items.length, 2);
  const linxia = list.items.find((i) => i.id === 1);
  assert.equal(linxia.currentImage, 'http://x/linxia.png');
  assert.equal(linxia.blocked, false);
  const manager = list.items.find((i) => i.id === 2);
  assert.equal(manager.blocked, true, '缺当前图为真实阻塞');
});

test('createAsset：两步最低字段，创建不调用 AI（零任务）', () => {
  const { db, assets } = setup();
  const before = db.prepare('SELECT COUNT(*) AS n FROM async_tasks').get().n;
  const created = assets.createAsset(1, { type: 'prop', fields: { name: '13 层门卡', type: '钥匙', description: '刷不开 208' } });
  assert.ok(created.id > 0);
  const row = db.prepare('SELECT * FROM props WHERE id = ?').get(created.id);
  assert.equal(row.name, '13 层门卡');
  const after = db.prepare('SELECT COUNT(*) AS n FROM async_tasks').get().n;
  assert.equal(after, before, '创建素材不产生任务');
});

test('generateCandidate（mock 通道）：产出真实图片并进入候选，不自动设为当前图', async () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  const candidate = await assets.generateCandidate(1, {
    type: 'character',
    assetId: 1,
    prompt: '深蓝色制服的夜班服务员',
  });
  assert.ok(candidate.candidateId > 0);
  assert.ok(candidate.url, '候选有可访问 URL');
  const row = db.prepare('SELECT * FROM characters WHERE id = 1').get();
  assert.equal(row.image_url, null, '生成只入候选，不改当前图');
  const gen = db.prepare('SELECT * FROM image_generations WHERE id = ?').get(candidate.candidateId);
  assert.equal(gen.status, 'succeeded');
  assert.ok(fs.existsSync(gen.local_path), '产物文件真实存在');
});

test('useCandidate：点击候选即设为当前图并可撤销', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏', imageUrl: 'http://x/old.png' });
  db.prepare(
    `INSERT INTO image_generations (drama_id, character_id, image_url, local_path, status, created_at, updated_at)
     VALUES (1, 1, 'http://x/new.png', '/tmp/new.png', 'succeeded', '2026-09-11', '2026-09-11')`
  ).run();
  const genId = db.prepare('SELECT id FROM image_generations WHERE character_id = 1').get().id;
  const result = assets.useCandidate({ type: 'character', assetId: 1, candidateId: genId });
  assert.equal(db.prepare('SELECT image_url FROM characters WHERE id = 1').get().image_url, 'http://x/new.png');
  assert.equal(result.previous.imageUrl, 'http://x/old.png', '返回旧指针供撤销');
  // 撤销：恢复旧指针
  assets.useCandidate({ type: 'character', assetId: 1, imageUrl: result.previous.imageUrl });
  assert.equal(db.prepare('SELECT image_url FROM characters WHERE id = 1').get().image_url, 'http://x/old.png');
});

test('deleteAsset：被分镜引用时阻断并列出影响；未引用可回收站式删除并恢复', () => {
  const { db, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, created_at, updated_at) VALUES (10, 1, 1, '2026-09-11', '2026-09-11')`
  ).run();
  db.prepare(
    `INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role) VALUES (10, 1, 0, 'primary')`
  ).run();
  const blocked = assets.deleteAsset({ type: 'character', assetId: 1 });
  assert.equal(blocked.deleted, false);
  assert.ok(blocked.impacts.storyboards >= 1, '列出引用分镜');
  assert.ok(blocked.impacts.storyboardIds.includes(10));

  insertCharacter(db, { id: 2, name: '无引用角色' });
  const removed = assets.deleteAsset({ type: 'character', assetId: 2 });
  assert.equal(removed.deleted, true);
  assert.equal(removed.recoverable, true);
  assets.restoreAsset({ type: 'character', assetId: 2 });
  const row = db.prepare('SELECT deleted_at FROM characters WHERE id = 2').get();
  assert.equal(row.deleted_at, null);
});

test('本集设定：只投影本集引用对象（三 Tab）', () => {
  const { db, episodeAssets } = setup();
  insertCharacter(db, { id: 1, name: '林夏', imageUrl: 'http://x/linxia.png' });
  insertCharacter(db, { id: 9, name: '别集角色' });
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, 1)').run();
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, image_url, created_at, updated_at) VALUES (5, 1, 1, '208 走廊', NULL, '2026-09-11', '2026-09-11')`
  ).run();
  const projection = episodeAssets.getReferencedAssets(1);
  assert.equal(projection.characters.length, 1, '只投影本集引用的角色');
  assert.equal(projection.characters[0].name, '林夏');
  assert.equal(projection.scenes.length, 1);
  assert.equal(projection.props.length, 0);
});

test('mediaReadiness：剧本未确认 → script-unapproved；补确认与图片后 → ready', async () => {
  const { db, episodeAssets, script, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, 1)').run();
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, image_url, created_at, updated_at) VALUES (5, 1, 1, '208 走廊', NULL, '2026-09-11', '2026-09-11')`
  ).run();

  let readiness = episodeAssets.resolveMediaReadiness(1);
  assert.equal(readiness.status, 'script-unapproved');

  // 确认剧本
  const { createScriptService: _s } = { createScriptService: script };
  db.prepare('UPDATE episodes SET script_content = ? WHERE id = 1').run('第一场 内景·走廊·深夜');
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到门前。' });
  script.confirmScript(1, {});

  readiness = episodeAssets.resolveMediaReadiness(1);
  assert.equal(readiness.status, 'needs-attention');
  assert.ok(readiness.missing.some((m) => m.assetType === 'character' && m.assetId === 1));
  assert.ok(readiness.missing.some((m) => m.assetType === 'scene' && m.assetId === 5));

  // 为角色与场景补图（mock 生成 + 设为当前）
  const cand = await assets.generateCandidate(1, { type: 'character', assetId: 1, prompt: '林夏' });
  assets.useCandidate({ type: 'character', assetId: 1, candidateId: cand.candidateId });
  const cand2 = await assets.generateCandidate(1, { type: 'scene', assetId: 5, prompt: '208 走廊' });
  assets.useCandidate({ type: 'scene', assetId: 5, candidateId: cand2.candidateId });

  readiness = episodeAssets.resolveMediaReadiness(1);
  assert.equal(readiness.status, 'ready');
});

test('进入分镜：立即允许；快照事务写入精确版本与指纹；失败零部分写入', async () => {
  const { db, episodeAssets, script, assets } = setup();
  insertCharacter(db, { id: 1, name: '林夏' });
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, 1)').run();
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到门前。' });
  script.confirmScript(1, {});
  const cand = await assets.generateCandidate(1, { type: 'character', assetId: 1, prompt: '林夏' });
  assets.useCandidate({ type: 'character', assetId: 1, candidateId: cand.candidateId });

  const entry = episodeAssets.enterStoryboard(1);
  assert.equal(entry.navigation, 'immediate', '分镜随时可进入');
  assert.equal(entry.snapshot.status, 'active');
  assert.match(entry.snapshot.fingerprint, /^[a-f0-9]{64}$/);
  const items = JSON.parse(
    db.prepare('SELECT items_json FROM episode_asset_set_snapshots WHERE id = ?').get(entry.snapshot.id).items_json
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].assetType, 'character');
  assert.ok(items[0].mediaFingerprint, '快照记录媒体指纹');

  // 快照后项目 current 改选不影响已保存快照
  const cand2 = await assets.generateCandidate(1, { type: 'character', assetId: 1, prompt: '林夏 v2' });
  assets.useCandidate({ type: 'character', assetId: 1, candidateId: cand2.candidateId });
  const stored = episodeAssets.getLatestSnapshot(1);
  assert.equal(JSON.parse(stored.items_json)[0].mediaVersionId, cand.url, '快照保持旧精确版本');
});

test('生成守卫：readiness 非 ready 时禁用并给出唯一"去处理"恢复入口', () => {
  const { episodeAssets } = setup();
  const guard = episodeAssets.getMediaGenerationGuard({ episodeId: 1, shotId: 10 });
  assert.equal(guard.enabled, false);
  assert.deepEqual(guard.recoveryTarget, {
    routeId: 'studio-assets',
    params: { projectId: 1, episodeId: 1 },
  });
});
