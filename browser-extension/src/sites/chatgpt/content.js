import { ChatGPTAdapter } from './adapter.js';
const adapter = new ChatGPTAdapter();

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  (async () => {
    try {
      if (message.action === 'identity') return reply({ ok: true, value: adapter.getConversationIdentity() });
      if (message.action === 'fill') return reply({ ok: true, value: adapter.fillPrompt(message.prompt) });
      if (message.action === 'upload') return reply({ ok: true, value: await adapter.uploadReferences(message.files || []) });
      if (message.action === 'submit') return reply({ ok: true, value: adapter.submit() });
      if (message.action === 'fetchOriginal') return reply({ ok: true, value: await adapter.fetchOriginal(message.result) });
      return reply({ ok: false, error: 'Unknown action' });
    } catch (error) { return reply({ ok: false, error: error.code || error.message }); }
  })();
  return true;
});
