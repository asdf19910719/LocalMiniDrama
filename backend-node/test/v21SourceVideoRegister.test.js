'use strict';
/**
 * Task 4.7 · 从已有视频开始剪辑：来源媒体登记端点契约。
 * - episodeId 必传且服务端校验（存在 / 属于该项目 / 未软删）→ 400/404；
 * - 可选 sha256（64 位十六进制）/ fileSize（正整数）/ mediaInfo 入库并回显。
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
const SHA = 'a'.repeat(64);

async function startServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21sourcevideo-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/v2', createV21Router({
    db,
    cfg: { storage: { local_path: path.join(tmp, 'storage') } },
    log,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v2`;
  return { server, base, db, tmp };
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

/** 项目 + 两集（其中 ep2 供归属冲突用） */
async function setupProjects(ctx) {
  const { base } = ctx;
  const p1 = await api(base, 'POST', '/projects', { title: '项目一', styleId: 'rh-101-cinematic' });
  const p2 = await api(base, 'POST', '/projects', { title: '项目二', styleId: 'rh-101-cinematic' });
  const e1 = await api(base, 'POST', `/projects/${p1.body.id}/episodes`, { title: 'E01' });
  const e2 = await api(base, 'POST', `/projects/${p2.body.id}/episodes`, { title: '别家的集' });
  return { projectId: p1.body.id, episodeId: e1.body.id, otherProjectId: p2.body.id, otherEpisodeId: e2.body.id };
}

test('登记：完整字段（episodeId/sha256/fileSize/mediaInfo）入库并回显', async () => {
  const ctx = await startServer();
  try {
    const { projectId, episodeId } = await setupProjects(ctx);
    const res = await api(ctx.base, 'POST', `/projects/${projectId}/episodes/source-video`, {
      episodeId,
      name: '原始拍摄素材',
      localPath: 'D:\\footage\\ep01.mp4',
      sha256: SHA,
      fileSize: 734003200,
      mediaInfo: '1920x1080 · 03:24 · H.264',
    });
    assert.equal(res.status, 201, `应 201，实际 ${res.status}：${JSON.stringify(res.error)}`);
    assert.ok(Number.isInteger(res.body.assetId) && res.body.assetId > 0, '应返回 assetId');
    assert.equal(res.body.episodeId, episodeId, '应回显 episodeId');
    assert.equal(res.body.sha256, SHA, '应回显 sha256');
    assert.equal(res.body.fileSize, 734003200, '应回显 fileSize');
    assert.equal(res.body.mediaInfo, '1920x1080 · 03:24 · H.264', '应回显 mediaInfo');
    // 入库回读：file_size 列 + source_meta JSON（sha256/mediaInfo/episodeId 关联持久化）
    const row = ctx.db.prepare('SELECT file_size, source_meta FROM assets WHERE id = ?').get(res.body.assetId);
    assert.ok(row, 'assets 行应存在');
    assert.equal(row.file_size, 734003200, 'file_size 列应写入 fileSize');
    const meta = JSON.parse(row.source_meta);
    assert.equal(meta.sha256, SHA, 'source_meta.sha256 应入库');
    assert.equal(meta.mediaInfo, '1920x1080 · 03:24 · H.264', 'source_meta.mediaInfo 应入库');
    assert.equal(meta.episodeId, episodeId, 'source_meta.episodeId 应持久化剧集关联');
  } finally {
    ctx.server.close();
  }
});

