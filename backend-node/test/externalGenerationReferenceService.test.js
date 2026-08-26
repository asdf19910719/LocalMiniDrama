const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createExternalJob } = require('../src/services/externalGenerationService');
const { prepareReferencePackage, getReferenceFile } = require('../src/services/externalGenerationReferenceService');

describe('external generation reference packages', () => {
  let db;
  let root;
  let oldRoot;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-generation-test-'));
    oldRoot = process.env.EXTERNAL_GENERATION_PACKAGE_ROOT;
    process.env.EXTERNAL_GENERATION_PACKAGE_ROOT = root;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
    if (oldRoot === undefined) delete process.env.EXTERNAL_GENERATION_PACKAGE_ROOT;
    else process.env.EXTERNAL_GENERATION_PACKAGE_ROOT = oldRoot;
  });

  it('writes prompt, references, and a stable hashed manifest', () => {
    const job = createExternalJob(db, { dramaId: 3, site: 'jimeng', promptSnapshot: 'frozen prompt' });
    const result = prepareReferencePackage(db, job.id, [
      { assetId: 20, referenceRole: 'character', order: 1, fileName: 'character.png', content: Buffer.from('character') },
      { assetId: 10, referenceRole: 'scene', order: 0, fileName: 'scene.jpg', content: Buffer.from('scene') },
    ]);
    assert.equal(fs.readFileSync(getReferenceFile(db, job.id, 'prompt.txt'), 'utf8'), 'frozen prompt');
    const manifest = JSON.parse(fs.readFileSync(getReferenceFile(db, job.id, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.references.map((entry) => entry.asset_id), [10, 20]);
    assert.equal(result.manifestHash, db.prepare('SELECT reference_manifest_hash FROM external_generation_jobs WHERE id = ?').get(job.id).reference_manifest_hash);
    assert.equal(fs.readFileSync(getReferenceFile(db, job.id, manifest.references[0].path), 'utf8'), 'scene');
    assert.deepEqual(prepareReferencePackage(db, job.id, [
      { assetId: 20, referenceRole: 'character', order: 1, fileName: 'character.png', content: Buffer.from('character') },
      { assetId: 10, referenceRole: 'scene', order: 0, fileName: 'scene.jpg', content: Buffer.from('scene') },
    ]).manifest, manifest);
  });

  it('rejects traversal and changing an existing package', () => {
    const job = createExternalJob(db, { dramaId: 3, site: 'jimeng', promptSnapshot: 'prompt' });
    assert.throws(() => prepareReferencePackage(db, job.id, [{ fileName: '../escape.txt', content: 'bad' }]), /unsafe/i);
    prepareReferencePackage(db, job.id, [{ fileName: 'one.txt', content: 'one' }]);
    assert.throws(() => prepareReferencePackage(db, job.id, [{ fileName: 'one.txt', content: 'changed' }]), /immutable/i);
    assert.throws(() => getReferenceFile(db, job.id, '../manifest.json'), /unsafe/i);
  });

  it('resolves persisted storage-relative reference paths under the database storage root', () => {
    const dbFile = path.join(root, 'drama.db');
    db.close();
    db = new Database(dbFile);
    db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
    const storageFile = path.join(root, 'storage', 'projects', '3', 'reference.png');
    fs.mkdirSync(path.dirname(storageFile), { recursive: true });
    fs.writeFileSync(storageFile, Buffer.from('stored-reference'));
    const job = createExternalJob(db, { dramaId: 3, site: 'chatgpt', promptSnapshot: 'prompt' });
    const result = prepareReferencePackage(db, job.id, [{ fileName: 'reference.png', localPath: 'projects/3/reference.png' }]);
    assert.equal(fs.readFileSync(getReferenceFile(db, job.id, result.manifest.references[0].path), 'utf8'), 'stored-reference');
  });
});
