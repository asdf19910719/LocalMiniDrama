import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerBackground } from '../src/background.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function chromeFixture(identityResponses = [{ ok: true, value: null }]) {
  const updatedListeners = [];
  const executeCalls = [];
  const messageCalls = [];
  const chromeApi = {
    runtime: {
      onMessage: { addListener() {} },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
    },
    tabs: {
      onUpdated: { addListener(listener) { updatedListeners.push(listener); } },
      sendMessage: async (tabId, message) => {
        messageCalls.push([tabId, message]);
        const response = identityResponses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
    },
    scripting: {
      executeScript: async (details) => { executeCalls.push(details); },
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
  return { chromeApi, updatedListeners, executeCalls, messageCalls };
}

test('ChatGPT content injection uses a browser-loadable bundle', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const chatgptEntry = manifest.content_scripts.find((entry) => (entry.matches || []).some((match) => match.includes('chatgpt.com')));
  assert.ok(chatgptEntry, 'ChatGPT content script entry is required');
  assert.deepEqual(chatgptEntry.js, ['src/sites/chatgpt/content.bundle.js']);
  const source = fs.readFileSync(path.join(root, chatgptEntry.js[0]), 'utf8');
  assert.doesNotMatch(source, /(^|\n)\s*import\s/m);
  assert.doesNotMatch(source, /(^|\n)\s*export\s/m);
});

test('ChatGPT content injection pings a healthy receiver without reinjecting', async () => {
  const { chromeApi, updatedListeners, executeCalls, messageCalls } = chromeFixture();
  registerBackground(chromeApi, { storage: chromeApi.storage.local });
  assert.equal(updatedListeners.length, 1);

  await updatedListeners[0](42, { status: 'complete' }, { url: 'https://chatgpt.com/c/abc' });
  assert.deepEqual(messageCalls, [[42, { action: 'identity' }]]);
  assert.deepEqual(executeCalls, []);

  await updatedListeners[0](42, { status: 'complete' }, { url: 'https://example.com/' });
  assert.equal(messageCalls.length, 1);
});

test('ChatGPT content injection recovers a missing receiver and verifies it', async () => {
  const { chromeApi, updatedListeners, executeCalls, messageCalls } = chromeFixture([
    new Error('Receiving end does not exist'),
    { ok: true, value: { conversationId: 'conversation-1' } },
  ]);
  registerBackground(chromeApi, { storage: chromeApi.storage.local });

  await updatedListeners[0](43, { status: 'complete' }, { url: 'https://chatgpt.com/c/conversation-1' });
  assert.deepEqual(executeCalls, [{
    target: { tabId: 43 },
    files: ['src/sites/chatgpt/content.bundle.js'],
  }]);
  assert.deepEqual(messageCalls, [
    [43, { action: 'identity' }],
    [43, { action: 'identity' }],
  ]);
});
