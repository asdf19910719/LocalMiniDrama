import { envelope, writeRequest } from './protocol.js';
import { Outbox, chromeStorageLocal } from './outbox.js';
import { SessionRegistry } from './sessionRegistry.js';
import { BridgeClient } from './bridgeClient.js';
import { WorkbenchClient } from './workbenchClient.js';

const DEFAULT_API = 'http://127.0.0.1:5679/api/v1';
const WRITE_PATHS = new Set(['jobs', 'prepare', 'attempts', 'events', 'results/import', 'session/attach']);
const CHATGPT_CONTENT_BUNDLE = 'src/sites/chatgpt/content.bundle.js';

export function isChatGPTUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (
      parsed.hostname === 'chatgpt.com' ||
      parsed.hostname.endsWith('.chatgpt.com') ||
      parsed.hostname === 'chat.openai.com'
    );
  } catch (_) {
    return false;
  }
}

export async function injectChatGPTContentScript(chromeApi, tabId, url) {
  if (!isChatGPTUrl(url) || !Number.isInteger(tabId) || !chromeApi?.scripting?.executeScript) return false;
  try {
    await chromeApi.scripting.executeScript({ target: { tabId }, files: [CHATGPT_CONTENT_BUNDLE] });
    return true;
  } catch (_) {
    // Chrome can reject restricted, discarded, or already-closing tabs.
    return false;
  }
}

