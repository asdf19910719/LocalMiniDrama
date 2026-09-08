const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const backendRoot = path.join(__dirname, '..');
const workspaceRoot = path.join(backendRoot, '..');
const catalogPath = path.join(backendRoot, 'src', 'catalog', 'stylePresets.v1.json');
const manifestPath = path.join(backendRoot, 'src', 'catalog', 'stylePreviewManifest.v1.json');
const outputRoot = path.resolve(workspaceRoot, 'frontweb', 'public', 'style-thumbs', 'runninghub');
const screenshotPath = path.join(workspaceRoot, 'docs', 'research', '_artifacts', 'runninghub-survey-2026-09-08', '01-画风库-预设画风面板.png');
const sourceMapPath = process.argv[2] ? path.resolve(process.argv[2]) : null;

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const sourceMap = sourceMapPath && fs.existsSync(sourceMapPath) ? JSON.parse(fs.readFileSync(sourceMapPath, 'utf8')) : {};
const screenshotCards = [
  ['电影超写实', 50, 162], ['黑白电影', 349, 162], ['复古胶片', 649, 162], ['赛博朋克', 949, 162],
  ['蒸汽朋克', 50, 346], ['失焦美学', 349, 346], ['纪录片写实风', 649, 346], ['北欧冷淡写实风', 949, 346],
  ['巴洛克油画风格', 50, 530], ['紫色色调电影风格', 349, 530], ['好莱坞黑白电影风格', 649, 530], ['美式复古影视风格', 949, 530],
];
const screenshotByLabel = new Map(screenshotCards.map(([label, left, top]) => [label, { left, top, width: 282, height: 167 }]));

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

function fallbackSvg(style) {
  const colors = style.category === 'realistic' ? ['#725c45', '#24313e'] : style.category === '3d-special' ? ['#593f82', '#1d3152'] : ['#9d5e78', '#30346b'];
  const label = style.labelZh.replace(/[<>&"']/g, '');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="384"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="640" height="384" rx="28" fill="url(#g)"/><circle cx="520" cy="80" r="110" fill="#fff" opacity=".08"/><path d="M0 310 C120 220 210 360 340 250 S560 210 640 290 V384 H0Z" fill="#000" opacity=".22"/><text x="40" y="315" fill="#fff" font-size="34" font-family="Microsoft YaHei, sans-serif" font-weight="700">${label}</text><text x="42" y="350" fill="#fff" opacity=".72" font-size="18" font-family="Arial, sans-serif">${style.labelEn}</text></svg>`);
}

async function buildEntry(style) {
  const filePath = ensureInsideOutput(path.join(outputRoot, `${style.runningHubId}-${style.key}.webp`));
  let pipeline;
  let sourceUrl = null;
  let status = 'fallback';

  const remoteUrl = sourceMap[style.runningHubId] || sourceMap[style.id];
  if (remoteUrl) {
    pipeline = sharp(await download(remoteUrl));
    sourceUrl = remoteUrl;
    status = 'runninghub-api';
  } else if (fs.existsSync(screenshotPath) && screenshotByLabel.has(style.labelZh)) {
    pipeline = sharp(screenshotPath).extract(screenshotByLabel.get(style.labelZh));
    sourceUrl = 'docs/research/_artifacts/runninghub-survey-2026-09-08/01-画风库-预设画风面板.png';
    status = 'runninghub-screenshot';
  } else {
    pipeline = sharp(fallbackSvg(style));
  }

  await pipeline.resize(640, 384, { fit: 'cover' }).webp({ quality: 82 }).toFile(filePath);
  const bytes = fs.readFileSync(filePath);
  const metadata = await sharp(bytes).metadata();
  return {
    runningHubId: style.runningHubId,
    styleId: style.id,
    sourceUrl,
    localPath: style.preview.localPath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    width: metadata.width,
    height: metadata.height,
    collectedAt: new Date().toISOString(),
    status,
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
