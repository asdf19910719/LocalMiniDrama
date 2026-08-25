import test from 'node:test';
import assert from 'node:assert/strict';
import { envelope, validateEvent, writeRequest } from '../src/protocol.js';

test('protocol preserves event, job, and attempt identity', () => {
  const event = envelope('ATTEMPT_CREATED', { jobId: 'job-1', attemptId: 'attempt-1' }, 4, 'event-1');
  assert.deepEqual({ id: event.id, idempotencyKey: event.id, sequence: event.sequence, jobId: event.payload.jobId, attemptId: event.payload.attemptId }, { id: 'event-1', idempotencyKey: 'event-1', sequence: 4, jobId: 'job-1', attemptId: 'attempt-1' });
  assert.equal(writeRequest(event).headers['Idempotency-Key'], 'event-1');
  assert.equal(validateEvent(event), event);
});

test('protocol rejects unknown events and incomplete result identity', () => {
  assert.throws(() => envelope('NOPE'), /Unknown event/);
  assert.throws(() => envelope('RESULT_IMPORTED', { attemptId: 'a', resultSetId: 'set' }), /resultIndex/);
  assert.throws(() => envelope('ATTEMPT_EVENT', { attemptId: 'a' }, 0), /sequence/);
});
