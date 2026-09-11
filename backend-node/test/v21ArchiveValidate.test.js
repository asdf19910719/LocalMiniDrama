'use strict';
/**
 * Task 5-C · 归档导入真实校验（POST /api/v2/archive/validate）+ 镜头轨 processing 状态。
 * - validate 收 JSON { path }（本地 zip 路径）：404/400 硬错误 + 七项检查矩阵 + 概要指标；
 * - V1 导出（project.json version=1.7）如实返回 unsupported，不伪装通过；
 * - batchPrecheck 补 processing（处理中镜头），供前端镜头轨"失败/处理中"筛选。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const express = require('express');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createV21Router } = require('../src/v21/routes.js');
const { createStoryboardService } = require('../src/v21/storyboard/storyboardService.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');
const { exportDrama } = require('../src/services/dramaExportService');

const log = { info() {}, warn() {}, error() {} };
const NOW = '2026-09-11T00:00:00Z';

async function startServer({ db }) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/v2', createV21Router({
    db,
    cfg: { storage: { local_path: path.join(os.tmpdir(), 'v21archive-storage') } },
    log,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v2`;
  return { server, base, db };
}

async function api(base, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  const unwrapped = data && data.data !== undefined ? data.data : data;
  return { status: res.status, body: unwrapped, error: data && data.error ? data.error : null };
}

/** 最小可导出项目：1 剧 1 集 1 分镜 1 人物（带本地主图 → zip 内有媒体条目） */
function seedExportableDrama(db, storageDir) {
  const mediaRel = 'projects/src/characters/char_main.png';
  fs.mkdirSync(path.join(storageDir, 'projects/src/characters'), { recursive: true });
  fs.writeFileSync(path.join(storageDir, mediaRel), Buffer.from('png-bytes'));
  const dramaId = Number(db.prepare(
    "INSERT INTO dramas (title, description, style_id, status, created_at, updated_at) VALUES ('归档校验剧', '测试', 'rh-101-cinematic', 'draft', ?, ?)"
  ).run(NOW, NOW).lastInsertRowid);
  const epId = Number(db.prepare(
    "INSERT INTO episodes (drama_id, episode_number, title, duration, created_at, updated_at) VALUES (?, 1, '第一集', 0, ?, ?)"
  ).run(dramaId, NOW, NOW).lastInsertRowid);
  db.prepare(
    "INSERT INTO storyboards (episode_id, storyboard_number, title, characters, created_at, updated_at) VALUES (?, 1, '开场', '[]', ?, ?)"
  ).run(epId, NOW, NOW);
  db.prepare(
    "INSERT INTO characters (drama_id, name, local_path, created_at, updated_at) VALUES (?, '林晚', ?, ?, ?)"
  ).run(dramaId, mediaRel, NOW, NOW);
  return { dramaId, storageDir };
}

// ---------- batchPrecheck.processing ----------

