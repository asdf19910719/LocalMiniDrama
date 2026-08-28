# ChatGPT 单独生图串行队列与全局通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单独点击的 chatgpt_web 生图任务进入持久化串行队列自动依次发送，关键事件右上角全局通知。

**Architecture:** 后端新增 `claim-next` 领取接口（全局并发 1、后端事务裁决防重复领取）与 `fail` 标记接口，单独任务创建后直接落 `queued`；前端 store 内建队列驱动器（纯函数工厂、依赖注入、可 node 测试）复用现有发送链路，状态迁移触发 ElNotification 关键事件通知。批次与 API 通道行为零变更。

**Tech Stack:** Node 22（`E:/AI/tools/node-v22.22.3-win-x64/node.exe`）、Express 4、better-sqlite3、node:test、Vue 3 + Pinia、Element Plus（ElNotification）。

**Spec:** `E:/AI/references/LocalMiniDrama/docs/superpowers/specs/2026-08-28-chatgpt-image-serial-queue-design.md`

## Global Constraints

- 可运行仓库为 `E:/AI/references/LocalMiniDrama`；工作在 `main` 分支工作树，不得 reset/checkout/丢弃现有未提交修改。
- 后端全量测试必须 `--test-concurrency=1`（共享临时数据库的旧套件会互抢）。
- Node 一律用 `E:/AI/tools/node-v22.22.3-win-x64/node.exe`。
- 批次任务与 API 通道任务行为零变更；状态机零迁移（复用 `TRANSITIONS`）。
- 每个任务以聚焦测试通过 + `git diff --check` 无输出结束，只提交本任务文件。

---

### Task 1: 后端 claim-next 领取服务

**Files:**
- Modify: `backend-node/src/services/imageGenerationQueueService.js`
- Test: `backend-node/test/imageGenerationQueueService.test.js`

**Interfaces:**
- Produces: `claimNextChatgptTask(db, { now }?) -> { claimed: boolean, task?: object, active_task_id?: string }`
- Consumes: `tasks.transitionTask(db, id, next, patch)`（`preparing→failed` + `{ errorCode, errorMessage }`）

- [ ] **Step 1: 写失败测试**

在 `backend-node/test/imageGenerationQueueService.test.js` 现有测试后追加（该文件已有内存库 + 批次测试，沿用其夹具；若其夹具缺 `generation_channel` 列补在测试内 CREATE）：

```js
it('claims the oldest queued chatgpt task and blocks while one is active', () => {
  const first = tasks.createTask(db, { dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web', promptSnapshot: 'a', status: 'queued' });
  const second = tasks.createTask(db, { dramaId: 7, targetType: 'prop', targetId: 1, generationChannel: 'chatgpt_web', promptSnapshot: 'b', status: 'queued' });
  const claim = queue.claimNextChatgptTask(db);
  assert.equal(claim.claimed, true);
  assert.equal(claim.task.id, first.id);
  assert.equal(tasks.getTask(first.id).status, 'preparing');
  const blocked = queue.claimNextChatgptTask(db);
  assert.equal(blocked.claimed, false);
  assert.equal(blocked.active_task_id, first.id);
  tasks.transitionTask(db, first.id, 'failed', { errorCode: 'send_failed', errorMessage: 'x' });
  const next = queue.claimNextChatgptTask(db);
  assert.equal(next.claimed, true);
  assert.equal(next.task.id, second.id);
});

it('fails stale preparing tasks and keeps fresh ones active', () => {
  const stale = tasks.createTask(db, { dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web', promptSnapshot: 's', status: 'preparing' });
  db.prepare("UPDATE image_generation_tasks SET updated_at='2026-08-28T00:00:00.000Z' WHERE id=?").run(stale.id);
  const result = queue.claimNextChatgptTask(db, { now: () => new Date('2026-08-28T00:20:00.000Z') });
  assert.equal(tasks.getTask(stale.id).status, 'failed');
  assert.equal(tasks.getTask(stale.id).error_code, 'send_timeout');
  assert.equal(result.claimed, false);
});
```

