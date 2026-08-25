const fs = require('node:fs/promises');
const path = require('node:path');
class EventOutbox {
  constructor(filePath) { this.filePath = path.resolve(filePath); }
  async load() { try { return JSON.parse(await fs.readFile(this.filePath, 'utf8')); } catch { return { nextSequence: 1, events: [] }; } }
  async save(state) { await fs.mkdir(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; await fs.writeFile(tmp, JSON.stringify(state, null, 2)); await fs.rename(tmp, this.filePath); }
  async enqueue(event) { const state = await this.load(); if (event.idempotencyKey && state.events.find(e => e.idempotencyKey === event.idempotencyKey)) return state.events.find(e => e.idempotencyKey === event.idempotencyKey); const item = { ...event, sequence: state.nextSequence++ }; state.events.push(item); await this.save(state); return item; }
  async pending() { return (await this.load()).events; }
  async ack(sequence) { const state = await this.load(); state.events = state.events.filter(e => e.sequence > Number(sequence)); await this.save(state); return state.events; }
}
module.exports = { EventOutbox };