test('batchPrecheck：返回 processing（有 pending/running 视频任务的未采用镜头）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21archive-'));
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
  const mock = createMockProvider({ db, log, storageDir: path.join(tmp, 'storage') });
  const script = createScriptService(db, { log });
  script.saveDraft(1, { content: '第一场 内景·酒店走廊·深夜\n林夏走到 208 门前。\n第二场 外景·停车场·凌晨\n经理从阴影中走出。' });
  script.confirmScript(1, {});
  const svc = createStoryboardService(db, { log, mockProvider: mock });
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  assert.equal(shots.length, 2);
  const [shotA, shotB] = shots;

  const insertTask = (id, shotId, status) => db.prepare(
    `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at, input_json, cost_json, owner_type, owner_id, idempotency_key)
     VALUES (?, 'v21:mock-video', ?, 0, '', '', ?, ?, '{}', '{}', 'storyboard_video', ?, NULL)`
  ).run(id, status, NOW, NOW, String(shotId));
  insertTask('t-run-1', shotA.id, 'running');
  insertTask('t-fail-1', shotB.id, 'failed');

  try {
    const pre = svc.batchPrecheck(1);
    assert.deepEqual(pre.processing, [shotA.id], 'running 任务的镜头进入 processing');
    assert.ok(pre.failed.some((f) => f.shotId === shotB.id), 'failed 任务的未采用镜头进入 failed');
    assert.ok(!pre.processing.includes(shotB.id), '失败镜头不进 processing');
    assert.ok(!pre.failed.some((f) => f.shotId === shotA.id), '处理中镜头不进 failed');
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- POST /api/v2/archive/validate ----------

test('validate：缺少 path → 400；不存在与非 zip 同为 400 + 同一模糊文案（消除存在性 oracle）', async () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const ctx = await startServer({ db });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21archive-'));
  try {
    const noPath = await api(ctx.base, 'POST', '/archive/validate', {});
    assert.equal(noPath.status, 400);
    const missing = await api(ctx.base, 'POST', '/archive/validate', { path: path.join(os.tmpdir(), `v21-no-such-${Date.now()}.zip`) });
    assert.equal(missing.status, 400, `应 400（不区分存在性），实际 ${missing.status}`);
    const plain = path.join(tmp, 'plain.txt');
    fs.writeFileSync(plain, 'not a zip');
    const badZip = await api(ctx.base, 'POST', '/archive/validate', { path: plain });
    assert.equal(badZip.status, 400);
    assert.equal(missing.error.message, badZip.error.message, '不存在与非 zip 返回同一模糊文案');
    assert.equal(missing.error.message, '无法读取该归档文件');
  } finally {
    ctx.server.close();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validate：V1 导出归档 → unsupported + 七项检查矩阵 + 概要指标；重名项目 warn', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21archive-'));
  const storageDir = path.join(tmp, 'storage');
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const ctx = await startServer({ db });
  try {
    const { dramaId } = seedExportableDrama(db, storageDir);
    const { buffer } = exportDrama(db, { storage: { local_path: storageDir } }, log, dramaId);
    const zipPath = path.join(tmp, '归档校验剧_backup.zip');
    fs.writeFileSync(zipPath, buffer);

    // 导出源项目仍在库中 → 名称检查 warn（重名）
    const dup = await api(ctx.base, 'POST', '/archive/validate', { path: zipPath });
    assert.equal(dup.status, 200, `应 200，实际 ${dup.status}：${JSON.stringify(dup.error)}`);
    const r = dup.body;
    assert.equal(r.overall, 'unsupported', 'V1 导出版本非 2.1 → overall unsupported');
    assert.equal(r.archiveVersion, '1.7', '如实回读归档版本');
    assert.equal(r.supportedVersion, '2.1');
    assert.equal(r.summary.projectName, '归档校验剧');
    assert.equal(r.summary.episodeCount, 1);
    assert.ok(r.summary.mediaCount >= 1, '应统计到人物主图媒体条目');
    assert.ok(r.summary.estimatedSizeBytes > 0, '预计大小 > 0');

    const ids = r.checks.map((c) => c.id);
    assert.deepEqual(ids.sort(), ['format', 'integrity', 'media', 'name', 'space', 'structure', 'version'], '七项检查齐备');
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    assert.equal(byId.format.status, 'pass');
    assert.equal(byId.version.status, 'unsupported', '版本项如实标 unsupported');
    assert.match(byId.version.detail, /1\.7/, '版本项注明实际版本');
    assert.match(byId.version.detail, /2\.1/, '版本项注明支持版本');
    assert.equal(byId.structure.status, 'pass');
    assert.equal(byId.integrity.status, 'pass', '完整归档可解压');
    assert.equal(byId.media.status, 'pass');
    assert.equal(byId.name.status, 'warn', '与现有项目重名 → warn');
    assert.ok(byId.name.detail.includes('归档校验剧'));
    assert.ok(['pass', 'warn'].includes(byId.space.status), '正常磁盘下空间检查不阻断');
    if (byId.space.status === 'pass') {
      assert.match(byId.space.detail, /数据盘/, '空间检查探测并注明数据目录所在盘');
    }

    // 移除同名项目 → 名称检查 pass
    db.prepare('DELETE FROM dramas WHERE id = ?').run(dramaId);
    const clean = await api(ctx.base, 'POST', '/archive/validate', { path: zipPath });
    assert.equal(clean.status, 200);
    const nameCheck = clean.body.checks.find((c) => c.id === 'name');
    assert.equal(nameCheck.status, 'pass', '无重名 → 名称检查 pass');
  } finally {
    ctx.server.close();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validate：合法 zip 但缺 project.json → 结构检查 block，overall error', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21archive-'));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const ctx = await startServer({ db });
  try {
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('not a project archive'));
    const zipPath = path.join(tmp, 'empty.zip');
    fs.writeFileSync(zipPath, zip.toBuffer());
    const res = await api(ctx.base, 'POST', '/archive/validate', { path: zipPath });
    assert.equal(res.status, 200);
    assert.equal(res.body.overall, 'error');
    const structure = res.body.checks.find((c) => c.id === 'structure');
    assert.equal(structure.status, 'block', '缺 manifest → 结构阻断');
  } finally {
    ctx.server.close();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
