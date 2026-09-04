const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stageReferenceAssets, safeName, cleanupReferenceAssets } = require('../src/services/videoProviders/referenceAssetStaging');
const { loadConfig } = require('../src/config');

describe('reference asset staging', () => {
  test('copies allowlisted local refs using hash-derived path-free names', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-stage-'));
    const input = path.join(root, 'storage');
    const out = path.join(root, 'comfy-input');
    fs.mkdirSync(input); fs.writeFileSync(path.join(input, 'my ref.png'), 'image-data');
    const result = await stageReferenceAssets([{ source: path.join(input, 'my ref.png'), role: 'subject' }], { allowedRoots: [input], inputDir: out });
    assert.equal(result.length, 1);
    assert.match(result[0].comfyFilename, /^reference-0-[a-f0-9]{24}\.png$/);
    assert.equal(fs.existsSync(path.join(out, result[0].comfyFilename)), true);
    cleanupReferenceAssets(result, { inputDir: out });
    assert.equal(fs.existsSync(path.join(out, result[0].comfyFilename)), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('prefers local input copies even when a client exposes uploadImage', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-stage-'));
    const input = path.join(root, 'storage');
    const out = path.join(root, 'comfy-input');
    fs.mkdirSync(input); fs.writeFileSync(path.join(input, 'ref.png'), 'image-data');
    let uploads = 0;
    const result = await stageReferenceAssets([{ source: path.join(input, 'ref.png') }], {
      allowedRoots: [input], inputDir: out, client: { uploadImage: async () => { uploads += 1; } },
    });
    assert.equal(uploads, 0);
    assert.equal(fs.existsSync(path.join(out, result[0].comfyFilename)), true);
    await cleanupReferenceAssets(result, { inputDir: out });
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('keeps a shared staged file until all owners are cleaned up', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-stage-'));
    const input = path.join(root, 'storage');
    const out = path.join(root, 'comfy-input');
    fs.mkdirSync(input); fs.writeFileSync(path.join(input, 'ref.png'), 'image-data');
    const source = path.join(input, 'ref.png');
    const first = await stageReferenceAssets([{ source }], { allowedRoots: [input], inputDir: out });
    const second = await stageReferenceAssets([{ source }], { allowedRoots: [input], inputDir: out });
    await cleanupReferenceAssets(first, { inputDir: out });
    assert.equal(fs.existsSync(path.join(out, first[0].comfyFilename)), true);
    await cleanupReferenceAssets(second, { inputDir: out });
    assert.equal(fs.existsSync(path.join(out, first[0].comfyFilename)), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('cleans uploaded remote refs through the client hook', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-stage-'));
    const input = path.join(root, 'storage');
    fs.mkdirSync(input); fs.writeFileSync(path.join(input, 'ref.png'), 'image-data');
    const deleted = [];
    const result = await stageReferenceAssets([{ source: path.join(input, 'ref.png') }], {
      allowedRoots: [input], remote: true,
      uploadImage: async ({ filename }) => ({ name: filename }),
    });
    await cleanupReferenceAssets(result, { remote: true, client: { deleteImage: async (name) => deleted.push(name) } });
    assert.deepEqual(deleted, [result[0].comfyFilename]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('rejects traversal and remote URLs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-stage-'));
    const allowed = path.join(root, 'allowed'); fs.mkdirSync(allowed); fs.writeFileSync(path.join(allowed, 'ok.png'), 'x');
    await assert.rejects(() => stageReferenceAssets([{ source: path.join(root, 'outside.png') }], { allowedRoots: [allowed], inputDir: path.join(root, 'out') }), /outside|does not exist|roots/);
    await assert.rejects(() => stageReferenceAssets([{ source: 'https://example.test/a.png' }], { allowedRoots: [allowed], inputDir: path.join(root, 'out') }), /NOT_LOCAL/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('stages downloaded external-web images with the project director allowlist', async () => {
    const externalRoot = path.resolve('data', 'external-web');
    fs.mkdirSync(externalRoot, { recursive: true });
    const sourceDir = fs.mkdtempSync(path.join(externalRoot, 'staging-test-'));
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-stage-out-'));
    const source = path.join(sourceDir, 'original.png');
    fs.writeFileSync(source, 'downloaded-image');
    try {
      const allowedRoots = loadConfig().director.allowed_local_roots.map((root) => path.resolve(root));
      const staged = await stageReferenceAssets([{ source }], { allowedRoots, inputDir: outputDir });
      assert.equal(staged.length, 1);
      assert.equal(fs.existsSync(path.join(outputDir, staged[0].comfyFilename)), true);
      await cleanupReferenceAssets(staged, { inputDir: outputDir });
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
