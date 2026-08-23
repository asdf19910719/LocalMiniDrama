const crypto = require('node:crypto');
const fs = require('node:fs');

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = sortValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function hashFile(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Artifact path is not a file: ${filePath}`);
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return { sha256: hash.digest('hex'), fileSize: stat.size };
}

function createArtifactManifest({
  artifactPath,
  parentArtifactId = null,
  kind = 'video',
  ffprobe = null,
  metadata = {},
  now = new Date().toISOString(),
}) {
  const file = hashFile(artifactPath);
  const manifest = {
    artifactPath,
    fileSize: file.fileSize,
    sha256: file.sha256,
    ffprobe,
    parentArtifactId,
    kind,
    metadata,
    createdAt: now,
  };
  return {
    ...file,
    ffprobe,
    manifest,
    manifestJson: canonicalJson(manifest),
  };
}

module.exports = { canonicalJson, hashFile, createArtifactManifest };
