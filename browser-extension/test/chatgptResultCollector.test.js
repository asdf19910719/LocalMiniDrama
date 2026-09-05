import test from 'node:test';
import assert from 'node:assert/strict';
import { extractResultSet } from '../src/sites/chatgpt/resultCollector.js';
import { ChatGPTAdapter } from '../src/sites/chatgpt/adapter.js';
import { captureResults, installChatGPTContentBridge } from '../src/sites/chatgpt/contentRuntime.js';

function node(id, images = []) { return { dataset: { messageId: id }, getAttribute(name) { return name === 'data-message-id' ? id : null; }, querySelectorAll() { return images; } }; }
function image(url) { return { currentSrc: url, src: url, dataset: {} }; }

test('collector binds only to the registered assistant and fingerprints source nodes', () => {
  const result = extractResultSet(node('assistant-1', [image('https://cdn.test/a.png')]), { attemptId: 'attempt-1', assistantMessageId: 'assistant-1', resultSetId: 'set-1' });
  assert.equal(result.status, 'RESULT_READY'); assert.equal(result.results[0].nodeFingerprint, 'assistant-1:https://cdn.test/a.png');
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

test('collector prefers the stable ChatGPT turn id while retaining the render id as a recovery alias', () => {
  const assistant = {
    dataset: { turn: 'assistant' },
    getAttribute(name) {
      if (name === 'data-turn') return 'assistant';
      if (name === 'data-turn-id') return 'request-conversation-1-5';
      if (name === 'data-turn-id-container') return 'request-conversation-1-5';
      if (name === 'data-testid') return 'conversation-turn-22';
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'img' ? [image('https://chatgpt.com/backend-api/estuary/content?id=stable')] : [];
    },
  };
  const doc = { querySelectorAll() { return [assistant]; } };
  const adapter = new ChatGPTAdapter({ documentRef: doc });

  const result = extractResultSet(assistant, {
    attemptId: 'attempt-stable',
    assistantMessageId: 'request-conversation-1-5',
  });

  assert.equal(result.status, 'RESULT_READY');
  assert.equal(result.assistantMessageId, 'request-conversation-1-5');
  assert.equal(adapter.findAssistant({ assistantMessageId: 'conversation-turn-22' }), assistant);
});

test('adapter blocks the conversation composer while the ChatGPT image editor is open and can close it', async () => {
  let editorOpen = true;
  const dialog = {
    getAttribute(name) { return name === 'data-state' ? (editorOpen ? 'open' : 'closed') : null; },
    querySelector(selector) { return selector.includes('关闭全屏') ? closeButton : null; },
  };
  const closeButton = {
    hidden: false,
    getClientRects() { return [{ width: 36, height: 36 }]; },
    getAttribute() { return null; },
    click() { editorOpen = false; },
  };
  const composer = (kind) => ({
    hidden: false,
    getClientRects() { return [{ width: 320, height: 40 }]; },
    getAttribute() { return null; },
    closest(selector) {
      if (kind === 'editor' && selector.includes('[role="dialog"]') && editorOpen) return dialog;
      return null;
    },
  });
  const normalComposer = composer('normal');
  const editorComposer = composer('editor');
  const doc = {
    querySelector() { return null; },
    querySelectorAll(selector) { return selector.includes('prompt-textarea') || selector.includes('contenteditable') ? [normalComposer, editorComposer] : []; },
  };
  const adapter = new ChatGPTAdapter({ documentRef: doc });

  assert.equal(adapter.pageMode(), 'image_editor');
  assert.equal(adapter.isComposerReady(), false);
  await adapter.closeImageEditor({ timeoutMs: 20, intervalMs: 0 });
  assert.equal(editorOpen, false);
  assert.equal(adapter.pageMode(), 'conversation');
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

test('adapter refuses unbound recovery instead of stealing the latest assistant turn', () => {
  const oldAssistant = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-2' : null; } };
  const latestAssistant = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-4' : null; } };
  const doc = { querySelector() { return null; }, querySelectorAll(selector) { return selector.includes('data-turn="assistant"') ? [oldAssistant, latestAssistant] : []; } };
  const adapter = new ChatGPTAdapter({ documentRef: doc });
  let observed;
  let error;
  adapter.observeAttempt = (identity) => { observed = identity; return () => {}; };
  adapter.recoverAttempt({ attemptId: 'attempt-1', conversationId: 'conversation-1' }, () => {}, (value) => { error = value; });
  assert.equal(observed, undefined);
  assert.equal(error.code, 'UNBOUND_RESULT');
});

test('adapter recovers the bound older assistant instead of stealing a later attempt result', () => {
  const firstAssistant = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-2' : null; } };
  const secondAssistant = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-4' : null; } };
  const doc = { querySelectorAll() { return [firstAssistant, secondAssistant]; } };
  const adapter = new ChatGPTAdapter({ documentRef: doc });
  let observed;
  adapter.observeAttempt = (identity) => { observed = identity; return () => {}; };

  adapter.recoverAttempt({ attemptId: 'attempt-1', assistantMessageId: 'conversation-turn-2' }, () => {});

  assert.equal(observed.assistantMessageId, 'conversation-turn-2');
});

test('adapter waits for the stable assistant turn to mount after a ChatGPT page reload', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const assistant = {
      dataset: { turn: 'assistant' },
      getAttribute(name) {
        if (name === 'data-turn') return 'assistant';
        if (name === 'data-turn-id') return 'request-conversation-1-5';
        return null;
      },
    };
    let nodes = [];
    const root = { querySelectorAll() { return nodes; } };
    const doc = {
      body: root,
      querySelector(selector) { return selector.includes('main') ? root : null; },
      querySelectorAll() { return nodes; },
    };
    const adapter = new ChatGPTAdapter({ documentRef: doc, recoveryTimeoutMs: 1000 });
    let observed;
    const errors = [];
    adapter.observeAttempt = (identity) => { observed = identity; return () => {}; };

    const stop = adapter.recoverAttempt(
      { attemptId: 'attempt-reload', assistantMessageId: 'request-conversation-1-5' },
      () => {},
      (error) => errors.push(error.code),
    );
    assert.equal(observed, undefined);
    assert.deepEqual(errors, []);

    nodes = [assistant];
    discover();

    assert.equal(observed.assistantMessageId, 'request-conversation-1-5');
    assert.deepEqual(errors, []);
    stop();
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('adapter recovers a promoted final assistant UUID from the bound user turn after reload', () => {
  const user = {
    getAttribute(name) {
      if (name === 'data-turn') return 'user';
      if (name === 'data-turn-id') return 'user-message-uuid';
      if (name === 'data-testid') return 'conversation-turn-9';
      return null;
    },
  };
  const assistant = {
    getAttribute(name) {
      if (name === 'data-turn') return 'assistant';
      if (name === 'data-turn-id') return 'assistant-final-uuid';
      if (name === 'data-testid') return 'conversation-turn-10';
      return null;
    },
  };
  const ordered = [user, assistant];
  const doc = {
    body: { querySelectorAll() { return ordered; } },
    querySelector(selector) { return selector.includes('main') ? this.body : null; },
    querySelectorAll(selector) {
      return selector.includes('data-turn="assistant"') ? [assistant] : ordered;
    },
  };
  const adapter = new ChatGPTAdapter({ documentRef: doc, recoveryTimeoutMs: 0 });
  let observed;
  const errors = [];
  adapter.observeAttempt = (identity) => { observed = identity; return () => {}; };

  adapter.recoverAttempt({
    attemptId: 'attempt-promoted-after-reload',
    assistantMessageId: 'request-conversation-1-3',
    userMessageId: 'user-message-uuid',
  }, () => {}, (error) => errors.push(error.code));

  assert.equal(observed.assistantMessageId, 'assistant-final-uuid');
  assert.deepEqual(errors, []);
});

test('adapter recovers from a bound user turn when no assistant id was captured', () => {
  const user = {
    getAttribute(name) {
      if (name === 'data-turn') return 'user';
      if (name === 'data-turn-id') return 'user-message-uuid';
      if (name === 'data-testid') return 'conversation-turn-11';
      return null;
    },
  };
  const assistant = {
    getAttribute(name) {
      if (name === 'data-turn') return 'assistant';
      if (name === 'data-turn-id') return 'request-conversation-1-0';
      if (name === 'data-testid') return 'conversation-turn-12';
      return null;
    },
  };
  const ordered = [user, assistant];
  const doc = {
    body: { querySelectorAll() { return ordered; } },
    querySelector(selector) { return selector.includes('main') ? this.body : null; },
    querySelectorAll(selector) {
      return selector.includes('data-turn="assistant"') ? [assistant] : ordered;
    },
  };
  const adapter = new ChatGPTAdapter({ documentRef: doc, recoveryTimeoutMs: 0 });
  let observed;
  const errors = [];
  adapter.observeAttempt = (identity) => { observed = identity; return () => {}; };

  adapter.recoverAttempt({
    attemptId: 'attempt-user-anchor-only',
    userMessageId: 'user-message-uuid',
  }, () => {}, (error) => errors.push(error.code));

  assert.equal(observed.assistantMessageId, 'request-conversation-1-0');
  assert.deepEqual(errors, []);
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

test('beginAttempt reports generating once across assistant node replacement', async () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const shell = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-6' : null; } };
    const replacement = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-6' : null; } };
    let assistants = [];
    const root = { querySelectorAll() { return assistants; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    adapter.observeAttempt = (identity, onResult) => {
      onResult({ status: 'GENERATING', assistantMessageId: identity.assistantMessageId, results: [] });
      const stop = () => {};
      stop.root = assistants.at(-1);
      return stop;
    };
    const statuses = [];
    adapter.beginAttempt({ attemptId: 'attempt-replaced' }, (result) => statuses.push(result.status));
    assistants = [shell];
    discover();
    assistants = [replacement];
    discover();
    await Promise.resolve();
    assert.deepEqual(statuses, ['GENERATING']);
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

test('adapter waits for a transiently disabled submit button before clicking', async () => {
  let checks = 0;
  const button = { get disabled() { checks += 1; return checks < 3; }, click() { this.clicked = true; } };
  const composer = {};
  const doc = { querySelector(selector) { return selector.includes('send') ? button : composer; }, querySelectorAll() { return []; } };
  const adapter = new ChatGPTAdapter({ documentRef: doc });
  await adapter.submitWhenReady({ timeoutMs: 100, intervalMs: 0 });
  assert.equal(button.clicked, true);
  assert.ok(checks >= 3);
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

test('adapter ignores hidden stale composers and submits through the visible ChatGPT composer', () => {
  const previousDocument = globalThis.document;
  const events = [];
  const makeComposer = (visible) => ({
    textContent: '',
    focus() { this.focused = true; },
    dispatchEvent(event) { events.push([visible, event.type]); },
    getClientRects() { return visible ? [{ width: 320, height: 40 }] : []; },
    getAttribute(name) { return name === 'contenteditable' ? 'true' : null; },
  });
  const hiddenComposer = makeComposer(false);
  const visibleComposer = makeComposer(true);
  const hiddenButton = { disabled: false, click() { this.clicked = true; }, getClientRects() { return []; }, getAttribute() { return null; } };
  const visibleButton = { disabled: false, click() { this.clicked = true; }, getClientRects() { return [{ width: 32, height: 32 }]; }, getAttribute() { return null; } };
  const doc = {
    querySelector(selector) { return selector.includes('send') ? hiddenButton : hiddenComposer; },
    querySelectorAll(selector) { return selector.includes('send') ? [hiddenButton, visibleButton] : [hiddenComposer, visibleComposer]; },
    execCommand(command, _showUi, value) {
      if (command === 'insertText') visibleComposer.textContent = value;
      return true;
    },
  };
  globalThis.InputEvent = class InputEvent { constructor(type) { this.type = type; } };
  try {
    const adapter = new ChatGPTAdapter({ documentRef: doc, locationRef: { href: 'https://chatgpt.com/' } });
    adapter.fillPrompt('只进入可见输入框');
    adapter.submit();
    assert.equal(hiddenComposer.textContent, '');
    assert.equal(visibleComposer.textContent, '只进入可见输入框');
    assert.equal(hiddenButton.clicked, undefined);
    assert.equal(visibleButton.clicked, true);
    assert.deepEqual(events, [[true, 'input']]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('collector treats blob placeholder images as still generating', () => {
  const generating = extractResultSet(node('assistant-9', [image('blob:https://chatgpt.com/abc')]), { attemptId: 'attempt-9', assistantMessageId: 'assistant-9', resultSetId: 'set-9' });
  assert.equal(generating.status, 'GENERATING');
  assert.deepEqual(generating.results, []);
});

test('collector distinguishes a semantically completed gray result shell from ordinary generation', () => {
  const marker = {
    getAttribute(name) { return name === 'aria-label' ? '已生成图片：等待实体图片挂载' : null; },
  };
  const assistant = {
    dataset: { messageId: 'assistant-shell' },
    getAttribute(name) { return name === 'data-message-id' ? 'assistant-shell' : null; },
    querySelectorAll(selector) {
      if (selector === 'img') return [];
      if (selector.includes('aria-label')) return [marker];
      return [];
    },
  };

  const result = extractResultSet(assistant, {
    attemptId: 'attempt-shell',
    assistantMessageId: 'assistant-shell',
  });

  assert.equal(result.status, 'RESULT_SHELL');
  assert.deepEqual(result.results, []);
});

test('adapter escalates a sustained gray result shell exactly once', async () => {
  const previousObserver = globalThis.MutationObserver;
  const previousTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  let now = 0;
  let poll;
  const marker = { getAttribute(name) { return name === 'aria-label' ? 'Generated image' : null; } };
  const assistant = {
    dataset: { messageId: 'assistant-shell' },
    getAttribute(name) { return name === 'data-message-id' ? 'assistant-shell' : null; },
    querySelectorAll(selector) {
      if (selector === 'img') return [];
      if (selector.includes('aria-label')) return [marker];
      return [];
    },
  };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.setTimeout = (callback) => { poll = callback; return 1; };
  globalThis.clearTimeout = () => {};
  try {
    const adapter = new ChatGPTAdapter({
      documentRef: { querySelectorAll() { return [assistant]; } },
      now: () => now,
      grayShellStallMs: 1000,
    });
    const statuses = [];
    adapter.observeAttempt(
      { attemptId: 'attempt-shell', assistantMessageId: 'assistant-shell' },
      async (result) => { statuses.push(result.status); },
    );
    await Promise.resolve();
    assert.deepEqual(statuses, ['GENERATING']);

    now = 1001;
    poll();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(statuses, ['GENERATING', 'RESULT_SHELL_STALLED']);
    poll?.();
    await Promise.resolve();
    assert.deepEqual(statuses, ['GENERATING', 'RESULT_SHELL_STALLED']);
  } finally {
    globalThis.MutationObserver = previousObserver;
    globalThis.setTimeout = previousTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test('capture runtime asks the background to reload a stalled gray result shell', async () => {
  const messages = [];
  const chromeApi = { runtime: { sendMessage: async (message) => { messages.push(message); return { ok: true }; } } };
  const adapter = { getConversationIdentity: () => ({ conversationId: 'conversation-1' }) };

  await captureResults({
    adapter,
    chromeApi,
    attempt: { attemptId: 'attempt-shell', assistantMessageId: 'request-conversation-1-5' },
    resultSet: { status: 'RESULT_SHELL_STALLED', assistantMessageId: 'request-conversation-1-5', results: [] },
  });

  assert.deepEqual(messages, [{
    action: 'recoverGrayShell',
    payload: {
      attemptId: 'attempt-shell',
      conversationId: 'conversation-1',
      assistantMessageId: 'request-conversation-1-5',
    },
  }]);
});

test('capture runtime persists the submitted user UUID as a recovery anchor', async () => {
  const messages = [];
  const chromeApi = { runtime: { sendMessage: async (message) => { messages.push(message); return { ok: true }; } } };

  await captureResults({
    adapter: {},
    chromeApi,
    attempt: { attemptId: 'attempt-user-anchor', conversationId: 'conversation-1' },
    resultSet: { status: 'USER_BOUND', userMessageId: 'user-message-uuid', results: [] },
  });

  assert.deepEqual(messages, [{
    action: 'attemptUserBound',
    payload: {
      attemptId: 'attempt-user-anchor',
      conversationId: 'conversation-1',
      userMessageId: 'user-message-uuid',
    },
  }]);
});

test('capture runtime retains persisted recovery state until the adapter settle signal', async () => {
  const actions = [];
  const chromeApi = { runtime: { sendMessage: async (message) => { actions.push(message.action); return { ok: true }; } } };
  const adapter = {
    getConversationIdentity: () => ({ conversationId: 'conversation-1' }),
    fetchOriginal: async (result) => ({ bytes: Uint8Array.from([1]), mime: 'image/png', sourceUrl: result.sourceUrl }),
  };

  await captureResults({
    adapter,
    chromeApi,
    attempt: { attemptId: 'attempt-complete' },
    resultSet: {
      status: 'RESULT_READY',
      resultSetId: 'set-1',
      assistantMessageId: 'request-conversation-1-6',
      results: [{ resultIndex: 0, sourceUrl: 'https://chatgpt.com/result.png' }],
    },
  });

  assert.deepEqual(actions, ['attemptBound', 'capturedResult']);

  await captureResults({
    adapter,
    chromeApi,
    attempt: { attemptId: 'attempt-complete' },
    resultSet: { status: 'CAPTURE_COMPLETE', results: [] },
  });
  assert.deepEqual(actions, ['attemptBound', 'capturedResult', 'attemptCaptureComplete']);
});

test('content bridge exposes image-editor mode and closes it on request', async () => {
  let listener;
  let closed = 0;
  const chromeApi = { runtime: { onMessage: { addListener(value) { listener = value; } } } };
  const attributes = new Map();
  const globalRef = {
    document: { documentElement: {
      hasAttribute(name) { return attributes.has(name); },
      setAttribute(name, value) { attributes.set(name, value); },
    } },
  };
  const adapter = {
    pageMode: () => 'image_editor',
    isComposerReady: () => false,
    isSubmitReady: () => false,
    closeImageEditor: async () => { closed += 1; return true; },
  };
  installChatGPTContentBridge({ chromeApi, adapter, globalRef });
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));

  const ready = await send({ action: 'ready' });
  const exited = await send({ action: 'exitImageEditor' });

  assert.deepEqual(ready, { ok: true, value: { composer: false, submit: false, mode: 'image_editor' } });
  assert.deepEqual(exited, { ok: true, value: true });
  assert.equal(closed, 1);
});

test('collector waits until an HTTP image node has actually loaded', () => {
  const pendingImage = image('https://chatgpt.com/backend-api/estuary/content?id=pending');
  pendingImage.complete = false;
  pendingImage.naturalWidth = 0;
  const generating = extractResultSet(
    node('assistant-pending', [pendingImage]),
    { attemptId: 'attempt-pending', assistantMessageId: 'assistant-pending', resultSetId: 'set-pending' },
  );
  assert.equal(generating.status, 'GENERATING');
  assert.deepEqual(generating.results, []);
});

test('collector accepts a semantically completed ChatGPT image even while lazy loading', () => {
  const lazyGeneratedImage = image('https://chatgpt.com/backend-api/estuary/content?id=lazy-generated');
  lazyGeneratedImage.complete = false;
  lazyGeneratedImage.naturalWidth = 0;
  lazyGeneratedImage.alt = '已生成图片：周启角色服装参考图板';
  lazyGeneratedImage.getAttribute = (name) => (name === 'alt' ? lazyGeneratedImage.alt : null);
  lazyGeneratedImage.closest = (selector) => (selector === '[id^="image-"]' ? { id: 'image-result-1' } : null);

  const result = extractResultSet(
    node('assistant-lazy', [lazyGeneratedImage]),
    { attemptId: 'attempt-lazy', assistantMessageId: 'assistant-lazy', resultSetId: 'set-lazy' },
  );

  assert.equal(result.status, 'RESULT_READY');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceUrl, lazyGeneratedImage.src);
});

test('adapter reports generating once and polls until an image finishes loading', async () => {
  const previousObserver = globalThis.MutationObserver;
  const previousTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const pendingImage = image('https://chatgpt.com/backend-api/estuary/content?id=eventual');
  pendingImage.complete = false;
  pendingImage.naturalWidth = 0;
  const assistant = {
    dataset: { turn: 'assistant' },
    getAttribute(name) {
      if (name === 'data-turn') return 'assistant';
      if (name === 'data-testid') return 'conversation-turn-10';
      return null;
    },
    querySelectorAll() { return [pendingImage]; },
  };
  let poll;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.setTimeout = (callback) => { poll = callback; return 1; };
  globalThis.clearTimeout = () => {};
  try {
    const adapter = new ChatGPTAdapter({ documentRef: { querySelectorAll() { return [assistant]; } } });
    const statuses = [];
    adapter.observeAttempt(
      { attemptId: 'attempt-eventual', assistantMessageId: 'conversation-turn-10' },
      async (result) => { statuses.push(result.status); },
    );
    await Promise.resolve();
    assert.deepEqual(statuses, ['GENERATING']);
    assert.equal(typeof poll, 'function');

    pendingImage.complete = true;
    pendingImage.naturalWidth = 1536;
    poll();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(statuses, ['GENERATING', 'RESULT_READY']);
  } finally {
    globalThis.MutationObserver = previousObserver;
    globalThis.setTimeout = previousTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test('collector keeps only http(s) sources when placeholders are mixed in', () => {
  const mixed = extractResultSet(
    node('assistant-9', [
      image('blob:https://chatgpt.com/x'),
      image('data:image/png;base64,pending'),
      image('https://chatgpt.com/backend-api/estuary/content?id=done'),
    ]),
    { attemptId: 'attempt-9', assistantMessageId: 'assistant-9', resultSetId: 'set-9' },
  );
  assert.equal(mixed.status, 'RESULT_READY');
  assert.equal(mixed.results.length, 1);
  assert.equal(mixed.pendingResultCount, 2);
  assert.equal(mixed.results[0].sourceUrl, 'https://chatgpt.com/backend-api/estuary/content?id=done');
  assert.equal(mixed.results[0].resultIndex, 2);
});

test('collector deduplicates repeated DOM image nodes that point to the same source', () => {
  const duplicate = extractResultSet(
    node('assistant-duplicate', [
      image('https://chatgpt.com/backend-api/estuary/content?id=same-file'),
      image('https://chatgpt.com/backend-api/estuary/content?id=same-file'),
      image('https://chatgpt.com/backend-api/estuary/content?id=other-file'),
    ]),
    { attemptId: 'attempt-duplicate', assistantMessageId: 'assistant-duplicate', resultSetId: 'set-duplicate' },
  );
  assert.equal(duplicate.status, 'RESULT_READY');
  assert.deepEqual(duplicate.results.map((result) => result.sourceUrl), [
    'https://chatgpt.com/backend-api/estuary/content?id=same-file',
    'https://chatgpt.com/backend-api/estuary/content?id=other-file',
  ]);
  assert.deepEqual(duplicate.results.map((result) => result.resultIndex), [0, 1]);
});

test('collector accepts a loaded responsive copy when an earlier node with the same URL is pending', () => {
  const pendingCopy = image('https://chatgpt.com/backend-api/estuary/content?id=responsive-copy');
  pendingCopy.complete = false;
  pendingCopy.naturalWidth = 0;
  const loadedCopy = image(pendingCopy.src);
  loadedCopy.complete = true;
  loadedCopy.naturalWidth = 1536;

  const result = extractResultSet(
    node('assistant-responsive', [pendingCopy, loadedCopy]),
    { attemptId: 'attempt-responsive', assistantMessageId: 'assistant-responsive' },
  );

  assert.equal(result.status, 'RESULT_READY');
  assert.equal(result.pendingResultCount, 0);
  assert.deepEqual(result.results.map((item) => ({ index: item.resultIndex, url: item.sourceUrl })), [{
    index: 0,
    url: pendingCopy.src,
  }]);
});

test('beginAttempt ignores assistant nodes that existed before submit even without identity', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const ghost = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? this.dataset.testid : null; } };
    const fresh = { dataset: { turn: 'assistant' }, getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-12' : null; } };
    let nodes = [ghost];
    const root = { querySelectorAll() { return nodes; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    let observed;
    adapter.observeAttempt = (identity) => { observed = identity; return () => {}; };
    adapter.beginAttempt({ attemptId: 'attempt-9' }, () => {});
    ghost.dataset.testid = 'conversation-turn-11';
    discover();
    assert.equal(observed, undefined);
    nodes = [ghost, fresh];
    discover();
    assert.equal(observed.assistantMessageId, 'conversation-turn-12');
    assert.equal(observed.attemptId, 'attempt-9');
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('beginAttempt waits past transient request placeholders for the real assistant turn', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const makeTurn = (testid) => ({
      dataset: { turn: 'assistant' },
      getAttribute(name) {
        if (name === 'data-turn') return 'assistant';
        if (name === 'data-testid') return testid;
        return null;
      },
    });
    const placeholder = makeTurn('request-placeholder-request-conversation-1-1');
    const completed = makeTurn('conversation-turn-12');
    let nodes = [];
    const root = { querySelectorAll() { return nodes; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    const observed = [];
    adapter.observeAttempt = (identity) => { observed.push(identity.assistantMessageId); return () => {}; };

    adapter.beginAttempt({ attemptId: 'attempt-placeholder' }, () => {});
    nodes = [placeholder];
    discover();
    assert.deepEqual(observed, []);
    nodes = [placeholder, completed];
    discover();
    assert.deepEqual(observed, ['conversation-turn-12']);
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('beginAttempt skips the duplicate wrapper for its anchored user and binds the following assistant', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const turn = (role, id, images = []) => ({
      getAttribute(name) {
        if (name === 'data-turn') return role;
        if (name === 'data-turn-id') return id;
        return null;
      },
      querySelectorAll(selector) { return selector === 'img' ? images : []; },
    });
    const generated = image('https://chatgpt.com/backend-api/estuary/content?id=completed-transient');
    generated.complete = true;
    generated.naturalWidth = 1024;
    generated.naturalHeight = 1536;
    const user = turn('user', 'user-anchor');
    const duplicateUserWrapper = {
      getAttribute(name) {
        if (name === 'data-message-author-role') return 'user';
        if (name === 'data-message-id') return 'user-anchor';
        return null;
      },
      querySelectorAll() { return []; },
    };
    const assistant = turn('assistant', 'request-conversation-1-0', [generated]);
    let nodes = [];
    const root = { querySelectorAll() { return nodes; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    const observed = [];
    adapter.observeAttempt = (identity) => { observed.push(identity.assistantMessageId); return () => {}; };

    adapter.beginAttempt({ attemptId: 'attempt-completed-transient' }, () => {});
    nodes = [user, duplicateUserWrapper, assistant];
    discover();

    assert.deepEqual(observed, ['request-conversation-1-0']);
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('beginAttempt binds the newly submitted user UUID before the assistant reply appears', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const user = {
      getAttribute(name) {
        if (name === 'data-turn') return 'user';
        if (name === 'data-turn-id') return 'new-user-uuid';
        if (name === 'data-testid') return 'conversation-turn-11';
        return null;
      },
    };
    let nodes = [];
    const root = { querySelectorAll() { return nodes; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    const results = [];

    adapter.beginAttempt({ attemptId: 'attempt-user-anchor' }, (result) => results.push(result));
    nodes = [user];
    discover();

    assert.deepEqual(results, [{
      status: 'USER_BOUND',
      attemptId: 'attempt-user-anchor',
      userMessageId: 'new-user-uuid',
      results: [],
    }]);
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('beginAttempt ignores rerendered historical users when binding the newly submitted user', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const user = (id) => ({
      getAttribute(name) {
        if (name === 'data-turn') return 'user';
        if (name === 'data-turn-id') return id;
        return null;
      },
    });
    let nodes = [user('historical-user')];
    const root = { querySelectorAll() { return nodes; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    const results = [];

    adapter.beginAttempt({ attemptId: 'attempt-rerender' }, (result) => results.push(result));
    nodes = [user('historical-user'), user('fresh-user')];
    discover();

    assert.equal(results[0]?.userMessageId, 'fresh-user');
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('beginAttempt binds only the assistant immediately following its user anchor', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const turn = (role, id) => ({
      getAttribute(name) {
        if (name === 'data-turn') return role;
        if (name === 'data-turn-id') return id;
        return null;
      },
    });
    const targetUser = turn('user', 'user-target');
    const targetAssistant = turn('assistant', 'assistant-target');
    const laterUser = turn('user', 'user-unrelated');
    const laterAssistant = turn('assistant', 'assistant-unrelated');
    let nodes = [];
    const root = { querySelectorAll() { return nodes; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    const observed = [];
    adapter.observeAttempt = (identity) => { observed.push(identity.assistantMessageId); return () => {}; };

    adapter.beginAttempt({ attemptId: 'attempt-adjacent' }, () => {});
    nodes = [targetUser, targetAssistant, laterUser, laterAssistant];
    discover();

    assert.deepEqual(observed, ['assistant-target']);
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('adapter emits capture completion only after the result set settles', async () => {
  const previousObserver = globalThis.MutationObserver;
  const previousTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let nextTimer = 1;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.setTimeout = (callback) => { const id = nextTimer++; timers.set(id, callback); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  try {
    const assistant = node('assistant-settle', [image('https://chatgpt.com/backend-api/estuary/content?id=settled')]);
    const adapter = new ChatGPTAdapter({
      documentRef: { querySelectorAll() { return [assistant]; } },
      resultSettleMs: 100,
    });
    const statuses = [];

    adapter.observeAttempt(
      { attemptId: 'attempt-settle', assistantMessageId: 'assistant-settle' },
      async (result) => { statuses.push(result.status); },
    );
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(statuses, ['RESULT_READY']);
    assert.equal(timers.size, 1);

    [...timers.values()][0]();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(statuses, ['RESULT_READY', 'CAPTURE_COMPLETE']);
  } finally {
    globalThis.MutationObserver = previousObserver;
    globalThis.setTimeout = previousTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test('adapter does not settle while another generated candidate is still loading', async () => {
  const previousObserver = globalThis.MutationObserver;
  const previousTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let nextTimer = 1;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.setTimeout = (callback) => { const id = nextTimer++; timers.set(id, callback); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  try {
    const first = image('https://chatgpt.com/backend-api/estuary/content?id=first-ready');
    const second = image('blob:https://chatgpt.com/second-pending');
    second.complete = false;
    second.naturalWidth = 0;
    const assistant = node('assistant-progressive', [first, second]);
    const adapter = new ChatGPTAdapter({
      documentRef: { querySelectorAll() { return [assistant]; } },
      resultSettleMs: 100,
    });
    const batches = [];

    adapter.observeAttempt(
      { attemptId: 'attempt-progressive', assistantMessageId: 'assistant-progressive' },
      async (result) => { batches.push({ status: result.status, indexes: result.results.map((item) => item.resultIndex) }); },
    );
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(batches, [{ status: 'RESULT_READY', indexes: [0] }]);

    const pendingPoll = [...timers.entries()][0];
    timers.delete(pendingPoll[0]);
    pendingPoll[1]();
    await Promise.resolve();
    assert.equal(batches.some((item) => item.status === 'CAPTURE_COMPLETE'), false);

    second.currentSrc = 'https://chatgpt.com/backend-api/estuary/content?id=second-ready';
    second.src = second.currentSrc;
    second.complete = true;
    second.naturalWidth = 1536;
    const readyPoll = [...timers.entries()][0];
    timers.delete(readyPoll[0]);
    readyPoll[1]();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(batches, [
      { status: 'RESULT_READY', indexes: [0] },
      { status: 'RESULT_READY', indexes: [1] },
    ]);

    const settle = [...timers.entries()][0];
    timers.delete(settle[0]);
    settle[1]();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(batches.at(-1).status, 'CAPTURE_COMPLETE');
  } finally {
    globalThis.MutationObserver = previousObserver;
    globalThis.setTimeout = previousTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test('beginAttempt records the freshly submitted user turn but never imports its reference thumbnails', () => {
  const previousObserver = globalThis.MutationObserver;
  let discover;
  globalThis.MutationObserver = class {
    constructor(callback) { discover = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const asFake = (turn, testid, imgs) => ({
      dataset: { turn, testid },
      getAttribute(name) {
        if (name === 'data-turn' || name === 'data-message-author-role') return turn;
        if (name === 'data-testid') return this.dataset.testid || null;
        return null;
      },
      querySelectorAll() { return imgs; },
    });
    const userTurn = asFake('user', null, [{ currentSrc: 'https://chatgpt.com/backend-api/estuary/content?id=refthumb', src: 'https://chatgpt.com/backend-api/estuary/content?id=refthumb', dataset: {} }]);
    const assistantTurn = asFake('assistant', null, [{ currentSrc: 'https://chatgpt.com/backend-api/estuary/content?id=generated', src: 'https://chatgpt.com/backend-api/estuary/content?id=generated', dataset: {} }]);
    let nodes = [];
    const root = { querySelectorAll() { return nodes; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; } } });
    const captured = [];
    adapter.observeAttempt = (identity, onResult) => {
      captured.push(identity.assistantMessageId);
      // exercise the real extraction path against the bound node
      const bound = identity.assistantMessageId === 'conversation-turn-11' ? userTurn : assistantTurn;
      const testid = identity.assistantMessageId;
      bound.getAttribute = function (name) {
        if (name === 'data-turn' || name === 'data-message-author-role') return this.dataset.turn;
        if (name === 'data-testid') return testid;
        return null;
      };
      onResult(extractResultSet(bound, { attemptId: 'attempt-10', assistantMessageId: identity.assistantMessageId, resultSetId: 'set-10' }));
      return () => {};
    };
    adapter.beginAttempt({ attemptId: 'attempt-10' }, (resultSet) => captured.push('result:' + resultSet.assistantMessageId + ':' + resultSet.status));
    // submit: the user turn appears first with a reference thumbnail
    userTurn.dataset.testid = 'conversation-turn-11';
    nodes = [userTurn];
    discover();
    discover();
    // the real assistant reply appears afterwards
    assistantTurn.dataset.testid = 'conversation-turn-12';
    nodes = [userTurn, assistantTurn];
    discover();
    assert.deepEqual(captured, [
      'result:undefined:USER_BOUND',
      'conversation-turn-12',
      'result:conversation-turn-12:RESULT_READY',
    ]);
    // the user turn must never surface its reference thumbnail as a result
    assert.ok(!captured.some((entry) => String(entry).includes('refthumb')));
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('adapter disconnects after an assistant identity mismatch and reports it once', () => {
  const previousObserver = globalThis.MutationObserver;
  let emit;
  let disconnects = 0;
  globalThis.MutationObserver = class {
    constructor(callback) { emit = callback; }
    observe() {}
    disconnect() { disconnects += 1; }
  };
  try {
    const assistant = {
      dataset: { turn: 'assistant', messageId: 'assistant-1' },
      getAttribute(name) {
        if (name === 'data-turn') return 'assistant';
        if (name === 'data-message-id') return this.dataset.messageId;
        return null;
      },
      querySelectorAll() { return [{ currentSrc: 'https://chatgpt.com/generated.png', src: 'https://chatgpt.com/generated.png', dataset: {} }]; },
    };
    const doc = {
      querySelectorAll(selector) {
        return selector.includes('data-turn="assistant"') ? [assistant] : [];
      },
    };
    const adapter = new ChatGPTAdapter({ documentRef: doc });
    let errors = 0;
    adapter.observeAttempt({ attemptId: 'attempt-identity', assistantMessageId: 'assistant-1' }, () => {}, () => { errors += 1; });
    assistant.dataset.messageId = 'assistant-2';
    emit();
    emit();
    assert.equal(errors, 1);
    assert.equal(disconnects, 1);
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});

test('beginAttempt rebinds a drifted assistant identity without surfacing UNBOUND_RESULT', () => {
  const previousObserver = globalThis.MutationObserver;
  const callbacks = [];
  globalThis.MutationObserver = class {
    constructor(callback) { callbacks.push(callback); }
    observe() {}
    disconnect() {}
  };
  try {
    const assistant = {
      dataset: { turn: 'assistant', messageId: null },
      getAttribute(name) {
        if (name === 'data-turn') return 'assistant';
        if (name === 'data-message-id') return this.dataset.messageId;
        return null;
      },
      querySelectorAll() { return []; },
    };
    let nodes = [];
    const root = { querySelectorAll() { return nodes; } };
    const adapter = new ChatGPTAdapter({ documentRef: { querySelector() { return root; }, querySelectorAll() { return nodes; } } });
    const observed = [];
    const errors = [];
    const observe = adapter.observeAttempt.bind(adapter);
    adapter.observeAttempt = (identity, ...args) => { observed.push(identity.assistantMessageId); return observe(identity, ...args); };
    const stop = adapter.beginAttempt({ attemptId: 'attempt-drift' }, () => {}, (error) => errors.push(error.code));
    assistant.dataset.messageId = 'assistant-1';
    nodes = [assistant];
    callbacks[0]();
    assistant.dataset.messageId = 'assistant-2';
    callbacks[1]();
    callbacks[0]();
    assert.deepEqual(observed, ['assistant-1', 'assistant-2']);
    assert.deepEqual(errors, []);
    assert.equal(callbacks.length, 3);
    stop();
  } finally {
    globalThis.MutationObserver = previousObserver;
  }
});
