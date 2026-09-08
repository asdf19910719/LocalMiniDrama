const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const sourcePath = path.join(root, '业务整理', 'RunningHub真实风格提示词与模型映射.json');
const outputPath = path.join(__dirname, '..', 'src', 'catalog', 'stylePresets.v1.json');
const businessExportPath = path.join(root, '业务整理', 'LocalMiniDrama风格目录v1.json');

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const fallbackColors = {
  realistic: 'linear-gradient(135deg,#725c45,#24313e)',
  '3d-special': 'linear-gradient(135deg,#593f82,#1d3152)',
  '2d': 'linear-gradient(135deg,#9d5e78,#30346b)',
};

function titleFromKey(key) {
  return String(key).split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
}

function englishPrompt(name, category, key) {
  const lead = category === 'realistic'
    ? `Create a ${name} live-action cinematic look with physically believable people, environments, materials, and camera behavior.`
    : category === '3d-special'
      ? `Render the world in a distinctive ${name} three-dimensional visual style with coherent character design, materials, lighting, and spatial depth.`
      : `Illustrate the world in a distinctive ${name} two-dimensional visual style with coherent line work, shapes, color design, and expressive staging.`;
  return `${lead} Treat “${key}” as a complete art direction, not a loose tag. Carry the same visual language through faces, costumes, props, architecture, atmosphere, color palette, key light, fill light, rim light, lens choice, depth of field, composition, texture, and motion-ready staging. Preserve character identity and production continuity across every reusable short-film asset. Use intentional detail, clean silhouettes, readable focal hierarchy, natural spatial relationships, and high production quality. Avoid malformed anatomy, duplicated body parts, inconsistent facial identity, unreadable text, logos, watermarks, low resolution, and accidental style mixing.`;
}

function hasEnglishInstruction(value) {
  const text = String(value || '');
  const englishWords = text.match(/[A-Za-z]{3,}/g) || [];
  const chineseChars = text.match(/[\u3400-\u9fff]/g) || [];
  return englishWords.length >= 8 && englishWords.length * 3 > chineseChars.length;
}

function parseKeywords(raw) {
  let value = {};
  try { value = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch (_) {}
  const read = (name) => Array.isArray(value[name]) ? value[name].map(String).filter(Boolean) : [];
  return {
    color: read('colorKeywords'),
    lighting: read('lightingKeywords'),
    material: read('materialKeywords'),
    camera: read('cameraKeywords'),
    environment: read('environmentKeywords'),
    quality: read('qualityKeywords'),
    negative: read('negativeKeywords'),
  };
}

const styles = source.groups.flatMap((group) => group.styles.map((item) => {
  const labelEn = item.labelEn || titleFromKey(item.key);
  return {
    id: `rh-${item.id}-${item.key}`,
    key: item.key,
    type: 'system',
    version: 1,
    enabled: true,
    source: 'runninghub-research',
    runningHubId: String(item.id),
    category: group.key,
    sortOrder: Number(group.sortOrder || 0) * 1000 + Number(item.sortOrder || 0),
    labelZh: item.label,
    labelEn,
    descriptionZh: item.prompt,
    promptZh: item.prompt,
    promptEn: hasEnglishInstruction(item.promptEn) ? item.promptEn : englishPrompt(labelEn, group.key, item.key),
    keywords: parseKeywords(item.styleKeywords),
    suitableAssetTypes: ['character', 'character_variant', 'scene', 'prop', 'storyboard', 'video'],
    recommendedCapabilities: {
      renderType: group.key === 'realistic' ? 'realistic' : group.key === '3d-special' ? '3d' : '2d',
      supportsTextToImage: true,
      supportsImageToImage: true,
      characterConsistency: 'recommended',
      multiReference: 'recommended',
      preferredPromptLanguage: 'auto',
      runningHubTextToImageModelKey: item.t2iModelKey || null,
      runningHubImageToImageModelKey: item.i2iModelKey || null,
    },
    preview: {
      localPath: `/style-thumbs/runninghub/${item.id}-${item.key}.webp`,
      fallbackColor: fallbackColors[group.key],
    },
  };
}));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const catalog = { schemaVersion: 1, sourceExportedAt: source.exportedAt, styles };
fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
fs.writeFileSync(businessExportPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${styles.length} styles to ${outputPath}`);
console.log(`Wrote business export to ${businessExportPath}`);
