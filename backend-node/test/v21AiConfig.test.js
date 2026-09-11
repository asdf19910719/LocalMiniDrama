'use strict';
/**
 * Task 4.2 AI 配置页交互化（§13.3 最小闭环）：
 * - GET /api/v2/ai-config/overview：聚合 Provider（脱敏——api_key 永不出现在响应）/
 *   默认生图通道（全局 + 项目解析）/ 8 类业务映射当前生效 provider/模型；
 * - PUT /api/v2/ai-config/image-default：{ scope: global|project, projectId?, channel } 写入真实存储
 *   （global_settings KV + dramas.metadata，复用 imageGenerationTaskService 的读写机制），
 *   且读取侧 getDefaultChannel 真实消费全局默认（项目默认优先，安装默认 api 兜底）；
 * - POST /api/v2/ai-config/providers/:id/test：连接测试复用 aiConfigService.testConnection，
 *   密钥只在服务端参与请求；响应对失败给原因与恢复建议（hint）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createV21Router } = require('../src/v21/routes.js');
const imageGenerationTaskService = require('../src/services/imageGenerationTaskService');

const log = { info() {}, warn() {}, error() {} };

async function startServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21aicfg-'));
  const dataRoot = path.join(tmp, 'data');
  fs.mkdirSync(dataRoot, { recursive: true });
  const dbPath = path.join(dataRoot, 'drama_generator.db');
  const fileDb = new Database(dbPath);
  fileDb.pragma('journal_mode = WAL');
  runMigrationsAndEnsure(fileDb);
  ensureV21Domain(fileDb);

  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '测试剧', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run('2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z');

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
  return { server, base, db, tmp, fileDb };
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

let seedSeq = 0;
function seedConfig(db, over = {}) {
  const r = {
    service_type: 'text',
    provider: 'openai',
    name: '测试中转',
    base_url: 'https://api.example.com/v1',
    api_key: '',
    model: '["gpt-4o-mini"]',
    default_model: 'gpt-4o-mini',
    priority: 0,
    is_default: 0,
    is_active: 1,
    ...over,
  };
  seedSeq += 1;
  const info = db.prepare(
    `INSERT INTO ai_service_configs
     (service_type, provider, name, base_url, api_key, model, default_model, priority, is_default, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    r.service_type, r.provider, r.name + ' #' + seedSeq, r.base_url, r.api_key, r.model,
    r.default_model, r.priority, r.is_default, r.is_active,
    '2026-09-11T00:00:0' + (seedSeq % 10) + 'Z', '2026-09-11T00:00:0' + (seedSeq % 10) + 'Z'
  );
  return Number(info.lastInsertRowid);
}

// ---- overview：聚合形状与脱敏 ----

test('overview：Provider 聚合脱敏（响应无任何 api_key 字段/密钥值），hasKey/keyTail/域名正确', async () => {
  const ctx = await startServer();
  try {
    const textId = seedConfig(ctx.db, { service_type: 'text', api_key: 'sk-test-1234', is_default: 1 });
    const imageAId = seedConfig(ctx.db, { service_type: 'storyboard_image', api_key: 'sk-image-9876', is_default: 1, base_url: 'https://img.example.com/v1' });
    const imageBId = seedConfig(ctx.db, { service_type: 'image', api_key: '', is_active: 1 });
    seedConfig(ctx.db, { service_type: 'video', provider: 'minimax_h3', api_key: '', is_default: 1, base_url: 'https://video.example.com' });
    seedConfig(ctx.db, { service_type: 'tts', provider: 'minimax', api_key: 'sk-tts-4444', is_default: 1 });

    const res = await api(ctx.base, 'GET', '/ai-config/overview');
    assert.equal(res.status, 200, `应 200，实际 ${res.status}：${JSON.stringify(res.error)}`);

    // 脱敏铁律：序列化后的响应不出现密钥字段名或密钥值
    const raw = JSON.stringify(res.body);
    assert.ok(!/"api_key"\s*:/.test(raw), '响应不得包含 api_key 字段');
    assert.ok(!/"apiKey"\s*:/.test(raw), '响应不得包含 apiKey 字段');
    for (const secret of ['sk-test-1234', 'sk-image-9876', 'sk-tts-4444']) {
      assert.ok(!raw.includes(secret), `响应不得泄露密钥值 ${secret}`);
    }

    const providers = res.body.providers;
    assert.equal(providers.length, 5, '应返回全部 5 条配置');
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));

    const text = byId[textId];
    assert.equal(text.hasKey, true);
    assert.equal(text.keyTail, '1234', '脱敏只展示尾 4 位');
    assert.equal(text.baseUrlDomain, 'api.example.com', '地址应脱敏为域名');
    assert.equal(text.isDefault, true);
    assert.equal(text.status, 'ok');
    assert.equal(text.serviceType, 'text');

    assert.equal(byId[imageBId].hasKey, false);
    assert.equal(byId[imageBId].keyTail, '');
    assert.equal(byId[imageBId].status, 'missing_key', '启用但缺密钥应标 missing_key');
    assert.equal(byId[imageAId].status, 'ok');

    // imageDefault：未设置时全局解析为安装默认 api
    assert.deepEqual(res.body.imageDefault.global, { channel: 'api', source: 'install_default' });
    assert.equal(res.body.imageDefault.chatgptWebEnabled, true, 'chatgpt_web 默认启用');
    assert.deepEqual(res.body.imageDefault.channels.sort(), ['api', 'chatgpt_web']);
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('overview：业务映射固定 8 类，Provider 类给出当前生效 provider/模型，本地类诚实标注', async () => {
  const ctx = await startServer();
  try {
    seedConfig(ctx.db, { service_type: 'text', api_key: 'sk-test-1234', default_model: 'gpt-4o-mini', is_default: 1 });
    const imageAId = seedConfig(ctx.db, { service_type: 'storyboard_image', api_key: 'sk-image-9876', default_model: 'flux-dev', is_default: 1 });
    seedConfig(ctx.db, { service_type: 'video', provider: 'minimax_h3', api_key: 'sk-video-1111', model: '["minimax-h3"]', default_model: 'minimax-h3', is_default: 1 });
    seedConfig(ctx.db, { service_type: 'tts', provider: 'minimax', api_key: 'sk-tts-4444', is_default: 1 });

    const res = await api(ctx.base, 'GET', '/ai-config/overview');
    assert.equal(res.status, 200);
    const map = res.body.businessMapping;
    assert.equal(map.length, 8, '业务映射应固定 8 类');
    assert.deepEqual(
      map.map((m) => m.key).sort(),
      ['audio_post', 'external_ai', 'image', 'merge', 'script', 'tts', 'upscale', 'video'].sort()
    );
    const byKey = Object.fromEntries(map.map((m) => [m.key, m]));

    assert.equal(byKey.script.group, '创作与协作');
    assert.equal(byKey.script.configured, true);
    assert.equal(byKey.script.provider, 'openai');
    assert.equal(byKey.script.model, 'gpt-4o-mini');

    assert.equal(byKey.image.group, '图片、视频与声音');
    assert.equal(byKey.image.configId, imageAId, '图片业务应解析到有 Key 的默认配置');
    assert.equal(byKey.image.model, 'flux-dev');

    assert.equal(byKey.video.configured, true);
    assert.equal(byKey.video.provider, 'minimax_h3');
    assert.equal(byKey.video.model, 'minimax-h3');

    assert.equal(byKey.tts.configured, true);
    assert.equal(byKey.tts.provider, 'minimax');

    for (const local of ['external_ai', 'merge', 'upscale', 'audio_post']) {
      assert.equal(byKey[local].providerBacked, false, `${local} 不经 Provider 通道`);
      assert.ok(byKey[local].note, `${local} 应有口径说明`);
    }
    // 每项都带分组，分组只允许规格三组
    for (const item of map) {
      assert.ok(['创作与协作', '图片、视频与声音', '后期处理'].includes(item.group), `分组非法：${item.group}`);
    }
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('overview：query 传 projectId 返回项目解析；未知项目 project 为 null 且不影响全局', async () => {
  const ctx = await startServer();
  try {
    const res = await api(ctx.base, 'GET', '/ai-config/overview?projectId=1');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.imageDefault.project, { projectId: 1, channel: 'api', source: 'install_default' });

    const bad = await api(ctx.base, 'GET', '/ai-config/overview?projectId=999');
    assert.equal(bad.status, 200);
    assert.equal(bad.body.imageDefault.project, null, '未知项目应返回 null（诚实缺省）');
    assert.deepEqual(bad.body.imageDefault.global, { channel: 'api', source: 'install_default' });

    const none = await api(ctx.base, 'GET', '/ai-config/overview');
    assert.equal(none.body.imageDefault.project, null, '不带 projectId 时 project 为 null');
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

// ---- image-default：写入真实存储 + 读取侧消费 ----

test('image-default：project 作用域写入 dramas.metadata，overview 反映 project_default', async () => {
  const ctx = await startServer();
  try {
    const res = await api(ctx.base, 'PUT', '/ai-config/image-default', { scope: 'project', projectId: 1, channel: 'chatgpt_web' });
    assert.equal(res.status, 200, `应 200，实际 ${res.status}：${JSON.stringify(res.error)}`);
    assert.equal(res.body.channel, 'chatgpt_web');

    const row = ctx.db.prepare('SELECT metadata FROM dramas WHERE id = 1').get();
    assert.equal(JSON.parse(row.metadata).default_image_generation_channel, 'chatgpt_web', '应写入 dramas.metadata（与 V1 setDefaultChannel 同存储）');

    const overview = await api(ctx.base, 'GET', '/ai-config/overview?projectId=1');
    assert.deepEqual(overview.body.imageDefault.project, { projectId: 1, channel: 'chatgpt_web', source: 'project_default' });
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('image-default：global 作用域写入 KV，读取侧 getDefaultChannel 真实消费（项目默认优先、安装默认兜底）', async () => {
  const ctx = await startServer();
  try {
    const res = await api(ctx.base, 'PUT', '/ai-config/image-default', { scope: 'global', channel: 'chatgpt_web' });
    assert.equal(res.status, 200);
    assert.equal(res.body.channel, 'chatgpt_web');

    const row = ctx.db.prepare('SELECT value FROM global_settings WHERE key = ?').get('default_image_generation_channel');
    assert.ok(row, 'global_settings 应有 default_image_generation_channel');
    assert.equal(row.value, '"chatgpt_web"');

    const overview = await api(ctx.base, 'GET', '/ai-config/overview');
    assert.deepEqual(overview.body.imageDefault.global, { channel: 'chatgpt_web', source: 'global_default' });

    // 读取侧真实消费：项目无自身默认时全局生效（否则该写入只是死 KV）
    assert.equal(imageGenerationTaskService.getDefaultChannel(ctx.db, 1), 'chatgpt_web');

    // 项目默认覆盖全局默认
    await api(ctx.base, 'PUT', '/ai-config/image-default', { scope: 'project', projectId: 1, channel: 'api' });
    assert.equal(imageGenerationTaskService.getDefaultChannel(ctx.db, 1), 'api');
    const other = ctx.db.prepare(
      `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (2, '剧2', 'draft', 'rh-101-cinematic', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z')`
    );
    other.run();
    assert.equal(imageGenerationTaskService.getDefaultChannel(ctx.db, 2), 'chatgpt_web', '无项目默认的剧仍走全局默认');
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('image-default：校验拒绝——非法 channel / 非法 scope / project 缺 projectId / 项目不存在 / chatgpt_web 未启用', async () => {
  const ctx = await startServer();
  try {
    const bad1 = await api(ctx.base, 'PUT', '/ai-config/image-default', { scope: 'global', channel: 'comfyui' });
    assert.equal(bad1.status, 400);
    assert.equal(bad1.error.code, 'VALIDATION_ERROR');
    assert.match(bad1.error.message, /api|chatgpt_web/, '错误应列出合法通道');

    const bad2 = await api(ctx.base, 'PUT', '/ai-config/image-default', { scope: 'bogus', channel: 'api' });
    assert.equal(bad2.status, 400);

    const bad3 = await api(ctx.base, 'PUT', '/ai-config/image-default', { scope: 'project', channel: 'api' });
    assert.equal(bad3.status, 400);
    assert.match(bad3.error.message, /projectId/);

    const bad4 = await api(ctx.base, 'PUT', '/ai-config/image-default', { scope: 'project', projectId: 999, channel: 'api' });
    assert.equal(bad4.status, 404);

    ctx.db.prepare('INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)').run('chatgpt_web_enabled', 'false', '2026-09-11T00:00:00Z');
    const bad5 = await api(ctx.base, 'PUT', '/ai-config/image-default', { scope: 'global', channel: 'chatgpt_web' });
    assert.equal(bad5.status, 400);
    assert.match(bad5.error.message, /未启用/, 'chatgpt_web 未启用应给原因');

    // 校验失败不产生部分写入
    const row = ctx.db.prepare('SELECT value FROM global_settings WHERE key = ?').get('default_image_generation_channel');
    assert.equal(row, undefined, '非法请求不得写入');
  } finally {
    ctx.server.close();
    ctx.fileDb.close();
  }
});

// ---- providers/:id/test：复用 V1 testConnection，密钥只在本机服务端参与 ----

/** 本地桩服务：模拟 OpenAI 兼容 chat completions */
function startStub(status, payload) {
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => stub.listen(0, '127.0.0.1', () => resolve(stub)));
}

