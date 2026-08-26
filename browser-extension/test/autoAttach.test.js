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
