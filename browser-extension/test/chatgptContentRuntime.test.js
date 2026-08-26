import test from 'node:test';
import assert from 'node:assert/strict';
import { captureResults, installChatGPTContentBridge } from '../src/sites/chatgpt/contentRuntime.js';

test('result capture binds the discovered assistant identity and waits for import acknowledgement', async () => {
  const messages = [];
  let acknowledge;
  const chromeApi = {
    runtime: {
      sendMessage(message) {
        messages.push(message);
        return new Promise((resolve) => { acknowledge = resolve; });
      },
    },
  };
  const adapter = {
    async fetchOriginal() {
      return { bytes: Uint8Array.from([1, 2, 3]), mime: 'image/png' };
    },
  };
  let settled = false;
  const pending = captureResults({
    adapter,
    chromeApi,
    attempt: { attemptId: 'attempt-1', conversationId: 'conversation-1' },
    resultSet: {
      resultSetId: 'set-1',
      assistantMessageId: 'assistant-9',
      results: [{ resultIndex: 0, sourceUrl: 'https://files.oaiusercontent.com/result.png' }],
    },
  }).then(() => { settled = true; });

  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(messages[0].payload.assistantMessageId, 'assistant-9');
  acknowledge({ ok: true, result: { resultId: 'result-1' } });
  await pending;
  assert.equal(settled, true);
});

test('result capture rejects a failed import acknowledgement so the adapter can retry', async () => {
  const chromeApi = {
    runtime: {
      async sendMessage() {
        return { ok: false, error: 'NEEDS_REVIEW: assistant message identity is required' };
      },
    },
  };
  const adapter = {
    async fetchOriginal() {
      return { bytes: Uint8Array.from([4, 5]), mime: 'image/png' };
    },
  };

  await assert.rejects(() => captureResults({
    adapter,
    chromeApi,
    attempt: { attemptId: 'attempt-2', conversationId: 'conversation-1' },
    resultSet: {
      resultSetId: 'set-2',
      assistantMessageId: 'assistant-10',
      results: [{ resultIndex: 0, sourceUrl: 'https://files.oaiusercontent.com/result-2.png' }],
    },
  }), /NEEDS_REVIEW/);
});

test('result capture reports source or import failures to the background', async () => {
  const messages = [];
  const chromeApi = { runtime: { async sendMessage(message) { messages.push(message); return { ok: true }; } } };
  const adapter = { async fetchOriginal() { throw new Error('ORIGINAL_FETCH_FAILED:403'); } };
  await assert.rejects(() => captureResults({
    adapter,
    chromeApi,
    attempt: { attemptId: 'attempt-3', conversationId: 'conversation-1' },
    resultSet: { resultSetId: 'set-3', assistantMessageId: 'assistant-11', results: [{ resultIndex: 0, sourceUrl: 'https://chatgpt.com/result.png' }] },
  }), /ORIGINAL_FETCH_FAILED:403/);
  assert.equal(messages.at(-1).action, 'adapterError');
  assert.equal(messages.at(-1).payload.attemptId, 'attempt-3');
  assert.match(messages.at(-1).payload.message, /ORIGINAL_FETCH_FAILED:403/);
});

test('provider bridge installs one runtime listener and never forwards page messages', () => {
  const runtimeListeners = [];
  const pageListeners = [];
  const chromeApi = {
    runtime: {
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      async sendMessage() { return { ok: true }; },
    },
  };
  const windowRef = { addEventListener(type) { pageListeners.push(type); } };
  const globalRef = { window: windowRef };
  const adapter = { getConversationIdentity() { return null; } };

  assert.equal(installChatGPTContentBridge({ chromeApi, adapter, globalRef }), true);
  assert.equal(installChatGPTContentBridge({ chromeApi, adapter, globalRef }), false);
  assert.equal(runtimeListeners.length, 1);
  assert.deepEqual(pageListeners, []);
});

test('provider bridge uses a DOM marker to avoid duplicate isolated-world listeners', () => {
  const runtimeListeners = [];
  const attrs = new Map([['data-aistory-chatgpt-bridge', 'v1']]);
  const chromeApi = { runtime: { onMessage: { addListener(listener) { runtimeListeners.push(listener); } } } };
  const documentRef = {
    documentElement: {
      hasAttribute(name) { return attrs.has(name); },
      setAttribute(name, value) { attrs.set(name, value); },
    },
  };
  const globalRef = { document: documentRef };
  const adapter = { getConversationIdentity() { return null; } };
  assert.equal(installChatGPTContentBridge({ chromeApi, adapter, globalRef }), false);
  assert.equal(runtimeListeners.length, 0);
});
