import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('manifest injects the workbench bridge on localhost workbench pages', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const matches = manifest.content_scripts.flatMap((entry) => entry.matches || []);
  assert.ok(matches.includes('http://127.0.0.1:3013/*'));
  assert.ok(matches.includes('http://localhost:3013/*'));
  assert.ok(manifest.content_scripts.some((entry) => entry.js.includes('src/workbench/content.js')));
});
