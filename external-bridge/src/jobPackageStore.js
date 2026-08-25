const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { safeJobFile, validateImage } = require('./fileValidation');

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
class JobPackageStore {
  constructor(rootDir) { this.rootDir = path.resolve(rootDir); }
  jobDir(jobId) { if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new Error('invalid job id'); return path.join(this.rootDir, jobId); }
  async create(jobId, input = {}) {
    const dir = this.jobDir(jobId); const refs = Array.isArray(input.references) ? input.references : [];
    await fs.mkdir(path.join(dir, 'references'), { recursive: true });
    const prompt = String(input.prompt || ''); await fs.writeFile(path.join(dir, 'prompt.txt'), prompt, 'utf8');
    const manifestRefs = [];
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]; const name = `${String(i + 1).padStart(2, '0')}-${path.basename(ref.fileName || ref.name || 'reference.png')}`;
      const target = safeJobFile(dir, `references/${name}`); const bytes = ref.bytes || await fs.readFile(ref.path);
      await fs.writeFile(target, bytes); const info = await validateImage(target);
      manifestRefs.push({ assetId: ref.assetId || null, role: ref.role || 'reference', order: i, fileName: name, bytes: info.bytes, sha256: info.sha256, width: info.width, height: info.height });
    }
    const manifest = { version: 1, jobId, promptSha256: hash(prompt), references: manifestRefs };
    manifest.sha256 = hash(stable(manifest));
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  }
  async manifest(jobId) { try { return JSON.parse(await fs.readFile(path.join(this.jobDir(jobId), 'manifest.json'), 'utf8')); } catch { throw new Error('manifest not found'); } }
  async readReference(jobId, fileName) { const dir = this.jobDir(jobId); const target = safeJobFile(dir, `references/${fileName}`); if (path.dirname(target) !== path.join(dir, 'references')) throw new Error('invalid reference name'); return fs.readFile(target); }
}
module.exports = { JobPackageStore, stable, hash };
