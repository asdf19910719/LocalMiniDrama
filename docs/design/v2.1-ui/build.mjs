#!/usr/bin/env node
/**
 * V2.1 UI 设计稿构建脚本
 * 1) shared/head.html + screens/*.body.html + shared/foot.html -> out/*.html
 * 2) Chrome headless 截图 1440x900 -> out/png/*.png
 * 用法: node build.mjs [--shot-only] [screen-name ...]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHARED = join(ROOT, 'shared');
const SRC = join(ROOT, 'screens');
const OUT = join(ROOT, 'out');
const PNG = join(OUT, 'png');
mkdirSync(OUT, { recursive: true });
mkdirSync(PNG, { recursive: true });

const head = readFileSync(join(SHARED, 'head.html'), 'utf8');
const foot = readFileSync(join(SHARED, 'foot.html'), 'utf8');

const args = process.argv.slice(2);
const shotOnly = args.includes('--shot-only');
const only = args.filter((a) => !a.startsWith('--'));

const screens = readFileSync(join(SHARED, 'screens.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!CHROME) { console.error('未找到 Chrome/Edge'); process.exit(1); }

let fail = 0;
for (const name of screens) {
  if (only.length && !only.includes(name)) continue;
  const bodyPath = join(SRC, `${name}.body.html`);
  const html = head + '\n' + readFileSync(bodyPath, 'utf8') + '\n' + foot;
  const htmlPath = join(OUT, `${name}.html`);
  writeFileSync(htmlPath, html);

  if (shotOnly) { console.log(`skip-build ${name}`); continue; }
  const pngPath = join(PNG, `${name}.png`);
  const url = 'file:///' + htmlPath.replace(/\\/g, '/');
  const r = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--force-device-scale-factor=2',
    '--hide-scrollbars', '--window-size=1440,900', '--virtual-time-budget=4000',
    `--screenshot=${pngPath}`, url,
  ], { stdio: 'pipe' });
  const ok = r.status === 0 && existsSync(pngPath);
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name}.png`);
  if (!ok) { fail++; console.error(r.stderr?.toString().slice(0, 500)); }
}
process.exit(fail ? 1 : 0);
