import test from 'node:test'
import assert from 'node:assert/strict'
import { BackgroundController } from '../src/background.js'

function storage() {
  const values = {}
  return {
    get: async (key) => ({ [key]: values[key] }),
    set: async (value) => Object.assign(values, value),
  }
}

test('prepare auto-attaches the logged-in ChatGPT tab before filling', async () => {
  const messages = []
  const apiCalls = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async (url, init) => {
    apiCalls.push([url, init])
    return { ok: true, json: async () => ({ data: { id: 'session-1' } }) }
  } })
  controller.emit = async () => ({ id: 'event-1' })
  await controller.handle({ action: 'prepare', dramaId: 3, site: 'chatgpt', jobId: 'job-1', prompt: 'hello' }, { tab: { id: 9 } })
  assert.deepEqual(messages.filter(([, message]) => message.action !== 'ready').slice(0, 2), [[77, { action: 'identity' }], [77, { action: 'fill', prompt: 'hello' }]])
  assert.equal(messages.at(-1)[0], 77)
  assert.match(apiCalls[0][0], /external-generation\/dramas\/3\/session\/attach$/)
  const body = JSON.parse(apiCalls[0][1].body)
  assert.equal(body.conversationId, 'conv-1')
  assert.equal(body.tabId, 77)
})

test('send waits for the provider submit button before beginning an attempt', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
  })
  let waitOptions = null
  controller.waitForProviderReady = async (...args) => { waitOptions = args; return true }
  controller.emit = async () => ({ id: 'event-1' })

  await controller.handle({
    action: 'send', dramaId: 3, site: 'chatgpt', jobId: 'job-1', attemptId: 'attempt-1',
    conversationId: 'conv-1', payload: { id: 'attempt-1' },
  })

  assert.equal(waitOptions?.[3]?.submit, true)
  assert.deepEqual(messages.slice(-2).map(([, message]) => message.action), ['beginAttempt', 'submit'])
})

test('send checks submit readiness again after binding the attempt', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
  })
  const readinessChecks = []
  controller.waitForProviderReady = async (...args) => {
    readinessChecks.push(args)
    return true
  }
  controller.emit = async () => ({ id: 'event-1' })

  await controller.handle({
    action: 'send', dramaId: 3, site: 'chatgpt', jobId: 'job-1', attemptId: 'attempt-1',
    conversationId: 'conv-1', payload: { id: 'attempt-1' },
  })

  assert.equal(readinessChecks.filter((args) => args[3]?.submit === true).length, 2)
  assert.deepEqual(messages.slice(-2).map(([, message]) => message.action), ['beginAttempt', 'submit'])
})

test('prepare replaces a closed stored tab with a live tab for the same conversation', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 88, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (tabId === 77) throw new Error('No tab with id: 77')
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { id: 'session-1' } }) }),
  })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', { conversationId: 'conv-1', tabId: 77 })
  controller.emit = async () => ({ id: 'event-1' })

  await controller.handle({ action: 'prepare', dramaId: 3, site: 'chatgpt', jobId: 'job-1', prompt: 'hello' })

  assert.deepEqual(messages.filter(([, message]) => message.action !== 'ready'), [
    [77, { action: 'identity' }],
    [88, { action: 'identity' }],
    [88, { action: 'fill', prompt: 'hello' }],
  ])
  assert.equal(controller.sessions.get(3, 'chatgpt').tabId, 88)
})

