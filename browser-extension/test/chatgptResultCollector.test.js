import test from 'node:test';
import assert from 'node:assert/strict';
import { extractResultSet } from '../src/sites/chatgpt/resultCollector.js';
import { ChatGPTAdapter } from '../src/sites/chatgpt/adapter.js';

function node(id, images = []) { return { dataset: { messageId: id }, getAttribute(name) { return name === 'data-message-id' ? id : null; }, querySelectorAll() { return images; } }; }
function image(url) { return { currentSrc: url, src: url, dataset: {} }; }

test('collector binds only to the registered assistant and fingerprints source nodes', () => {
  const result = extractResultSet(node('assistant-1', [image('https://cdn.test/a.png')]), { attemptId: 'attempt-1', assistantMessageId: 'assistant-1', resultSetId: 'set-1' });
  assert.equal(result.status, 'RESULT_READY'); assert.equal(result.results[0].nodeFingerprint, 'assistant-1:0:https://cdn.test/a.png');
  assert.equal(result.assistantMessageId, 'assistant-1');
  assert.equal(extractResultSet(node('assistant-2', [image('https://cdn.test/b.png')]), { assistantMessageId: 'assistant-1' }).status, 'UNBOUND_RESULT');
});

test('collector recognizes current ChatGPT assistant turns and generated image nodes', () => {
  const assistant = {
    dataset: { turn: 'assistant' },
    getAttribute(name) {
      if (name === 'data-turn') return 'assistant';
      if (name === 'data-testid') return 'conversation-turn-2';
      return null;
    },
    querySelectorAll() { return [image('https://chatgpt.com/backend-api/estuary/content?id=generated')]; },
  };
  const result = extractResultSet(assistant, { attemptId: 'attempt-1', assistantMessageId: 'conversation-turn-2' });
  assert.equal(result.status, 'RESULT_READY');
  assert.equal(result.assistantMessageId, 'conversation-turn-2');
  assert.equal(result.results[0].sourceUrl, 'https://chatgpt.com/backend-api/estuary/content?id=generated');
});

test('adapter finds current ChatGPT assistant turn containers', () => {
  const assistant = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-2' : null; } };
  const doc = { querySelector() { return null; }, querySelectorAll(selector) { return selector.includes('data-turn="assistant"') ? [assistant] : []; } };
  const adapter = new ChatGPTAdapter({ documentRef: doc });
  assert.equal(adapter.findAssistant({ assistantMessageId: 'conversation-turn-2' }), assistant);
});

test('adapter recognizes ChatGPT conversation turns when author roles are omitted', () => {
  const assistant = node('conversation-turn-2', [image('https://cdn.test/generated.png')]);
  const doc = {
    querySelectorAll(selector) {
      return selector.split(',').some((part) => part.trim() === '[data-testid^="conversation-turn-"]') ? [assistant] : [];
    },
  };
  const adapter = new ChatGPTAdapter({ documentRef: doc });
  assert.equal(adapter.findAssistant({ assistantMessageId: 'conversation-turn-2' }), assistant);
});

test('adapter recovers the latest assistant turn after the content script reloads', () => {
  const oldAssistant = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-2' : null; } };
  const latestAssistant = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-4' : null; } };
  const doc = { querySelector() { return null; }, querySelectorAll(selector) { return selector.includes('data-turn="assistant"') ? [oldAssistant, latestAssistant] : []; } };
  const adapter = new ChatGPTAdapter({ documentRef: doc });
  let observed;
  adapter.observeAttempt = (identity) => { observed = identity; return () => {}; };
  adapter.recoverAttempt({ attemptId: 'attempt-1', conversationId: 'conversation-1' }, () => {});
  assert.deepEqual(observed, { attemptId: 'attempt-1', conversationId: 'conversation-1', assistantMessageId: 'conversation-turn-4' });
});

test('adapter pauses after capture failure instead of retrying forever', async () => {
  const assistant = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-4' : null; }, querySelectorAll() { return [image('https://chatgpt.com/result.png')]; } };
  const doc = { querySelector() { return null; }, querySelectorAll(selector) { return selector.includes('data-turn="assistant"') ? [assistant] : []; } };
  const previousObserver = globalThis.MutationObserver;
  const previousTimeout = globalThis.setTimeout;
  let timers = 0;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.setTimeout = () => { timers += 1; return 0; };
  try {
    const adapter = new ChatGPTAdapter({ documentRef: doc });
    adapter.observeAttempt({ attemptId: 'attempt-1', assistantMessageId: 'conversation-turn-4' }, () => Promise.reject(new Error('import failed')));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(adapter.capturePaused, true);
    assert.equal(timers, 0);
  } finally {
    globalThis.MutationObserver = previousObserver;
    globalThis.setTimeout = previousTimeout;
  }
});

test('adapter reattaches capture when ChatGPT replaces an assistant turn node with the same id', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const shell = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-6' : null; } };
    const completed = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-6' : null; } };
    let assistants = [];
    const root = { querySelectorAll() { return assistants; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    const observed = [];
    adapter.observeAttempt = (identity) => {
      observed.push({ identity, node: assistants.at(-1) });
      const stop = () => {};
      stop.root = assistants.at(-1);
      return stop;
    };

    adapter.beginAttempt({ attemptId: 'attempt-2' }, () => {});
    assistants = [shell];
    discover();
    assistants = [completed];
    discover();

    assert.deepEqual(observed.map((entry) => entry.node), [shell, completed]);
    assert.equal(observed[1].identity.assistantMessageId, 'conversation-turn-6');
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
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

test('adapter fills a ProseMirror contenteditable composer with an input event', () => {
  const previousDocument = globalThis.document;
  const events = [];
  const commands = [];
  const composer = {
    textContent: '',
    focus() { this.focused = true; },
    dispatchEvent(event) { events.push(event.type); },
    getAttribute(name) { return name === 'contenteditable' ? 'true' : null; },
  };
  const doc = { querySelector(selector) { return selector.includes('[contenteditable="true"]') ? composer : null; }, querySelectorAll() { return []; }, execCommand(command, _showUi, value) { commands.push([command, value]); composer.textContent = value || composer.textContent; return true; } };
  globalThis.InputEvent = class InputEvent { constructor(type) { this.type = type; } };
  const adapter = new ChatGPTAdapter({ documentRef: doc, locationRef: { href: 'https://chatgpt.com/' } });
  const result = adapter.fillPrompt('精准测试 prompt');
  assert.equal(result.promptLength, 11);
  assert.equal(composer.textContent, '精准测试 prompt');
  assert.deepEqual(commands, [['selectAll', undefined], ['insertText', '精准测试 prompt']]);
  assert.deepEqual(events, ['input']);
  globalThis.document = previousDocument;
});