注意：`createTask` 的入参字段名以 `imageGenerationTaskService.insertTask` 实际键为准（`dramaId/targetType/...` 驼峰），执行时先读该函数确认，测试按实际键名书写。

- [ ] **Step 2: 运行确认失败**

```powershell
cd E:/AI/references/LocalMiniDrama/backend-node
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/imageGenerationQueueService.test.js
```

预期：FAIL（`claimNextChatgptTask is not a function`）。

- [ ] **Step 3: 最小实现**

在 `imageGenerationQueueService.js` 追加并导出：

```js
const PREPARING_STALE_MS = 10 * 60 * 1000;

function claimNextChatgptTask(db, { now = () => new Date() } = {}) {
  return db.transaction(() => {
    const timestamp = now();
    const staleBefore = new Date(timestamp.getTime() - PREPARING_STALE_MS).toISOString();
    const stale = db.prepare(`SELECT * FROM image_generation_tasks
      WHERE generation_channel='chatgpt_web' AND status='preparing' AND updated_at < ?
      ORDER BY updated_at LIMIT 1`).get(staleBefore);
    if (stale) tasks.transitionTask(db, stale.id, 'failed', { errorCode: 'send_timeout', errorMessage: '超时未发送，已跳过' });
    const active = db.prepare(`SELECT id FROM image_generation_tasks
      WHERE generation_channel='chatgpt_web' AND status IN ('submitted','generating') LIMIT 1`).get()
      || db.prepare(`SELECT id FROM image_generation_tasks
        WHERE generation_channel='chatgpt_web' AND status='preparing' AND updated_at >= ?
        ORDER BY updated_at DESC LIMIT 1`).get(staleBefore);
    if (active) return { claimed: false, active_task_id: active.id };
    const next = db.prepare(`SELECT * FROM image_generation_tasks
      WHERE generation_channel='chatgpt_web' AND status='queued'
      ORDER BY created_at LIMIT 1`).get();
    if (!next) return { claimed: false };
    return { claimed: true, task: tasks.transitionTask(db, next.id, 'preparing') };
  })();
}
```

`module.exports` 追加 `claimNextChatgptTask`。测试文件顶部按需 `const queue = require('../src/services/imageGenerationQueueService')`。

- [ ] **Step 4: 运行确认通过**

同 Step 2 命令，预期 PASS；再跑 `E:/AI/tools/node-v22.22.3-win-x64/node.exe --test --test-concurrency=1 test/*.test.js` 确认无回归。

- [ ] **Step 5: 提交**

```powershell
git add backend-node/src/services/imageGenerationQueueService.js backend-node/test/imageGenerationQueueService.test.js
git commit -m "feat: add chatgpt serial queue claim service"
```

---

### Task 2: claim-next 与 fail 路由 + 创建路径直落 queued

**Files:**
- Modify: `backend-node/src/routes/imageGenerationTasks.js`
- Test: `backend-node/test/imageGenerationTaskRoutes.test.js`

**Interfaces:**
- Consumes: Task 1 的 `claimNextChatgptTask`；`tasks.transitionTask`。
- Produces: `POST /image-generation-tasks/claim-next` → `{ claimed, task?, active_task_id? }`；`POST /image-generation-tasks/:taskId/fail`（body `{ message }`）→ failed 任务；chatgpt_web 单独任务 create 后状态为 `queued`。

- [ ] **Step 1: 写失败测试**

在 `backend-node/test/imageGenerationTaskRoutes.test.js` 现有首测的夹具与 server 上追加断言式新用例（复用其 `db`/`base` 生成方式，若夹具为单测内联则复制该内联到新 `it`）：

