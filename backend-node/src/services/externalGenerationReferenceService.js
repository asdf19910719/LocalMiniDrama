const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stableStringify, sha256 } = require('./externalGenerationService');

function packageRoot(db) {
  if (process.env.EXTERNAL_GENERATION_PACKAGE_ROOT) return path.resolve(process.env.EXTERNAL_GENERATION_PACKAGE_ROOT);
  if (process.env.EXTERNAL_GENERATION_STORAGE_ROOT) return path.resolve(process.env.EXTERNAL_GENERATION_STORAGE_ROOT);
  const dbName = typeof db.name === 'string' && db.name !== ':memory:' ? db.name : null;
  return path.resolve(dbName ? path.join(path.dirname(dbName), 'external-generation') : path.join(os.tmpdir(), 'localminidrama-external-generation'));
}

function jobRow(db, jobId) {
  const row = db.prepare('SELECT * FROM external_generation_jobs WHERE id = ?').get(jobId);
  if (!row) throw new Error(`External generation job not found: ${jobId}`);
  return row;
}

function referenceValue(reference, camel, snake, fallback = undefined) {
  if (reference && reference[camel] !== undefined) return reference[camel];
  if (reference && reference[snake] !== undefined) return reference[snake];
  return fallback;
}

function safeRelativeName(name) {
  const candidate = String(name || '').trim();
  if (!candidate || path.isAbsolute(candidate) || candidate.includes('\\') || candidate.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`Unsafe reference file name: ${name}`);
  }
  const normalized = path.posix.normalize(candidate);
  if (normalized !== candidate || normalized.startsWith('../') || normalized === '..') throw new Error(`Unsafe reference file name: ${name}`);
  return normalized;
}

function referenceBytes(db, reference) {
  const supplied = referenceValue(reference, 'content', 'content', referenceValue(reference, 'data', 'data'));
  if (Buffer.isBuffer(supplied)) return Buffer.from(supplied);
  if (typeof supplied === 'string') return Buffer.from(supplied, 'utf8');
  if (supplied instanceof Uint8Array || Array.isArray(supplied)) return Buffer.from(supplied);
  const source = referenceValue(reference, 'filePath', 'file_path', referenceValue(reference, 'localPath', 'local_path', referenceValue(reference, 'sourcePath', 'source_path', referenceValue(reference, 'path', 'path'))));
  let sourcePath = source;
  if (!sourcePath) {
    const assetId = referenceValue(reference, 'assetId', 'asset_id');
    if (assetId !== undefined && assetId !== null) {
      const asset = db.prepare('SELECT local_path, url FROM assets WHERE id = ?').get(assetId);
      sourcePath = asset?.local_path;
    }
  }
  if (!sourcePath) throw new Error('Reference content or local path is required');
  const resolved = path.resolve(String(sourcePath));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`Reference file not found: ${sourcePath}`);
  return fs.readFileSync(resolved);
}

function readExistingPackage(db, job) {
  if (!job.reference_package_path || !job.reference_manifest_json) return null;
  let manifest;
  try { manifest = JSON.parse(job.reference_manifest_json); } catch (_) { throw new Error(`Invalid reference manifest for job ${job.id}`); }
  const hash = sha256(stableStringify(manifest));
  if (job.reference_manifest_hash && hash !== job.reference_manifest_hash) throw new Error(`Reference manifest hash mismatch for job ${job.id}`);
  if (!fs.existsSync(path.join(job.reference_package_path, 'prompt.txt')) || !fs.existsSync(path.join(job.reference_package_path, 'manifest.json'))) {
    throw new Error(`Reference package is incomplete for job ${job.id}`);
  }
  return { job, manifest, manifestHash: hash, packagePath: job.reference_package_path };
}

