import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(extensionRoot, 'src/sites/chatgpt/content.js')],
  outfile: path.join(extensionRoot, 'src/sites/chatgpt/content.bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
});
