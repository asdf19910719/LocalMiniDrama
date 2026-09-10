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
const { createCutService } = require('../src/v21/cut/cutService.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21cut-'));
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
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。\n第二场 外景·停车场·凌晨\n经理走出阴影。' });
  script.confirmScript(1, {});
  const storyboard = createStoryboardService(db, { log, mockProvider: mock });
  storyboard.createFromScript(1);
  const cut = createCutService(db, { log, ffmpegPath: path.join(__dirname, '..', 'tools', 'ffmpeg', 'ffmpeg.exe'), exportDir: path.join(tmp, 'exports') });
  return { db, storyboard, cut, script };
}

/** 让全部镜头完成并采用，达到可合成状态 */
async function adoptAllShots(ctx) {
  const { storyboard } = ctx;
  const shots = storyboard.listShots(1);
  for (const shot of shots) {
    const img = await storyboard.generateImage(shot.id, {});
    storyboard.setImageCurrent(shot.id, { candidateId: img.candidateId });
    storyboard.generateH3(shot.id);
    const submitted = await storyboard.submitVideo(shot.id, { count: 1 });
    const done = await storyboard.completeVideoTask(submitted.tasks[0].taskId);
    storyboard.adoptVideo(shot.id, done.candidateId);
  }
  return shots;
}

test('审片投影：逐镜状态与来源标注；未完成时软进入可审片', async () => {
  const ctx = setup();
  const { cut, storyboard } = ctx;
  const shots = storyboard.listShots(1);
  await adoptAllShots(ctx);
  // 让最后一个镜头退出采用以构造 blocked 场景
  storyboard.undoAdoptVideo(shots[shots.length - 1].id);
  const review = cut.getReviewModel(1);
  assert.equal(review.total, 2);
  assert.equal(review.completed, 1);
  const lastShot = review.shots.find((s) => s.shotId === shots[shots.length - 1].id);
  assert.equal(lastShot.status, 'missing');
  assert.ok(review.gate.canCompose === false);
  assert.ok(review.gate.blockers.some((b) => b.includes('尚未生成')));
});

test('生成成片：硬门禁（全部用于本镜）通过后可提交；产出成片版本 v1', async () => {
  const ctx = setup();
  const { cut, db } = ctx;
  await adoptAllShots(ctx);
  const review = cut.getReviewModel(1);
  assert.equal(review.gate.canCompose, true);

  const compose = await cut.composeEpisode(1, {
    bgmStrategy: 'episode-track',
    narrationTts: false,
    subtitleBurn: false,
    upscale: false,
  });
  assert.equal(compose.version, 1);
  assert.ok(fs.existsSync(compose.filePath), '成片文件真实存在');
  const row = db.prepare('SELECT * FROM episode_cut_versions WHERE episode_id = 1 AND version = 1').get();
  assert.equal(row.status, 'ready');
  assert.ok(JSON.parse(row.shots_json).length === 2, '记录来源镜头候选快照');
}, { timeout: 120000 });

test('重复合成产出 v2，历史保留互不覆盖；镜头变化后新版本记录新候选', async () => {
  const ctx = setup();
  const { cut, db } = ctx;
  await adoptAllShots(ctx);
  await cut.composeEpisode(1, { bgmStrategy: 'none', narrationTts: false, subtitleBurn: false, upscale: false });
  const second = await cut.composeEpisode(1, { bgmStrategy: 'episode-track', narrationTts: true, subtitleBurn: false, upscale: false });
  assert.equal(second.version, 2);
  const versions = cut.listVersions(1);
  assert.equal(versions.items.length, 2);
  assert.equal(versions.items[0].version, 2, '最新版本在前');
  const settings2 = JSON.parse(db.prepare('SELECT settings_json FROM episode_cut_versions WHERE episode_id = 1 AND version = 2').get().settings_json);
  assert.equal(settings2.narrationTts, true);
}, { timeout: 180000 });

test('导出 MP4 与 SRT：导出文件真实存在并记录 hash；未合成时导出不可用', async () => {
  const ctx = setup();
  const { cut, db } = ctx;
  // 未合成 → 导出不可用
  const emptyExport = await cut.exportCut(1, { format: 'mp4' });
  assert.equal(emptyExport.ok, false);

  await adoptAllShots(ctx);
  const composed = await cut.composeEpisode(1, { bgmStrategy: 'none', narrationTts: false, subtitleBurn: true, upscale: false });
  const result = await cut.exportCut(1, { format: 'mp4' });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.filePath), '导出 MP4 存在');
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const srt = await cut.exportCut(1, { format: 'srt' });
  assert.equal(srt.ok, true);
  assert.ok(fs.existsSync(srt.filePath), '导出 SRT 存在');
  const srtContent = fs.readFileSync(srt.filePath, 'utf8');
  assert.ok(srtContent.includes('-->'), 'SRT 含时间轴');
  const row = db.prepare('SELECT * FROM episode_cut_versions WHERE id = ?').get(composed.versionId);
  assert.equal(row.status, 'exported');
  assert.equal(row.export_sha256, result.sha256);
}, { timeout: 180000 });

test('豁免：有效豁免可满足门禁；镜头级 blocker 被豁免后可合成', async () => {
  const ctx = setup();
  const { cut, storyboard, db } = ctx;
  const shots = storyboard.listShots(1);
  // 只完成第一镜，第二镜缺失
  const img = await storyboard.generateImage(shots[0].id, {});
  storyboard.setImageCurrent(shots[0].id, { candidateId: img.candidateId });
  storyboard.generateH3(shots[0].id);
  const submitted = await storyboard.submitVideo(shots[0].id, { count: 1 });
  const done = await storyboard.completeVideoTask(submitted.tasks[0].taskId);
  storyboard.adoptVideo(shots[0].id, done.candidateId);

  let review = cut.getReviewModel(1);
  assert.equal(review.gate.canCompose, false);
  // 对缺失镜头签发豁免（原因必填）
  assert.throws(() => cut.createWaiver({ gate: 'video', ownerType: 'shot', ownerId: shots[1].id, reason: '' }), /原因/);
  const waiver = cut.createWaiver({ gate: 'video', ownerType: 'shot', ownerId: shots[1].id, reason: '空镜头以黑场过渡' });
  assert.ok(waiver.id > 0);
  review = cut.getReviewModel(1);
  assert.equal(review.gate.canCompose, true, '豁免满足门禁');
});
