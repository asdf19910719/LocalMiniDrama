'use strict';

const { h3DirectorR2VAdapter } = require('./h3DirectorR2VAdapter');

class AdapterRegistryError extends Error {
  constructor(message, code = 'ADAPTER_NOT_FOUND') {
    super(message);
    this.name = 'AdapterRegistryError';
    this.code = code;
  }
}

const adapters = new Map([
  [h3DirectorR2VAdapter.id, h3DirectorR2VAdapter],
]);

function getAdapter(id) {
  const key = String(id || '').trim();
  const adapter = adapters.get(key);
  if (!adapter) throw new AdapterRegistryError(`workflow adapter not registered: ${key || '(empty)'}`);
  return adapter;
}

function registerAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || !String(adapter.id || '').trim()) {
    throw new AdapterRegistryError('adapter must declare a non-empty id', 'ADAPTER_INVALID');
  }
  for (const method of ['validate', 'buildPrompt', 'describeCapabilities']) {
    if (typeof adapter[method] !== 'function') {
      throw new AdapterRegistryError(`adapter ${adapter.id} must implement ${method}`, 'ADAPTER_INVALID');
    }
  }
  adapters.set(adapter.id, adapter);
  return adapter;
}

function listAdapters() {
  return [...adapters.keys()];
}

module.exports = {
  AdapterRegistryError,
  getAdapter,
  registerAdapter,
  listAdapters,
};
