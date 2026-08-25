import { selectors } from './selectors.js';
import { conversationIdentity, messageIdentity, identityMatches } from './messageIdentity.js';
import { extractResultSet } from './resultCollector.js';

function asFile(input) {
  if (typeof File !== 'undefined' && input instanceof File) return input;
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes || []);
  return new File([bytes], input.name || 'reference', { type: input.mime || 'application/octet-stream' });
}

export class ChatGPTAdapter {
  constructor({ documentRef = globalThis.document, fetchImpl = globalThis.fetch, locationRef = globalThis.location } = {}) {
    this.document = documentRef; this.fetchImpl = fetchImpl; this.location = locationRef; this.referencesReady = false; this.capturePaused = false;
  }
  matches(url = this.location?.href || '') { return /^https:\/\/(www\.)?chatgpt\.com\//.test(url); }
  getConversationIdentity() { return conversationIdentity(this.location?.href); }
  fillPrompt(prompt) {
    const element = this.document?.querySelector(selectors.composer); if (!element) throw new Error('ADAPTER_BROKEN');
    element.focus?.(); if ('value' in element) element.value = prompt; else element.textContent = prompt;
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
    return nodes.find((node) => identityMatches(messageIdentity(node), { messageId: identity.assistantMessageId || identity.messageId })) || null;
  }
  observeAttempt(identity, onResult, onError = () => {}) {
    if (this.capturePaused) { const stopped = () => {}; stopped.stop = stopped; return stopped; }
    const root = this.findAssistant(identity); if (!root) { this.capturePaused = true; onError(Object.assign(new Error('UNBOUND_RESULT'), { code: 'UNBOUND_RESULT' })); const stopped = () => {}; stopped.stop = stopped; return stopped; }
    const emit = () => { try { const result = extractResultSet(root, identity); if (result.status === 'UNBOUND_RESULT' || result.status === 'NEEDS_REVIEW') { this.capturePaused = true; onError(Object.assign(new Error(result.status), { code: result.status })); } else onResult(result); } catch (error) { this.capturePaused = true; onError(error); } };
    emit(); const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(emit); observer?.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    const stop = () => observer?.disconnect(); stop.stop = stop; stop.root = root; return stop;
  }
  resumeCapture() { this.capturePaused = false; }
  extractResultSet(node, attempt) { return extractResultSet(node, attempt); }
  async fetchOriginal(result, fetchImpl = this.fetchImpl) {
    const sourceUrl = result?.sourceUrl || result?.url; if (!sourceUrl) throw new Error('ORIGINAL_URL_MISSING');
    const response = await fetchImpl(sourceUrl, { credentials: 'include' }); if (!response.ok) throw new Error(`ORIGINAL_FETCH_FAILED:${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer()); const mime = response.headers?.get?.('content-type') || result.sourceMime || 'application/octet-stream';
    return { bytes, mime: mime.split(';')[0], sourceUrl };
  }
}
