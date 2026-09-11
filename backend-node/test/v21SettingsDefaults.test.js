'use strict';
/**
 * Task 4.3 常规设置真实化：
 * - GET/PUT /api/v2/settings/defaults：默认画幅/默认单集时长/备份保留天数（KV 落库，
 *   缺省 16:9/90/30；保留天数 0 明确拒绝——规格不允许 0 静默关闭备份保护）；
 * - POST /api/v2/datatools/backup/run + GET /api/v2/datatools/backup/stats：
 *   真实执行 backupService.createBackup 与备份目录扫描统计；
 * - createProject 容忍 targetDurationSeconds：新建项目页随全局默认上报，暂存前端不落项目资料。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createV21Router } = require('../src/v21/routes.js');

const log = { info() {}, warn() {}, error() {} };

/** 在临时目录上建真实文件库 + 挂 /api/v2 路由（dbPath/backupRoot 走 cfg 注入） */
async function startServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21setdef-'));
  const dataRoot = path.join(tmp, 'data');
  fs.mkdirSync(dataRoot, { recursive: true });
  const dbPath = path.join(dataRoot, 'drama_generator.db');
  const fileDb = new Database(dbPath);
  fileDb.pragma('journal_mode = WAL');
  runMigrationsAndEnsure(fileDb);
  ensureV21Domain(fileDb);
  fileDb.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '剧', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run('2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z');

  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/v2', createV21Router({
    db,
    cfg: {
      storage: { local_path: path.join(dataRoot, 'storage') },
      database: { path: dbPath },
    },
    log,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v2`;
  return { server, base, db, tmp, dataRoot, dbPath, fileDb };
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

// ---- 创作默认值 ----

test('defaults：GET 缺省返回 16:9 / 90 / 30', async () => {
  const ctx = await startServer();
  try {
    const res = await api(ctx.base, 'GET', '/settings/defaults');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { aspectRatio: '16:9', episodeDurationSeconds: 90, backupRetentionDays: 30 });
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('defaults：PUT 写入生效并回读；KV 落到指定键', async () => {
  const ctx = await startServer();
  try {
    const put = await api(ctx.base, 'PUT', '/settings/defaults', {
      aspectRatio: '9:16',
      episodeDurationSeconds: 60,
      backupRetentionDays: 14,
    });
    assert.equal(put.status, 200, `应 200，实际 ${put.status}：${JSON.stringify(put.error)}`);
    assert.deepEqual(put.body, { aspectRatio: '9:16', episodeDurationSeconds: 60, backupRetentionDays: 14 });

    const got = await api(ctx.base, 'GET', '/settings/defaults');
    assert.deepEqual(got.body, { aspectRatio: '9:16', episodeDurationSeconds: 60, backupRetentionDays: 14 });

    // KV 存储使用简报指定键名
    for (const [key, value] of [
      ['v21:default_aspect_ratio', '"9:16"'],
      ['v21:default_episode_duration_seconds', '60'],
      ['v21:backup_retention_days', '14'],
    ]) {
      const row = ctx.db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key);
      assert.ok(row, `global_settings 应有 ${key}`);
      assert.equal(row.value, value);
    }
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('defaults：PUT 支持部分字段（仅改一项，其余保持现值）', async () => {
  const ctx = await startServer();
  try {
    await api(ctx.base, 'PUT', '/settings/defaults', { aspectRatio: '1:1' });
    const got = await api(ctx.base, 'GET', '/settings/defaults');
    assert.deepEqual(got.body, { aspectRatio: '1:1', episodeDurationSeconds: 90, backupRetentionDays: 30 });
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('defaults：各字段校验拒绝（画幅/时长边界/保留天数含 0）', async () => {
  const ctx = await startServer();
  try {
    const cases = [
      [{ aspectRatio: '4:3' }, /画幅/],
      [{ aspectRatio: '' }, /画幅/],
      [{ episodeDurationSeconds: 29 }, /30-600/],
      [{ episodeDurationSeconds: 601 }, /30-600/],
      [{ episodeDurationSeconds: 90.5 }, /30-600/],
      [{ episodeDurationSeconds: '90' }, /30-600/],
      [{ backupRetentionDays: 0 }, /不允许关闭备份保护/],
      [{ backupRetentionDays: 366 }, /1-365/],
      [{ backupRetentionDays: 1.5 }, /1-365/],
    ];
    for (const [body, pattern] of cases) {
      const res = await api(ctx.base, 'PUT', '/settings/defaults', body);
      assert.equal(res.status, 400, `应拒绝 ${JSON.stringify(body)}`);
      assert.equal(res.error.code, 'VALIDATION_ERROR');
      assert.match(res.error.message, pattern);
    }
    // 拒绝后缺省值不被部分写入污染
    const got = await api(ctx.base, 'GET', '/settings/defaults');
    assert.deepEqual(got.body, { aspectRatio: '16:9', episodeDurationSeconds: 90, backupRetentionDays: 30 });
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

// ---- 备份：真实执行 + 扫描统计 ----

test('backup/run：临时目录真实执行，返回 path 存在且含 manifest，sha256/bytes 有效', async () => {
  const ctx = await startServer();
  try {
    const res = await api(ctx.base, 'POST', '/datatools/backup/run', {});
    assert.equal(res.status, 200, `应 200，实际 ${res.status}：${JSON.stringify(res.error)}`);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.path, '应返回备份目录 path');
    assert.ok(fs.existsSync(res.body.path), '备份目录应真实存在');
    assert.ok(fs.existsSync(path.join(res.body.path, 'manifest.json')), '应含 manifest.json');
    assert.ok(/^[0-9a-f]{64}$/.test(res.body.sha256), 'sha256 应为 64 位十六进制');
    assert.ok(res.body.bytes > 0, 'bytes 应大于 0');
    assert.ok(String(res.body.path).startsWith(ctx.dataRoot), '备份应落在当前工作区 backups 根下');
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('backup/run：源数据库不存在 → 500 带消息', async () => {
  const ctx = await startServer();
  try {
    // 指向不存在的库文件
    ctx.fileDb.close();
    fs.rmSync(ctx.dbPath, { force: true });
    const res = await api(ctx.base, 'POST', '/datatools/backup/run', {});
    assert.equal(res.status, 500);
    assert.ok(res.error && res.error.message, '应带错误消息');
    assert.match(res.error.message, /不存在/);
  } finally {
    ctx.server.close();
  }
});

test('backup/stats：空目录 → 0 个备份 / lastBackupAt null / 0 字节', async () => {
  const ctx = await startServer();
  try {
    const res = await api(ctx.base, 'GET', '/datatools/backup/stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.backupCount, 0);
    assert.equal(res.body.lastBackupAt, null);
    assert.equal(res.body.estimatedUsageBytes, 0);
    assert.ok(res.body.backupDir, '应返回备份目录');
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('backup/stats：有备份 → 数量/最近时间/预计占用如实统计', async () => {
  const ctx = await startServer();
  try {
    const run = await api(ctx.base, 'POST', '/datatools/backup/run', {});
    assert.equal(run.status, 200);
    const res = await api(ctx.base, 'GET', '/datatools/backup/stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.backupCount, 1);
    assert.ok(res.body.lastBackupAt, 'lastBackupAt 应有值');
    assert.ok(!Number.isNaN(new Date(res.body.lastBackupAt).getTime()), 'lastBackupAt 应可解析');
    assert.ok(res.body.estimatedUsageBytes > 0, '预计占用应大于 0');

    // 第二次备份 → 数量与占用单调增加
    await api(ctx.base, 'POST', '/datatools/backup/run', {});
    const again = await api(ctx.base, 'GET', '/datatools/backup/stats');
    assert.equal(again.body.backupCount, 2);
    assert.ok(again.body.estimatedUsageBytes >= res.body.estimatedUsageBytes);
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

// ---- 新建项目：targetDurationSeconds 暂存前端（不落项目资料、不 400）----

test('createProject：携带 targetDurationSeconds 不再 400，字段被忽略不入 metadata', async () => {
  const ctx = await startServer();
  try {
    const res = await api(ctx.base, 'POST', '/projects', {
      title: '带默认时长的项目',
      aspectRatio: '9:16',
      genre: '悬疑',
      targetDurationSeconds: 90,
    });
    assert.equal(res.status, 201, `应 201，实际 ${res.status}：${JSON.stringify(res.error)}`);
    assert.ok(res.body.id);
    const row = ctx.db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(res.body.id);
    const meta = JSON.parse(row.metadata);
    assert.equal('target_duration_seconds' in meta, false, '时长不应写入项目资料');
    assert.equal('duration' in meta, false);
    assert.equal(meta.aspect_ratio, '9:16');
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});
