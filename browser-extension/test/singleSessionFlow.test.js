import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionRegistry } from '../src/sessionRegistry.js'
import { envelope } from '../src/protocol.js'

function storage() {
  const values = {}
  return {
    get(key) { return Promise.resolve({ [key]: values[key] }) },
    set(value) { Object.assign(values, value); return Promise.resolve() },
  }
}

test('keeps three attempts in one project conversation and pauses on identity drift', async () => {
  const registry = new SessionRegistry(storage())
  await registry.attach(7, 'chatgpt', { conversationId: 'conversation-1', tabId: 99 })
  await registry.assertAndAdvance(7, 'chatgpt', 'conversation-1', 1)
  await registry.assertAndAdvance(7, 'chatgpt', 'conversation-1', 2)
  await registry.assertAndAdvance(7, 'chatgpt', 'conversation-1', 3)
  assert.equal(registry.get(7, 'chatgpt').conversationId, 'conversation-1')
  await assert.rejects(() => registry.assertAndAdvance(7, 'chatgpt', 'conversation-2', 4), /identity mismatch/)
  const event = envelope('ATTEMPT_EVENT', { attemptId: 'attempt-3', eventType: 'RESULT_READY' }, 3, 'event-3')
  assert.equal(event.payload.attemptId, 'attempt-3')
  await registry.pause(7, 'chatgpt', 'manual review')
  await assert.rejects(() => registry.assertAndAdvance(7, 'chatgpt', 'conversation-1', 4), /paused/)
})
