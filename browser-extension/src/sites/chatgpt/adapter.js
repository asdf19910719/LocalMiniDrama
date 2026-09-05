import { selectors } from './selectors.js';
import { conversationIdentity, messageIdentity, identityMatches } from './messageIdentity.js';
import { extractResultSet } from './resultCollector.js';

// The turn selectors include a broad [data-testid^="conversation-turn-"]
// fallback that also matches freshly submitted user messages; binding one of
// those imports its reference thumbnails instead of the generated result.
function isUserTurn(node) {
  return node?.getAttribute?.('data-turn') === 'user' || node?.getAttribute?.('data-message-author-role') === 'user';
}

function isAssistantTurn(node) {
  return node?.getAttribute?.('data-turn') === 'assistant' || node?.getAttribute?.('data-message-author-role') === 'assistant';
}

function isVisibleControl(element, documentRef) {
  if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
  if (element.closest?.('[aria-hidden="true"]')) return false;
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
  const view = documentRef?.defaultView;
  const style = view?.getComputedStyle?.(element) || globalThis.getComputedStyle?.(element);
  return !style || (style.display !== 'none' && style.visibility !== 'hidden');
}

function visibleControl(documentRef, selector) {
  const candidates = typeof documentRef?.querySelectorAll === 'function'
    ? [...documentRef.querySelectorAll(selector)]
    : [];
  if (candidates.length) return candidates.find((element) => isVisibleControl(element, documentRef)) || null;
  const fallback = documentRef?.querySelector?.(selector) || null;
  return isVisibleControl(fallback, documentRef) ? fallback : null;
}

function openDialogFor(element) {
  const dialog = element?.closest?.('[role="dialog"], dialog');
  if (!dialog) return null;
  if (dialog.getAttribute?.('aria-hidden') === 'true' || dialog.getAttribute?.('data-state') === 'closed') return null;
  return dialog;
}

function isTransientAssistantIdentity(messageId) {
  return /^request-placeholder-/i.test(String(messageId || ''));
}

function asFile(input) {
  if (typeof File !== 'undefined' && input instanceof File) return input;
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes || []);
  return new File([bytes], input.name || 'reference', { type: input.mime || 'application/octet-stream' });
}