```js
it('queues fresh chatgpt tasks and claims them serially', async () => {
  const created = (await (await fetch(`${base}/image-generation-tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dramaId: 7, targetType: 'character', targetId: 1, generationChannel: 'chatgpt_web' }),
  })).json()).data;
  assert.equal(created.status, 'queued');
  const second = (await (await fetch(`${base}/image-generation-tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dramaId: 7, targetType: 'prop', targetId: 1, generationChannel: 'chatgpt_web' }),
  })).json()).data;
  const claim = (await (await fetch(`${base}/image-generation-tasks/claim-next`, { method: 'POST' })).json()).data;
  assert.equal(claim.claimed, true);
  assert.equal(claim.task.id, created.id);
  const blocked = (await (await fetch(`${base}/image-generation-tasks/claim-next`, { method: 'POST' })).json()).data;
  assert.equal(blocked.claimed, false);
  const failed = (await (await fetch(`${base}/image-generation-tasks/${claim.task.id}/fail`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'NOT_READY 超限' }),
  })).json()).data;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error_message, 'NOT_READY 超限');
  const retry = (await (await fetch(`${base}/image-generation-tasks/${claim.task.id}/retry`, { method: 'POST' })).json()).data;
  assert.equal(retry.status, 'queued');
  const next = (await (await fetch(`${base}/image-generation-tasks/claim-next`, { method: 'POST' })).json()).data;
  assert.equal(next.claimed, true);
  assert.equal(next.task.id, created.id); // 按 created_at 排序，重试的原任务更早
});
```

注意：现有首测断言 `created.status === 'draft'` 与 `prepared.task.status === 'preparing'`（走 prepare-send 路径）——创建路径改为 queued 后，`draft` 断言需同步改为 `'queued'`（prepare-send 从 queued 转 preparing 的跃迁已在 TRANSITIONS 中，行为兼容）。执行时同步更新该断言。

- [ ] **Step 2: 运行确认失败**

```powershell
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/imageGenerationTaskRoutes.test.js
```

预期：FAIL（claim-next 404、create 仍为 draft）。

- [ ] **Step 3: 实现**

`backend-node/src/routes/imageGenerationTasks.js`：

1. create 路由中 chatgpt_web 分支的 `task = tasks.transitionTask(db, task.id, task.status, { externalJobId: job.id });` 改为 `task = tasks.transitionTask(db, task.id, 'queued', { externalJobId: job.id });`
2. 在 `router.post('/image-generation-tasks/:taskId/prepare-send', ...)` 之前追加：

```js
router.post('/image-generation-tasks/claim-next', (req, res) => handle(res, () => queue.claimNextChatgptTask(db)));

router.post('/image-generation-tasks/:taskId/fail', (req, res) => handle(res, () => {
  const task = tasks.getTask(db, req.params.taskId);
  if (!task) throw new Error('Image generation task not found');
  if (task.generation_channel !== 'chatgpt_web' || task.status !== 'preparing') throw new Error('Only a preparing chatgpt_web task can be failed');
  return tasks.transitionTask(db, task.id, 'failed', { errorCode: 'send_failed', errorMessage: String(req.body?.message || '发送失败') });
}));
```

（文件顶部已 `const queue = require('../services/imageGenerationQueueService')` — 名为 `queue`，确认后复用。）

- [ ] **Step 4: 运行确认通过 + 全量无回归**

```powershell
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/imageGenerationTaskRoutes.test.js
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test --test-concurrency=1 test/*.test.js
```

预期：全 PASS。若批次相关测试因创建路径变化受影响，按"批次任务创建不变"原则检查 `createBatch` 路径未被改动。

- [ ] **Step 5: 提交**

```powershell
git add backend-node/src/routes/imageGenerationTasks.js backend-node/test/imageGenerationTaskRoutes.test.js
git commit -m "feat: queue solo chatgpt tasks and expose claim/fail endpoints"
```

---

### Task 3: 前端队列驱动器（纯函数工厂）

**Files:**
- Create: `frontweb/src/utils/imageGenerationQueueDriver.js`
- Test: `frontweb/test/imageGenerationQueueDriver.test.js`

**Interfaces:**
- Produces: `createQueueDriver({ claimNext, getTask, prepareSend, sendAttempt, acknowledge, failTask, onEvent, intervalMs?, retryLimit?, retryDelayMs?, delay? }) -> { start, stop, tick, isDriving }`
- Produces: `isTransientSendError(error) -> boolean`（匹配 `NOT_READY|provider tab unavailable|provider composer is not ready`）
- Events: `{ type: 'claimed'|'retrying'|'submitted'|'needs_review'|'failed'|'driver_error', taskId?, task?, message? }`

- [ ] **Step 1: 写失败测试**

`frontweb/test/imageGenerationQueueDriver.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createQueueDriver, isTransientSendError } from '../src/utils/imageGenerationQueueDriver.js'

function makeDriver(overrides = {}) {
  const events = []
  let pendingResolvers = []
  const delay = (ms) => new Promise((resolve) => { pendingResolvers.push(() => resolve()); })
  const state = { events, flushDelays: () => { const list = pendingResolvers; pendingResolvers = []; list.forEach((fn) => fn()); } }
  const driver = createQueueDriver({
    claimNext: overrides.claimNext || (async () => ({ claimed: false })),
    getTask: overrides.getTask || (async () => { throw new Error('no getTask') }),
    prepareSend: overrides.prepareSend || (async () => { throw new Error('no prepareSend') }),
    sendAttempt: overrides.sendAttempt || (async () => {}),
    acknowledge: overrides.acknowledge || (async () => { throw new Error('no acknowledge') }),
    failTask: overrides.failTask || (async () => {}),
    onEvent: (event) => events.push(event),
    delay,
    retryDelayMs: 0,
    intervalMs: 0,
    ...overrides,
  })
  return { driver, events, ...state }
}

test('isTransientSendError matches only known transient failures', () => {
  assert.equal(isTransientSendError(new Error('NOT_READY')), true)
  assert.equal(isTransientSendError(new Error('provider tab unavailable')), true)
  assert.equal(isTransientSendError(new Error('Image generation task not found')), false)
})

test('claims when idle, sends, acknowledges and watches to needs_review', async () => {
  const task = { id: 't1', status: 'preparing' }
  let poll = 0
  const { driver, events } = makeDriver({
    claimNext: async () => ({ claimed: true, task }),
    prepareSend: async () => ({ task, attempt: { id: 'a1' }, already_submitted: false }),
    getTask: async () => (poll++ === 0 ? { id: 't1', status: 'submitted' } : { id: 't1', status: 'needs_review', candidates: [1, 2, 3] }),
    acknowledge: async () => ({ id: 't1', status: 'submitted' }),
  })
  const run = driver.tick()
  await run
  driver.stop()
  assert.deepEqual(events.map((e) => e.type), ['claimed', 'submitted', 'needs_review', 'terminal'])
})

test('retries transient send errors within budget then fails and does not block', async () => {
  let sendCalls = 0
  const failed = []
  const task = { id: 't2', status: 'preparing' }
  const { driver, events } = makeDriver({
    claimNext: async () => ({ claimed: true, task }),
    prepareSend: async () => ({ task, attempt: { id: 'a2' }, already_submitted: false }),
    sendAttempt: async () => { sendCalls += 1; throw new Error('NOT_READY') },
    failTask: async (id, message) => { failed.push([id, message]); return { id, status: 'failed' } },
    getTask: async () => ({ id: 't2', status: 'failed', error_message: 'NOT_READY' }),
  })
  const run = driver.tick()
  await run
  driver.stop()
  assert.equal(sendCalls, 3) // 初次 + 2 次重试
  assert.equal(failed.length, 1)
  assert.equal(failed[0][1], 'NOT_READY')
  assert.ok(events.some((e) => e.type === 'failed'))
})

test('does not claim again while driving and ignores claim when busy', async () => {
  let claims = 0
  const { driver, events } = makeDriver({ claimNext: async () => { claims += 1; return { claimed: false } } })
  await driver.tick()
  await driver.tick()
  driver.stop()
  assert.equal(claims, 2)
  assert.deepEqual(events, [])
})
```

- [ ] **Step 2: 运行确认失败**

```powershell
cd E:/AI/references/LocalMiniDrama/frontweb
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/imageGenerationQueueDriver.test.js
```

预期：FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`frontweb/src/utils/imageGenerationQueueDriver.js`：

```js
const TRANSIENT_SEND_ERRORS = /NOT_READY|provider tab unavailable|provider composer is not ready/

export function isTransientSendError(error) {
  return TRANSIENT_SEND_ERRORS.test(String(error?.message || error || ''))
}

const TERMINAL = new Set(['needs_review', 'completed', 'failed', 'cancelled'])

export function createQueueDriver({
  claimNext, getTask, prepareSend, sendAttempt, acknowledge, failTask,
  onEvent = () => {},
  intervalMs = 5000,
  retryLimit = 2,
  retryDelayMs = 5000,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let stopped = true
  let driving = false
  async function tick() {
    if (stopped || driving) return
    driving = true
    try {
      const result = await claimNext()
      if (!result?.claimed) return
      await drive(result.task)
    } catch (error) {
      onEvent({ type: 'driver_error', message: error?.message })
    } finally {
      driving = false
    }
  }
  async function drive(task) {
    onEvent({ type: 'claimed', taskId: task.id, task })
    let attemptId = null
    try {
      const prepared = await prepareSend(task.id)
      attemptId = prepared.attempt?.id
      if (!prepared.already_submitted) await sendWithRetry(prepared)
      const acknowledged = await acknowledge(task.id, attemptId)
      onEvent({ type: 'submitted', taskId: task.id, task: acknowledged })
    } catch (error) {
      const message = error?.message || '发送失败'
      await failTask(task.id, message).catch(() => {})
      onEvent({ type: 'failed', taskId: task.id, message })
      return
    }
    await watch(task.id)
  }
  async function sendWithRetry(prepared) {
    let retries = 0
    for (;;) {
      try {
        await sendAttempt(prepared)
        return
      } catch (error) {
        if (!isTransientSendError(error) || retries >= retryLimit) throw error
        retries += 1
        onEvent({ type: 'retrying', taskId: prepared.task.id, attempt: retries, message: error?.message })
        await delay(retryDelayMs)
      }
    }
  }
  async function watch(taskId) {
    let lastStatus = null
    while (!stopped) {
      let task
      try { task = await getTask(taskId) } catch { return }
      if (!task) return
      if (task.status !== lastStatus) {
        if (task.status === 'needs_review') onEvent({ type: 'needs_review', taskId, task })
        if (task.status === 'failed') onEvent({ type: 'failed', taskId, task, message: task.error_message })
        lastStatus = task.status
      }
      if (TERMINAL.has(task.status)) { onEvent({ type: 'terminal', taskId, task, status: task.status }); return }
      await delay(intervalMs)
    }
  }
  return {
    start() { if (!stopped) return; stopped = false; tick() },
    stop() { stopped = true },
    tick,
    isDriving: () => driving,
  }
}
```

- [ ] **Step 4: 运行确认通过**

同 Step 2，预期 4/4 PASS。

- [ ] **Step 5: 提交**

```powershell
git add frontweb/src/utils/imageGenerationQueueDriver.js frontweb/test/imageGenerationQueueDriver.test.js
git commit -m "feat: add injectable chatgpt queue driver"
```

---

### Task 4: store 接线（驱动器 + 通知 + API client + 发送函数抽取）

**Files:**
- Modify: `frontweb/src/stores/imageGenerationStore.js`
- Modify: `frontweb/src/api/imageGenerationTasks.js`
- Test: `frontweb/test/imageGenerationQueueDriver.test.js`（追加 store 源断言）、`frontweb/test/externalGeneration.test.js`（若其断言受影响则同步）

**Interfaces:**
- Consumes: Task 3 工厂；`imageGenerationTaskAPI`。
- Produces: API `claimNext()` / `failTask(id, message)`；store `startQueueDriver()` / `stopQueueDriver()` / `openTaskById(id)` / `requeueTask(task)`；内部 `sendChatGPTAttempt(prepared)`（桥接 prepare+send，drawer 与驱动器共用）。

- [ ] **Step 1: 写失败测试**

`frontweb/test/imageGenerationQueueDriver.test.js` 追加源断言（沿用仓库既有风格）：

```js
test('store wires the driver with real bridge/api deps and deduped notifications', () => {
  const source = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  assert.match(source, /createQueueDriver\(/)
  assert.match(source, /ElNotification\(/)
  assert.match(source, /notifiedEvents/)
  assert.match(source, /openTaskById/)
  assert.match(source, /requeueTask/)
  const api = fs.readFileSync(path.join(root, 'src/api/imageGenerationTasks.js'), 'utf8')
  assert.match(api, /claim-next/)
  assert.match(api, /\/fail`/)
})
```

（文件顶部已有 `fs`/`path`/`root` 则复用，否则补：`const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`。）

- [ ] **Step 2: 运行确认失败**

```powershell
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/imageGenerationQueueDriver.test.js
```

- [ ] **Step 3: 实现**

1. `frontweb/src/api/imageGenerationTasks.js` 的 `imageGenerationTaskAPI` 对象内追加：

```js
  claimNext() { return request.post('/image-generation-tasks/claim-next') },
  failTask(id, message) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/fail`, { message }) },
```

