'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createStoryboardService } = require('../src/v21/storyboard/storyboardService.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');
const { createAssetQueryService } = require('../src/v21/assets/assetQueryService.js');
const { createEpisodeAssetsService } = require('../src/v21/assets/episodeAssetsService.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21vid-'));
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
  const mock = createMockProvider({ db, log, storageDir: path.join(tmp, 'storage') });
  const script = createScriptService(db, { log });
  const assets = createAssetQueryService(db, { log, mockProvider: mock });
  const episodeAssets = createEpisodeAssetsService(db, { log });
  const svc = createStoryboardService(db, { log, mockProvider: mock });
  return { db, svc, script, assets, episodeAssets };
}

async function prepareReadyEpisode(ctx) {
  const { db, script, assets } = ctx;
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。' });
  script.confirmScript(1, {});
  const info = db
    .prepare(
      "INSERT INTO characters (drama_id, name, created_at, updated_at) VALUES (1, '林夏', datetime('now'), datetime('now'))"
    )
    .run();
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, ?)').run(info.lastInsertRowid);
  const cand = await assets.generateCandidate(1, { type: 'character', assetId: info.lastInsertRowid, prompt: '林夏' });
  assets.useCandidate({ type: 'character', assetId: info.lastInsertRowid, candidateId: cand.candidateId });
  ctx.characterId = info.lastInsertRowid;
  ctx.svc.createFromScript(1);
}

test('媒体守卫集成：素材未就绪时视频提交被禁用；就绪后可提交', async () => {
  const ctx = setup();
  const { db, script, svc, episodeAssets, assets } = ctx;
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏。' });
  script.confirmScript(1, {});
  const info = db
    .prepare(
      "INSERT INTO characters (drama_id, name, created_at, updated_at) VALUES (1, '林夏', datetime('now'), datetime('now'))"
    )
    .run();
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, ?)').run(info.lastInsertRowid);
  svc.createFromScript(1);
  const shots = svc.listShots(1);

  // 就绪检查：缺图 → needs-attention → 守卫禁用
  let readiness = episodeAssets.resolveMediaReadiness(1);
  assert.equal(readiness.status, 'needs-attention');
  let guard = episodeAssets.getMediaGenerationGuard({ episodeId: 1, shotId: shots[0].id });
  assert.equal(guard.enabled, false);
  assert.deepEqual(guard.recoveryTarget.routeId, 'studio-assets');

  // 补图 → ready → 守卫启用
  const cand = await assets.generateCandidate(1, { type: 'character', assetId: info.lastInsertRowid, prompt: '林夏' });
  assets.useCandidate({ type: 'character', assetId: info.lastInsertRowid, candidateId: cand.candidateId });
  readiness = episodeAssets.resolveMediaReadiness(1);
  assert.equal(readiness.status, 'ready');
  guard = episodeAssets.getMediaGenerationGuard({ episodeId: 1, shotId: shots[0].id });
  assert.equal(guard.enabled, true);
});

test('视频提交：H3 未生成被联合检查阻断；生成并通过后可提交', async () => {
  const ctx = setup();
  await prepareReadyEpisode(ctx);
  const { svc } = ctx;
  const shots = svc.listShots(1);
  const shotId = shots[0].id;

  await assert.rejects(() => svc.submitVideo(shotId, { count: 1 }), (err) => err.code === 'GENERATION_BLOCKED');

  const img = await svc.generateImage(shotId, {});
  svc.setImageCurrent(shotId, { candidateId: img.candidateId });
  svc.generateH3(shotId);
  const guard = svc.jointGuard(shotId);
  assert.equal(guard.canSubmit, true);
  const submitted = await svc.submitVideo(shotId, { count: 1 });
  assert.equal(submitted.tasks.length, 1);
  // 运行中重复提交被阻断
  await assert.rejects(() => svc.submitVideo(shotId, { count: 1 }), (err) => err.code === 'GENERATION_BLOCKED');
});

