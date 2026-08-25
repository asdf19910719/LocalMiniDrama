import test from 'node:test';
import assert from 'node:assert/strict';
import { extractResultSet } from '../src/sites/chatgpt/resultCollector.js';
import { ChatGPTAdapter } from '../src/sites/chatgpt/adapter.js';

function node(id, images = []) { return { dataset: { messageId: id }, getAttribute(name) { return name === 'data-message-id' ? id : null; }, querySelectorAll() { return images; } }; }
function image(url) { return { currentSrc: url, src: url, dataset: {} }; }

test('collector binds only to the registered assistant and fingerprints source nodes', () => {
  const result = extractResultSet(node('assistant-1', [image('https://cdn.test/a.png')]), { attemptId: 'attempt-1', assistantMessageId: 'assistant-1', resultSetId: 'set-1' });
  assert.equal(result.status, 'RESULT_READY'); assert.equal(result.results[0].nodeFingerprint, 'assistant-1:0:https://cdn.test/a.png');
  assert.equal(extractResultSet(node('assistant-2', [image('https://cdn.test/b.png')]), { assistantMessageId: 'assistant-1' }).status, 'UNBOUND_RESULT');
});

test('adapter uploads byte references through DataTransfer and exposes authenticated original fetch', async () => {
  const fileInput = { files: [], dispatchEvent() {} }; const button = { disabled: false, click() { this.clicked = true; } };
  const doc = { querySelector(selector) { if (selector.includes('file')) return fileInput; if (selector.includes('send')) return button; return null; }, querySelectorAll() { return []; } };
  class FakeFile { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; } }
  class FakeDataTransfer { constructor() { this.items = { list: [], add: (file) => this.items.list.push(file) }; } get files() { return this.items.list; } }
  globalThis.File = FakeFile; globalThis.DataTransfer = FakeDataTransfer; globalThis.Event = class Event { constructor(type) { this.type = type; } };
  const adapter = new ChatGPTAdapter({ documentRef: doc, fetchImpl: async (_url, options) => { assert.equal(options.credentials, 'include'); return { ok: true, headers: { get: () => 'image/png' }, async arrayBuffer() { return Uint8Array.from([1, 2]).buffer; } }; } });
  await adapter.uploadReferences([{ name: 'ref.png', bytes: Uint8Array.from([1]), mime: 'image/png' }]); assert.equal(fileInput.files.length, 1); adapter.submit(); assert.equal(button.clicked, true);
  const original = await adapter.fetchOriginal({ sourceUrl: 'https://files.oaiusercontent.com/a.png' }); assert.equal(original.mime, 'image/png'); assert.deepEqual([...original.bytes], [1, 2]);
});
