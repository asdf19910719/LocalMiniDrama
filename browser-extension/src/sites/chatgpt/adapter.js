import { selectors } from './selectors.js';
import { conversationIdentity, messageIdentity, identityMatches } from './messageIdentity.js';
import { extractResultSet } from './resultCollector.js';

// The turn selectors include a broad [data-testid^="conversation-turn-"]
// fallback that also matches freshly submitted user messages; binding one of
// those imports its reference thumbnails instead of the generated result.
function isUserTurn(node) {
  return node?.getAttribute?.('data-turn') === 'user' || node?.getAttribute?.('data-message-author-role') === 'user';
}

function asFile(input) {
  if (typeof File !== 'undefined' && input instanceof File) return input;
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes || []);
  return new File([bytes], input.name || 'reference', { type: input.mime || 'application/octet-stream' });
}

export class ChatGPTAdapter {
  constructor({ documentRef = globalThis.document, fetchImpl = globalThis.fetch, locationRef = globalThis.location } = {}) {
    this.document = documentRef; this.fetchImpl = fetchImpl; this.location = locationRef; this.referencesReady = false; this.capturePaused = false; this.seenResultFingerprints = new Set(); this.pendingObserver = null;
  }
  matches(url = this.location?.href || '') { return /^https:\/\/(www\.)?chatgpt\.com\//.test(url); }
  getConversationIdentity() { return conversationIdentity(this.location?.href); }
  fillPrompt(prompt) {
    const element = this.document?.querySelector(selectors.composer); if (!element) throw new Error('ADAPTER_BROKEN');
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
    const button = this.document?.querySelector(selectors.send); if (!button || button.disabled) throw new Error('NOT_READY');
    button.click(); this.referencesReady = false;
    return { submittedAt: new Date().toISOString() };
  }
  findAssistant(identity) {
    const nodes = [...(this.document?.querySelectorAll(selectors.assistant) || [])];
    return nodes.find((node) => !isUserTurn(node) && identityMatches(messageIdentity(node), { messageId: identity.assistantMessageId || identity.messageId })) || null;
  }
  recoverAttempt(identity, onResult, onError = () => {}) {
    this.capturePaused = false;
    this.seenResultFingerprints.clear();
    const requested = identity?.assistantMessageId || identity?.messageId;
    const nodes = [...(this.document?.querySelectorAll(selectors.assistant) || [])].filter((node) => !isUserTurn(node));
    const target = requested
      ? nodes.find((node) => identityMatches(messageIdentity(node), { messageId: requested }))
      : nodes.filter((node) => messageIdentity(node)).at(-1);
    const assistantMessageId = messageIdentity(target)?.messageId;
    if (!target || !assistantMessageId) {
      const error = Object.assign(new Error('UNBOUND_RESULT'), { code: 'UNBOUND_RESULT' });
      onError(error);
      return () => {};
    }
    return this.observeAttempt({ ...identity, assistantMessageId }, onResult, onError);
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
    const known = new Set(existingNodes
      .map((node) => messageIdentity(node)?.messageId).filter(Boolean));
    const preExisting = new WeakSet(existingNodes);
    if (identity?.assistantMessageId) return this.observeAttempt(identity, onResult, onError);
    if (!root) { onError(Object.assign(new Error('UNBOUND_RESULT'), { code: 'UNBOUND_RESULT' })); return () => {}; }
    let activeStop = null;
    let activeAssistantId = null;
    const discover = () => {
      const candidates = [...(root.querySelectorAll?.(selectors.assistant) || [])]
        .filter((node) => !preExisting.has(node) && !isUserTurn(node))
        .map((node) => ({ node, id: messageIdentity(node)?.messageId }))
        .filter((entry) => entry.id && (!known.has(entry.id) || (entry.id === activeAssistantId && entry.node !== activeStop?.root)));
      if (!candidates.length) return;
      const selected = candidates[candidates.length - 1];
      activeStop?.();
      known.add(selected.id);
      activeAssistantId = selected.id;
      activeStop = this.observeAttempt(
        { ...identity, assistantMessageId: selected.id },
        onResult,
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
        if (result.status === 'UNBOUND_RESULT' || result.status === 'NEEDS_REVIEW') {
          halt(Object.assign(new Error(result.status), { code: result.status }));
        } else {
          const fresh = result.results.filter((item) => !this.seenResultFingerprints.has(item.nodeFingerprint));
          if (fresh.length) {
            Promise.resolve(onResult({ ...result, results: fresh }))
              .then(() => fresh.forEach((item) => this.seenResultFingerprints.add(item.nodeFingerprint)))
              .catch(() => halt(null, false));
          }
        }
      } catch (error) { halt(error); }
    };
    emit();
    if (!stopped && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(emit);
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    const stop = () => { if (stopped) return; stopped = true; observer?.disconnect(); };
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