2. `frontweb/src/stores/imageGenerationStore.js`：

- 顶部追加 `import { ElNotification } from 'element-plus'` 与 `import { createQueueDriver } from '@/utils/imageGenerationQueueDriver'`。
- 从 `sendToChatGPT` 中抽取桥接发送为独立函数（`sendToChatGPT` 改为调用它）：

```js
async function sendChatGPTAttempt(prepared) {
  const job = prepared.external_job
  await sendImageGenerationBridgeMessage({
    action: 'prepare', dramaId: prepared.task.drama_id, site: 'chatgpt', jobId: job.id,
    conversationId: job.conversation_id,
    prompt: buildChatGPTImageGenerationPrompt(prepared.task.prompt_snapshot, prepared.task.target_type),
    references: parseReferenceManifest(prepared.task.reference_manifest),
  })
  await sendImageGenerationBridgeMessage({
    action: 'send', dramaId: prepared.task.drama_id, site: 'chatgpt', jobId: job.id,
    attemptId: prepared.attempt.id, conversationId: job.conversation_id, payload: prepared.attempt,
  })
}
```

- 追加驱动器与通知（return 对象导出 `startQueueDriver, stopQueueDriver, openTaskById, requeueTask`）：

```js
const notifiedEvents = new Set()
let queueDriver = null
function notifyQueueEvent(event) {
  if (!event.taskId || event.type === 'driver_error' || event.type === 'retrying') return
  const key = `${event.taskId}:${event.type}`
  if (notifiedEvents.has(key)) return
  notifiedEvents.add(key)
  if (event.type === 'needs_review') {
    const count = (event.task?.candidates || []).length
    ElNotification({ title: '生图完成', message: count ? `${count} 张候选待选择` : '候选已导入，请选择', type: 'success', onClick: () => { openTaskById(event.taskId) } })
  } else if (event.type === 'failed') {
    ElNotification({ title: '生图失败', message: event.message || '请重新排队', type: 'error', onClick: () => { openTaskById(event.taskId) } })
  }
}
async function openTaskById(taskId) {
  currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.get(taskId))
  drawerVisible.value = true
  startTaskPolling()
}
function startQueueDriver() {
  if (queueDriver) return
  queueDriver = createQueueDriver({
    claimNext: imageGenerationTaskAPI.claimNext,
    getTask: async (id) => normalizeImageGenerationTask(await imageGenerationTaskAPI.get(id)),
    prepareSend: (id) => imageGenerationTaskAPI.prepareSend(id),
    sendAttempt: sendChatGPTAttempt,
    acknowledge: (id, attemptId) => imageGenerationTaskAPI.acknowledge(id, attemptId),
    failTask: (id, message) => imageGenerationTaskAPI.failTask(id, message),
    onEvent: notifyQueueEvent,
  })
  queueDriver.start()
}
function stopQueueDriver() { queueDriver?.stop(); queueDriver = null }
async function requeueTask(task) {
  if (!task?.id) throw new Error('图片生成任务不存在')
  currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.retry(task.id))
  startTaskPolling(0)
  await loadSummary(task.drama_id ?? dramaId.value, { reattach: false })
  return currentTask.value
}
```

