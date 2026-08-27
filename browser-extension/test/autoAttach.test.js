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
  assert.deepEqual(messages.slice(0, 2), [[77, { action: 'identity' }], [77, { action: 'fill', prompt: 'hello' }]])
  assert.equal(messages.at(-1)[0], 77)
  assert.match(apiCalls[0][0], /external-generation\/dramas\/3\/session\/attach$/)
  const body = JSON.parse(apiCalls[0][1].body)
  assert.equal(body.conversationId, 'conv-1')
  assert.equal(body.tabId, 77)
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

  assert.deepEqual(messages, [
    [77, { action: 'identity' }],
    [88, { action: 'identity' }],
    [88, { action: 'fill', prompt: 'hello' }],
  ])
  assert.equal(controller.sessions.get(3, 'chatgpt').tabId, 88)
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
    [77, { action: 'beginAttempt', attempt: { attemptId: 'attempt-1', conversationId: 'conv-1' } }],
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
  assert.deepEqual(messages.slice(-2), [[77, { action: 'identity' }], [77, { action: 'fill', prompt: 'hello' }]])
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
  const result = await controller.handle({ action: 'recoverAttempt', dramaId: 3, site: 'chatgpt', attemptId: 'attempt-1', conversationId: 'conversation-final' })
  assert.equal(result.ok, true)
  assert.deepEqual(messages, [
    [77, { action: 'identity' }],
    [77, { action: 'recoverAttempt', attempt: { attemptId: 'attempt-1', conversationId: 'conversation-final' } }],
  ])
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