test('diagnostics reports provider readiness and conversation identity', async () => {
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (_tabId, message) => {
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        if (message.action === 'ready') return { ok: true, value: { composer: true } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  const result = await controller.handle({ action: 'diagnostics', dramaId: 3, site: 'chatgpt', conversationId: 'conv-1' })
  assert.equal(result.ok, true)
  assert.equal(result.diagnostics.canProceed, true)
  assert.equal(result.diagnostics.checks.find((check) => check.key === 'provider_tab').status, 'ok')
  assert.equal(result.diagnostics.checks.find((check) => check.key === 'conversation').status, 'ok')
})

test('diagnostics reports missing provider tab instead of throwing', async () => {
  const chromeApi = { tabs: { query: async () => [], sendMessage: async () => { throw new Error('missing') } } }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  const result = await controller.handle({ action: 'diagnostics', dramaId: 3, site: 'chatgpt' })
  assert.equal(result.ok, true)
  assert.equal(result.diagnostics.canProceed, false)
  assert.equal(result.diagnostics.checks.find((check) => check.key === 'provider_tab').code, 'PROVIDER_TAB_MISSING')
})

test('prepare restores the persisted project conversation after the browser restarts on ChatGPT home', async () => {
  const messages = []
  const navigations = []
  let restored = false
  let readyChecks = 0
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 88, url: 'https://chatgpt.com/' }],
      update: async (tabId, change) => {
        navigations.push([tabId, change])
        restored = true
        return { id: tabId, url: change.url }
      },
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (tabId === 77) throw new Error('No tab with id: 77')
        if (message.action === 'identity') {
          return restored
            ? { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
            : { ok: true, value: { conversationId: 'WEB:home', confidence: 'url' } }
        }
        if (message.action === 'ready') {
          readyChecks += 1
          return { ok: true, value: { composer: true } }
        }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { id: 'session-1' } }) }),
  })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', { conversationId: 'conv-1', tabId: 77 })
  controller.emit = async () => ({ id: 'event-1' })

  await controller.handle({ action: 'prepare', dramaId: 3, site: 'chatgpt', jobId: 'job-1', prompt: 'hello' })

  assert.deepEqual(navigations, [[88, { url: 'https://chatgpt.com/c/conv-1' }]])
  assert.equal(readyChecks, 1)
  assert.equal(controller.sessions.get(3, 'chatgpt').tabId, 88)
  assert.deepEqual(messages.at(-1), [88, { action: 'fill', prompt: 'hello' }])
})

test('prepare resumes a paused session when the same conversation is available again', async () => {
  const apiCalls = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 88, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (_tabId, message) => {
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async (url, init) => {
      apiCalls.push([url, init])
      return { ok: true, json: async () => ({ data: {} }) }
    },
  })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', { conversationId: 'conv-1', tabId: 88, status: 'paused', pauseReason: 'provider tab unavailable' })

  const session = await controller.ensureProviderSession({ dramaId: 3, site: 'chatgpt' })

  assert.equal(session.status, 'active')
  assert.equal(session.pauseReason, null)
  assert.equal(controller.sessions.get(3, 'chatgpt').status, 'active')
  assert.match(apiCalls.at(-1)[0], /external-generation\/dramas\/3\/session\/attach$/)
  assert.equal(JSON.parse(apiCalls.at(-1)[1].body).status, 'active')
})

test('prepare pauses instead of filling when the stored tab drifts to another conversation', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      query: async () => [],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        return { ok: true, value: { conversationId: 'conv-2', confidence: 'url' } }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
  })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', { conversationId: 'conv-1', tabId: 77 })

  await assert.rejects(
    () => controller.handle({ action: 'prepare', dramaId: 3, site: 'chatgpt', jobId: 'job-1', prompt: 'do not fill' }),
    /conversation identity mismatch/i,
  )
  assert.equal(controller.sessions.get(3, 'chatgpt').status, 'paused')
  assert.deepEqual(messages, [[77, { action: 'identity' }]])
})

test('prepare stops when the provider rejects fill or upload', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1' } }
        return { ok: false, error: 'ADAPTER_BROKEN' }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  await assert.rejects(() => controller.handle({ action: 'prepare', dramaId: 3, site: 'chatgpt', jobId: 'job-1', prompt: 'hello' }), /ADAPTER_BROKEN/)
  assert.deepEqual(messages.at(-1), [77, { action: 'fill', prompt: 'hello' }])
})

