import test from 'node:test';
import assert from 'node:assert/strict';
import { Outbox } from '../src/outbox.js';
import { envelope } from '../src/protocol.js';

function storage() { const data = {}; return { data, async get(key) { return { [key]: data[key] }; }, async set(value) { Object.assign(data, value); } }; }

test('outbox persists, deduplicates, and only removes acknowledged events', async () => {
  const firstStorage = storage(); const first = new Outbox(firstStorage); await first.load();
  const a = envelope('JOB_CREATED', { jobId: 'job' }, 1, 'e1'); const b = envelope('JOB_PREPARED', { jobId: 'job' }, 2, 'e2');
  await first.add(a); await first.add(a); await first.add(b); assert.deepEqual(first.pending().map((x) => x.id), ['e1', 'e2']);
  const restarted = new Outbox(firstStorage); await restarted.load(); let calls = 0;
  await restarted.flush(async (event, request) => { calls += 1; assert.equal(request.headers['Idempotency-Key'], event.id); return calls === 1 ? { ok: true } : { ok: false }; });
  assert.deepEqual(restarted.pending().map((x) => x.id), ['e2']);
  const recovered = new Outbox(firstStorage); await recovered.load(); assert.deepEqual(recovered.pending().map((x) => x.id), ['e2']);
});
