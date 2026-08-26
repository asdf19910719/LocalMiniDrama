import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRegistry } from '../src/sessionRegistry.js';

function storage() { const data = {}; return { async get(key) { return { [key]: data[key] }; }, async set(value) { Object.assign(data, value); } }; }

test('session is keyed by drama/site and persists one conversation', async () => {
  const registry = new SessionRegistry(storage()); await registry.load();
  await registry.attach(1, 'ChatGPT', { conversationId: 'c1', tabId: 7 });
  assert.equal(registry.get(1, 'chatgpt').conversationId, 'c1');
  await assert.rejects(() => registry.attach(1, 'chatgpt', { conversationId: 'c2' }), /rebind/);
  await registry.pause(1, 'chatgpt', 'manual'); assert.throws(() => registry.assertConversation(1, 'chatgpt', 'c1'), /paused/);
  const rebound = await registry.rebind(1, 'chatgpt', { conversationId: 'c2', status: 'active' }); assert.equal(rebound.conversationId, 'c2');
});
