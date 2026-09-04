const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertAllowedLocalPath } = require('../../director/directorGovernance');

// ComfyUI input names are content-addressed, so concurrent jobs can share a file.
// Keep a process-local reference count and remove it only after the last owner exits.
const stagedReferenceCounts = new Map();

function safeName(source, sha256, index) {
  const ext = path.extname(String(source || '')).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8) || '.bin';
  return `reference-${index}-${sha256.slice(0, 24)}${ext}`;
}

function sourcePath(value) {
  const item = typeof value === 'object' ? value : { source: value };
  return String(item.source || item.imageFile || item.image_file || item.localPath || item.local_path
    || item.url || item.imageUrl || item.image_url || '').trim();
}

async function stageReferenceAssets(references, {
  allowedRoots = [],
  inputDir = null,
  client = null,
  remote = false,
  remoteKey = '',
  copyFile = fs.copyFileSync,
  uploadImage = client?.uploadImage,
  minReferences = 1,
  maxReferences = 9,
} = {}) {
  const list = Array.isArray(references) ? references : [];
  if (list.length < Number(minReferences) || list.length > Number(maxReferences)) {
    throw new Error('VIDEO_REFERENCE_COUNT_INVALID');
  }
  const staged = [];
  try {
    for (let index = 0; index < list.length; index += 1) {
      const item = typeof list[index] === 'object' ? list[index] : { source: list[index] };
      const source = sourcePath(item);
      if (!source || /^https?:\/\//i.test(source)) throw new Error('VIDEO_REFERENCE_SOURCE_NOT_LOCAL');
      const resolved = assertAllowedLocalPath(source, allowedRoots, { mustExist: true, kind: 'file' });
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
      const filename = safeName(resolved, sha256, index);
      let comfyFilename = filename;
      if (remote) {
        if (typeof uploadImage !== 'function') throw new Error('COMFYUI_IMAGE_UPLOAD_UNAVAILABLE');
        const result = await uploadImage({ filePath: resolved, filename });
        comfyFilename = String(result?.name || result?.filename || filename).replace(/[\\/]/g, '');
        if (!comfyFilename) throw new Error('COMFYUI_IMAGE_UPLOAD_INVALID');
      } else {
        if (!inputDir) throw new Error('COMFYUI_INPUT_DIR_REQUIRED');
        fs.mkdirSync(inputDir, { recursive: true });
        copyFile(resolved, path.join(inputDir, filename));
      }
      staged.push({ source, comfyFilename, sha256, role: String(item.role || 'reference'), index });
      const key = `${remote ? `remote:${String(remoteKey || 'default').trim()}` : path.resolve(inputDir)}:${comfyFilename}`;
      stagedReferenceCounts.set(key, (stagedReferenceCounts.get(key) || 0) + 1);
      staged[staged.length - 1].cleanupKey = key;
    }
  } catch (error) {
    await cleanupReferenceAssets(staged, { inputDir, client, remote, log: console });
    throw error;
  }
  return staged;
}

async function cleanupReferenceAssets(staged, {
  inputDir,
  remote = !inputDir,
  remoteKey = '',
  client = null,
  referenced = new Set(),
  unlink = fs.unlinkSync,
  log = console,
} = {}) {
  for (const item of Array.isArray(staged) ? staged : []) {
    if (!item?.comfyFilename || referenced.has(item.comfyFilename)) continue;
    const key = item.cleanupKey || `${remote ? `remote:${String(remoteKey || 'default').trim()}` : path.resolve(inputDir)}:${item.comfyFilename}`;
    const remaining = Math.max(0, (stagedReferenceCounts.get(key) || 1) - 1);
    if (remaining) {
      stagedReferenceCounts.set(key, remaining);
      continue;
    }
    stagedReferenceCounts.delete(key);
    try {
      if (remote) {
        if (typeof client?.deleteImage === 'function') await client.deleteImage(item.comfyFilename);
        else log.warn?.('Remote ComfyUI reference cleanup unavailable', { file: item.comfyFilename });
        continue;
      }
      if (!inputDir) continue;
      const target = path.join(inputDir, path.basename(item.comfyFilename));
      if (fs.existsSync(target)) unlink(target);
    } catch (error) {
      log.warn?.('Reference asset cleanup failed', { file: item.comfyFilename, error: error.message });
    }
  }
}

module.exports = { stageReferenceAssets, cleanupReferenceAssets, safeName };