test('providers/:id/test：本地桩 200 → ok；401 → 失败原因 + 恢复建议（hint）；无 Key → 400；未知 id → 404', async () => {
  const ctx = await startServer();
  let stub = null;
  let stub401 = null;
  try {
    stub = await startStub(200, { choices: [{ message: { content: 'pong' } }] });
    const port = stub.address().port;
    stub401 = await startStub(401, { error: { message: 'Invalid API key' } });
    const badPort = stub401.address().port;
    const okId = seedConfig(ctx.db, {
      service_type: 'text', provider: 'openai', api_key: 'sk-local-0001', is_default: 1,
      base_url: `http://127.0.0.1:${port}/v1`,
    });
    const badId = seedConfig(ctx.db, {
      service_type: 'text', provider: 'openai', api_key: 'sk-wrong', priority: -1,
      base_url: `http://127.0.0.1:${badPort}/v1`,
    });
    const noKeyId = seedConfig(ctx.db, { service_type: 'text', api_key: '', priority: -2 });

    const ok = await api(ctx.base, 'POST', `/ai-config/providers/${okId}/test`, {});
    assert.equal(ok.status, 200, `应 200，实际 ${ok.status}：${JSON.stringify(ok.error)}`);
    assert.equal(ok.body.ok, true);
    assert.ok(ok.body.message);
    assert.ok(!JSON.stringify(ok.body).includes('sk-local-0001'), '测试结果不得回显密钥');

    const bad = await api(ctx.base, 'POST', `/ai-config/providers/${badId}/test`, {});
    assert.equal(bad.status, 400);
    assert.ok(bad.error.message, '失败必须给原因');
    assert.ok(bad.error.hint, '失败必须给恢复建议（hint）');

    const noKey = await api(ctx.base, 'POST', `/ai-config/providers/${noKeyId}/test`, {});
    assert.equal(noKey.status, 400);
    assert.match(noKey.error.message, /api_key|密钥/);

    const missing = await api(ctx.base, 'POST', '/ai-config/providers/99999/test', {});
    assert.equal(missing.status, 404);
  } finally {
    if (stub) stub.close();
    if (stub401) stub401.close();
    ctx.server.close();
    ctx.fileDb.close();
  }
});

test('providers/:id/test：body 可覆盖 baseUrl/apiKey（抽屉保存前测试），存储值不被修改', async () => {
  const ctx = await startServer();
  let stub = null;
  try {
    stub = await startStub(200, { choices: [{ message: { content: 'pong' } }] });
    const port = stub.address().port;
    const id = seedConfig(ctx.db, {
      service_type: 'text', provider: 'openai', api_key: 'sk-stored-key', is_default: 1,
      base_url: 'https://stored.example.com/v1',
    });

    const res = await api(ctx.base, 'POST', `/ai-config/providers/${id}/test`, {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-typed-key',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const row = ctx.db.prepare('SELECT base_url, api_key FROM ai_service_configs WHERE id = ?').get(id);
    assert.equal(row.base_url, 'https://stored.example.com/v1', '覆盖测试不得改动存储');
    assert.equal(row.api_key, 'sk-stored-key', '覆盖测试不得改动存储密钥');
    assert.ok(!JSON.stringify(res.body).includes('sk-typed-key'), '响应不得回显测试密钥');
  } finally {
    if (stub) stub.close();
    ctx.server.close();
    ctx.fileDb.close();
  }
});