test('prepare hydrates local reference URLs before uploading them', async () => {
  const messages = []
  const requests = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async (url) => {
      requests.push(url)
      if (!String(url).includes('/static/')) return { ok: true, json: async () => ({ data: {} }) }
      return { ok: true, arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer }
    },
  })

  await controller.handle({
    action: 'prepare', dramaId: 3, site: 'chatgpt', jobId: 'job-1', prompt: 'hello',
    references: [{ role: 'character', sourceId: 3, url: 'http://localhost:5679/static/character.png' }],
  })

  assert.deepEqual(requests.filter((url) => String(url).includes('/static/')), ['http://localhost:5679/static/character.png'])
  const upload = messages.at(-1)
  assert.equal(upload[1].action, 'upload')
  assert.deepEqual(upload[1].files[0].bytes, [137, 80, 78, 71])
})

test('prepare rejects local reference responses that are not images', async () => {
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (_tabId, message) => {
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async (url) => String(url).includes('/static/')
      ? {
          ok: true,
          headers: { get: () => 'text/html; charset=utf-8' },
          arrayBuffer: async () => new TextEncoder().encode('<!doctype html>').buffer,
        }
      : { ok: true, json: async () => ({ data: {} }) },
  })

  await assert.rejects(
    () => controller.handle({
      action: 'prepare', dramaId: 3, site: 'chatgpt', jobId: 'job-1', prompt: 'hello',
      references: [{ role: 'character', sourceId: 3, url: 'http://localhost:5679/static/character.png' }],
    }),
    /reference response is not an image/i,
  )
})

test('send pauses instead of rebinding when the provider conversation drifts after prepare', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-2' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', { conversationId: 'conv-1', tabId: 77 })
  await assert.rejects(() => controller.handle({ action: 'send', dramaId: 3, site: 'chatgpt', tabId: 77, attemptId: 'attempt-1', payload: {} }), /conversation identity mismatch|rebind/i)
  assert.equal(controller.sessions.get(3, 'chatgpt').status, 'paused')
  assert.deepEqual(messages, [[77, { action: 'identity' }]])
})

test('send auto-attaches a provider tab when invoked from the workbench tab', async () => {
  const messages = []
  const apiCalls = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({
    chromeApi,
    storage: storage(),
    fetchImpl: async (url, init) => {
      apiCalls.push([url, init])
      return { ok: true, json: async () => ({ data: { id: 'session-1' } }) }
    },
  })
  controller.emit = async () => ({ id: 'event-1' })

  await controller.handle({
    action: 'send', dramaId: 3, site: 'chatgpt', jobId: 'job-1',
    attemptId: 'attempt-1', payload: {},
  }, { tab: { id: 9, url: 'http://127.0.0.1:3013/film/3' } })

  assert.deepEqual(messages, [
    [77, { action: 'identity' }],
    [77, { action: 'identity' }],
    [77, { action: 'ready' }],
    [77, { action: 'beginAttempt', attempt: { attemptId: 'attempt-1', conversationId: 'conv-1' } }],
    [77, { action: 'ready' }],
    [77, { action: 'submit' }],
  ])
  assert.match(apiCalls[0][0], /external-generation\/dramas\/3\/session\/attach$/)
})

test('send skips ChatGPT tabs without a content-script receiver', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      query: async () => [
        { id: 9, url: 'https://chatgpt.com/' },
        { id: 77, url: 'https://chatgpt.com/c/conv-1' },
      ],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (tabId === 9) throw new Error('Could not establish connection. Receiving end does not exist.')
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  controller.emit = async () => ({ id: 'event-1' })

  await controller.handle({ action: 'send', dramaId: 3, site: 'chatgpt', attemptId: 'attempt-1', payload: {} }, { tab: { id: 100 } })

  assert.equal(messages.some(([tabId, message]) => tabId === 77 && message.action === 'beginAttempt'), true)
})

