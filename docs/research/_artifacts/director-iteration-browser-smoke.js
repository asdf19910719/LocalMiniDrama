const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.resolve(__dirname);
const profile = path.join(process.env.TEMP, `director-iteration-cdp-${process.pid}`);
const port = 9231;
const appUrl = process.env.DIRECTOR_FRONTEND_URL || 'http://127.0.0.1:3014';
fs.mkdirSync(profile, { recursive: true });

const chromeProcess = execFile(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function connect() {
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
  return { socket, send };
}

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${appUrl}/drama/1/canvas` });
  await sleep(7000);
  const click = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Timeline'); if (!button) return false; button.click(); return true; })()`,
    returnByValue: true,
  });
  await sleep(3000);

  async function capture(name, width, height, mobile) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await sleep(1000);
    const metrics = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const panel = document.querySelector('.director-timeline-panel');
        const rect = panel?.getBoundingClientRect();
        const bodyText = document.body.innerText;
        return {
          title: document.title,
          panelVisible: Boolean(panel && rect.width > 0 && rect.height > 0),
          panelRect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
          viewport: { width: innerWidth, height: innerHeight },
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          hasTimelineText: bodyText.includes('Assemble selected shots'),
          hasRuntimeError: /TypeError|ReferenceError|Internal Server Error/.test(bodyText),
          bodyPreview: bodyText.slice(0, 500)
        };
      })()`,
      returnByValue: true,
    });
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(screenshot.data, 'base64'));
    return metrics.result.value;
  }

  const report = {
    url: `${appUrl}/drama/1/canvas`,
    timelineClicked: Boolean(click.result.value),
    desktop: await capture('director-iteration-desktop.png', 1440, 1000, false),
    mobile: await capture('director-iteration-mobile.png', 390, 844, true),
    checkedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'director-iteration-browser-smoke.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  cdp.socket.close();
  chromeProcess.kill();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  chromeProcess.kill();
  process.exitCode = 1;
});
