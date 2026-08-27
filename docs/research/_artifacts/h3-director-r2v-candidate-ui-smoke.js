const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.resolve(__dirname);
const profile = path.join(process.env.TEMP, `h3-r2v-candidate-ui-${process.pid}`);
const port = 9233;
const appUrl = process.env.H3_DIRECTOR_FRONTEND_URL || 'http://127.0.0.1:3013';
fs.mkdirSync(profile, { recursive: true });
const chromeProcess = execFile(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let version;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) { version = await response.json(); break; }
    } catch (_) {}
    await sleep(100);
  }
  if (!version) throw new Error('Chrome CDP did not start');
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result || {});
  };
  const sendRoot = (method, params = {}) => new Promise((resolve, reject) => {
    const commandId = ++id;
    pending.set(commandId, { resolve, reject });
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
  const target = await sendRoot('Target.createTarget', { url: 'about:blank' });
  const attached = await sendRoot('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const commandId = ++id;
    pending.set(commandId, { resolve, reject });
    socket.send(JSON.stringify({ id: commandId, method, params, sessionId: attached.sessionId }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${appUrl}/film/3` });
  await sleep(7000);

  const openPanel = await send('Runtime.evaluate', {
    expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => /打开视频生成|视频生成与候选/.test(item.textContent)); if (!button) return false; button.click(); return true; })()`,
    returnByValue: true,
  });
  await sleep(2500);

  const before = await send('Runtime.evaluate', {
    expression: `(() => { const panel = document.querySelector('.video-generation-panel'); const text = panel?.innerText || ''; const button = [...(panel?.querySelectorAll('button') || [])].find((item) => item.textContent.includes('生成候选')); return { panelVisible: Boolean(panel), config: text.includes('minimax_h3_director_r2v'), sage: text.includes('Sage'), continuityDisabled: text.includes('不使用连续性'), buttonFound: Boolean(button), buttonDisabled: Boolean(button?.disabled), text: text.slice(0, 900) }; })()`,
    returnByValue: true,
  });
  const clicked = await send('Runtime.evaluate', {
    expression: `(() => { const panel = document.querySelector('.video-generation-panel'); const button = [...(panel?.querySelectorAll('button') || [])].find((item) => item.textContent.includes('生成候选')); if (!button || button.disabled) return false; button.click(); return true; })()`,
    returnByValue: true,
  });
  const states = [];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await sleep(2500);
    const snapshot = await send('Runtime.evaluate', {
      expression: `(() => { const panel = document.querySelector('.video-generation-panel'); const text = panel?.innerText || ''; return { text: text.slice(-1400), hasError: /API-format|adapter requires|ADAPTER_INPUT_INVALID|Internal Server Error|生成失败/.test(text), generating: /生成中|排队|运行中/.test(text), review: text.includes('待审核'), selectedTask: (text.match(/任务：\\d+/g) || []).slice(0, 3), buttons: [...(panel?.querySelectorAll('button') || [])].map((item) => item.textContent.trim()).filter(Boolean).slice(-12) }; })()`,
      returnByValue: true,
    });
    states.push({ atMs: (attempt + 1) * 2500, ...snapshot.result.value });
    if (snapshot.result.value.review && !snapshot.result.value.generating) break;
  }
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(outDir, 'h3-director-r2v-candidate-ui-smoke.png'), Buffer.from(screenshot.data, 'base64'));
  const report = { url: `${appUrl}/film/3`, openPanelClicked: Boolean(openPanel.result.value), before: before.result.value, clicked: Boolean(clicked.result.value), states, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, 'h3-director-r2v-candidate-ui-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  socket.close();
  chromeProcess.kill();
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); chromeProcess.kill(); process.exitCode = 1; });