test('background binds the global fetch implementation before calling it', async () => {
  const originalFetch = globalThis.fetch
  let boundThis = null
  globalThis.fetch = function () {
    boundThis = this
    return Promise.resolve({ ok: true, json: async () => ({ data: {} }) })
  }
  try {
    const controller = new BackgroundController({ chromeApi: {}, storage: storage() })
    await controller.api('health')
    assert.equal(boundThis, globalThis)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('conversation identity polling ignores ChatGPT provisional WEB ids', async () => {
  const identities = [
    { ok: true, value: { conversationId: 'WEB:temporary', confidence: 'url' } },
    { ok: true, value: { conversationId: 'WEB:temporary', confidence: 'url' } },
    { ok: true, value: { conversationId: 'conversation-final', confidence: 'url' } },
  ]
  const controller = new BackgroundController({
    chromeApi: { tabs: { sendMessage: async () => identities.shift() } },
    storage: storage(),
  })
  const identity = await controller.waitForConversationIdentity(77, 3, 0)
  assert.equal(identity.conversationId, 'conversation-final')
})

test('prepare upgrades a provisional WEB session to the live final conversation', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 88, url: 'https://chatgpt.com/c/conversation-final' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conversation-final', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', { conversationId: 'WEB:temporary', tabId: 77 })
  controller.emit = async () => ({ id: 'event-1' })
  await controller.handle({ action: 'prepare', dramaId: 3, site: 'chatgpt', jobId: 'job-1', prompt: 'hello' })
  assert.equal(controller.sessions.get(3, 'chatgpt').conversationId, 'conversation-final')
  assert.deepEqual(messages.filter(([, message]) => message.action !== 'ready').slice(-2), [[77, { action: 'identity' }], [77, { action: 'fill', prompt: 'hello' }]])
})

test('recoverAttempt routes recovery to the bound provider tab', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conversation-final', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', { conversationId: 'conversation-final', tabId: 77 })
  const result = await controller.handle({
    action: 'recoverAttempt', dramaId: 3, site: 'chatgpt', attemptId: 'attempt-1', conversationId: 'conversation-final',
    attempt: { id: 'attempt-1', assistant_message_id: 'assistant-old', conversation_id: 'conversation-final' },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(messages, [
    [77, { action: 'identity' }],
    [77, { action: 'recoverAttempt', attempt: {
      id: 'attempt-1', assistant_message_id: 'assistant-old', conversation_id: 'conversation-final',
      attemptId: 'attempt-1', conversationId: 'conversation-final', assistantMessageId: 'assistant-old',
    } }],
  ])
})

test('diagnostics exits an open image editor before reporting the provider ready', async () => {
  const actions = []
  let editorOpen = true
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (_tabId, message) => {
        actions.push(message.action)
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        if (message.action === 'exitImageEditor') { editorOpen = false; return { ok: true, value: true } }
        if (message.action === 'ready') return { ok: true, value: editorOpen
          ? { composer: false, submit: false, mode: 'image_editor' }
          : { composer: true, submit: true, mode: 'conversation' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })

  const result = await controller.handle({ action: 'diagnostics', dramaId: 3, site: 'chatgpt', conversationId: 'conv-1' })

  assert.equal(result.diagnostics.canProceed, true)
  assert.equal(result.diagnostics.checks.find((check) => check.key === 'composer').status, 'ok')
  assert.deepEqual(actions.slice(-3), ['ready', 'exitImageEditor', 'ready'])
})

test('cancelAttemptSend aborts a queued send before any provider action', async () => {
  const messages = []
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (tabId, message) => {
        messages.push([tabId, message])
        if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        return { ok: true }
      },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  controller.emit = async () => ({ id: 'event-1' })
  let release
  // 只让第一次按钮等待阻塞(模拟生成中按钮不可点);后续调用立即放行
  controller.waitForProviderReady = () => {
    if (release) return true
    return new Promise((resolve) => { release = resolve })
  }

  const sendPromise = controller.handle({
    action: 'send', dramaId: 3, site: 'chatgpt', jobId: 'job-1', attemptId: 'attempt-9', payload: {},
  })
  // 等发送链走到按钮等待这一步(期间它占用后台串行队列,模拟桥接超时时任务已被判失败的场景)
  for (let i = 0; i < 200 && !release; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.ok(release, 'send chain should reach the submit-button wait')

  await controller.handle({ action: 'cancelAttemptSend', attemptId: 'attempt-9' })
  release(true)
  await assert.rejects(sendPromise, /SEND_CANCELLED/)
  assert.equal(messages.some(([, message]) => message.action === 'beginAttempt'), false)
  assert.equal(messages.some(([, message]) => message.action === 'submit'), false)
  // 链结束后取消登记必须清除,同一 attempt 的重试才不会被误伤
  assert.equal(controller.cancelledSends.has('attempt-9'), false)
})

test('expired cancel requests no longer block a retry of the same attempt', async () => {
  const controller = new BackgroundController({ chromeApi: {}, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  controller.cancelledSends.set('attempt-old', Date.now() - 16 * 60 * 1000)
  assert.equal(controller.isSendCancelled('attempt-old'), false)
  controller.cancelledSends.set('attempt-new', Date.now())
  assert.equal(controller.isSendCancelled('attempt-new'), true)
})

test('adapter error outbox events preserve diagnostic payloads', async () => {
  const requests = []
  const controller = new BackgroundController({
    chromeApi: {},
    storage: storage(),
    fetchImpl: async (url, init) => { requests.push([url, init]); return { ok: true, json: async () => ({ data: {} }) } },
  })
  await controller.emit('ADAPTER_ERROR', { attemptId: 'attempt-1', code: 'RESULT_CAPTURE_FAILED', message: 'download failed' })
  const body = JSON.parse(requests[0][1].body)
  assert.equal(body.payload.attemptId, 'attempt-1')
  assert.equal(body.payload.code, 'RESULT_CAPTURE_FAILED')
  assert.equal(body.payload.message, 'download failed')
})

test('captured results normalize Chrome JSON-serialized byte objects before import', async () => {
  const controller = new BackgroundController({ chromeApi: {}, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  let imported
  controller.workbench.importImage = async (payload) => { imported = payload; return { resultId: 'result-1' } }
  controller.emit = async () => ({ id: 'event-1' })
  await controller.handle({ action: 'capturedResult', payload: {
    attemptId: 'attempt-1', resultSetId: 'set-1', resultIndex: 0, assistantMessageId: 'assistant-1',
    bytes: { 0: 137, 1: 80, 2: 78, 3: 71 },
  } })
  assert.ok(imported.bytes instanceof Uint8Array)
  assert.deepEqual([...imported.bytes], [137, 80, 78, 71])
})

test('generating observations emit a backend attempt event', async () => {
  const controller = new BackgroundController({ chromeApi: {}, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  const emitted = []
  controller.emit = async (...args) => { emitted.push(args); return { id: 'event-generating' } }

  const response = await controller.handle({ action: 'attemptGenerating', payload: {
    attemptId: 'attempt-generating', conversationId: 'conversation-1', assistantMessageId: 'assistant-12',
  } })

  assert.equal(response.ok, true)
  assert.deepEqual(emitted, [[
    'ATTEMPT_EVENT',
    {
      attemptId: 'attempt-generating',
      conversationId: 'conversation-1',
      eventType: 'GENERATING',
      payload: { assistantMessageId: 'assistant-12' },
    },
  ]])
})

test('assistant identity promotions emit a bound event before import', async () => {
  const controller = new BackgroundController({ chromeApi: {}, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  const emitted = []
  controller.emit = async (...args) => { emitted.push(args); return { id: 'event-bound' } }

  const response = await controller.handle({ action: 'attemptBound', payload: {
    attemptId: 'attempt-promoted', conversationId: 'conversation-1', assistantMessageId: 'assistant-final',
  } })

  assert.equal(response.ok, true)
  assert.equal(emitted[0][1].eventType, 'ASSISTANT_BOUND')
  assert.equal(emitted[0][1].payload.assistantMessageId, 'assistant-final')
})

test('provider readiness closes the ChatGPT image editor before using the conversation composer', async () => {
  const messages = []
  const responses = [
    { ok: true, value: { composer: false, submit: false, mode: 'image_editor' } },
    { ok: true },
    { ok: true, value: { composer: true, submit: true, mode: 'conversation' } },
  ]
  const controller = new BackgroundController({
    chromeApi: { tabs: { sendMessage: async (tabId, message) => { messages.push([tabId, message]); return responses.shift() } } },
    storage: storage(),
  })

  const ready = await controller.waitForProviderReady(77, 3, 0, { submit: true })

  assert.equal(ready, true)
  assert.deepEqual(messages, [
    [77, { action: 'ready' }],
    [77, { action: 'exitImageEditor' }],
    [77, { action: 'ready' }],
  ])
})

test('send persists the active capture before the provider click', async () => {
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 77, url: 'https://chatgpt.com/c/conv-1' }],
      sendMessage: async (_tabId, message) => message.action === 'identity'
        ? { ok: true, value: { conversationId: 'conv-1', confidence: 'url' } }
        : { ok: true, value: { composer: true, submit: true, mode: 'conversation' } },
    },
  }
  const controller = new BackgroundController({ chromeApi, storage: storage(), fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) })
  controller.emit = async () => ({ id: 'event-1' })

  await controller.handle({
    action: 'send', dramaId: 3, site: 'chatgpt', attemptId: 'attempt-persisted', payload: {},
  })

  assert.deepEqual(controller.sessions.get(3, 'chatgpt').activeAttempt, {
    attemptId: 'attempt-persisted',
    conversationId: 'conv-1',
    userMessageId: null,
    assistantMessageId: null,
    grayShellReloads: 0,
  })
})

test('gray shell recovery reloads at most twice and keeps the stable assistant identity', async () => {
  const reloads = []
  const controller = new BackgroundController({
    chromeApi: { tabs: { reload: async (tabId) => { reloads.push(tabId) } } },
    storage: storage(),
  })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', {
    tabId: 77,
    conversationId: 'conv-1',
    activeAttempt: {
      attemptId: 'attempt-shell', conversationId: 'conv-1', assistantMessageId: null, grayShellReloads: 0,
    },
  })

  const message = { action: 'recoverGrayShell', payload: {
    attemptId: 'attempt-shell', conversationId: 'conv-1', assistantMessageId: 'request-conv-1-5',
  } }
  await controller.handle(message, { tab: { id: 77 } })
  await controller.handle(message, { tab: { id: 77 } })
  await assert.rejects(() => controller.handle(message, { tab: { id: 77 } }), /RESULT_SHELL_STUCK/)

  assert.deepEqual(reloads, [77, 77])
  assert.deepEqual(controller.sessions.get(3, 'chatgpt').activeAttempt, {
    attemptId: 'attempt-shell',
    conversationId: 'conv-1',
    assistantMessageId: 'request-conv-1-5',
    grayShellReloads: 2,
  })
})

test('page reload automatically reattaches a persisted active capture by stable identity', async () => {
  const messages = []
  const controller = new BackgroundController({
    chromeApi: { tabs: { sendMessage: async (tabId, message) => {
      messages.push([tabId, message])
      if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1' } }
      return { ok: true }
    } } },
    storage: storage(),
  })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', {
    tabId: 77,
    conversationId: 'conv-1',
    activeAttempt: {
      attemptId: 'attempt-shell', conversationId: 'conv-1', assistantMessageId: 'request-conv-1-5', grayShellReloads: 1,
    },
  })

  const recovered = await controller.recoverActiveCapture(77)

  assert.equal(recovered, true)
  assert.deepEqual(messages, [
    [77, { action: 'identity' }],
    [77, { action: 'recoverAttempt', attempt: {
      attemptId: 'attempt-shell',
      conversationId: 'conv-1',
      assistantMessageId: 'request-conv-1-5',
      grayShellReloads: 1,
    } }],
  ])
})

test('page reload reattaches from the user anchor before an assistant identity exists', async () => {
  const messages = []
  const controller = new BackgroundController({
    chromeApi: { tabs: { sendMessage: async (tabId, message) => {
      messages.push([tabId, message])
      if (message.action === 'identity') return { ok: true, value: { conversationId: 'conv-1' } }
      return { ok: true }
    } } },
    storage: storage(),
  })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', {
    tabId: 77,
    conversationId: 'conv-1',
    activeAttempt: {
      attemptId: 'attempt-user-only', conversationId: 'conv-1', userMessageId: 'user-final-uuid', assistantMessageId: null, grayShellReloads: 0,
    },
  })

  const recovered = await controller.recoverActiveCapture(77)

  assert.equal(recovered, true)
  assert.deepEqual(messages.at(-1), [77, { action: 'recoverAttempt', attempt: {
    attemptId: 'attempt-user-only',
    conversationId: 'conv-1',
    userMessageId: 'user-final-uuid',
    assistantMessageId: null,
    grayShellReloads: 0,
  } }])
})

