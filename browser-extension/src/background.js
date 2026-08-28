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

function isChatGPTHomeUrl(url = '') {
  if (!isChatGPTUrl(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' || parsed.pathname === '';
  } catch (_) {
    return false;
  }
}

export async function injectChatGPTContentScript(chromeApi, tabId, url) {
  if (!isChatGPTUrl(url) || !Number.isInteger(tabId) || !chromeApi?.scripting?.executeScript) return false;
  if (chromeApi?.tabs?.sendMessage) {
    const active = await chromeApi.tabs.sendMessage(tabId, { action: 'identity' }).catch(() => null);
    if (active?.ok) return true;
  }
  try {
    await chromeApi.scripting.executeScript({ target: { tabId }, files: [CHATGPT_CONTENT_BUNDLE] });
    if (!chromeApi?.tabs?.sendMessage) return true;
    const recovered = await chromeApi.tabs.sendMessage(tabId, { action: 'identity' }).catch(() => null);
    return recovered?.ok === true;
  } catch (_) {
    // Chrome can reject restricted, discarded, or already-closing tabs.
    return false;
  }
}

function makeEventId() { return globalThis.crypto?.randomUUID?.() || `write-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function normalizeBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  if (bytes?.type === 'Buffer' && Array.isArray(bytes.data)) return Uint8Array.from(bytes.data);
  if (bytes && typeof bytes === 'object') {
    const keys = Object.keys(bytes).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
    if (keys.length) return Uint8Array.from(keys.map((key) => bytes[key]));
  }
  throw new Error('image bytes are required');
}

export class BackgroundController {
  constructor({ chromeApi = globalThis.chrome, fetchImpl = globalThis.fetch, apiBase = DEFAULT_API, storage } = {}) {
    this.chromeApi = chromeApi; this.fetchImpl = fetchImpl === globalThis.fetch && typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : fetchImpl; this.apiBase = apiBase.replace(/\/$/, '');
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
  queueFor(sessionKey, task) {
    const prior = this.queues.get(sessionKey) || Promise.resolve()
    const next = prior.catch(() => {}).then(task)
    const tracked = next.then(
      () => { if (this.queues.get(sessionKey) === tracked) this.queues.delete(sessionKey) },
      () => { if (this.queues.get(sessionKey) === tracked) this.queues.delete(sessionKey) },
    )
    this.queues.set(sessionKey, tracked)
    return next
  }
  async emit(type, payload, sequence = 1, id) { const event = envelope(type, payload, sequence, id); await this.outbox.add(event); await this.flush(); return event; }
  async flush() { await this.init(); return this.outbox.flush(async (event) => { const endpoint = event.type === 'ATTEMPT_EVENT' || event.type === 'ADAPTER_ERROR' ? `external-generation/attempts/${event.payload.attemptId}/events` : null; if (!endpoint) return { ok: true }; const body = { ...event.payload, id: event.id, idempotencyKey: event.id, eventType: event.type === 'ADAPTER_ERROR' ? 'ADAPTER_ERROR' : event.payload.eventType }; if (event.type === 'ADAPTER_ERROR') body.payload = { ...event.payload }; try { await this.api(endpoint, { method: 'POST', body, idempotencyKey: event.id }); return { ok: true }; } catch { return { ok: false }; } }); }
  async resolveProviderTab(message, sender) {
    const existing = this.sessions.get(message.dramaId, message.site)
    if (existing?.tabId) return existing.tabId
    if (sender?.tab?.id && isChatGPTUrl(sender.tab.url)) return sender.tab.id
    const tabs = await this.chromeApi?.tabs?.query?.({ url: ['https://chatgpt.com/*', 'https://www.chatgpt.com/*', 'https://chat.openai.com/*'] }) || []
    return tabs.find((tab) => Number.isInteger(tab?.id))?.id ?? null
  }
  async ensureProviderSession(message, sender) {
    if (!message?.dramaId || !message?.site || message.site !== 'chatgpt') return null
    const existing = this.sessions.get(message.dramaId, message.site)
    const ping = async (tabId) => this.chromeApi?.tabs?.sendMessage
      ? this.chromeApi.tabs.sendMessage(tabId, { action: 'identity' }).catch(() => null)
      : null
    const activate = async (session) => {
      if (session?.status !== 'paused') return session
      const active = await this.sessions.attach(message.dramaId, message.site, {
        tabId: session.tabId,
        conversationId: session.conversationId,
        confidence: session.confidence || 'url',
        status: 'active',
        pauseReason: null,
      })
      await this.api(`external-generation/dramas/${message.dramaId}/session/attach`, {
        method: 'POST',
        body: { site: message.site, ...active },
        idempotencyKey: message.id || makeEventId(),
      })
      return active
    }
    if (existing?.conversationId && existing?.tabId) {
      const identity = await ping(existing.tabId)
      if (identity?.value?.conversationId === existing.conversationId) return activate(existing)
      if (identity?.value?.conversationId && String(existing.conversationId).startsWith('WEB:')) {
        const upgraded = await this.sessions.rebind(message.dramaId, message.site, {
          tabId: existing.tabId,
          conversationId: identity.value.conversationId,
          confidence: identity.value.confidence || 'url',
        })
        await this.api(`external-generation/dramas/${message.dramaId}/session/attach`, { method: 'POST', body: { site: message.site, ...upgraded }, idempotencyKey: message.id || makeEventId() })
        return upgraded
      }
      const tabs = await this.chromeApi?.tabs?.query?.({ url: ['https://chatgpt.com/*', 'https://www.chatgpt.com/*', 'https://chat.openai.com/*'] }) || []
      for (const tab of tabs) {
        if (!Number.isInteger(tab?.id) || tab.id === existing.tabId) continue
        const candidate = await ping(tab.id)
        if (candidate?.value?.conversationId === existing.conversationId) {
          const rebound = await this.sessions.attach(message.dramaId, message.site, { tabId: tab.id, confidence: candidate.value.confidence || 'url', status: 'active', pauseReason: null })
          await this.api(`external-generation/dramas/${message.dramaId}/session/attach`, { method: 'POST', body: { site: message.site, ...rebound }, idempotencyKey: message.id || makeEventId() })
          return rebound
        }
      }
      const homeTab = tabs.find((tab) => Number.isInteger(tab?.id) && isChatGPTHomeUrl(tab?.url))
      if (homeTab && this.chromeApi?.tabs?.update) {
        await this.chromeApi.tabs.update(homeTab.id, { url: `https://chatgpt.com/c/${encodeURIComponent(existing.conversationId)}` })
        const restoredIdentity = await this.waitForConversationIdentity(homeTab.id, 40, 250, existing.conversationId)
        if (restoredIdentity?.conversationId === existing.conversationId) {
          const rebound = await this.sessions.attach(message.dramaId, message.site, {
            tabId: homeTab.id,
            confidence: restoredIdentity.confidence || 'url',
            status: 'active',
            pauseReason: null,
          })
          await this.api(`external-generation/dramas/${message.dramaId}/session/attach`, { method: 'POST', body: { site: message.site, ...rebound }, idempotencyKey: message.id || makeEventId() })
          return rebound
        }
      }
      await this.sessions.pause(message.dramaId, message.site, identity ? 'conversation identity mismatch' : 'provider tab unavailable')
      throw new Error(identity ? 'conversation identity mismatch' : 'provider tab unavailable')
    }
    if (!this.chromeApi?.tabs?.sendMessage) return null
    const queriedTabs = await this.chromeApi?.tabs?.query?.({ url: ['https://chatgpt.com/*', 'https://www.chatgpt.com/*', 'https://chat.openai.com/*'] }) || []
    const candidates = []
    if (sender?.tab?.id && isChatGPTUrl(sender.tab.url)) candidates.push(sender.tab)
    for (const tab of queriedTabs) {
      if (!candidates.some((candidate) => candidate.id === tab?.id)) candidates.push(tab)
    }
    for (const tab of candidates) {
      if (!Number.isInteger(tab?.id)) continue
      const identity = await ping(tab.id)
      if (!identity?.ok) continue
      const conversationId = identity.value?.conversationId
      const session = await this.sessions.attach(message.dramaId, message.site, { conversationId: conversationId || null, tabId: tab.id, confidence: identity.value?.confidence || 'tab' })
      await this.api(`external-generation/dramas/${message.dramaId}/session/attach`, { method: 'POST', body: { site: message.site, ...session }, idempotencyKey: message.id || makeEventId() })
      return session
    }
    return null
  }
  async waitForConversationIdentity(tabId, attempts = 20, intervalMs = 250, expectedConversationId = null) {
    if (!tabId || !this.chromeApi?.tabs?.sendMessage) return null
    for (let index = 0; index < attempts; index += 1) {
      const identity = await this.chromeApi.tabs.sendMessage(tabId, { action: 'identity' }).catch(() => null)
      const conversationId = identity?.value?.conversationId
      if (conversationId && !String(conversationId).startsWith('WEB:')
        && (!expectedConversationId || conversationId === expectedConversationId)) return identity.value
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    return null
  }
  async sendToProviderTab(tabId, message) {
    if (!tabId || !this.chromeApi?.tabs?.sendMessage) throw new Error('provider tab is unavailable')
    const response = await this.chromeApi.tabs.sendMessage(tabId, message)
    if (response?.ok === false) throw new Error(response.error || 'provider adapter rejected request')
    return response
  }
  async waitForProviderReady(tabId, attempts = 40, intervalMs = 250) {
    if (!tabId || !this.chromeApi?.tabs?.sendMessage) return false;
    for (let index = 0; index < attempts; index += 1) {
      const ready = await this.chromeApi.tabs.sendMessage(tabId, { action: 'ready' }).catch(() => null);
      // Older content scripts do not implement ready; let fill report the
      // adapter-specific error in that case while newer scripts can gate on
      // the composer actually being mounted.
      if (!ready || ready.ok === false || (ready.ok && ready.value?.composer !== false)) return true;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  }
  async hydrateReferences(references = []) {
    if (!Array.isArray(references) || !references.length) return []
    return Promise.all(references.map(async (reference) => {
      if (!reference?.url || reference.bytes || reference.data || reference.content) return reference
      const url = new URL(String(reference.url), this.apiBase).href
      const response = await this.fetchImpl(url)
      if (!response?.ok) throw new Error(`reference download failed: ${response?.status || 'unknown'}`)
      const bytes = Array.from(new Uint8Array(await response.arrayBuffer()))
      const contentType = response.headers?.get?.('content-type')?.split(';', 1)[0].trim().toLowerCase() || ''
      if (contentType && !contentType.startsWith('image/')) throw new Error(`reference response is not an image: ${contentType}`)
      const isImageBytes = (contentType === 'image/png' && bytes.slice(0, 4).join(',') === '137,80,78,71')
        || (contentType === 'image/jpeg' && bytes.slice(0, 3).join(',') === '255,216,255')
        || (contentType === 'image/gif' && String.fromCharCode(...bytes.slice(0, 3)) === 'GIF')
        || (contentType === 'image/webp' && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
      if (contentType && contentType.startsWith('image/') && !isImageBytes && bytes.length >= 12) throw new Error(`reference response is not an image: invalid ${contentType} bytes`)
      return {
        ...reference,
        bytes,
        name: reference.name || reference.fileName || `reference-${reference.sourceId || 'image'}`,
        mime: reference.mime || 'image/png',
      }
    }))
  }
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
      const session = await this.ensureProviderSession(message, sender);
      const tabId = message.tabId ?? session?.tabId ?? this.sessions.get(message.dramaId, message.site)?.tabId ?? sender.tab?.id;
      if (tabId) {
        const ready = await this.waitForProviderReady(tabId);
        if (!ready) throw new Error('provider composer is not ready');
        await this.sendToProviderTab(tabId, { action: 'fill', prompt: message.prompt });
      }
      if (tabId && message.references?.length) {
        const references = await this.hydrateReferences(message.references)
        await this.sendToProviderTab(tabId, { action: 'upload', files: references })
      }
      return { ok: true, event: await this.emit('JOB_PREPARED', { jobId: message.jobId, conversationId: message.conversationId }, message.sequence, message.id) };
    }
    if (action === 'send') return this.queueFor(message.sessionKey || `${message.dramaId}:${message.site}`, async () => {
      const session = message.dramaId !== undefined && message.site === 'chatgpt'
        ? await this.ensureProviderSession(message, sender)
        : null
      const tabId = session?.tabId ?? message.tabId ?? this.sessions.get(message.dramaId, message.site)?.tabId ?? sender.tab?.id;
      let conversationId = message.conversationId || this.sessions.get(message.dramaId, message.site)?.conversationId || null
      if (tabId && this.chromeApi?.tabs?.sendMessage) {
        const identity = await this.chromeApi.tabs.sendMessage(tabId, { action: 'identity' }).catch(() => null)
        if (identity?.value?.conversationId) conversationId = identity.value.conversationId
      }
      if (message.dramaId !== undefined && message.site && conversationId) {
        const session = this.sessions.get(message.dramaId, message.site)
        if (!session?.conversationId || session.conversationId !== conversationId) {
          if (session?.conversationId) {
            await this.sessions.pause(message.dramaId, message.site, 'conversation identity mismatch')
            throw new Error('conversation identity mismatch; rebind is required')
          }
          await this.sessions.attach(message.dramaId, message.site, { conversationId, tabId, confidence: 'url' })
          await this.api(`external-generation/dramas/${message.dramaId}/session/attach`, { method: 'POST', body: { site: message.site, conversationId, tabId }, idempotencyKey: makeEventId() })
        } else this.sessions.assertConversation(message.dramaId, message.site, conversationId)
      }
      if (tabId) await this.sendToProviderTab(tabId, { action: 'beginAttempt', attempt: { ...message.payload, attemptId: message.attemptId, conversationId } });
      if (tabId) await this.sendToProviderTab(tabId, { action: 'submit' });
      if (!conversationId) {
        const identity = await this.waitForConversationIdentity(tabId)
        if (identity?.conversationId) {
          conversationId = identity.conversationId
          await this.sessions.attach(message.dramaId, message.site, { conversationId, tabId, confidence: identity.confidence || 'url' })
          await this.api(`external-generation/dramas/${message.dramaId}/session/attach`, { method: 'POST', body: { site: message.site, conversationId, tabId }, idempotencyKey: makeEventId() })
        }
      }
      return { ok: true, event: await this.emit('ATTEMPT_EVENT', { attemptId: message.attemptId, conversationId, eventType: 'SUBMITTED', payload: message.payload || {} }, message.sequence, message.id) };
    });
    if (action === 'recoverAttempt') {
      const session = await this.ensureProviderSession(message, sender);
      const tabId = message.tabId ?? session?.tabId ?? this.sessions.get(message.dramaId, message.site)?.tabId ?? sender.tab?.id;
      if (!tabId) throw new Error('provider tab is unavailable');
      const conversationId = session?.conversationId || message.conversationId || null;
      if (message.conversationId && conversationId && message.conversationId !== conversationId) throw new Error('conversation identity mismatch');
      await this.sendToProviderTab(tabId, { action: 'recoverAttempt', attempt: { ...(message.attempt || {}), attemptId: message.attemptId || message.attempt?.attemptId, conversationId } });
      return { ok: true, conversationId, tabId };
    }
    if (action === 'capturedResult') {
      const payload = { ...(message.payload || {}), bytes: normalizeBytes(message.payload?.bytes) };
      const result = await this.workbench.importImage(payload);
      await this.emit('RESULT_IMPORTED', { attemptId: payload.attemptId, resultSetId: payload.resultSetId, resultIndex: payload.resultIndex, result });
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
  const listener = (message, sender, reply) => { controller.handle(message, sender).then(reply).catch((error) => reply({ ok: false, error: error.message })); return true; };
  chromeApi.runtime.onMessage.addListener(listener);
  chromeApi.runtime.onMessageExternal?.addListener(listener);
  chromeApi.runtime.onStartup?.addListener(() => controller.flush()); chromeApi.runtime.onInstalled?.addListener(() => controller.flush());
  chromeApi.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
    if (changeInfo?.status && changeInfo.status !== 'complete') return;
    return injectChatGPTContentScript(chromeApi, tabId, tab?.url || changeInfo?.url);
  });
  return controller;
}

const registered = registerBackground();
export default registered;
