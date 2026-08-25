const test = require('node:test');
const assert = require('node:assert/strict');
const { safeJobFile, validateImage } = require('../src/fileValidation');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
test('rejects traversal and absolute paths', () => { assert.throws(() => safeJobFile('C:/jobs/a', '../x')); assert.throws(() => safeJobFile('C:/jobs/a', 'C:/x')); assert.equal(safeJobFile('C:/jobs/a', 'references/a.png'), path.resolve('C:/jobs/a/references/a.png')); });
test('validates png and returns stable hash and dimensions', async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-')); const file = path.join(dir, 'a.png'); const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000020806000000f4' + '78d4fa0000000a49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex'); await fs.writeFile(file, png); const result = await validateImage(file); assert.equal(result.width, 1); assert.equal(result.height, 2); assert.match(result.sha256, /^[a-f0-9]{64}$/); });
