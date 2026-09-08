const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const catalog = require('../src/catalog/stylePresets.v1.json');
const manifest = require('../src/catalog/stylePreviewManifest.v1.json');

const publicRoot = path.resolve(__dirname, '..', '..', 'frontweb', 'public');

test('preview manifest accounts for every catalog style with verified local files', () => {
  assert.equal(manifest.entries.length, 169);
  assert.equal(new Set(manifest.entries.map((entry) => entry.styleId)).size, 169);
  assert.deepEqual(new Set(manifest.entries.map((entry) => entry.styleId)), new Set(catalog.styles.map((style) => style.id)));

  for (const entry of manifest.entries) {
    assert.ok(['runninghub-api', 'runninghub-screenshot', 'fallback'].includes(entry.status));
    assert.match(entry.localPath, /^\/style-thumbs\/runninghub\/[a-zA-Z0-9-]+\.webp$/);
    const absolute = path.resolve(publicRoot, entry.localPath.slice(1));
    assert.ok(absolute.startsWith(path.join(publicRoot, 'style-thumbs', 'runninghub') + path.sep));
    assert.ok(fs.existsSync(absolute), `${entry.styleId} preview is missing`);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    assert.equal(hash, entry.sha256);
    assert.ok(entry.width > 0 && entry.height > 0);
    if (entry.status === 'runninghub-api') assert.match(entry.sourceUrl, /^https:\/\//);
  }
});

test('runtime catalog uses local preview paths only', () => {
  for (const style of catalog.styles) {
    assert.match(style.preview.localPath, /^\/style-thumbs\/runninghub\//);
    assert.doesNotMatch(style.preview.localPath, /^https?:/);
  }
});
