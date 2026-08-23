const crypto = require('node:crypto');

function createGpuMutex({ clock = () => Date.now() } = {}) {
  let lease = null;

  function inspect() {
    if (lease && lease.expiresAt <= clock()) lease = null;
    return lease ? { ...lease } : null;
  }

  function acquire(owner, { leaseMs = 15 * 60 * 1000 } = {}) {
    if (!owner) throw new Error('GPU lease owner is required');
    if (inspect()) throw new Error('GPU_BUSY');
    lease = { owner, token: crypto.randomUUID(), acquiredAt: clock(), expiresAt: clock() + leaseMs };
    return { ...lease };
  }

  function release(handle) {
    if (!lease) return false;
    const owner = typeof handle === 'string' ? handle : handle?.owner;
    const token = typeof handle === 'object' ? handle?.token : null;
    if (owner !== lease.owner || (token && token !== lease.token)) return false;
    lease = null;
    return true;
  }

  async function withLease(owner, options, work) {
    if (typeof options === 'function') {
      work = options;
      options = {};
    }
    const handle = acquire(owner, options);
    try {
      return await work(handle);
    } finally {
      release(handle);
    }
  }

  return { acquire, release, inspect, reclaimExpired: () => { const previous = lease; inspect(); return previous && !lease; }, withLease };
}

module.exports = { createGpuMutex };
