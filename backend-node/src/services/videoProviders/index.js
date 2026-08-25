const { createComfyUIVideoProvider } = require('./comfyuiVideoProvider');

function createVideoProviderRegistry(initialProviders = {}) {
  const providers = new Map();
  for (const [name, provider] of Object.entries(initialProviders)) {
    providers.set(String(name).trim().toLowerCase(), provider);
  }
  return {
    get(name) {
      const normalized = String(name || '').trim().toLowerCase();
      const provider = providers.get(normalized);
      if (!provider) throw new Error(`VIDEO_PROVIDER_UNSUPPORTED: ${normalized || '(empty)'}`);
      return provider;
    },
    has(name) {
      return providers.has(String(name || '').trim().toLowerCase());
    },
  };
}

module.exports = { createComfyUIVideoProvider, createVideoProviderRegistry };