- `sendToChatGPT` 内原两段 `sendImageGenerationBridgeMessage(...)` 替换为 `await sendChatGPTAttempt(prepared)`。

3. 驱动器启动时机：`loadSummary(id, ...)` 末尾——当 `summary` 或默认通道表明 chatgpt_web 可用时调 `startQueueDriver()`；`closeDrawer` 不停驱动器（页面会话内持续推进）。简单实现：`loadSummary` 内无条件 `startQueueDriver()`（幂等）。

- [ ] **Step 4: 运行确认通过 + 全量**

```powershell
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/*.test.js
```

预期全 PASS（若 `externalGeneration.test.js` 的源断言因 sendToChatGPT 重构受影响，按其原始意图更新断言）。

- [ ] **Step 5: 提交**

```powershell
git add frontweb/src/stores/imageGenerationStore.js frontweb/src/api/imageGenerationTasks.js frontweb/test/imageGenerationQueueDriver.test.js frontweb/test/externalGeneration.test.js
git commit -m "feat: drive solo chatgpt tasks through the serial queue with notifications"
```

---

### Task 5: 抽屉与视图交互（queued/failed 状态 + 视图接线）

**Files:**
- Modify: `frontweb/src/components/imageGeneration/ImageGenerationDrawer.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`（`generateUnifiedImage` + Drawer 事件）
- Modify: `frontweb/src/views/DramaCanvas.vue`、`frontweb/src/views/DramaDetail.vue`（Drawer `@requeue` 接线，若两处也挂了该抽屉）
- Test: `frontweb/test/imageGenerationUi.test.js`（沿用其源断言风格；不存在则按本任务新建）

