'use strict';

const ADAPTER_ID = 'h3_director_r2v';
const ADAPTER_VERSION = 'v2';
const MAX_REFERENCES = 9;

function fail(message, code = 'ADAPTER_INPUT_INVALID') {
  const error = new Error(message);
  error.name = 'H3DirectorR2VAdapterError';
  error.code = code;
  throw error;
}

function classTypes(workflow) {
  return new Set(Object.values(workflow?.prompt || {}).map((node) => node?.class_type).filter(Boolean));
}

function entriesByType(workflow, type) {
  return Object.entries(workflow?.prompt || {}).filter(([, node]) => node?.class_type === type);
}

function modelSource(node) {
  const source = node?.inputs?.model;
  return Array.isArray(source) && source.length === 2 ? [String(source[0]), Number(source[1])] : null;
}

function sameSource(actual, nodeId) {
  return Array.isArray(actual) && actual[0] === String(nodeId) && actual[1] === 0;
}

function stagedReferences(input = {}, stagedAssets) {
  const supplied = stagedAssets ?? input.stagedAssets ?? input.staged_assets;
  const rawInput = input.referenceUrls ?? input.reference_urls ?? input.referenceImageUrls ?? input.reference_image_urls ?? input.referenceImages;
  // An omitted/empty staging argument may accompany raw references during planning;
  // prefer those references so the adapter remains useful before the staging service runs.
  const assets = Array.isArray(supplied) && (supplied.length > 0 || !rawInput) ? supplied : null;
  if (Array.isArray(assets)) {
    return assets.map((asset, index) => {
      if (typeof asset === 'string') return { index, comfyFilename: asset, role: 'subject' };
      const comfyFilename = String(asset?.comfyFilename ?? asset?.comfy_filename ?? asset?.fileName ?? asset?.filename ?? '').trim();
      return { index, comfyFilename, role: String(asset?.role || 'subject').trim() || 'subject' };
    }).filter((asset) => asset.comfyFilename);
  }
  const raw = rawInput;
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return values.map((value, index) => {
    const item = typeof value === 'object' ? value : { fileName: value };
    return {
      index,
      comfyFilename: String(item.comfyFilename ?? item.comfy_filename ?? item.fileName ?? item.file_name ?? item.url ?? item.imageFile ?? '').trim(),
      role: String(item.role || (values.length > 1 ? (index === 0 ? 'environment' : 'subject') : 'state')).trim(),
    };
  }).filter((asset) => asset.comfyFilename);
}

function validateWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || !workflow.prompt || typeof workflow.prompt !== 'object') {
    fail('H3 Director R2V adapter requires an API-format workflow', 'ADAPTER_WORKFLOW_INVALID');
  }
  const types = classTypes(workflow);
  if ([...types].some((type) => /spectrum/i.test(String(type)))) {
    fail('H3 Director R2V workflow cannot combine Spectrum with TE-Speed', 'ADAPTER_WORKFLOW_UNSUPPORTED');
  }
  for (const required of ['MiniMaxH3Director', 'PathchSageAttentionKJ']) {
    if (!types.has(required)) fail(`H3 Director R2V workflow is missing ${required}`, 'ADAPTER_WORKFLOW_UNSUPPORTED');
  }
  const [directorEntry] = entriesByType(workflow, 'MiniMaxH3Director');
  const [unetEntry] = entriesByType(workflow, 'UNETLoader');
  const [sageEntry] = entriesByType(workflow, 'PathchSageAttentionKJ');
  const teEntries = entriesByType(workflow, 'TESpeedMiniMaxH3');
  const director = directorEntry?.[1];
  const unet = unetEntry?.[1];
  if (!String(unet?.inputs?.unet_name || '').toLowerCase().includes('ref2va')) {
    fail('H3 Director R2V workflow must use a ref2va UNET', 'ADAPTER_WORKFLOW_UNSUPPORTED');
  }
  const sage = sageEntry?.[1];
  if (sage?.inputs?.sage_attention !== 'auto' || sage?.inputs?.allow_compile !== false) {
    fail('H3 Director R2V workflow must configure SageAttention auto with compile disabled', 'ADAPTER_WORKFLOW_UNSUPPORTED');
  }
  if (!director) fail('H3 Director R2V workflow is missing MiniMaxH3Director', 'ADAPTER_WORKFLOW_UNSUPPORTED');
  if (teEntries.length > 1) fail('H3 Director R2V workflow must contain exactly one TE-Speed node', 'ADAPTER_WORKFLOW_UNSUPPORTED');
  if (teEntries.length === 1) {
    const [teId, te] = teEntries[0];
    const [sageId] = sageEntry;
    const [unetId] = unetEntry;
    const chainValid = sameSource(modelSource(sage), unetId)
      && sameSource(modelSource(te), sageId)
      && sameSource(modelSource(director), teId);
    if (!chainValid) {
      fail('H3 Director R2V TE-Speed chain must be UNET -> Sage -> TE-Speed -> Director', 'ADAPTER_WORKFLOW_UNSUPPORTED');
    }
  }
}

