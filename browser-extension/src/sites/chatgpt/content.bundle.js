(() => {
  // src/sites/chatgpt/selectors.js
  var selectors = {
    composer: 'textarea#prompt-textarea, textarea[placeholder*="Message"], [contenteditable="true"], [role="textbox"][aria-label*="\u804A\u5929"], [role="textbox"][aria-label*="Message"]',
    file: 'input[type="file"]',
    send: 'button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="\u53D1\u9001"]',
    message: '[data-message-id],[data-testid^="conversation-turn-"]',
    assistant: '[data-message-author-role="assistant"], [data-message-author-role="assistant"] [data-message-id], [data-turn="assistant"], [data-turn="assistant"] [data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
    user: '[data-message-author-role="user"]'
  };

  // src/sites/chatgpt/messageIdentity.js
  function messageIdentity(node) {
    if (!node) return null;
    const messageId = node.dataset?.messageId || node.getAttribute?.("data-message-id");
    const domId = node.getAttribute?.("data-testid") || node.getAttribute?.("data-turn-id-container") || node.id || null;
    if (messageId) return { messageId, confidence: "provider" };
    if (domId) return { messageId: domId, confidence: "dom" };
    return null;
  }
  function conversationIdentity(url = globalThis.location?.href || "") {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\/c\/([^/]+)/);
      return match ? { conversationId: decodeURIComponent(match[1]), confidence: "url" } : null;
    } catch {
      return null;
    }
  }
  function identityMatches(actual, expected) {
    if (!actual || !expected) return false;
    return actual.messageId === (expected.messageId || expected.assistantMessageId || expected.userMessageId);
  }

  // src/sites/chatgpt/resultCollector.js
  function fingerprint(node, id, index, url) {
    return `${id}:${url}`;
  }
  function extractResultSet(node, attempt = {}) {
    const actual = messageIdentity(node);
    const expected = attempt.assistantMessageId || attempt.messageId;
    if (!actual || !expected) return { status: "NEEDS_REVIEW", reason: "missing assistant identity", results: [] };
    if (!identityMatches(actual, { messageId: expected })) return { status: "UNBOUND_RESULT", reason: "assistant identity mismatch", results: [] };
    const turnRole = node.getAttribute?.("data-turn") || node.getAttribute?.("data-message-author-role");
    if (turnRole === "user") return { status: "GENERATING", resultSetId: attempt.resultSetId || `${attempt.attemptId || expected}:results`, attemptId: attempt.attemptId, assistantMessageId: actual.messageId, results: [] };
    const seenSources = /* @__PURE__ */ new Set();
    const results = [...node.querySelectorAll?.("img") || []].map((img) => {
      const sourceUrl = img.currentSrc || img.src || img.getAttribute?.("src");
      if (!sourceUrl || !/^https?:/i.test(sourceUrl) || seenSources.has(sourceUrl)) return null;
      seenSources.add(sourceUrl);
      const resultIndex = seenSources.size - 1;
      return { resultIndex, sourceUrl, sourceMime: img.dataset?.mime || null, nodeFingerprint: fingerprint(node, actual.messageId, resultIndex, sourceUrl) };
    }).filter(Boolean);
    return {
      status: results.length ? "RESULT_READY" : "GENERATING",
      resultSetId: attempt.resultSetId || `${attempt.attemptId || expected}:results`,
      attemptId: attempt.attemptId,
      assistantMessageId: actual.messageId,
      results
    };
  }

  // src/sites/chatgpt/adapter.js
  function isUserTurn(node) {
    return node?.getAttribute?.("data-turn") === "user" || node?.getAttribute?.("data-message-author-role") === "user";
  }
  function asFile(input) {
    if (typeof File !== "undefined" && input instanceof File) return input;
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes || []);
    return new File([bytes], input.name || "reference", { type: input.mime || "application/octet-stream" });
  }
  var ChatGPTAdapter = class {
    constructor({ documentRef = globalThis.document, fetchImpl = globalThis.fetch, locationRef = globalThis.location } = {}) {
      this.document = documentRef;
      this.fetchImpl = fetchImpl;
      this.location = locationRef;
      this.referencesReady = false;
      this.capturePaused = false;
      this.seenResultFingerprints = /* @__PURE__ */ new Set();
      this.pendingObserver = null;
    }
    matches(url = this.location?.href || "") {
      return /^https:\/\/(www\.)?chatgpt\.com\//.test(url);
    }
    getConversationIdentity() {
      return conversationIdentity(this.location?.href);
    }
    isComposerReady() {
      return Boolean(this.document?.querySelector?.(selectors.composer));
    }
    isSubmitReady() {
      const composer = this.isComposerReady();
      const button = this.document?.querySelector?.(selectors.send);
      return composer && Boolean(button && !button.disabled);
    }
    fillPrompt(prompt) {
      const element = this.document?.querySelector(selectors.composer);
      if (!element) throw new Error("ADAPTER_BROKEN");
      element.focus?.();
      if ("value" in element) element.value = prompt;
      else {
        const execDocument = element.ownerDocument || this.document;
        execDocument?.execCommand?.("selectAll", false);
        const inserted = execDocument?.execCommand?.("insertText", false, String(prompt));
        if (!inserted) element.textContent = prompt;
      }
      const Input = globalThis.InputEvent || globalThis.Event;
      element.dispatchEvent?.(new Input("input", { bubbles: true, inputType: "insertText", data: prompt }));
      return { promptLength: String(prompt).length };
    }
    async uploadReferences(files = []) {
      const input = this.document?.querySelector(selectors.file);
      if (!input) throw new Error("ADAPTER_BROKEN");
      if (typeof DataTransfer === "undefined") throw new Error("ADAPTER_BROKEN");
      const dataTransfer = new DataTransfer();
      for (const file of files) dataTransfer.items.add(asFile(file));
      input.files = dataTransfer.files;
      input.dispatchEvent?.(new Event("change", { bubbles: true }));
      this.referencesReady = input.files.length === files.length;
      if (!this.referencesReady) throw new Error("UPLOAD_NOT_CONFIRMED");
      return { count: input.files.length };
    }
    submit() {
      if (!this.referencesReady && this.document?.querySelector(selectors.file)?.files?.length) this.referencesReady = true;
      const button = this.document?.querySelector(selectors.send);
      if (!button || button.disabled) throw new Error("NOT_READY");
      button.click();
      this.referencesReady = false;
      return { submittedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    async submitWhenReady({ timeoutMs = 12e4, intervalMs = 250 } = {}) {
      const deadline = Date.now() + Math.max(0, timeoutMs);
      do {
        if (this.isSubmitReady()) return this.submit();
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(0, intervalMs), Math.max(0, deadline - Date.now()))));
      } while (Date.now() <= deadline);
      throw new Error("NOT_READY");
    }
    findAssistant(identity) {
      const nodes = [...this.document?.querySelectorAll(selectors.assistant) || []];
      return nodes.find((node) => !isUserTurn(node) && identityMatches(messageIdentity(node), { messageId: identity.assistantMessageId || identity.messageId })) || null;
    }
    recoverAttempt(identity, onResult, onError = () => {
    }) {
      this.capturePaused = false;
      this.seenResultFingerprints.clear();
      const requested = identity?.assistantMessageId || identity?.messageId;
      const nodes = [...this.document?.querySelectorAll(selectors.assistant) || []].filter((node) => !isUserTurn(node));
      const target = requested ? nodes.find((node) => identityMatches(messageIdentity(node), { messageId: requested })) : nodes.filter((node) => messageIdentity(node)).at(-1);
      const assistantMessageId = messageIdentity(target)?.messageId;
      if (!target || !assistantMessageId) {
        const error = Object.assign(new Error("UNBOUND_RESULT"), { code: "UNBOUND_RESULT" });
        onError(error);
        return () => {
        };
      }
      return this.observeAttempt({ ...identity, assistantMessageId }, onResult, onError);
    }
    conversationRoot() {
      return this.document?.querySelector?.("main[data-conversation-id], main") || this.document?.body || this.document;
    }
    beginAttempt(identity, onResult, onError = () => {
    }) {
      this.capturePaused = false;
      const root = this.conversationRoot();
      const existingNodes = [...root?.querySelectorAll?.(selectors.assistant) || []];
      const known = new Set(existingNodes.map((node) => messageIdentity(node)?.messageId).filter(Boolean));
      const preExisting = new WeakSet(existingNodes);
      if (identity?.assistantMessageId) return this.observeAttempt(identity, onResult, onError);
      if (!root) {
        onError(Object.assign(new Error("UNBOUND_RESULT"), { code: "UNBOUND_RESULT" }));
        return () => {
        };
      }
      let activeStop = null;
      let activeAssistantId = null;
      const discover = () => {
        const candidates = [...root.querySelectorAll?.(selectors.assistant) || []].filter((node) => !preExisting.has(node) && !isUserTurn(node)).map((node) => ({ node, id: messageIdentity(node)?.messageId })).filter((entry) => entry.id && (!known.has(entry.id) || entry.id === activeAssistantId && entry.node !== activeStop?.root));
        if (!candidates.length) return;
        const selected = candidates[candidates.length - 1];
        activeStop?.();
        known.add(selected.id);
        activeAssistantId = selected.id;
        activeStop = this.observeAttempt(
          { ...identity, assistantMessageId: selected.id },
          onResult,
          (error) => {
            if (error?.code === "UNBOUND_RESULT") {
              this.resumeCapture();
              discover();
              return;
            }
            onError(error);
          }
        );
      };
      const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(discover);
      if (!observer) {
        onError(Object.assign(new Error("ADAPTER_BROKEN"), { code: "ADAPTER_BROKEN" }));
        return () => {
        };
      }
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      discover();
      const stop = () => {
        observer.disconnect();
        activeStop?.();
        this.pendingObserver = null;
      };
      stop.stop = stop;
      this.pendingObserver = stop;
      return stop;
    }
    observeAttempt(identity, onResult, onError = () => {
    }) {
      if (this.capturePaused) {
        const stopped2 = () => {
        };
        stopped2.stop = stopped2;
        return stopped2;
      }
      const root = this.findAssistant(identity);
      if (!root) {
        this.capturePaused = true;
        onError(Object.assign(new Error("UNBOUND_RESULT"), { code: "UNBOUND_RESULT" }));
        const stopped2 = () => {
        };
        stopped2.stop = stopped2;
        return stopped2;
      }
      let observer = null;
      let stopped = false;
      const halt = (error, report = true) => {
        if (stopped) return;
        stopped = true;
        this.capturePaused = true;
        observer?.disconnect();
        if (report) onError(error);
      };
      const emit = () => {
        if (stopped || this.capturePaused) return;
        try {
          const result = extractResultSet(root, identity);
          if (result.status === "UNBOUND_RESULT" || result.status === "NEEDS_REVIEW") {
            halt(Object.assign(new Error(result.status), { code: result.status }));
          } else {
            const fresh = result.results.filter((item) => !this.seenResultFingerprints.has(item.nodeFingerprint));
            if (fresh.length) {
              Promise.resolve(onResult({ ...result, results: fresh })).then(() => fresh.forEach((item) => this.seenResultFingerprints.add(item.nodeFingerprint))).catch(() => halt(null, false));
            }
          }
        } catch (error) {
          halt(error);
        }
      };
      emit();
      if (!stopped && typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(emit);
        observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      }
      const stop = () => {
        if (stopped) return;
        stopped = true;
        observer?.disconnect();
      };
      stop.stop = stop;
      stop.root = root;
      return stop;
    }
    resumeCapture() {
      this.capturePaused = false;
      this.seenResultFingerprints.clear();
    }
    extractResultSet(node, attempt) {
      return extractResultSet(node, attempt);
    }
    async fetchOriginal(result, fetchImpl = this.fetchImpl) {
      const sourceUrl = result?.sourceUrl || result?.url;
      if (!sourceUrl) throw new Error("ORIGINAL_URL_MISSING");
      let parsed;
      try {
        parsed = new URL(sourceUrl);
      } catch (_) {
        throw new Error("ORIGINAL_URL_INVALID");
      }
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:" || !(host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "openai.com" || host.endsWith(".openai.com") || host.endsWith(".oaiusercontent.com"))) throw new Error("ORIGINAL_URL_NOT_ALLOWED");
      const response = await fetchImpl(sourceUrl, { credentials: "include" });
      if (!response.ok) throw new Error(`ORIGINAL_FETCH_FAILED:${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const mime = response.headers?.get?.("content-type") || result.sourceMime || "application/octet-stream";
      return { bytes, mime: mime.split(";")[0], sourceUrl };
    }
  };

  // src/sites/chatgpt/contentRuntime.js
  async function captureResults({ adapter, chromeApi, attempt, resultSet }) {
    try {
      for (const result of resultSet.results || []) {
        const original = await adapter.fetchOriginal(result);
        const response = await chromeApi.runtime.sendMessage({
          action: "capturedResult",
          payload: {
            ...result,
            attemptId: attempt.attemptId,
            resultSetId: resultSet.resultSetId,
            conversationId: attempt.conversationId || adapter.getConversationIdentity?.()?.conversationId || null,
            assistantMessageId: resultSet.assistantMessageId || attempt.assistantMessageId || null,
            sourceMime: original.mime,
            bytes: original.bytes
          }
        });
        if (!response?.ok) throw new Error(response?.error || "RESULT_IMPORT_NOT_ACKNOWLEDGED");
      }
    } catch (error) {
      try {
        await chromeApi.runtime.sendMessage({
          action: "adapterError",
          payload: {
            attemptId: attempt.attemptId,
            code: error.code || "RESULT_CAPTURE_FAILED",
            message: error.message,
            assistantMessageId: resultSet.assistantMessageId || attempt.assistantMessageId || null,
            resultSetId: resultSet.resultSetId || null
          }
        });
      } catch (_) {
      }
      throw error;
    }
  }
  var INSTALL_FLAG = "__AISTORY_CHATGPT_BRIDGE_INSTALLED__";
  var DOM_INSTALL_FLAG = "data-aistory-chatgpt-bridge";
  function installChatGPTContentBridge({ chromeApi, adapter, globalRef = globalThis }) {
    if (globalRef[INSTALL_FLAG]) return false;
    const documentElement = globalRef.document?.documentElement;
    if (documentElement?.hasAttribute?.(DOM_INSTALL_FLAG)) return false;
    documentElement?.setAttribute?.(DOM_INSTALL_FLAG, "v1");
    globalRef[INSTALL_FLAG] = true;
    let activeObservation = null;
    chromeApi.runtime.onMessage.addListener((message, _sender, reply) => {
      (async () => {
        try {
          if (message.action === "identity") return reply({ ok: true, value: adapter.getConversationIdentity() });
          if (message.action === "ready") {
            const composer = adapter.document?.querySelector?.('[contenteditable="true"], textarea#prompt-textarea, textarea[placeholder*="Message"], [role="textbox"][aria-label*="\u804A\u5929"], [role="textbox"][aria-label*="Message"]');
            const composerReady = typeof adapter.isComposerReady === "function" ? adapter.isComposerReady() : Boolean(composer);
            const submit = typeof adapter.isSubmitReady === "function" ? adapter.isSubmitReady() : void 0;
            return reply({ ok: true, value: { composer: composerReady, ...submit === void 0 ? {} : { submit } } });
          }
          if (message.action === "fill") return reply({ ok: true, value: adapter.fillPrompt(message.prompt) });
          if (message.action === "upload") return reply({ ok: true, value: await adapter.uploadReferences(message.files || []) });
          if (message.action === "submit") {
            const submit = typeof adapter.submitWhenReady === "function" ? await adapter.submitWhenReady() : adapter.submit();
            return reply({ ok: true, value: submit });
          }
          if (message.action === "beginAttempt") {
            activeObservation?.();
            const attempt = message.attempt || {};
            activeObservation = adapter.beginAttempt(
              attempt,
              (resultSet) => captureResults({ adapter, chromeApi, attempt, resultSet }),
              (error) => chromeApi.runtime.sendMessage({
                action: "adapterError",
                payload: {
                  attemptId: attempt.attemptId,
                  code: error.code || "ADAPTER_ERROR",
                  message: error.message
                }
              })
            );
            return reply({ ok: true });
          }
          if (message.action === "recoverAttempt") {
            activeObservation?.();
            const attempt = message.attempt || {};
            activeObservation = adapter.recoverAttempt(
              attempt,
              (resultSet) => captureResults({ adapter, chromeApi, attempt, resultSet }),
              (error) => chromeApi.runtime.sendMessage({
                action: "adapterError",
                payload: {
                  attemptId: attempt.attemptId,
                  code: error.code || "ADAPTER_ERROR",
                  message: error.message
                }
              })
            );
            return reply({ ok: true });
          }
          if (message.action === "stopAttempt") {
            activeObservation?.();
            activeObservation = null;
            return reply({ ok: true });
          }
          if (message.action === "fetchOriginal") return reply({ ok: true, value: await adapter.fetchOriginal(message.result) });
          return reply({ ok: false, error: "Unknown action" });
        } catch (error) {
          return reply({ ok: false, error: error.code || error.message });
        }
      })();
      return true;
    });
    return true;
  }

  // src/sites/chatgpt/content.js
  installChatGPTContentBridge({ chromeApi: chrome, adapter: new ChatGPTAdapter() });
})();