export class ChatGPTAdapter {
  constructor({ documentRef = globalThis.document, fetchImpl = globalThis.fetch, locationRef = globalThis.location, now = () => Date.now(), grayShellStallMs = 15000, recoveryTimeoutMs = 30000, recoveryPollMs = 250, resultSettleMs = 5000 } = {}) {
    this.document = documentRef; this.fetchImpl = fetchImpl; this.location = locationRef; this.now = now; this.grayShellStallMs = grayShellStallMs; this.recoveryTimeoutMs = recoveryTimeoutMs; this.recoveryPollMs = recoveryPollMs; this.resultSettleMs = resultSettleMs; this.referencesReady = false; this.capturePaused = false; this.seenResultFingerprints = new Set(); this.pendingObserver = null;
  }
  matches(url = this.location?.href || '') { return /^https:\/\/(www\.)?chatgpt\.com\//.test(url); }
  getConversationIdentity() { return conversationIdentity(this.location?.href); }
  imageEditor() {
    const candidates = typeof this.document?.querySelectorAll === 'function'
      ? [...this.document.querySelectorAll(selectors.composer)]
      : [];
    for (const candidate of candidates) {
      if (!isVisibleControl(candidate, this.document)) continue;
      const dialog = openDialogFor(candidate);
      if (dialog) return { composer: candidate, dialog };
    }
    return null;
  }
  pageMode() { return this.imageEditor() ? 'image_editor' : 'conversation'; }
  composer() {
    if (this.pageMode() !== 'conversation') return null;
    const candidates = typeof this.document?.querySelectorAll === 'function'
      ? [...this.document.querySelectorAll(selectors.composer)]
      : [];
    const normal = candidates.find((element) => isVisibleControl(element, this.document) && !openDialogFor(element));
    if (normal) return normal;
    const fallback = this.document?.querySelector?.(selectors.composer) || null;
    return isVisibleControl(fallback, this.document) && !openDialogFor(fallback) ? fallback : null;
  }
  sendButton() { return visibleControl(this.document, selectors.send); }
  isComposerReady() { return Boolean(this.composer()); }
  isSubmitReady() {
    const composer = this.isComposerReady();
    const button = this.sendButton();
    return composer && Boolean(button && !button.disabled);
  }
  async closeImageEditor({ timeoutMs = 3000, intervalMs = 50 } = {}) {
    const editor = this.imageEditor();
    if (!editor) return false;
    const close = editor.dialog.querySelector?.([
      'button[aria-label*="关闭全屏"]',
      'button[aria-label*="Close fullscreen"]',
      'button[aria-label*="关闭"]',
      'button[aria-label*="Close"]',
    ].join(','));
    if (!close || !isVisibleControl(close, this.document)) throw new Error('IMAGE_EDITOR_CLOSE_UNAVAILABLE');
    close.click();
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (this.imageEditor()) {
      if (Date.now() >= deadline) throw new Error('IMAGE_EDITOR_CLOSE_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, intervalMs)));
    }
    return true;
  }
  fillPrompt(prompt) {
    const element = this.composer(); if (!element) throw new Error('ADAPTER_BROKEN');
    element.focus?.();
    if ('value' in element) element.value = prompt;
    else {
      const execDocument = element.ownerDocument || this.document;
      execDocument?.execCommand?.('selectAll', false);
      const inserted = execDocument?.execCommand?.('insertText', false, String(prompt));
      if (!inserted) element.textContent = prompt;
    }
    const Input = globalThis.InputEvent || globalThis.Event; element.dispatchEvent?.(new Input('input', { bubbles: true, inputType: 'insertText', data: prompt })); return { promptLength: String(prompt).length };
  }
  async uploadReferences(files = []) {
    const input = this.document?.querySelector(selectors.file); if (!input) throw new Error('ADAPTER_BROKEN');
    if (typeof DataTransfer === 'undefined') throw new Error('ADAPTER_BROKEN');
    const dataTransfer = new DataTransfer(); for (const file of files) dataTransfer.items.add(asFile(file)); input.files = dataTransfer.files; input.dispatchEvent?.(new Event('change', { bubbles: true }));
    this.referencesReady = input.files.length === files.length; if (!this.referencesReady) throw new Error('UPLOAD_NOT_CONFIRMED');
    return { count: input.files.length };
  }
  submit() {
    if (!this.referencesReady && this.document?.querySelector(selectors.file)?.files?.length) this.referencesReady = true;
    const button = this.sendButton(); if (!button || button.disabled) throw new Error('NOT_READY');
    button.click(); this.referencesReady = false;
    return { submittedAt: new Date().toISOString() };
  }
  async submitWhenReady({ timeoutMs = 120000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    do {
      if (this.isSubmitReady()) return this.submit();
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(0, intervalMs), Math.max(0, deadline - Date.now()))));
    } while (Date.now() <= deadline);
    throw new Error('NOT_READY');
  }
  findAssistant(identity) {
    const nodes = [...(this.document?.querySelectorAll(selectors.assistant) || [])];
    return nodes.find((node) => !isUserTurn(node) && identityMatches(messageIdentity(node), { messageId: identity.assistantMessageId || identity.messageId })) || null;
  }
  recoverAttempt(identity, onResult, onError = () => {}) {
    this.capturePaused = false;
    this.seenResultFingerprints.clear();
    const requested = identity?.assistantMessageId || identity?.messageId;
    if (!requested) {
      const error = Object.assign(new Error('UNBOUND_RESULT'), { code: 'UNBOUND_RESULT' });
      onError(error);
      return () => {};
    }
    const root = this.conversationRoot();
    let observer = null;
    let pollTimer = null;
    let activeStop = null;
    let stopped = false;
    const deadline = this.now() + Math.max(0, this.recoveryTimeoutMs);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      observer?.disconnect();
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      activeStop?.();
    };
    const discover = () => {
      if (stopped || activeStop) return;
      const nodes = [...(this.document?.querySelectorAll(selectors.assistant) || [])].filter((node) => !isUserTurn(node));
      let target = nodes.find((node) => identityMatches(messageIdentity(node), { messageId: requested }));
      if (!target && identity?.userMessageId) {
        const turns = [...(this.document?.querySelectorAll(selectors.turn) || [])];
        const anchorIndex = turns.findIndex((node) => isUserTurn(node)
          && identityMatches(messageIdentity(node), { messageId: identity.userMessageId }));
        if (anchorIndex >= 0) {
          for (let index = anchorIndex + 1; index < turns.length; index += 1) {
            const candidate = turns[index];
            if (isUserTurn(candidate)) {
              if (identityMatches(messageIdentity(candidate), { messageId: identity.userMessageId })) continue;
              break;
            }
            const candidateId = messageIdentity(candidate)?.messageId;
            if (isAssistantTurn(candidate) && candidateId && !isTransientAssistantIdentity(candidateId)) {
              target = candidate;
              break;
            }
          }
        }
      }
      const assistantMessageId = messageIdentity(target)?.messageId;
      if (target && assistantMessageId) {
        observer?.disconnect();
        if (pollTimer !== null) clearTimeout(pollTimer);
        pollTimer = null;
        activeStop = this.observeAttempt({ ...identity, assistantMessageId }, onResult, onError);
        return;
      }
      if (this.now() >= deadline) {
        stop();
        onError(Object.assign(new Error('UNBOUND_RESULT'), { code: 'UNBOUND_RESULT' }));
        return;
      }
      if (pollTimer === null) pollTimer = setTimeout(() => {
        pollTimer = null;
        discover();
      }, Math.max(0, this.recoveryPollMs));
    };
    if (root && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(discover);
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    discover();
    return stop;
  }
  conversationRoot() {
    return this.document?.querySelector?.('main[data-conversation-id], main') || this.document?.body || this.document;
  }
  beginAttempt(identity, onResult, onError = () => {}) {
    this.capturePaused = false;
    const root = this.conversationRoot();
    // Any assistant node already in the DOM at submit time cannot be this
    // attempt's reply, even when its turn identity has not rendered yet —
    // otherwise a still-loading history turn gets bound and the observer is
    // orphaned when ChatGPT renumbers turns mid-generation.
    const existingNodes = [...(root?.querySelectorAll?.(selectors.assistant) || [])];
    const existingTurns = [...(root?.querySelectorAll?.(selectors.turn) || [])];
    const known = new Set(existingNodes
      .map((node) => messageIdentity(node)?.messageId).filter(Boolean));
    const preExisting = new WeakSet(existingNodes);
    const preExistingTurns = new WeakSet(existingTurns);
    if (identity?.assistantMessageId) return this.observeAttempt(identity, onResult, onError);
    if (!root) { onError(Object.assign(new Error('UNBOUND_RESULT'), { code: 'UNBOUND_RESULT' })); return () => {}; }
    let activeStop = null;
    let activeAssistantId = null;
    let activeUserId = identity?.userMessageId || null;
    let generatingReported = false;
    const forwardResult = (result) => {
      if (result?.status === 'GENERATING') {
        if (generatingReported) return;
        generatingReported = true;
      }
      return onResult(result);
    };
    const discover = () => {
      if (!activeUserId) {
        const newUser = [...(root.querySelectorAll?.(selectors.turn) || [])]
          .filter((node) => !preExistingTurns.has(node) && isUserTurn(node))
          .map((node) => messageIdentity(node)?.messageId)
          .find((messageId) => messageId && !isTransientAssistantIdentity(messageId));
        if (newUser) {
          activeUserId = newUser;
          forwardResult({ status: 'USER_BOUND', attemptId: identity?.attemptId, userMessageId: newUser, results: [] });
        }
      }
      const allTurns = [...(root.querySelectorAll?.(selectors.turn) || [])];
      let candidateNodes = null;
      if (activeUserId) {
        const anchorIndex = allTurns.findIndex((node) => isUserTurn(node)
          && identityMatches(messageIdentity(node), { messageId: activeUserId }));
        candidateNodes = [];
        if (anchorIndex >= 0) {
          for (let index = anchorIndex + 1; index < allTurns.length; index += 1) {
            const candidate = allTurns[index];
            if (isUserTurn(candidate)) break;
            if (isAssistantTurn(candidate)) { candidateNodes.push(candidate); break; }
          }
        }
      }
      const candidates = [...(candidateNodes || root.querySelectorAll?.(selectors.assistant) || [])]
        .filter((node) => !preExisting.has(node) && !isUserTurn(node))
        .map((node) => ({ node, id: messageIdentity(node)?.messageId }))
        .filter((entry) => entry.id && !isTransientAssistantIdentity(entry.id)
          && (!known.has(entry.id) || (entry.id === activeAssistantId && entry.node !== activeStop?.root)));
      if (!candidates.length) return;
      const selected = candidates[candidates.length - 1];
      activeStop?.();
      known.add(selected.id);
      activeAssistantId = selected.id;
      activeStop = this.observeAttempt(
        { ...identity, userMessageId: activeUserId, assistantMessageId: selected.id },
        forwardResult,
        (error) => {
          // ChatGPT can replace a streaming turn or promote its temporary
          // turn id. Let the root observer bind the replacement instead of
          // surfacing a transient UNBOUND_RESULT to the workbench.
          if (error?.code === 'UNBOUND_RESULT') {
            this.resumeCapture();
            discover();
            return;
          }
          onError(error);
        },
      );
    };
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(discover);
    if (!observer) { onError(Object.assign(new Error('ADAPTER_BROKEN'), { code: 'ADAPTER_BROKEN' })); return () => {}; }
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    discover();
    const stop = () => { observer.disconnect(); activeStop?.(); this.pendingObserver = null; };
    stop.stop = stop;
    this.pendingObserver = stop;
    return stop;
  }
  observeAttempt(identity, onResult, onError = () => {}) {
    if (this.capturePaused) { const stopped = () => {}; stopped.stop = stopped; return stopped; }
    const root = this.findAssistant(identity); if (!root) { this.capturePaused = true; onError(Object.assign(new Error('UNBOUND_RESULT'), { code: 'UNBOUND_RESULT' })); const stopped = () => {}; stopped.stop = stopped; return stopped; }
    let observer = null;
    let pollTimer = null;
    let settleTimer = null;
    const importingFingerprints = new Set();
    let generatingReported = false;
    let grayShellSince = null;
    let grayShellEscalated = false;
    let stopped = false;
    const halt = (error, report = true) => {
      if (stopped) return;
      stopped = true;
      this.capturePaused = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      observer?.disconnect();
      if (report) onError(error);
    };
    const schedulePoll = () => {
      if (stopped || this.capturePaused || pollTimer !== null) return;
      pollTimer = setTimeout(() => {
        pollTimer = null;
        emit();
      }, 500);
    };
    const clearSettle = () => {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
    };
    const scheduleSettle = (result) => {
      if (stopped || this.capturePaused || settleTimer !== null || importingFingerprints.size) return;
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (stopped || this.capturePaused) return;
        try {
          const latest = extractResultSet(root, identity);
          const hasFresh = latest.results?.some((item) => !this.seenResultFingerprints.has(item.nodeFingerprint)
            && !importingFingerprints.has(item.nodeFingerprint));
          if (latest.status !== 'RESULT_READY' || Number(latest.pendingResultCount || 0) > 0 || hasFresh) {
            emit();
            return;
          }
          Promise.resolve(onResult({ ...result, ...latest, status: 'CAPTURE_COMPLETE', results: [] }))
            .then(() => stop())
            .catch(() => halt(null, false));
        } catch (error) { halt(error); }
      }, Math.max(0, this.resultSettleMs));
    };
    const emit = () => {
      if (stopped || this.capturePaused) return;
      try {
        const result = extractResultSet(root, identity);
        if (result.status === 'UNBOUND_RESULT' || result.status === 'NEEDS_REVIEW') {
          halt(Object.assign(new Error(result.status), { code: result.status }));
        } else if (result.status === 'RESULT_SHELL') {
          if (grayShellSince === null) grayShellSince = this.now();
          if (!generatingReported) {
            generatingReported = true;
            Promise.resolve(onResult({ ...result, status: 'GENERATING' })).catch(() => halt(null, false));
          }
          if (!grayShellEscalated && this.now() - grayShellSince >= this.grayShellStallMs) {
            grayShellEscalated = true;
            Promise.resolve(onResult({ ...result, status: 'RESULT_SHELL_STALLED' }))
              .then(() => halt(null, false))
              .catch(() => halt(null, false));
            return;
          }
          schedulePoll();
        } else if (result.status === 'GENERATING') {
          grayShellSince = null;
          if (!generatingReported) {
            generatingReported = true;
            Promise.resolve(onResult(result)).catch(() => halt(null, false));
          }
          schedulePoll();
        } else {
          if (pollTimer !== null) clearTimeout(pollTimer);
          pollTimer = null;
          if (Number(result.pendingResultCount || 0) > 0) clearSettle();
          const fresh = result.results.filter((item) => !this.seenResultFingerprints.has(item.nodeFingerprint)
            && !importingFingerprints.has(item.nodeFingerprint));
          if (fresh.length) {
            clearSettle();
            fresh.forEach((item) => importingFingerprints.add(item.nodeFingerprint));
            Promise.resolve(onResult({ ...result, results: fresh }))
              .then(() => {
                fresh.forEach((item) => {
                  importingFingerprints.delete(item.nodeFingerprint);
                  this.seenResultFingerprints.add(item.nodeFingerprint);
                });
                if (stopped) return;
                emit();
              })
              .catch(() => {
                fresh.forEach((item) => importingFingerprints.delete(item.nodeFingerprint));
                halt(null, false);
              });
          } else if (Number(result.pendingResultCount || 0) > 0) {
            schedulePoll();
          } else if (result.results.length && importingFingerprints.size === 0) {
            scheduleSettle(result);
          }
        }
      } catch (error) { halt(error); }
    };
    emit();
    if (!stopped && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(emit);
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      observer?.disconnect();
    };
    stop.stop = stop; stop.root = root; return stop;
  }
  resumeCapture() { this.capturePaused = false; this.seenResultFingerprints.clear(); }
  extractResultSet(node, attempt) { return extractResultSet(node, attempt); }
  async fetchOriginal(result, fetchImpl = this.fetchImpl) {
    const sourceUrl = result?.sourceUrl || result?.url; if (!sourceUrl) throw new Error('ORIGINAL_URL_MISSING');
    let parsed;
    try { parsed = new URL(sourceUrl); } catch (_) { throw new Error('ORIGINAL_URL_INVALID'); }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'openai.com' || host.endsWith('.openai.com') || host.endsWith('.oaiusercontent.com'))) throw new Error('ORIGINAL_URL_NOT_ALLOWED');
    const response = await fetchImpl(sourceUrl, { credentials: 'include' }); if (!response.ok) throw new Error(`ORIGINAL_FETCH_FAILED:${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer()); const mime = response.headers?.get?.('content-type') || result.sourceMime || 'application/octet-stream';
    return { bytes, mime: mime.split(';')[0], sourceUrl };
  }
}
