const $ = (id) => document.getElementById(id);
let state = { dramaId: null, site: 'chatgpt', session: null, jobs: [], adapter: 'unknown', results: 0 };
function render(next = state) {
  state = { ...state, ...next }; const session = state.session;
  $('health').textContent = state.adapter; $('health').dataset.state = state.adapter;
  $('project').textContent = session?.dramaId ?? 'Not attached'; $('conversation').textContent = session?.conversationId || '-';
  $('pause').disabled = !session || session.status === 'paused'; $('rebind').disabled = !session;
  $('adapter').textContent = session?.status === 'paused' ? `Paused: ${session.pauseReason || 'manual'}` : `Adapter: ${state.adapter}`;
  $('results').textContent = `Results: ${Number(state.results || 0)}`;
  $('jobs').replaceChildren(...(state.jobs.length ? state.jobs : [{ status: 'Waiting for workbench' }]).map((job) => { const li = document.createElement('li'); li.textContent = `${job.jobId || job.id || 'Job'} - ${job.status || 'unknown'}`; return li; }));
}
async function send(message) { return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve)); }
$('pause').addEventListener('click', async () => { if (state.session) { await send({ action: 'pause', dramaId: state.session.dramaId, site: state.session.site }); render({ session: { ...state.session, status: 'paused' } }); } });
$('rebind').addEventListener('click', async () => { if (state.session) { const value = window.prompt('Conversation ID', state.session.conversationId || ''); if (value) { const response = await send({ action: 'rebind', dramaId: state.session.dramaId, site: state.session.site, session: { conversationId: value } }); if (response?.session) render({ session: response.session }); } } });
chrome.runtime.onMessage?.addListener((message) => { if (message?.type === 'STATE') render(message.state); });
send({ action: 'state', dramaId: state.dramaId, site: state.site }).then((response) => { if (response?.ok) render({ session: response.session }); });
