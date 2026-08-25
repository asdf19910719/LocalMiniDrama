import { ChatGPTAdapter } from './adapter.js';
const adapter = new ChatGPTAdapter();
let activeObservation = null;

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'aistory-external-generation') return;
  const message = event.data.message;
  if (message) chrome.runtime.sendMessage(message);
});

async function captureResults(attempt, resultSet) {
  for (const result of resultSet.results || []) {
    try {
      const original = await adapter.fetchOriginal(result);
      chrome.runtime.sendMessage({ action: 'capturedResult', payload: {
        ...result,
        attemptId: attempt.attemptId,
        resultSetId: resultSet.resultSetId,
        conversationId: attempt.conversationId || adapter.getConversationIdentity()?.conversationId || null,
        assistantMessageId: attempt.assistantMessageId || null,
        sourceMime: original.mime,
        bytes: original.bytes,
      }});
    } catch (error) {
      chrome.runtime.sendMessage({ action: 'adapterError', payload: { attemptId: attempt.attemptId, code: error.code || 'ORIGINAL_FETCH_FAILED', message: error.message } });
      throw error;
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  (async () => {
    try {
      if (message.action === 'identity') return reply({ ok: true, value: adapter.getConversationIdentity() });
      if (message.action === 'fill') return reply({ ok: true, value: adapter.fillPrompt(message.prompt) });
      if (message.action === 'upload') return reply({ ok: true, value: await adapter.uploadReferences(message.files || []) });
      if (message.action === 'submit') return reply({ ok: true, value: adapter.submit() });
      if (message.action === 'beginAttempt') {
        activeObservation?.();
        activeObservation = adapter.beginAttempt(message.attempt || {}, (resultSet) => captureResults(message.attempt || {}, resultSet), (error) => chrome.runtime.sendMessage({ action: 'adapterError', payload: { attemptId: message.attempt?.attemptId, code: error.code || 'ADAPTER_ERROR', message: error.message } }));
        return reply({ ok: true });
      }
      if (message.action === 'stopAttempt') { activeObservation?.(); activeObservation = null; return reply({ ok: true }); }
      if (message.action === 'fetchOriginal') return reply({ ok: true, value: await adapter.fetchOriginal(message.result) });
      return reply({ ok: false, error: 'Unknown action' });
    } catch (error) { return reply({ ok: false, error: error.code || error.message }); }
  })();
  return true;
});
