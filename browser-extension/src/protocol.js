const EVENT_TYPES = new Set([
  'JOB_CREATED', 'JOB_PREPARED', 'ATTEMPT_CREATED', 'ATTEMPT_EVENT',
  'RESULT_IMPORTED', 'ADAPTER_ERROR',
]);

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
}
function validatePayload(type, payload) {
  requireObject(payload, 'payload');
  const required = { JOB_CREATED: ['jobId'], JOB_PREPARED: ['jobId'], ATTEMPT_CREATED: ['jobId', 'attemptId'], ATTEMPT_EVENT: ['attemptId'], RESULT_IMPORTED: ['attemptId', 'resultSetId', 'resultIndex'], ADAPTER_ERROR: [] }[type];
  for (const key of required) if (payload[key] === undefined || payload[key] === null || payload[key] === '') throw new Error(`${type} payload.${key} is required`);
  if (type === 'RESULT_IMPORTED' && (!Number.isInteger(payload.resultIndex) || payload.resultIndex < 0)) throw new Error('RESULT_IMPORTED payload.resultIndex must be a non-negative integer');
}
export function validateEvent(event) {
  requireObject(event, 'event');
  if (!EVENT_TYPES.has(event.type)) throw new Error(`Unknown event: ${event.type}`);
  if (typeof event.id !== 'string' || !event.id) throw new Error('Event id is required');
  if (!Number.isInteger(event.sequence) || event.sequence < 1) throw new Error('Invalid sequence');
  validatePayload(event.type, event.payload);
  if (!event.createdAt || Number.isNaN(Date.parse(event.createdAt))) throw new Error('Invalid createdAt');
  if (event.idempotencyKey !== event.id) throw new Error('idempotencyKey must equal event id');
  return event;
}
export function envelope(type, payload = {}, sequence = 1, id = randomId(), createdAt = new Date().toISOString()) {
  if (!EVENT_TYPES.has(type)) throw new Error(`Unknown event: ${type}`);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Invalid sequence');
  validatePayload(type, payload);
  return validateEvent({ id: String(id), idempotencyKey: String(id), type, sequence, payload, createdAt });
}
export const createEvent = envelope;
export { EVENT_TYPES };
export function writeRequest(event, body = event.payload) {
  validateEvent(event);
  return { body, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': event.id } };
}
