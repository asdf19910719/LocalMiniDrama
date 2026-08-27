const crypto = require('node:crypto');
const { validateH3Dimensions } = require('../director/directorGenerationPolicy');

const ALLOWED_KEYS = new Set([
  'workflowId', 'workflow_id', 'mode', 'generationMode', 'generation_mode', 'common', 'segments',
  'prompt', 'negativePrompt', 'negative_prompt', 'width', 'height', 'durationSeconds', 'duration',
  'frameRate', 'frame_rate', 'seed', 'referenceImages', 'referenceUrls', 'reference_urls', 'storyboardId', 'storyboard_id',
  'continuityEnabled', 'continuity_enabled', 'continuityMode', 'continuity_mode', 'style', 'reference_image_urls',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}

function planHash(plan) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical(plan))).digest('hex')}`;
}

function refsFrom(input = {}) {
  const raw = input.referenceImages ?? input.referenceUrls ?? input.reference_urls ?? input.reference_image_urls ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map((item, index) => {
    const value = typeof item === 'object' ? item : { source: item };
    const source = String(value.source || value.imageFile || value.image_file || value.url || value.imageUrl || '').trim();
    if (!source) throw new Error('VIDEO_REFERENCE_SOURCE_REQUIRED');
    return { index, source, role: String(value.role || (index === 0 ? 'subject' : 'reference')).trim() };
  });
}

function assertAllowedKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) if (!ALLOWED_KEYS.has(key)) throw new Error(`VIDEO_INPUT_FIELD_UNSUPPORTED: ${key}`);
}

function buildVideoGenerationPlan(input = {}, { workflowId = 'minimax_h3_director_r2v' } = {}) {
  assertAllowedKeys(input);
  const requestedWorkflow = String(input.workflowId || input.workflow_id || workflowId).trim();
  if (requestedWorkflow !== workflowId) throw new Error('VIDEO_WORKFLOW_NOT_ALLOWED');
  const mode = String(input.generationMode || input.generation_mode || input.mode || 'single_reference').trim();
  if (!['single_reference', 'single_segment_r2v'].includes(mode)) throw new Error('VIDEO_GENERATION_MODE_UNSUPPORTED');
  const width = Number(input.width ?? input.common?.width ?? 864);
  const height = Number(input.height ?? input.common?.height ?? 480);
  const dimensions = validateH3Dimensions({ width, height });
  const durationSeconds = Number(input.durationSeconds ?? input.duration ?? input.common?.durationSeconds ?? 5);
  const frameRate = Number(input.frameRate ?? input.frame_rate ?? input.common?.frameRate ?? 24);
  const seed = Number(input.seed ?? input.common?.seed ?? 42);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60) throw new Error('VIDEO_DURATION_INVALID');
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 120) throw new Error('VIDEO_FRAME_RATE_INVALID');
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('VIDEO_SEED_INVALID');
  const refs = refsFrom(input);
  if (refs.length < 1 || refs.length > 9) throw new Error('VIDEO_REFERENCE_COUNT_INVALID');
  const continuity = input.continuityEnabled ?? input.continuity_enabled;
  if (continuity === true || (input.continuityMode && input.continuityMode !== 'none') || (input.continuity_mode && input.continuity_mode !== 'none')) {
    throw new Error('VIDEO_CONTINUITY_DISABLED');
  }
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('VIDEO_PROMPT_REQUIRED');
  const plan = {
    workflowId: requestedWorkflow,
    mode: 'single_reference',
    common: { ...dimensions, durationSeconds, frameRate, seed },
    segments: [{
      id: 's0', storyboardId: input.storyboardId ?? input.storyboard_id ?? null, prompt,
      durationSeconds, referenceImages: refs, continuityFromPrev: false,
    }],
  };
  return { plan, planHash: planHash(plan) };
}

module.exports = { buildVideoGenerationPlan, planHash, canonical };