function prepareReferencePackage(db, jobId, references = []) {
  const job = jobRow(db, jobId);
  if (!Array.isArray(references)) throw new Error('references must be an array');
  const existing = readExistingPackage(db, job);
  if (existing) {
    // A Job's package is immutable. Re-preparing with equivalent input is idempotent.
    const candidate = buildManifestOnly(db, job, references);
    if (sha256(stableStringify(candidate.manifest)) !== existing.manifestHash) throw new Error(`Reference package is immutable for job ${job.id}`);
    return existing;
  }

  const root = packageRoot(db);
  const target = path.resolve(root, String(job.id));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid reference package path');
  if (fs.existsSync(target)) throw new Error(`Reference package already exists for job ${job.id}`);
  const built = buildManifestOnly(db, job, references);
  fs.mkdirSync(path.join(target, 'references'), { recursive: true });
  try {
    fs.writeFileSync(path.join(target, 'prompt.txt'), Buffer.from(job.prompt_snapshot, 'utf8'), { flag: 'wx' });
    for (const entry of built.entries) {
      const output = path.resolve(target, entry.path);
      if (!output.startsWith(`${target}${path.sep}`)) throw new Error(`Unsafe reference path: ${entry.path}`);
      fs.writeFileSync(output, entry.bytes, { flag: 'wx' });
    }
    fs.writeFileSync(path.join(target, 'manifest.json'), stableStringify(built.manifest), { flag: 'wx' });
    const manifestJson = stableStringify(built.manifest);
    const manifestHash = sha256(manifestJson);
    db.prepare(`UPDATE external_generation_jobs
      SET reference_manifest_hash = ?, reference_manifest_json = ?, reference_package_path = ?, updated_at = ?
      WHERE id = ?`).run(manifestHash, manifestJson, target, new Date().toISOString(), job.id);
    return { job: jobRow(db, job.id), manifest: built.manifest, manifestHash, packagePath: target };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function buildManifestOnly(db, job, references) {
  const entries = references.map((reference, index) => {
    const bytes = referenceBytes(db, reference);
    const assetId = referenceValue(reference, 'assetId', 'asset_id', null);
    const role = String(referenceValue(reference, 'referenceRole', 'reference_role', referenceValue(reference, 'role', 'role', 'reference')) || 'reference');
    const order = Number(referenceValue(reference, 'order', 'order', referenceValue(reference, 'index', 'index', index)));
    if (!Number.isInteger(order) || order < 0) throw new Error(`Invalid reference order: ${order}`);
    const sourceName = referenceValue(reference, 'fileName', 'file_name', referenceValue(reference, 'name', 'name'));
    const defaultName = sourceName || `${String(order).padStart(4, '0')}-${assetId == null ? index : assetId}`;
    // Validate the caller's name before deriving the package path; basename() would hide ../ traversal.
    if (String(defaultName).includes('/')) throw new Error(`Unsafe reference file name: ${defaultName}`);
    const fileName = safeRelativeName(String(defaultName));
    const relativePath = `references/${String(order).padStart(4, '0')}-${fileName}`;
    return {
      bytes,
      order,
      inputIndex: index,
      path: relativePath,
      manifestEntry: {
        asset_id: assetId,
        reference_role: role,
        order,
        file_name: fileName,
        path: relativePath,
        size: bytes.length,
        sha256: sha256(bytes),
      },
    };
  }).sort((a, b) => a.order - b.order || a.inputIndex - b.inputIndex);
  const manifest = { version: 1, job_id: job.id, references: entries.map((entry) => entry.manifestEntry) };
  return { entries, manifest };
}

function getReferenceFile(db, jobId, fileName) {
  const job = jobRow(db, jobId);
  const relative = safeRelativeName(fileName);
  if (relative !== 'prompt.txt' && relative !== 'manifest.json' && !relative.startsWith('references/')) throw new Error(`Reference file is not exposed: ${fileName}`);
  const root = path.resolve(job.reference_package_path || path.join(packageRoot(db), String(job.id)));
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`Reference file not found: ${fileName}`);
  return target;
}

module.exports = {
  prepareReferencePackage,
  getReferenceFile,
  safeRelativeName,
};