function makeEventId() { return globalThis.crypto?.randomUUID?.() || `write-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

export class BackgroundController {
  constructor({ chromeApi = globalThis.chrome, fetchImpl = globalThis.fetch, apiBase = DEFAULT_API, storage } = {}) {
    this.chromeApi = chromeApi; this.fetchImpl = fetchImpl; this.apiBase = apiBase.replace(/\/$/, '');
    this.storage = storage || chromeStorageLocal(chromeApi); this.outbox = new Outbox(this.storage); this.sessions = new SessionRegistry(this.storage); this.queues = new Map(); this.ready = null;
    this.bridge = new BridgeClient(); this.workbench = new WorkbenchClient({ baseUrl: this.apiBase });
  }
  async init() { if (!this.ready) this.ready = Promise.all([this.outbox.load(), this.sessions.load(), this.storage.get('bridgeConfig').then((value) => { const config = value?.bridgeConfig || value; if (config?.baseUrl) this.bridge = new BridgeClient(config); })]); return this.ready; }
  async api(path, { method = 'GET', body, idempotencyKey } = {}) {
    const headers = { Accept: 'application/json' }; if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['Idempotency-Key'] = idempotencyKey || makeEventId();
    const response = await this.fetchImpl(`${this.apiBase}/${path.replace(/^\//, '')}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => null); if (!response.ok) { const error = new Error(data?.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data?.data ?? data;
  }
  queueFor(sessionKey, task) { const prior = this.queues.get(sessionKey) || Promise.resolve(); const next = prior.catch(() => {}).then(task); this.queues.set(sessionKey, next.finally(() => { if (this.queues.get(sessionKey) === next) this.queues.delete(sessionKey); })); return next; }
  async emit(type, payload, sequence = 1, id) { const event = envelope(type, payload, sequence, id); await this.outbox.add(event); await this.flush(); return event; }
  async flush() { await this.init(); return this.outbox.flush(async (event) => { const endpoint = event.type === 'ATTEMPT_EVENT' || event.type === 'ADAPTER_ERROR' ? `external-generation/attempts/${event.payload.attemptId}/events` : null; if (!endpoint) return { ok: true }; const body = { ...event.payload, id: event.id, idempotencyKey: event.id, eventType: event.type === 'ADAPTER_ERROR' ? 'ADAPTER_ERROR' : event.payload.eventType }; try { await this.api(endpoint, { method: 'POST', body, idempotencyKey: event.id }); return { ok: true }; } catch { return { ok: false }; } }); }
  async handle(message, sender = {}) {
    await this.init(); const action = message?.action;
    if (action === 'flush') return { ok: true, confirmed: await this.flush() };
    if (action === 'pairBridge') { const result = await this.bridge.pair(message.pairingToken); await this.storage.set({ bridgeConfig: { baseUrl: this.bridge.baseUrl, accessToken: this.bridge.accessToken } }); return { ok: true, result }; }
    if (action === 'createAttempt') { const attempt = await this.workbench.createAttempt(message.jobId, message.payload || {}); await this.emit('ATTEMPT_CREATED', { jobId: message.jobId, attemptId: attempt.id }); return { ok: true, attempt }; }
    if (action === 'importResult') { const result = await this.workbench.importImage(message.payload); await this.emit('RESULT_IMPORTED', { attemptId: message.payload.attemptId, resultSetId: message.payload.resultSetId, resultIndex: message.payload.resultIndex, result }); return { ok: true, result }; }
    if (action === 'attach') { const session = await this.sessions.attach(message.dramaId, message.site, { ...message.session, tabId: sender.tab?.id ?? message.session?.tabId }); await this.api(`external-generation/dramas/${message.dramaId}/session/attach`, { method: 'POST', body: { site: message.site, ...session }, idempotencyKey: message.id || makeEventId() }); return { ok: true, session }; }
    if (action === 'pause') { const session = await this.sessions.pause(message.dramaId, message.site, message.reason); return { ok: true, session }; }
    if (action === 'resume') return { ok: true, session: await this.sessions.resume(message.dramaId, message.site) };
    if (action === 'rebind') return { ok: true, session: await this.sessions.rebind(message.dramaId, message.site, message.session) };
    if (action === 'state') return { ok: true, session: this.sessions.get(message.dramaId, message.site), outbox: this.outbox.pending() };
    if (action === 'prepare') {
      const tabId = message.tabId ?? this.sessions.get(message.dramaId, message.site)?.tabId ?? sender.tab?.id;
      if (tabId && this.chromeApi?.tabs?.sendMessage) await this.chromeApi.tabs.sendMessage(tabId, { action: 'fill', prompt: message.prompt });
      if (tabId && message.references?.length && this.chromeApi?.tabs?.sendMessage) await this.chromeApi.tabs.sendMessage(tabId, { action: 'upload', files: message.references });
      return { ok: true, event: await this.emit('JOB_PREPARED', { jobId: message.jobId, conversationId: message.conversationId }, message.sequence, message.id) };
    }
    if (action === 'send') return this.queueFor(message.sessionKey || `${message.dramaId}:${message.site}`, async () => {
      if (message.dramaId !== undefined && message.site && message.conversationId) this.sessions.assertConversation(message.dramaId, message.site, message.conversationId);
      const tabId = message.tabId ?? this.sessions.get(message.dramaId, message.site)?.tabId ?? sender.tab?.id;
      if (tabId && this.chromeApi?.tabs?.sendMessage) await this.chromeApi.tabs.sendMessage(tabId, { action: 'beginAttempt', attempt: { ...message.payload, attemptId: message.attemptId, conversationId: message.conversationId } });
      if (tabId && this.chromeApi?.tabs?.sendMessage) await this.chromeApi.tabs.sendMessage(tabId, { action: 'submit' });
      return { ok: true, event: await this.emit('ATTEMPT_EVENT', { attemptId: message.attemptId, conversationId: message.conversationId, eventType: 'SUBMITTED', payload: message.payload || {} }, message.sequence, message.id) };
    });
    if (action === 'capturedResult') {
      const result = await this.workbench.importImage(message.payload);
      await this.emit('RESULT_IMPORTED', { attemptId: message.payload.attemptId, resultSetId: message.payload.resultSetId, resultIndex: message.payload.resultIndex, result });
      return { ok: true, result };
    }
    if (action === 'adapterError') {
      const payload = message.payload || {};
      if (payload.attemptId) await this.emit('ADAPTER_ERROR', payload);
      return { ok: true };
    }
    if (action === 'confirm') return { ok: true, event: await this.emit('ATTEMPT_EVENT', { attemptId: message.attemptId, conversationId: message.conversationId, eventType: 'CONFIRMED', payload: message.payload || {} }, message.sequence, message.id) };
    if (action === 'event') {
      const sessionKey = message.sessionKey || `${message.dramaId}:${message.site}`;
      if (message.dramaId !== undefined && message.site && message.payload?.conversationId) await this.sessions.assertAndAdvance(message.dramaId, message.site, message.payload.conversationId, message.sequence);
      return this.queueFor(sessionKey, async () => ({ ok: true, event: await this.emit(message.type, message.payload, message.sequence, message.id) }));
    }
    return { ok: false, error: 'Unknown action' };
  }
}

export function registerBackground(chromeApi = globalThis.chrome, options = {}) {
  if (!chromeApi?.runtime?.onMessage) return null;
  const controller = new BackgroundController({ chromeApi, ...options });
  chromeApi.runtime.onMessage.addListener((message, sender, reply) => { controller.handle(message, sender).then(reply).catch((error) => reply({ ok: false, error: error.message })); return true; });
  chromeApi.runtime.onStartup?.addListener(() => controller.flush()); chromeApi.runtime.onInstalled?.addListener(() => controller.flush());
  chromeApi.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
    if (changeInfo?.status && changeInfo.status !== 'complete') return;
    void injectChatGPTContentScript(chromeApi, tabId, tab?.url || changeInfo?.url);
  });
  return controller;
}

const registered = registerBackground();
export default registered;
