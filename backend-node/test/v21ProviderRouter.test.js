'use strict';
/**
 * A1 真实 Provider 接入 · 通道解析器（providerRouter）
 * 解析顺序＝本次覆盖 → 全局默认 → mock 回落（铁律 6：无 Key 全流程可用）。
 * 本文件只断言通道解析/费用/能力契约，不发起真实网络请求。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createProviderRouter } = require('../src/v21/providerRouter.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  return db;
}

function insertConfig(db, { serviceType, provider = 'openai', apiKey = '', isDefault = 1, priority = 0, model = null, defaultModel = null, settings = null, isActive = 1 }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO ai_service_configs
        (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES (?, ?, '', '配置', 'https://example.com', ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      serviceType,
      provider,
      apiKey,
      model ? JSON.stringify([model]) : '[]',
      defaultModel,
      priority,
      isDefault,
      isActive,
      settings,
      now,
      now
    );
  return Number(info.lastInsertRowid);
}

test('图片通道：无任何配置时回落 mock（铁律 6）', () => {
  const db = setup();
  const router = createProviderRouter({ db, log });
  const channel = router.resolveImageChannel();
  assert.equal(channel.channel, 'mock');
  assert.equal(router.resolveImageChannel.channelKind, undefined);
});

test('图片通道：默认 storyboard_image 配置带 Key → 真实通道并携带配置', () => {
  const db = setup();
  const id = insertConfig(db, { serviceType: 'storyboard_image', provider: 'volces', apiKey: 'sk-test', defaultModel: 'seedream-4' });
  const router = createProviderRouter({ db, log });
  const channel = router.resolveImageChannel();
  assert.equal(channel.channel, 'real');
  assert.equal(channel.serviceType, 'storyboard_image');
  assert.equal(channel.config.id, id);
  assert.equal(channel.config.provider, 'volces');
});

test('图片通道：storyboard_image 缺 Key 时落到带 Key 的 image 配置', () => {
  const db = setup();
  insertConfig(db, { serviceType: 'storyboard_image', apiKey: '', defaultModel: 'seedream-4' });
  const imageId = insertConfig(db, { serviceType: 'image', apiKey: 'sk-image', defaultModel: 'flux' });
  const router = createProviderRouter({ db, log });
  const channel = router.resolveImageChannel();
  assert.equal(channel.channel, 'real');
  assert.equal(channel.serviceType, 'image');
  assert.equal(channel.config.id, imageId);
});

test('图片通道：本次覆盖优先于全局默认', () => {
  const db = setup();
  insertConfig(db, { serviceType: 'storyboard_image', apiKey: 'sk-default', defaultModel: 'seedream-4' });
  const overrideId = insertConfig(db, { serviceType: 'image', apiKey: 'sk-override', defaultModel: 'flux', isDefault: 0 });
  const router = createProviderRouter({ db, log });
  const channel = router.resolveImageChannel({ overrideConfigId: overrideId });
  assert.equal(channel.channel, 'real');
  assert.equal(channel.config.id, overrideId);
});

test('视频通道：无默认视频配置 → mock', () => {
  const db = setup();
  const router = createProviderRouter({ db, log });
  const channel = router.resolveVideoChannel();
  assert.equal(channel.channel, 'mock');
  assert.ok(channel.reason);
});

test('视频通道：默认配置带 Key → 真实通道，MiniMax H3 可识别', () => {
  const db = setup();
  insertConfig(db, {
    serviceType: 'video',
    provider: 'minimax_h3',
    apiKey: 'sk-video',
    defaultModel: 'MiniMax-H3',
    model: 'MiniMax-H3',
  });
  const router = createProviderRouter({ db, log });
  const channel = router.resolveVideoChannel();
  assert.equal(channel.channel, 'real');
  assert.equal(channel.resolved.provider, 'minimax_h3');
  assert.equal(channel.resolved.protocol, 'minimax_h3');
  assert.equal(router.isH3Video(channel.resolved), true);
});

test('视频通道：非 ComfyUI 默认配置缺 Key → mock 回落', () => {
  const db = setup();
  insertConfig(db, { serviceType: 'video', provider: 'minimax_h3', apiKey: '', defaultModel: 'MiniMax-H3', model: 'MiniMax-H3' });
  const router = createProviderRouter({ db, log });
  const channel = router.resolveVideoChannel();
  assert.equal(channel.channel, 'mock');
});

test('视频通道：ComfyUI 本地配置缺 Key 仍为真实通道', () => {
  const db = setup();
  insertConfig(db, { serviceType: 'video', provider: 'comfyui', apiKey: '', defaultModel: 'h3-workflow', model: 'h3-workflow' });
  const router = createProviderRouter({ db, log });
  const channel = router.resolveVideoChannel();
  assert.equal(channel.channel, 'real');
  assert.equal(channel.resolved.provider, 'comfyui');
});

test('视频费用：配置单价时返回估值；未配置时返回「Provider 未返回价格」', () => {
  const db = setup();
  const router = createProviderRouter({ db, log });
  const priced = router.estimateVideoCost({
    config: { id: 1, settings: JSON.stringify({ perVideoPrice: 1.5, currency: 'CNY' }) },
    model: 'MiniMax-H3',
    provider: 'minimax_h3',
    protocol: 'minimax_h3',
  });
  assert.equal(priced.estimated, 1.5);
  assert.equal(priced.currency, 'CNY');
  const unpriced = router.estimateVideoCost({
    config: { id: 1, settings: null },
    model: 'MiniMax-H3',
    provider: 'minimax_h3',
    protocol: 'minimax_h3',
  });
  assert.equal(unpriced.estimated, null);
  assert.match(unpriced.note, /Provider 未返回价格/);
});

test('视频能力：settings.capabilities 驱动时长/引用数上限；缺失时为 null', () => {
  const db = setup();
  const router = createProviderRouter({ db, log });
  const resolved = {
    config: {
      id: 1,
      settings: JSON.stringify({
        capabilities: { maxDurationSeconds: 10, minReferences: 1, maxReferences: 4 },
      }),
    },
    model: 'MiniMax-H3',
    provider: 'minimax_h3',
    protocol: 'minimax_h3',
  };
  const caps = router.videoCapabilities(resolved);
  assert.equal(caps.maxDurationSeconds, 10);
  assert.equal(caps.maxReferences, 4);
  assert.equal(caps.minReferences, 1);
  assert.equal(
    router.videoCapabilities({ config: { id: 1, settings: null }, model: 'm', provider: 'p', protocol: 'openai' }),
    null
  );
});

test('执行器委托：无真实通道时全部返回 null（调用方回落 mock）；有通道时转发执行器', async () => {
  const db = setup();
  const calls = [];
  const router = createProviderRouter({
    db,
    log,
    imageExecutor: { generate: async (req) => { calls.push(['image', req]); return { candidateId: 11 }; } },
    videoExecutor: {
      submit: async (req) => { calls.push(['video', req]); return { tasks: [{ taskId: 't1' }] }; },
      waitForTask: async (taskId) => { calls.push(['wait', taskId]); return { candidateId: 'c1' }; },
      cancel: async (taskId) => { calls.push(['cancel', taskId]); return { taskId, cancelled: true }; },
      retry: async (taskId) => { calls.push(['retry', taskId]); return { taskId: 't2' }; },
    },
  });
  assert.equal(await router.generateImage({ shotId: 1 }), null);
  assert.equal(await router.submitVideo({ shotId: 1 }), null);
  assert.equal(await router.waitForVideoTask('t0'), null);
  assert.equal(await router.cancelVideoTask('t0'), null);
  assert.equal(await router.retryVideoTask('t0'), null);
  assert.equal(await router.compileH3Draft({ shotId: 1 }), null);

  insertConfig(db, { serviceType: 'storyboard_image', apiKey: 'sk', defaultModel: 'm1' });
  insertConfig(db, { serviceType: 'video', provider: 'minimax_h3', apiKey: 'sk', defaultModel: 'MiniMax-H3', model: 'MiniMax-H3' });
  const img = await router.generateImage({ shotId: 1, prompt: 'p' });
  assert.equal(img.candidateId, 11);
  const submitted = await router.submitVideo({ shotId: 1, count: 1 });
  assert.equal(submitted.tasks[0].taskId, 't1');
  const done = await router.waitForVideoTask('t1');
  assert.equal(done.candidateId, 'c1');
  await router.cancelVideoTask('t1');
  await router.retryVideoTask('t1');
  assert.equal(calls.length, 5);
});

test('H3 编译委托：仅 H3 通道转发 h3Executor；非 H3 真实通道返回 null', async () => {
  const db = setup();
  const compiled = [];
  const router = createProviderRouter({
    db,
    log,
    h3Executor: { compile: async (req) => { compiled.push(req); return { draftId: 9 }; } },
  });
  insertConfig(db, { serviceType: 'video', provider: 'minimax_h3', apiKey: 'sk', defaultModel: 'MiniMax-H3', model: 'MiniMax-H3' });
  const channel = router.resolveVideoChannel();
  const draft = await router.compileH3Draft({ shotId: 1, resolved: channel.resolved });
  assert.equal(draft.draftId, 9);
  assert.equal(compiled.length, 1);

  insertConfig(db, { serviceType: 'video', provider: 'openai', apiKey: 'sk2', defaultModel: 'sora', model: 'sora', isDefault: 0, priority: 1 });
  db.prepare("UPDATE ai_service_configs SET is_default = 0 WHERE provider = 'minimax_h3'").run();
  db.prepare("UPDATE ai_service_configs SET is_default = 1 WHERE provider = 'openai'").run();
  const generic = router.resolveVideoChannel();
  assert.equal(generic.channel, 'real');
  assert.equal(await router.compileH3Draft({ shotId: 1, resolved: generic.resolved }), null);
});
