import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toPlainMessage } from '../src/utils/imageGenerationBridge.js';

describe('image generation bridge message normalization', () => {
  it('unwraps deep reactive proxies into structured-cloneable messages', () => {
    const attempt = new Proxy({ id: 'attempt-1', status: 'submitted', assistant_message_id: null }, {});
    const reactiveLike = new Proxy({
      dramaId: 3,
      job: new Proxy({ id: 'job-1', attempts: [attempt] }, {}),
    }, {});
    const message = { action: 'recoverAttempt', dramaId: 3, attempt: reactiveLike.job.attempts[0], extra: reactiveLike };
    assert.throws(() => structuredClone(message), /could not be cloned|DataCloneError/i);
    const plain = toPlainMessage(message);
    const cloned = structuredClone(plain);
    assert.equal(cloned.attempt.id, 'attempt-1');
    assert.equal(cloned.extra.job.attempts[0].status, 'submitted');
  });

  it('drops function values that cannot be cloned', () => {
    const plain = toPlainMessage({ action: 'send', payload: { id: 'a', onSubmit: () => {} } });
    assert.equal(plain.payload.onSubmit, undefined);
    assert.equal(structuredClone(plain).payload.id, 'a');
  });

  it('preserves binary data that structured clone supports', () => {
    const plain = toPlainMessage({ bytes: new Uint8Array([1, 2, 3]) });
    assert.ok(plain.bytes instanceof Uint8Array);
    assert.deepEqual([...structuredClone(plain).bytes], [1, 2, 3]);
  });
});
