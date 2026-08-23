const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
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
    const availableNodes = classTypes(workflow);
    const missingNodes = entry.requiredNodes.filter((node) => !availableNodes.has(node));
    if (missingNodes.length > 0) {
      throw new WorkflowRegistryError(`workflow ${entry.id} is missing required nodes: ${missingNodes.join(', ')}`);
    }

    return {
      ...entry,
      workflowPath,
      workflowSha256: actualHash,
      requiredNodes: [...entry.requiredNodes],
      modelFiles: [...entry.modelFiles],
      customNodes: [...entry.customNodes],
      inputSchema: { ...entry.inputSchema },
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
  selectWorkflow,
  sha256File,
};
