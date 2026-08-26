// The workbench and provider page live in different tabs. This content script
// forwards the workbench's page-scoped messages to the extension background.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'aistory-external-generation') return;
  const message = event.data.message;
  if (message) chrome.runtime.sendMessage(message);
});