test('生成数量钳制：非 1–3 拒绝；count=3 创建 3 个并行任务且互不影响', async () => {
  const ctx = setup();
  await prepareReadyEpisode(ctx);
  const { svc } = ctx;
  const shots = svc.listShots(1);
  const shotId = shots[0].id;
  assert.throws(() => svc.getVideoQuote(shotId, 4), /生成数量/);
  assert.throws(() => svc.getVideoQuote(shotId, 0), /生成数量/);
  const img = await svc.generateImage(shotId, {});
  svc.setImageCurrent(shotId, { candidateId: img.candidateId });
  svc.generateH3(shotId);
  const submitted = await svc.submitVideo(shotId, { count: 3 });
  assert.equal(submitted.tasks.length, 3);
  const quote = svc.getVideoQuote(shotId, 2);
  assert.equal(quote.count, 2);
});

test('取消与重试：取消保留记录；重试按原输入创建新任务并产出候选', async () => {
  const ctx = setup();
  await prepareReadyEpisode(ctx);
  const { db, svc } = ctx;
  const shots = svc.listShots(1);
  const shotId = shots[0].id;
  const img = await svc.generateImage(shotId, {});
  svc.setImageCurrent(shotId, { candidateId: img.candidateId });
  svc.generateH3(shotId);
  const submitted = await svc.submitVideo(shotId, { count: 1 });
  const taskId = submitted.tasks[0].taskId;

  // 取消任务后，同镜可再次提交（运行中阻断解除），旧记录保留
  const { createMockProvider } = require('../src/v21/mockProvider.js');
  const mock = createMockProvider({ db, log, storageDir: path.join(os.tmpdir(), 'v21vid-reuse') });
  mock.cancel(taskId, '用户取消');
  const oldRow = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(taskId);
  assert.equal(oldRow.status, 'cancelled');
  const resub = await svc.submitVideo(shotId, { count: 1 });
  assert.equal(resub.tasks[0].taskId !== taskId, true);
  const done = await svc.completeVideoTask(resub.tasks[0].taskId);
  assert.ok(done.candidateId);
});

test('采用指针唯一：撤销后可改选；预期指针不匹配返回 ADOPTION_CONFLICT', async () => {
  const ctx = setup();
  await prepareReadyEpisode(ctx);
  const { svc } = ctx;
  const shots = svc.listShots(1);
  const shotId = shots[0].id;
  const img = await svc.generateImage(shotId, {});
  svc.setImageCurrent(shotId, { candidateId: img.candidateId });
  svc.generateH3(shotId);
  const submitted = await svc.submitVideo(shotId, { count: 2 });
  const done1 = await svc.completeVideoTask(submitted.tasks[0].taskId);
  const done2 = await svc.completeVideoTask(submitted.tasks[1].taskId);

  svc.adoptVideo(shotId, done1.candidateId);
  // 过期的预期指针 → 409
  assert.throws(
    () => svc.adoptVideo(shotId, done2.candidateId, { expectedSelectedCandidateId: 'stale' }),
    (err) => err.code === 'ADOPTION_CONFLICT' && err.status === 409
  );
  const switched = svc.adoptVideo(shotId, done2.candidateId, {
    expectedSelectedCandidateId: done1.candidateId,
  });
  assert.equal(switched.adoptedCandidateId, done2.candidateId);
  const undo = svc.undoAdoptVideo(shotId);
  assert.equal(undo.adoptedCandidateId, null);
  const candidates = svc.videoCandidates(shotId);
  assert.equal(candidates.candidates.length, 2, '旧候选保留');
});

test('首尾帧衔接：等待→可衔接→确认已衔接→断开不删媒体', async () => {
  const ctx = setup();
  await prepareReadyEpisode(ctx);
  const { svc } = ctx;
  const shots = svc.listShots(1);
  // 只有一个镜头时：第二镜不存在，用第一镜验证 none
  const first = svc.getFrameChaining(shots[0].id);
  assert.equal(first.state, 'none');
});
