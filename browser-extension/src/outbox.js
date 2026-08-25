import { validateEvent, writeRequest } from './protocol.js';
const STORAGE_KEY = 'externalGeneration.outbox';
const CURSOR_KEY = 'externalGeneration.cursor';
export class Outbox {
  constructor(storage, options = {}) { this.storage = storage; this.storageKey = options.storageKey || STORAGE_KEY; this.cursorKey = options.cursorKey || CURSOR_KEY; this.items = []; this.cursor = Number(options.cursor || 0); this.loaded = false; this.flushing = null; }
  async read(key) {
    const value = await this.storage.get(key); return value?.[key] === undefined ? value : value[key];
  }
  async write(key, value) {
    if (this.storage.set.length >= 2) return this.storage.set(key, value);
    return this.storage.set({ [key]: value });
  }
  async load() {
    const value = await this.read(this.storageKey); const raw = Array.isArray(value) ? value : [];
    this.items = raw.filter((item) => { try { validateEvent(item); return true; } catch { return false; } });
    const cursorValue = await this.read(this.cursorKey); this.cursor = Number(cursorValue ?? this.cursor) || 0; this.loaded = true; return this.pending();
  }
  async persist() { await this.write(this.storageKey, this.items); }
  async add(event) { validateEvent(event); if (!this.loaded) await this.load(); if (!this.items.some((item) => item.id === event.id)) { this.items.push(event); await this.persist(); } return event; }
  async ack(id) { if (!this.loaded) await this.load(); this.items = this.items.filter((item) => item.id !== id); await this.persist(); }
  pending() { return [...this.items].sort((a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); }
  async setCursor(cursor) { if (!Number.isInteger(cursor) || cursor < this.cursor) return this.cursor; this.cursor = cursor; await this.write(this.cursorKey, cursor); return cursor; }
  async flush(send) {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => { const confirmed = []; for (const event of this.pending()) { const response = await send(event, writeRequest(event)); if (!response || response.ok === false) break; await this.ack(event.id); confirmed.push(event.id); } return confirmed; })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
export function chromeStorageLocal(chromeApi = globalThis.chrome) {
  if (!chromeApi?.storage?.local) throw new Error('chrome.storage.local is unavailable');
  return { get: (key) => new Promise((resolve, reject) => chromeApi.storage.local.get(key, (value) => chromeApi.runtime?.lastError ? reject(chromeApi.runtime.lastError) : resolve(value))), set: (value) => new Promise((resolve, reject) => chromeApi.storage.local.set(value, () => chromeApi.runtime?.lastError ? reject(chromeApi.runtime.lastError) : resolve())) };
}