function validate(input = {}, workflow, stagedAssets) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) fail('H3 Director R2V prompt is required');
  const refs = stagedReferences(input, stagedAssets);
  if (refs.length < 1 || refs.length > MAX_REFERENCES) {
    fail(`H3 Director R2V requires 1-${MAX_REFERENCES} staged reference images`);
  }
  if (input.continuityEnabled === true || input.continuityMode && input.continuityMode !== 'none') {
    fail('H3 Director R2V V1 does not support continuity');
  }
  if (input.segments && (!Array.isArray(input.segments) || input.segments.length !== 1)) {
    fail('H3 Director R2V V1 requires exactly one segment');
  }
  if (workflow) validateWorkflow(workflow);
  return { prompt, stagedAssets: refs };
}

function buildPrompt(template, input = {}, stagedAssets = []) {
  const normalized = validate(input, template, stagedAssets);
  // Reuse the generic graph binder while enforcing the adapter's R2V invariants.
  // Lazy loading avoids a module cycle with workflowRegistry's adapter lookup.
  const { buildStructuredWorkflowPrompt } = require('../workflowRegistry');
  const refs = normalized.stagedAssets;
  const output = buildStructuredWorkflowPrompt(template, {
    ...input,
    referenceUrls: refs.map((asset) => asset.comfyFilename),
    referenceRoles: refs.map((asset) => asset.role),
    continuityMode: 'none',
    overlapFrames: 0,
  });
  const director = Object.values(output).find((node) => node?.class_type === 'MiniMaxH3Director');
  director.inputs.task_type = 'r2v';
  let timeline;
  try { timeline = JSON.parse(String(director.inputs.timeline_data || '{}')); } catch { timeline = {}; }
  timeline.output = { ...(timeline.output || {}), continuityEnabled: false, continuityOverlapFrames: 0 };
  timeline.global = { ...(timeline.global || {}), taskType: 'r2v', refs: normalized.stagedAssets.map((asset, index) => ({ index, imageFile: asset.comfyFilename, role: asset.role })) };
  timeline.segments = [{
    ...(timeline.segments?.[0] || {}),
    id: 's0',
    start: 0,
    length: Number(director.inputs.total_frames),
    frameCount: Number(director.inputs.total_frames),
    durationSec: Number(input.durationSeconds || 5),
    taskType: 'r2v',
    refs: timeline.global.refs,
    continuityFromPrev: false,
  }];
  director.inputs.timeline_data = JSON.stringify(timeline);
  return output;
}

function describeCapabilities(workflow) {
  if (workflow) validateWorkflow(workflow);
  const supportsTESpeed = entriesByType(workflow, 'TESpeedMiniMaxH3').length === 1;
  return {
    modes: ['single_reference'],
    maxReferenceImages: MAX_REFERENCES,
    supportsContinuity: false,
    supportsAudio: true,
    supportsSage: true,
    supportsTESpeed,
    approximateAcceleration: supportsTESpeed,
  };
}

const h3DirectorR2VAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  validate,
  buildPrompt,
  describeCapabilities,
};

module.exports = {
  h3DirectorR2VAdapter,
  stagedReferences,
  validateWorkflow,
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  validate,
  buildPrompt,
  describeCapabilities,
};