**Interfaces:**
- Consumes: store `requeueTask`（Task 4）。
- Produces: Drawer 新 emit `requeue`；`generateUnifiedImage` 不再直接发送。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('drawer owns queue states: queued alert, no manual send, failed requeue', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/imageGeneration/ImageGenerationDrawer.vue'), 'utf8')
  assert.match(source, /task\.status === 'queued'/)
  assert.match(source, /已加入队列/)
  assert.match(source, /重新排队/)
  assert.doesNotMatch(source, /task\.status === 'preparing' && task\.error_message/)
})

test('unified entry only creates the queued task and views requeue failed ones', () => {
  const film = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  assert.doesNotMatch(film, /const task = await openImageGenerationTask\([\s\S]{0,400}sendImageGenerationToChatGPT\(task\)/)
  assert.match(film, /onImageGenerationRequeue/)
})
```

- [ ] **Step 2: 运行确认失败**

```powershell
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/imageGenerationUi.test.js
```

- [ ] **Step 3: 实现**

1. `ImageGenerationDrawer.vue` 模板调整：
   - `queued` 提示：在现有 `preparing` info alert 旁加 `<el-alert v-if="task.status === 'queued'" type="info" title="已加入队列，将自动依次发送" show-icon />`
   - 发送按钮 `v-if` 收紧为 `task.status === 'draft' && task.generation_channel === 'chatgpt_web'`（移除 `preparing + error_message` 分支；按钮文案固定"发送到 ChatGPT"）
   - failed 按钮：`<el-button v-if="task.status === 'failed'" :loading="sending" @click="$emit('requeue', task)">重新排队</el-button>`
   - `defineEmits([...])` 追加 `'requeue'`
2. `FilmCreate.vue` 的 `generateUnifiedImage`：删除 `await sendImageGenerationToChatGPT(task)`（仅保留 open + catch）；追加事件处理：

```js
async function onImageGenerationRequeue(task) {
  try {
    await requeueImageGenerationTask(task)
    ElMessage.success('已重新排队')
  } catch (error) {
    ElMessage.error(error?.message || '重新排队失败')
  }
}
```

   （`useImageGeneration()` 解构追加 `requeueTask: requeueImageGenerationTask`，对齐 2707 行附近的命名模式。）
3. Drawer 模板挂载处追加 `@requeue="onImageGenerationRequeue"`；`DramaCanvas.vue` / `DramaDetail.vue` 若挂载了同一抽屉组件则同样接线（各自命名对应 handler，调用各自 store 解构的 `requeueTask`）。

- [ ] **Step 4: 运行确认通过 + 全量 + 构建**

```powershell
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/*.test.js
E:/AI/tools/node-v22.22.3-win-x64/node.exe node_modules/vite/bin/vite.js build
```

- [ ] **Step 5: 提交**

```powershell
git add frontweb/src/components/imageGeneration/ImageGenerationDrawer.vue frontweb/src/views/FilmCreate.vue frontweb/src/views/DramaCanvas.vue frontweb/src/views/DramaDetail.vue frontweb/test/imageGenerationUi.test.js
git commit -m "feat: surface queued and failed states in the generation drawer"
```

---

### Task 6: 全量回归、真实验收与文档

**Files:**
- Modify: `docs/统一ChatGPT图片生成设计.md`（追加 2026-08-28 串行队列章节）
- Modify: `docs/真实ChatGPT图片生成模拟测试启动与验收.md`（追加验收记录）

- [ ] **Step 1: 后端全量 + 前端全量 + 构建**

```powershell
cd E:/AI/references/LocalMiniDrama/backend-node
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test --test-concurrency=1 test/*.test.js
cd ../frontweb
E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/*.test.js
E:/AI/tools/node-v22.22.3-win-x64/node.exe node_modules/vite/bin/vite.js build
```

预期全 PASS、构建通过；`git diff --check` 无输出。

- [ ] **Step 2: 真实验收（专用 Chrome 9223）**

1. 重启后端（任务状态持久化，无迁移）。
2. 工作台连续点击 3 个不同资源的"ChatGPT 生成"：全部落 `queued`，抽屉显示"排队中/已加入队列"。
3. 观察自动串行执行：第一个 `preparing→submitted→候选导入`，第二、三个依次自动发送，全程无 NOT_READY。
4. 右上角出现"生图完成：N 张候选待选择"通知，点击打开对应抽屉。
5. 失败路径注入（可选）：断开扩展后点击一个生图，观察重试 2 次后转 failed、后续任务继续推进、失败通知出现；点"重新排队"恢复。
6. 刷新页面：驱动器恢复，队列继续推进。

- [ ] **Step 3: 文档记录并提交**

```powershell
git add docs/统一ChatGPT图片生成设计.md docs/真实ChatGPT图片生成模拟测试启动与验收.md
git commit -m "docs: record serial queue rollout and acceptance"
```

---

## Self-Review

- Spec coverage：4.2 创建路径（Task 2）、4.3 claim-next（Task 1/2）、4.4 fail（Task 2）、5 驱动器与抽屉（Task 3/4/5）、6 通知（Task 4）、8 测试策略（各任务）、9 完成定义（Task 6）。无缺口。
- Placeholder 扫描：无 TBD/TODO；所有代码块可直接执行；两处"执行时确认"（insertTask 键名、queue require 名）均为读现有代码的核对动作而非未定义内容。
- 类型一致性：`claimNextChatgptTask` 返回 `{ claimed, task, active_task_id }` 与路由/驱动器一致；驱动器事件 `type` 集合在 Task 3 定义、Task 4 消费一致；`requeueTask(task)` 命名在 Task 4/5 一致。
