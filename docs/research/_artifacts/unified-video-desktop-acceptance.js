const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = __dirname;
const profile = path.join(process.env.TEMP, `unified-video-desktop-${process.pid}`);
const port = 9232;
const appUrl = process.env.UNIFIED_VIDEO_FRONTEND_URL || 'http://127.0.0.1:3013';
fs.mkdirSync(profile, { recursive: true });
const chromeProcess = execFile(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let version;
  for (let i = 0; i < 100; i += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) { version = await response.json(); break; } } catch (_) {}
    await sleep(100);
  }
  if (!version) throw new Error('Chrome CDP did not start');
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => { const message = JSON.parse(event.data); if (!message.id || !pending.has(message.id)) return; const callback = pending.get(message.id); pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result || {}); };
  const sendRoot = (method, params = {}) => new Promise((resolve, reject) => { const commandId = ++id; pending.set(commandId, { resolve, reject }); socket.send(JSON.stringify({ id: commandId, method, params })); });
  const target = await sendRoot('Target.createTarget', { url: 'about:blank' });
  const attached = await sendRoot('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const commandId = ++id; pending.set(commandId, { resolve, reject }); socket.send(JSON.stringify({ id: commandId, method, params, sessionId: attached.sessionId })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${appUrl}/film/3` });
  await sleep(8000);
  const initial = await send('Runtime.evaluate', { expression: `(() => ({ title: document.title, bodyText: document.body.innerText.slice(0, 3000), buttons: [...document.querySelectorAll('button')].map((button) => button.textContent.trim()).filter(Boolean).slice(0, 80), overflow: document.documentElement.scrollWidth > innerWidth }))()`, returnByValue: true });
  const clicked = await send('Runtime.evaluate', { expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => /打开视频生成|视频生成与候选/.test(item.textContent)); if (!button) return false; button.click(); return true; })()`, returnByValue: true });
  await sleep(2500);
  const panel = await send('Runtime.evaluate', { expression: `(() => { const node = document.querySelector('.video-generation-panel'); const rect = node?.getBoundingClientRect(); const text = node?.innerText || ''; return { visible: Boolean(node && rect.width > 0 && rect.height > 0), rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null, overflow: document.documentElement.scrollWidth > innerWidth, hasChineseActions: ['生成候选', '刷新', '质量检查'].every((label) => text.includes(label)), hasEnglishAction: /Generate candidates|Refresh candidates|Run quality checks/i.test(text), text: text.slice(0, 1600) }; })()`, returnByValue: true });
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(outDir, 'unified-video-desktop-acceptance.png'), Buffer.from(screenshot.data, 'base64'));
  const report = { url: `${appUrl}/film/3`, initial: initial.result.value, panel: panel.result.value, generationPanelClicked: Boolean(clicked.result.value), checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, 'unified-video-desktop-acceptance.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  socket.close(); chromeProcess.kill();
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); chromeProcess.kill(); process.exitCode = 1; });
