const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const backendRoot = path.join(__dirname, '..');
const workspaceRoot = path.join(backendRoot, '..');
const catalogPath = path.join(backendRoot, 'src', 'catalog', 'stylePresets.v1.json');
const manifestPath = path.join(backendRoot, 'src', 'catalog', 'stylePreviewManifest.v1.json');
const outputRoot = path.resolve(workspaceRoot, 'frontweb', 'public', 'style-thumbs', 'runninghub');
const sourceMapPath = process.argv[2] ? path.resolve(process.argv[2]) : null;

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (!sourceMapPath || !fs.existsSync(sourceMapPath)) {
  throw new Error('A complete authenticated RunningHub style source map is required');
}
const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));

function ensureInsideOutput(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(outputRoot + path.sep)) throw new Error(`Unsafe preview output path: ${resolved}`);
  return resolved;
}

async function download(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Preview source must use HTTPS');
  const response = await fetch(parsed, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Preview download failed: HTTP ${response.status}`);
  const mime = response.headers.get('content-type') || '';
  if (!mime.startsWith('image/')) throw new Error(`Preview is not an image: ${mime}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 256 || bytes.length > 20 * 1024 * 1024) throw new Error(`Preview size is invalid: ${bytes.length}`);
  return bytes;
}

function sanitizeSourceUrl(remoteUrl) {
  const url = new URL(remoteUrl);
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function buildEntry(style) {
  const filePath = ensureInsideOutput(path.join(outputRoot, `${style.runningHubId}-${style.key}.webp`));
  const remoteUrl = sourceMap[style.runningHubId] || sourceMap[style.id];
  if (!remoteUrl) throw new Error(`Missing authenticated preview URL for ${style.runningHubId} (${style.labelZh})`);

  await sharp(await download(remoteUrl)).resize(640, 384, { fit: 'cover' }).webp({ quality: 82 }).toFile(filePath);
  const bytes = fs.readFileSync(filePath);
  const metadata = await sharp(bytes).metadata();
  return {
    runningHubId: style.runningHubId,
    styleId: style.id,
    sourceUrl: sanitizeSourceUrl(remoteUrl),
    localPath: style.preview.localPath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    width: metadata.width,
    height: metadata.height,
    collectedAt: new Date().toISOString(),
    status: 'runninghub-authenticated-page',
  };
}

(async () => {
  fs.mkdirSync(outputRoot, { recursive: true });
  const entries = [];
  for (const style of catalog.styles) entries.push(await buildEntry(style));
  fs.writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`);
  const counts = entries.reduce((acc, entry) => ({ ...acc, [entry.status]: (acc[entry.status] || 0) + 1 }), {});
  console.log(`Localized ${entries.length} previews: ${JSON.stringify(counts)}`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
