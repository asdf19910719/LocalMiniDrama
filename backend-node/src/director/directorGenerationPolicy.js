const crypto = require('node:crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function createGenerationCacheKey(input) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');
}

function estimatePeakVramMb({ width = 864, height = 480 } = {}) {
  const pixels = Math.max(1, Number(width) * Number(height));
  const previewPixels = 864 * 480;
  const masterPixels = 1920 * 1080;
  const ratio = Math.min(1, Math.max(0, (pixels - previewPixels) / (masterPixels - previewPixels)));
  return Math.round(13300 + ratio * (15750 - 13300));
}

function validateH3Dimensions({ width, height } = {}) {
  const normalized = { width: Number(width), height: Number(height) };
  if (!Number.isInteger(normalized.width)
    || !Number.isInteger(normalized.height)
    || normalized.width <= 0
    || normalized.height <= 0
    || normalized.width % 32 !== 0
    || normalized.height % 32 !== 0) {
    throw new Error('H3 宽度和高度必须为 32 的倍数且大于 0');
  }
  return normalized;
}

function validateVramBudget(request = {}, { totalVramMb = Number(process.env.DIRECTOR_VRAM_MB || 16303), reserveMb = 512 } = {}) {
  const estimatedPeakVramMb = estimatePeakVramMb(request);
  const availableVramMb = Number(totalVramMb) - Number(reserveMb);
  if (estimatedPeakVramMb > availableVramMb) {
    throw new Error(`Estimated peak VRAM ${estimatedPeakVramMb} MB exceeds safe budget ${availableVramMb} MB`);
  }
  return { estimatedPeakVramMb, totalVramMb: Number(totalVramMb), reserveMb: Number(reserveMb), availableVramMb };
}

module.exports = {
  canonicalize,
  createGenerationCacheKey,
  estimatePeakVramMb,
  validateH3Dimensions,
  validateVramBudget,
};