test('user-message binding persists a durable recovery anchor and records it in the backend', async () => {
  const controller = new BackgroundController({
    chromeApi: {},
    storage: storage(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }),
  })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', {
    tabId: 77,
    conversationId: 'conv-1',
    activeAttempt: {
      attemptId: 'attempt-user-anchor', conversationId: 'conv-1', assistantMessageId: null, grayShellReloads: 0,
    },
  })
  const emitted = []
  controller.emit = async (...args) => { emitted.push(args); return { id: 'event-user-bound' } }

  const response = await controller.handle({ action: 'attemptUserBound', payload: {
    attemptId: 'attempt-user-anchor', conversationId: 'conv-1', userMessageId: 'user-message-uuid',
  } })

  assert.equal(response.ok, true)
  assert.equal(controller.sessions.get(3, 'chatgpt').activeAttempt.userMessageId, 'user-message-uuid')
  assert.deepEqual(emitted, [[
    'ATTEMPT_EVENT',
    {
      attemptId: 'attempt-user-anchor',
      conversationId: 'conv-1',
      eventType: 'USER_BOUND',
      payload: { userMessageId: 'user-message-uuid' },
    },
  ]])
})

test('capture completion records a terminal event before clearing recovery state', async () => {
  const controller = new BackgroundController({ chromeApi: {}, storage: storage() })
  await controller.init()
  await controller.sessions.attach(3, 'chatgpt', {
    tabId: 77,
    conversationId: 'conv-1',
    activeAttempt: { attemptId: 'attempt-complete', conversationId: 'conv-1', assistantMessageId: 'assistant-1' },
  })
  const emitted = []
  controller.emit = async (...args) => { emitted.push(args); return { id: 'event-completed' } }

  const response = await controller.handle({ action: 'attemptCaptureComplete', payload: { attemptId: 'attempt-complete' } })

  assert.equal(response.ok, true)
  assert.deepEqual(emitted, [[
    'ATTEMPT_EVENT',
    { attemptId: 'attempt-complete', conversationId: 'conv-1', eventType: 'COMPLETED', payload: {} },
  ]])
  assert.equal(controller.sessions.get(3, 'chatgpt').activeAttempt, null)
})
