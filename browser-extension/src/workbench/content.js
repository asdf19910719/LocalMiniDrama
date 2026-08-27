// The workbench and provider page live in different tabs. This content script
// forwards the workbench's page-scoped messages to the extension background.
window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.source !== 'aistory-external-generation') return;
  const message = event.data.message;
  const requestId = event.data.requestId;
  if (!message || !requestId) return;
  try {
    const response = await chrome.runtime.sendMessage(message);
    window.postMessage({ source: 'aistory-external-generation-response', requestId, response }, '*');
  } catch (error) {
    window.postMessage({ source: 'aistory-external-generation-response', requestId, response: { ok: false, error: error.message } }, '*');
  }
});
