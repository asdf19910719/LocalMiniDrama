const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
function safeJobFile(jobRoot, fileName) {
  if (typeof fileName !== 'string' || !fileName || fileName.includes('\\') || path.posix.isAbsolute(fileName)) throw new Error('invalid file name');
  const root = path.resolve(jobRoot);
  const target = path.resolve(root, fileName);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('path traversal is not allowed');
  return target;
}
async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}
async function validateImage(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) throw new Error('unsupported image type');
  const bytes = await fs.readFile(filePath);
  let metadata;
  try {
    const sharp = require('sharp');
    metadata = await sharp(bytes).metadata();
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') metadata = basicMetadata(bytes, ext);
    else throw new Error(`invalid image: ${error.message}`);
  }
  if (!metadata || !metadata.width || !metadata.height) throw new Error('invalid image');
  if (options.maxBytes && bytes.length > options.maxBytes) throw new Error('image is too large');
  if (options.minWidth && metadata.width < options.minWidth) throw new Error('image is too small');
  return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: metadata.width, height: metadata.height, format: metadata.format || ext.slice(1) };
}
function basicMetadata(bytes, ext) {
  if (ext === '.png' && bytes.length > 24 && bytes.toString('ascii', 1, 4) === 'PNG') return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' };
  if ((ext === '.jpg' || ext === '.jpeg') && bytes[0] === 0xff && bytes[1] === 0xd8) return { width: 1, height: 1, format: 'jpeg' };
  if (ext === '.webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { width: 1, height: 1, format: 'webp' };
  throw new Error('invalid image');
}
module.exports = { safeJobFile, sha256File, validateImage };
