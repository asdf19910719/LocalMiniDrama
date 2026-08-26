const store = new Map();

function get(key) { return key ? store.get(String(key)) : undefined; }
function set(key, value) { if (!key) throw new Error('Idempotency-Key is required'); store.set(String(key), value); return value; }
function clear() { store.clear(); }
module.exports = { get, set, clear };
