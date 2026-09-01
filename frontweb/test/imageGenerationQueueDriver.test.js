import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createQueueDriver, isTransientSendError } from '../src/utils/imageGenerationQueueDriver.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

test('pauses and defers a task when the environment preflight fails', async () => {
  const task = { id: 'env-blocked', status: 'preparing' }
  let sends = 0
  let deferred = 0
  const { driver, events } = makeDriver({
    claimNext: async () => ({ claimed: true, task }),
    beforeSend: async () => ({ canProceed: false, checks: [{ key: 'bridge', status: 'failed', message: '扩展未响应' }] }),
    deferTask: async () => { deferred += 1; return { ...task, status: 'queued' } },
    sendAttempt: async () => { sends += 1 },
  })
  await driver.tick()
  await driver.tick()
  driver.stop()
  assert.equal(deferred, 1)
  assert.equal(sends, 0)
  assert.equal(events.at(-1).type, 'environment_blocked')
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

test('accepts a pre-claimed result so a probe claim is still driven', async () => {
  const task = { id: 'tp', status: 'preparing' }
  let claims = 0
  const { driver, events } = makeDriver({
    claimNext: async () => { claims += 1; return { claimed: false } },
    prepareSend: async () => ({ task, attempt: { id: 'ap' }, already_submitted: false }),
    getTask: async () => ({ id: 'tp', status: 'needs_review', candidates: [1] }),
    acknowledge: async () => ({ id: 'tp', status: 'submitted' }),
  })
  await driver.tick({ claimed: true, task })
  driver.stop()
  assert.equal(claims, 0)
  assert.deepEqual(events.map((e) => e.type), ['claimed', 'submitted', 'needs_review', 'terminal'])
})

test('cancels the pending background send after failing a task', async () => {
  const order = []
  const task = { id: 't3', status: 'preparing' }
  const { driver, events } = makeDriver({
    claimNext: async () => ({ claimed: true, task }),
    prepareSend: async () => ({ task, attempt: { id: 'a3' }, already_submitted: false }),
    sendAttempt: async () => { throw new Error('浏览器插件未响应，请确认插件已安装并启用') },
    failTask: async () => { order.push('failTask') },
    cancelSend: async (attemptId) => { order.push(`cancel:${attemptId}`) },
    getTask: async () => ({ id: 't3', status: 'failed' }),
  })
  await driver.tick()
  driver.stop()
  // 取消必须发生在任务已判失败之后,且带上后台正在等待的 attemptId
  assert.deepEqual(order, ['failTask', 'cancel:a3'])
  assert.ok(events.some((e) => e.type === 'failed'))
})

test('cancelSend failures never mask the task failure', async () => {
  const failed = []
  const task = { id: 't4', status: 'preparing' }
  const { driver, events } = makeDriver({
    claimNext: async () => ({ claimed: true, task }),
    prepareSend: async () => ({ task, attempt: { id: 'a4' }, already_submitted: false }),
    sendAttempt: async () => { throw new Error('boom') },
    failTask: async (id, message) => { failed.push(message) },
    cancelSend: async () => { throw new Error('cancel channel down') },
    getTask: async () => ({ id: 't4', status: 'failed' }),
  })
  await driver.tick()
  driver.stop()
  assert.deepEqual(failed, ['boom'])
  assert.ok(events.some((e) => e.type === 'failed'))
})

test('skips cancellation when no attempt reached the bridge', async () => {
  let cancels = 0
  const task = { id: 't5', status: 'preparing' }
  const { driver } = makeDriver({
    claimNext: async () => ({ claimed: true, task }),
    beforeSend: async () => { throw new Error('environment down') },
    cancelSend: async () => { cancels += 1 },
    failTask: async () => {},
    getTask: async () => ({ id: 't5', status: 'failed' }),
  })
  await driver.tick()
  driver.stop()
  assert.equal(cancels, 0)
})

test('store wires the send timeout raise and background cancellation', () => {
  const source = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  // 发送桥接的等待窗口必须覆盖后台最长 ~4 分钟的按钮等待,避免任务被提前判死
  assert.match(source, /SEND_BRIDGE_TIMEOUT_MS = 300000/)
  assert.match(source, /action: 'send'[\s\S]*?SEND_BRIDGE_TIMEOUT_MS/)
  // 手动发送与队列驱动都要能撤下后台仍在等待的发送链
  assert.match(source, /cancelAttemptSend/)
  assert.match(source, /cancelSend: \(attemptId\)/)
})

test('emits completed when the watched task auto-finalizes', async () => {
  const task = { id: 'tc', status: 'submitted' }
  let poll = 0
  const { driver, events } = makeDriver({
    claimNext: async () => ({ claimed: true, task }),
    prepareSend: async () => ({ task, attempt: { id: 'ac' }, already_submitted: false }),
    getTask: async () => (poll++ === 0 ? { id: 'tc', status: 'generating' } : { id: 'tc', status: 'completed' }),
    acknowledge: async () => ({ id: 'tc', status: 'generating' }),
  })
  await driver.tick()
  driver.stop()
  assert.deepEqual(events.map((e) => e.type), ['claimed', 'submitted', 'completed', 'terminal'])
})

test('store notifies queue completion on drained terminal events', () => {
  const source = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  // terminal 事件必须被处理并触发"队列完成"通知
  assert.match(source, /event\.type === 'terminal'/)
  assert.match(source, /队列完成/)
  assert.match(source, /全部生图任务已完成/)
  // 通过异步追探 claim-next 判定队列已空（含 active_task_id 判定）
  assert.match(source, /claimNext\(\)/)
  assert.match(source, /active_task_id/)
  // Queue drain must report review/failed counts instead of claiming every
  // task completed when no active task remains.
  assert.match(source, /summaryResult/)
  assert.match(source, /needs_review/)
  assert.match(source, /failed/)
})

test('store wires the driver with real bridge/api deps and deduped notifications', () => {
  const source = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  assert.match(source, /createQueueDriver\(/)
  assert.match(source, /ElNotification\(/)
  assert.match(source, /notifiedEvents/)
  assert.match(source, /openTaskById/)
  assert.match(source, /requeueTask/)
  // The store must keep a periodic timer ticking the driver so queued tasks
  // keep advancing after the first claimed task reaches a terminal state.
  assert.match(source, /setInterval/)
  assert.match(source, /\.tick\(\)/)
  assert.match(source, /stopQueueDriver/)
  const api = fs.readFileSync(path.join(root, 'src/api/imageGenerationTasks.js'), 'utf8')
  assert.match(api, /claim-next/)
  assert.match(api, /\/fail`/)
})
