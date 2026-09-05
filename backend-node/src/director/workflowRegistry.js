const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateWorkflowGovernance } = require('./directorGovernance');
const { getAdapter } = require('./adapters');

const REGISTRY_VERSION = 1;
const WORKFLOW_STATUSES = new Set(['verified', 'configured', 'invalid']);
const REQUIRED_ENTRY_FIELDS = [
  'id',
  'status',
  'workflowPath',
  'workflowSha256',
  'requiredNodes',
  'modelFiles',
  'customNodes',
  'inputSchema',
];

class WorkflowRegistryError extends Error {
  constructor(message, code = 'WORKFLOW_REGISTRY_INVALID') {
    super(message);
    this.name = 'WorkflowRegistryError';
    this.code = code;
  }
}

function sha256File(filePath) {
  const normalized = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
  return `sha256:${crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

function normalizeHash(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  return raw ? `sha256:${raw}` : '';
}

function readApiWorkflow(filePath) {
  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new WorkflowRegistryError(`workflow JSON cannot be parsed: ${filePath}: ${error.message}`);
  }
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || !workflow.prompt || typeof workflow.prompt !== 'object') {
    throw new WorkflowRegistryError(`workflow must be ComfyUI API format with a prompt object: ${filePath}`);
  }
  return workflow;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function findDirectorNode(prompt) {
  return Object.values(prompt || {}).find((node) => node?.class_type === 'MiniMaxH3Director');
}

function normalizeReferenceImages(input = {}) {
  const raw = input.referenceUrls ?? input.reference_urls ?? input.referenceImageUrls ?? input.reference_image_urls;
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const roles = Array.isArray(input.referenceRoles) ? input.referenceRoles : [];
  const refs = [];
  const push = (value, index) => {
    if (value == null) return;
    const item = typeof value === 'object' ? value : { imageFile: value };
    const imageFile = String(
      item.imageFile ?? item.image_file ?? item.local_path ?? item.localPath ?? item.fileName ?? item.url ?? item.image_url ?? ''
    ).trim();
    if (!imageFile || refs.some((ref) => ref.imageFile === imageFile)) return;
    const fallbackRole = values.length > 1 ? (index === 0 ? 'environment' : 'subject') : 'state';
    const role = String(item.role ?? roles[index] ?? input.referenceRole ?? fallbackRole).trim() || fallbackRole;
    refs.push({ index: refs.length, imageFile, role });
  };
  values.forEach(push);
  if (!refs.length && input.referenceImagePath) push(input.referenceImagePath, 0);
  return refs;
}

function normalizeReferenceAudios(input = {}) {
  const raw = input.referenceAudios ?? input.reference_audios;
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const audios = [];
  for (const value of values) {
    if (value == null) continue;
    const item = typeof value === 'object' ? value : { audioFile: value };
    const audioFile = String(item.audioFile ?? item.audio_file ?? item.local_path ?? item.localPath ?? '').trim();
    if (!audioFile || audios.some((audio) => audio.audioFile === audioFile)) continue;
    audios.push({ audioFile, characterName: String(item.characterName ?? item.character_name ?? '').trim(), characterId: item.characterId ?? item.character_id ?? null });
  }
  return audios;
}

function buildStructuredWorkflowPrompt(workflow, input = {}) {
  if (!workflow || typeof workflow !== 'object' || !workflow.prompt || typeof workflow.prompt !== 'object') {
    throw new WorkflowRegistryError('workflow must contain a ComfyUI prompt object', 'WORKFLOW_TEMPLATE_INVALID');
  }
  const text = String(input.prompt || '').trim();
  if (!text) throw new WorkflowRegistryError('structured prompt is required', 'STRUCTURED_PROMPT_REQUIRED');
  const directorNode = findDirectorNode(workflow.prompt);
  if (!directorNode) throw new WorkflowRegistryError('workflow does not contain MiniMaxH3Director', 'STRUCTURED_WORKFLOW_UNSUPPORTED');

  const output = cloneJson(workflow.prompt);
  const node = Object.values(output).find((candidate) => candidate?.class_type === 'MiniMaxH3Director');
  const nodeInputs = node.inputs || (node.inputs = {});
  const frameRate = Number.isFinite(Number(input.frameRate)) ? Number(input.frameRate) : Number(nodeInputs.frame_rate || 24);
  const durationSeconds = Number.isFinite(Number(input.durationSeconds)) ? Number(input.durationSeconds) : 5;
  const totalFrames = Math.max(1, Math.round(frameRate * durationSeconds));
  const width = Number.isInteger(Number(input.width)) ? Number(input.width) : Number(nodeInputs.width || 864);
  const height = Number.isInteger(Number(input.height)) ? Number(input.height) : Number(nodeInputs.height || 480);
  if (frameRate <= 0 || durationSeconds <= 0 || width <= 0 || height <= 0) {
    throw new WorkflowRegistryError('structured dimensions, frame rate, and duration must be positive', 'STRUCTURED_INPUT_INVALID');
  }
  const seed = Number.isInteger(Number(input.seed)) ? Number(input.seed) : Number(nodeInputs.seed || 42);
  const overlapFrames = Number.isInteger(Number(input.overlapFrames)) ? Number(input.overlapFrames) : Number(nodeInputs.continuityOverlapFrames || 22);
  const continuityEnabled = input.continuityMode !== 'none';
  const refs = normalizeReferenceImages(input);
  const refAudios = normalizeReferenceAudios(input);

  nodeInputs.global_prompt = text;
  nodeInputs.seed = seed;
  nodeInputs.frame_rate = frameRate;
  nodeInputs.width = width;
  nodeInputs.height = height;
  nodeInputs.ref_max_size = Math.max(width, height);
  nodeInputs.total_frames = totalFrames;
  nodeInputs.task_type = refs.length ? 'r2v' : 't2v';

  let timeline = {};
  try { timeline = JSON.parse(String(nodeInputs.timeline_data || '{}')); } catch { timeline = {}; }
  timeline.totalFrames = totalFrames;
  timeline.frameRate = frameRate;
  timeline.width = width;
  timeline.height = height;
  timeline.refMaxSize = Math.max(width, height);
  timeline.output = {
    ...(timeline.output || {}),
    continuityEnabled,
    continuityOverlapFrames: overlapFrames,
    width,
    height,
  };
  timeline.global = { ...(timeline.global || {}), prompt: text, refs, refAudios };
  timeline.segments = [{
    id: 's0', start: 0, length: totalFrames, frameCount: totalFrames,
    durationSec: durationSeconds, prompt: text, taskType: refs.length ? 'r2v' : '', refs, refAudios,
    referenceVideo: {}, genImage: { imageFile: '' }, negativePrompt: String(input.negativePrompt || ''),
    continuityFromPrev: continuityEnabled && input.continuityMode === 'motion_overlap',
  }];
  nodeInputs.timeline_data = JSON.stringify(timeline);
  return output;
}

function readWorkflowTemplate(filePath) {
  return readApiWorkflow(filePath);
}

function classTypes(workflow) {
  return new Set(Object.values(workflow.prompt).map((node) => node && node.class_type).filter(Boolean));
}

function validateEntryShape(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new WorkflowRegistryError(`workflow entry ${index} must be an object`);
  }
  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (!(field in entry)) throw new WorkflowRegistryError(`workflow entry ${index} missing ${field}`);
  }
  if (!String(entry.id).trim()) throw new WorkflowRegistryError(`workflow entry ${index} has an empty id`);
  if (!WORKFLOW_STATUSES.has(entry.status)) {
    throw new WorkflowRegistryError(`workflow ${entry.id} has unsupported status: ${entry.status}`);
  }
  if (!Array.isArray(entry.requiredNodes) || entry.requiredNodes.length === 0) {
    throw new WorkflowRegistryError(`workflow ${entry.id} must declare requiredNodes`);
  }
  if (!Array.isArray(entry.modelFiles) || !Array.isArray(entry.customNodes)) {
    throw new WorkflowRegistryError(`workflow ${entry.id} must declare modelFiles and customNodes arrays`);
  }
  if (!entry.inputSchema || typeof entry.inputSchema !== 'object' || Array.isArray(entry.inputSchema)) {
    throw new WorkflowRegistryError(`workflow ${entry.id} must declare inputSchema`);
  }
  if (entry.status === 'verified' && !String(entry.verifiedEvidence || '').trim()) {
    throw new WorkflowRegistryError(`verified workflow ${entry.id} must declare verifiedEvidence`);
  }
  if (entry.workflowFormat != null && entry.workflowFormat !== 'api') {
    throw new WorkflowRegistryError(`workflow ${entry.id} must use ComfyUI API format`);
  }
  const hasAdapterMetadata = ['family', 'adapter', 'variant', 'workflowFormat', 'capabilities', 'inputSchemaVersion']
    .some((field) => field in entry);
  if (hasAdapterMetadata) {
    for (const field of ['family', 'adapter', 'variant', 'workflowFormat', 'capabilities', 'inputSchemaVersion']) {
      if (!(field in entry)) throw new WorkflowRegistryError(`workflow ${entry.id} missing ${field}`);
    }
    if (!String(entry.family).trim() || !String(entry.variant).trim() || !String(entry.adapter).trim()) {
      throw new WorkflowRegistryError(`workflow ${entry.id} family, adapter, and variant are required`);
    }
    if (!Number.isInteger(entry.inputSchemaVersion) || entry.inputSchemaVersion < 1) {
      throw new WorkflowRegistryError(`workflow ${entry.id} inputSchemaVersion must be a positive integer`);
    }
    if (!entry.capabilities || typeof entry.capabilities !== 'object' || Array.isArray(entry.capabilities)) {
      throw new WorkflowRegistryError(`workflow ${entry.id} capabilities must be an object`);
    }
    if (!Array.isArray(entry.capabilities.modes) || entry.capabilities.modes.length === 0) {
      throw new WorkflowRegistryError(`workflow ${entry.id} capabilities.modes must be a non-empty array`);
    }
    if (!Number.isInteger(entry.capabilities.maxReferenceImages) || entry.capabilities.maxReferenceImages < 1) {
      throw new WorkflowRegistryError(`workflow ${entry.id} must declare maxReferenceImages`);
    }
    if (typeof entry.capabilities.supportsContinuity !== 'boolean') {
      throw new WorkflowRegistryError(`workflow ${entry.id} must declare supportsContinuity`);
    }
  }
  if (entry.adapter != null) {
    try {
      getAdapter(entry.adapter);
    } catch (error) {
      throw new WorkflowRegistryError(error.message, 'ADAPTER_NOT_FOUND');
    }
  }
  if (entry.capabilities != null && (!entry.capabilities || typeof entry.capabilities !== 'object')) {
    throw new WorkflowRegistryError(`workflow ${entry.id} capabilities must be an object`);
  }
  try {
    validateWorkflowGovernance(entry, entry.id);
  } catch (error) {
    throw new WorkflowRegistryError(error.message);
  }
}

function loadRegistry(registryPath, options = {}) {
  const absoluteRegistryPath = path.resolve(registryPath);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(absoluteRegistryPath, 'utf8'));
  } catch (error) {
    throw new WorkflowRegistryError(`registry JSON cannot be parsed: ${absoluteRegistryPath}: ${error.message}`);
  }
  if (!raw || raw.version !== REGISTRY_VERSION || !Array.isArray(raw.workflows)) {
    throw new WorkflowRegistryError(`registry must declare version ${REGISTRY_VERSION} and workflows[]`);
  }

  const baseDir = path.resolve(options.baseDir || path.dirname(absoluteRegistryPath));
  const ids = new Set();
  const workflows = raw.workflows.map((entry, index) => {
    validateEntryShape(entry, index);
    if (ids.has(entry.id)) throw new WorkflowRegistryError(`duplicate workflow id: ${entry.id}`);
    ids.add(entry.id);

    const workflowPath = path.isAbsolute(entry.workflowPath)
      ? entry.workflowPath
      : path.resolve(baseDir, entry.workflowPath);
    if (!fs.existsSync(workflowPath) || !fs.statSync(workflowPath).isFile()) {
      throw new WorkflowRegistryError(`workflow file does not exist: ${workflowPath}`);
    }
    const expectedHash = normalizeHash(entry.workflowSha256);
    if (!expectedHash) throw new WorkflowRegistryError(`workflow ${entry.id} must declare workflowSha256`);
    const actualHash = sha256File(workflowPath);
    if (actualHash !== expectedHash) {
      throw new WorkflowRegistryError(`workflow ${entry.id} hash mismatch: expected ${expectedHash}, got ${actualHash}`);
    }
    const workflow = readApiWorkflow(workflowPath);
    if (entry.status === 'verified') {
      const evidenceCandidates = path.isAbsolute(entry.verifiedEvidence)
        ? [entry.verifiedEvidence]
        : [
          path.resolve(baseDir, entry.verifiedEvidence),
          path.resolve(baseDir, '..', entry.verifiedEvidence),
          path.resolve(baseDir, '..', '..', entry.verifiedEvidence),
          path.resolve(process.cwd(), entry.verifiedEvidence),
        ];
      const evidencePath = evidenceCandidates.find((candidate) => fs.existsSync(candidate));
      if (!evidencePath || !fs.statSync(evidencePath).isFile()) {
        throw new WorkflowRegistryError(`verified workflow ${entry.id} evidence does not exist: ${entry.verifiedEvidence}`);
      }
    }
    const availableNodes = classTypes(workflow);
    const missingNodes = entry.requiredNodes.filter((node) => !availableNodes.has(node));
    if (missingNodes.length > 0) {
      throw new WorkflowRegistryError(`workflow ${entry.id} is missing required nodes: ${missingNodes.join(', ')}`);
    }

    if (entry.adapter) {
      const adapter = getAdapter(entry.adapter);
      if (typeof adapter.describeCapabilities === 'function') {
        try {
          adapter.describeCapabilities(workflow);
        } catch (error) {
          throw new WorkflowRegistryError(`workflow ${entry.id} adapter validation failed: ${error.message}`, error.code || 'WORKFLOW_UNSUPPORTED');
        }
      }
    }

    return {
      ...entry,
      workflowPath,
      workflowSha256: actualHash,
      requiredNodes: [...entry.requiredNodes],
      modelFiles: [...entry.modelFiles],
      customNodes: [...entry.customNodes],
      inputSchema: { ...entry.inputSchema },
      workflowFormat: entry.workflowFormat || 'api',
      family: entry.family || null,
      adapter: entry.adapter || null,
      adapterVersion: entry.adapterVersion || null,
      variant: entry.variant || null,
      capabilities: entry.capabilities ? cloneJson(entry.capabilities) : null,
      acceleration: entry.acceleration ? cloneJson(entry.acceleration) : null,
      inputSchemaVersion: entry.inputSchemaVersion || 1,
      provenance: cloneJson(entry.provenance),
      runtimeLock: cloneJson(entry.runtimeLock),
    };
  });

  return { version: REGISTRY_VERSION, workflows };
}

function selectWorkflow(registry, workflowId, options = {}) {
  if (!registry || !Array.isArray(registry.workflows)) {
    throw new WorkflowRegistryError('registry must contain workflows[]');
  }
  const entry = registry.workflows.find((workflow) => workflow.id === workflowId);
  if (!entry) throw new WorkflowRegistryError(`workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
  if (entry.status === 'invalid') {
    throw new WorkflowRegistryError(`invalid workflow cannot be submitted: ${workflowId}`, 'WORKFLOW_INVALID');
  }
  if (entry.status === 'configured' && options.allowExperimental !== true) {
    throw new WorkflowRegistryError(
      `configured workflow requires allowExperimental=true: ${workflowId}`,
      'WORKFLOW_EXPERIMENTAL_REQUIRED'
    );
  }
  return { ...entry };
}

module.exports = {
  REGISTRY_VERSION,
  WorkflowRegistryError,
  loadRegistry,
  readWorkflowTemplate,
  buildStructuredWorkflowPrompt,
  normalizeReferenceImages,
  selectWorkflow,
  sha256File,
  getWorkflowAdapter: (workflow) => {
    try {
      return getAdapter(workflow?.adapter || workflow);
    } catch (error) {
      throw new WorkflowRegistryError(error.message, 'ADAPTER_NOT_FOUND');
    }
  },
};
