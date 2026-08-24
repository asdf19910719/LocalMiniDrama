const fs = require('node:fs');
const path = require('node:path');

const LICENSE_STATUSES = new Set(['reviewed', 'review_required', 'restricted', 'unverified']);
const SHA256_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/i;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalExistingPath(candidatePath, mustExist) {
  const absolute = path.resolve(String(candidatePath || ''));
  if (mustExist) {
    if (!fs.existsSync(absolute)) throw new Error(`Local path does not exist: ${absolute}`);
    return fs.realpathSync(absolute);
  }

  let ancestor = absolute;
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`Local path has no existing ancestor: ${absolute}`);
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertAllowedLocalPath(candidatePath, allowedRoots, { mustExist = true, kind = 'file' } = {}) {
  if (!String(candidatePath || '').trim()) throw new Error('Local path is required');
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw new Error('Director allowed local roots are not configured');
  }
  const candidate = canonicalExistingPath(candidatePath, mustExist);
  const roots = allowedRoots.map((root) => {
    if (!fs.existsSync(root)) throw new Error(`Allowed local root does not exist: ${path.resolve(root)}`);
    return fs.realpathSync(root);
  });
  if (!roots.some((root) => isWithinRoot(root, candidate))) {
    throw new Error(`Local path is outside allowed local roots: ${candidate}`);
  }
  if (mustExist && kind === 'file' && !fs.statSync(candidate).isFile()) {
    throw new Error(`Local path is not a file: ${candidate}`);
  }
  return candidate;
}

function validateWorkflowGovernance(value, workflowId = 'workflow') {
  const provenance = value?.provenance;
  const runtimeLock = value?.runtimeLock;
  if (!provenance || typeof provenance !== 'object') throw new Error(`workflow ${workflowId} must declare provenance`);
  for (const field of ['provider', 'modelFamily', 'source']) {
    if (!String(provenance[field] || '').trim()) throw new Error(`workflow ${workflowId} provenance must declare ${field}`);
  }
  if (!provenance.license || !LICENSE_STATUSES.has(provenance.license.status)) {
    throw new Error(`workflow ${workflowId} must declare a valid license status`);
  }
  if (!String(provenance.license.evidence || '').trim()) {
    throw new Error(`workflow ${workflowId} license must declare evidence`);
  }
  if (!runtimeLock || typeof runtimeLock !== 'object') throw new Error(`workflow ${workflowId} must declare runtimeLock`);
  if (!String(runtimeLock.comfyUIVersion || '').trim()) throw new Error(`workflow ${workflowId} must lock ComfyUI version`);
  if (!Array.isArray(runtimeLock.models) || !Array.isArray(runtimeLock.customNodes)) {
    throw new Error(`workflow ${workflowId} runtimeLock must declare models and customNodes`);
  }
  for (const model of runtimeLock.models) {
    if (!String(model?.fileName || '').trim()) throw new Error(`workflow ${workflowId} model lock must declare fileName`);
    if (!SHA256_PATTERN.test(String(model.sha256 || ''))) throw new Error(`workflow ${workflowId} model ${model.fileName} must declare a valid sha256`);
    if (!String(model.relativePath || '').trim()) throw new Error(`workflow ${workflowId} model ${model.fileName} must declare relativePath`);
    if (!Number.isSafeInteger(model.fileSizeBytes) || model.fileSizeBytes <= 0) throw new Error(`workflow ${workflowId} model ${model.fileName} must declare a positive file size`);
  }
  for (const node of runtimeLock.customNodes) {
    if (!String(node?.name || '').trim() || !Array.isArray(node.files) || node.files.length === 0) {
      throw new Error(`workflow ${workflowId} custom node lock is incomplete`);
    }
    for (const file of node.files) {
      if (!String(file?.path || '').trim() || !SHA256_PATTERN.test(String(file?.sha256 || ''))) {
        throw new Error(`workflow ${workflowId} custom node ${node.name} must declare file path and sha256`);
      }
    }
  }
  return true;
}

function normalizeHash(value) {
  return String(value || '').toLowerCase().replace(/^sha256:/, '');
}

function compareRuntimeLock(expected, actual) {
  const mismatches = [];
  if (String(expected?.comfyUIVersion || '') !== String(actual?.comfyUIVersion || '')) {
    mismatches.push(`ComfyUI version: expected ${expected?.comfyUIVersion || 'missing'}, got ${actual?.comfyUIVersion || 'missing'}`);
  }
  const actualModels = new Map((actual?.models || []).map((model) => [model.fileName, model]));
  for (const model of expected?.models || []) {
    const found = actualModels.get(model.fileName);
    if (!found) mismatches.push(`model missing: ${model.fileName}`);
    else {
      if (normalizeHash(model.sha256) !== normalizeHash(found.sha256)) mismatches.push(`model hash mismatch: ${model.fileName}`);
      if (String(model.relativePath) !== String(found.relativePath)) mismatches.push(`model path mismatch: ${model.fileName}`);
      if (Number(model.fileSizeBytes) !== Number(found.fileSizeBytes)) mismatches.push(`model size mismatch: ${model.fileName}`);
    }
  }
  const actualNodes = new Map((actual?.customNodes || []).map((node) => [node.name, node]));
  for (const node of expected?.customNodes || []) {
    const found = actualNodes.get(node.name);
    if (!found) {
      mismatches.push(`custom node missing: ${node.name}`);
      continue;
    }
    const actualFiles = new Map((found.files || []).map((file) => [file.path, file]));
    for (const file of node.files) {
      const actualFile = actualFiles.get(file.path);
      if (!actualFile) mismatches.push(`custom node file missing: ${node.name}/${file.path}`);
      else if (normalizeHash(file.sha256) !== normalizeHash(actualFile.sha256)) {
        mismatches.push(`custom node hash mismatch: ${node.name}/${file.path}`);
      }
    }
  }
  return { compatible: mismatches.length === 0, mismatches };
}

function createGovernanceSnapshot(workflow) {
  validateWorkflowGovernance(workflow, workflow?.id);
  return cloneJson({
    workflowId: workflow.id,
    workflowSha256: workflow.workflowSha256,
    provenance: workflow.provenance,
    runtimeLock: workflow.runtimeLock,
  });
}

module.exports = {
  assertAllowedLocalPath,
  validateWorkflowGovernance,
  compareRuntimeLock,
  createGovernanceSnapshot,
};
