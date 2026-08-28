const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const launcherPath = path.join(projectRoot, 'start_chatgpt_browser.ps1');

function runLauncher() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aistory-chatgpt-launcher-'));
  const browserPath = path.join(tempRoot, 'fake-browser.cmd');
  const capturePath = path.join(tempRoot, 'arguments.txt');
  const profilePath = path.join(tempRoot, 'profile');
  fs.writeFileSync(browserPath, '@echo off\r\necho %* > "%CHATGPT_BROWSER_ARGS_CAPTURE%"\r\n');

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', launcherPath,
    '-BrowserPath', browserPath,
    '-ProfilePath', profilePath,
    '-RemoteDebuggingPort', '19447',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CHATGPT_BROWSER_ARGS_CAPTURE: capturePath },
    timeout: 15_000,
  });

  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 1_000;
  while (!fs.existsSync(capturePath) && Date.now() < deadline) {
    Atomics.wait(waitBuffer, 0, 0, 25);
  }
  const args = fs.existsSync(capturePath) ? fs.readFileSync(capturePath, 'utf8') : '';
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return { ...result, args };
}

test('launcher passes the Windows Chrome for Testing stability flags', { skip: process.platform !== 'win32' }, () => {
  const result = runLauncher();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.args, /--do-not-de-elevate/);
  assert.match(result.args, /--no-sandbox/);
});

test('launcher does not report success when the debugging port never becomes ready', { skip: process.platform !== 'win32' }, () => {
  const result = runLauncher();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /ChatGPT browser started with AIStory extension/);
  assert.match(`${result.stdout}\n${result.stderr}`, /failed to become ready/i);
});
