const STORAGE_KEY = 'externalGeneration.sessions';
export class SessionRegistry {
  constructor(storage, options = {}) { this.storage = storage; this.storageKey = options.storageKey || STORAGE_KEY; this.sessions = {}; this.loaded = false; }
  key(dramaId, site) { return `${String(dramaId)}:${String(site).trim().toLowerCase()}`; }
  async load() { const value = await this.storage.get(this.storageKey); this.sessions = value?.[this.storageKey] || value || {}; this.loaded = true; return this.sessions; }
  async save() { if (this.storage.set.length >= 2) await this.storage.set(this.storageKey, this.sessions); else await this.storage.set({ [this.storageKey]: this.sessions }); }
  get(dramaId, site) { return this.sessions[this.key(dramaId, site)] || null; }
  findByTabId(tabId) { return Object.values(this.sessions).find((session) => session?.tabId === tabId) || null; }
  findByActiveAttempt(attemptId) {
    return Object.values(this.sessions).find((session) => session?.activeAttempt?.attemptId === attemptId) || null;
  }
  async attach(dramaId, site, session = {}, options = {}) {
    if (!this.loaded) await this.load(); if (dramaId === undefined || dramaId === null || !String(site || '').trim()) throw new Error('dramaId and site are required');
    const key = this.key(dramaId, site); const existing = this.sessions[key]; const conversationId = session.conversationId ?? existing?.conversationId ?? null;
    if (existing?.conversationId && conversationId && existing.conversationId !== conversationId && !options.rebind) throw new Error('conversation is already bound; rebind is required');
    const next = { ...existing, ...session, dramaId, site: String(site).trim().toLowerCase(), conversationId, status: session.status || existing?.status || 'active', updatedAt: new Date().toISOString() };
    this.sessions[key] = next; await this.save(); return next;
  }
  async pause(dramaId, site, reason = 'manual') { const session = this.get(dramaId, site); return session ? this.attach(dramaId, site, { status: 'paused', pauseReason: reason }) : null; }
  async resume(dramaId, site) { return this.attach(dramaId, site, { status: 'active', pauseReason: null }); }
  async rebind(dramaId, site, session) { return this.attach(dramaId, site, session, { rebind: true }); }
  assertConversation(dramaId, site, conversationId) { const session = this.get(dramaId, site); if (!session?.conversationId || session.conversationId !== conversationId) throw new Error('conversation identity mismatch'); if (session.status === 'paused') throw new Error('session is paused'); return session; }
  async assertAndAdvance(dramaId, site, conversationId, sequence) {
    const session = this.assertConversation(dramaId, site, conversationId);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence <= Number(session.lastSequence || 0)) throw new Error('conversation sequence must increase');
    return this.attach(dramaId, site, { lastSequence: sequence });
  }
}
export { STORAGE_KEY };
