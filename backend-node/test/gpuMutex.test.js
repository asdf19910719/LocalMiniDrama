const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createGpuMutex } = require('../src/director/gpuMutex');

describe('Director GPU mutex', () => {
  it('allows one owner, rejects a second owner, and reclaims an expired lease', () => {
    let now = 1000;
    const mutex = createGpuMutex({ clock: () => now });
    const first = mutex.acquire('job-1', { leaseMs: 100 });
    assert.equal(first.owner, 'job-1');
    assert.throws(() => mutex.acquire('job-2', { leaseMs: 100 }), /GPU_BUSY/);
    now = 1200;
    const second = mutex.acquire('job-2', { leaseMs: 100 });
    assert.equal(second.owner, 'job-2');
    assert.equal(mutex.inspect().owner, 'job-2');
  });

  it('releases a lease when a task exits, including when the task throws', async () => {
    const mutex = createGpuMutex();
    await assert.rejects(() => mutex.withLease('job-1', async () => { throw new Error('boom'); }), /boom/);
    assert.equal(mutex.inspect(), null);
  });
});