test('登记：可选字段缺省 → 201，sha256/mediaInfo 存 null；fileSize 仍可单传', async () => {
  const ctx = await startServer();
  try {
    const { projectId, episodeId } = await setupProjects(ctx);
    const res = await api(ctx.base, 'POST', `/projects/${projectId}/episodes/source-video`, {
      episodeId,
      name: '最小登记',
      url: 'https://example.com/ep01.mp4',
      fileSize: 1024,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.sha256, null);
    assert.equal(res.body.mediaInfo, null);
    assert.equal(res.body.fileSize, 1024);
    const row = ctx.db.prepare('SELECT file_size, source_meta FROM assets WHERE id = ?').get(res.body.assetId);
    assert.equal(row.file_size, 1024);
    const meta = JSON.parse(row.source_meta);
    assert.equal(meta.sha256, null);
    assert.equal(meta.episodeId, episodeId);
  } finally {
    ctx.server.close();
  }
});

test('登记：sha256 非 64 位十六进制 → 400', async () => {
  const ctx = await startServer();
  try {
    const { projectId, episodeId } = await setupProjects(ctx);
    for (const bad of ['abc123', 'A'.repeat(63), `${SHA}0`, 'zz'.repeat(32)]) {
      const res = await api(ctx.base, 'POST', `/projects/${projectId}/episodes/source-video`, {
        episodeId, name: 'x', localPath: 'D:\\a.mp4', sha256: bad,
      });
      assert.equal(res.status, 400, `sha256=${bad} 应 400，实际 ${res.status}`);
      assert.equal(res.error.code, 'VALIDATION_ERROR');
    }
  } finally {
    ctx.server.close();
  }
});

test('登记：fileSize 非正整数 → 400', async () => {
  const ctx = await startServer();
  try {
    const { projectId, episodeId } = await setupProjects(ctx);
    for (const bad of [0, -5, 1.5, 'abc']) {
      const res = await api(ctx.base, 'POST', `/projects/${projectId}/episodes/source-video`, {
        episodeId, name: 'x', localPath: 'D:\\a.mp4', fileSize: bad,
      });
      assert.equal(res.status, 400, `fileSize=${bad} 应 400，实际 ${res.status}`);
      assert.equal(res.error.code, 'VALIDATION_ERROR');
    }
  } finally {
    ctx.server.close();
  }
});

test('登记：episodeId 必传，缺失 → 400', async () => {
  const ctx = await startServer();
  try {
    const { projectId } = await setupProjects(ctx);
    const res = await api(ctx.base, 'POST', `/projects/${projectId}/episodes/source-video`, {
      name: '无目标集', localPath: 'D:\\a.mp4',
    });
    assert.equal(res.status, 400, `应 400，实际 ${res.status}`);
    assert.equal(res.error.code, 'VALIDATION_ERROR');
  } finally {
    ctx.server.close();
  }
});

test('登记：episodeId 属于其他项目 → 400', async () => {
  const ctx = await startServer();
  try {
    const { projectId, otherEpisodeId } = await setupProjects(ctx);
    const res = await api(ctx.base, 'POST', `/projects/${projectId}/episodes/source-video`, {
      episodeId: otherEpisodeId, name: '跨项目', localPath: 'D:\\a.mp4',
    });
    assert.equal(res.status, 400, `应 400，实际 ${res.status}`);
    assert.equal(res.error.code, 'VALIDATION_ERROR');
  } finally {
    ctx.server.close();
  }
});

test('登记：episodeId 不存在 → 404；软删剧集 → 404', async () => {
  const ctx = await startServer();
  try {
    const { projectId, episodeId } = await setupProjects(ctx);
    const missing = await api(ctx.base, 'POST', `/projects/${projectId}/episodes/source-video`, {
      episodeId: 999999, name: 'x', localPath: 'D:\\a.mp4',
    });
    assert.equal(missing.status, 404, `应 404，实际 ${missing.status}`);
    assert.equal(missing.error.code, 'NOT_FOUND');

    const del = await api(ctx.base, 'DELETE', `/episodes/${episodeId}`);
    assert.equal(del.status, 200);
    const softDeleted = await api(ctx.base, 'POST', `/projects/${projectId}/episodes/source-video`, {
      episodeId, name: 'x', localPath: 'D:\\a.mp4',
    });
    assert.equal(softDeleted.status, 404, '软删剧集应 404');
  } finally {
    ctx.server.close();
  }
});
