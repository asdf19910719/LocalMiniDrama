const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sutPath = path.resolve(__dirname, '../src/director/workflowRegistry.js');

function loadSut() {
  assert.equal(fs.existsSync(sutPath), true, `missing implementation: ${sutPath}`);
  return require(sutPath);
}

function writeWorkflowFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistory-registry-'));
  const workflowPath = path.join(root, 'workflow.json');
  fs.writeFileSync(workflowPath, JSON.stringify({
    prompt: {
      '1': { class_type: 'UNETLoader' },
      '2': { class_type: 'CLIPLoader' },
      '3': { class_type: 'SaveVideo' },
    },
  }));
  return { root, workflowPath };
}

function registryFor(workflowPath, workflowSha256) {
  return {
    version: 1,
    workflows: [
      {
        id: 'h3-continuity-v1',
        status: 'verified',
        workflowPath,
        workflowSha256,
        requiredNodes: ['UNETLoader', 'CLIPLoader', 'SaveVideo'],
        modelFiles: ['minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
        customNodes: ['MiniMaxH3Director'],
        inputSchema: { prompt: 'string', seed: 'integer' },
        verifiedEvidence: 'docs/research/h3-continuity-test-report.md',
      },
      {
        id: 'h3-r2v-configured-v1',
        status: 'configured',
        workflowPath,
        workflowSha256,
        requiredNodes: ['UNETLoader', 'CLIPLoader', 'SaveVideo'],
        modelFiles: [],
        customNodes: [],
        inputSchema: { prompt: 'string' },
        verifiedEvidence: null,
      },
      {
        id: 'h3-r2v-invalid-v1',
        status: 'invalid',
        workflowPath,
        workflowSha256,
        requiredNodes: ['UNETLoader', 'CLIPLoader'],
        modelFiles: [],
        customNodes: [],
        inputSchema: { prompt: 'string' },
        verifiedEvidence: null,
      },
    ],
  };
}

describe('Director workflow registry', () => {
  it('selects verified workflows and rejects configured by default', () => {
    const { selectWorkflow } = loadSut();
    const { workflowPath } = writeWorkflowFixture();
    const registry = registryFor(workflowPath, 'sha256:fixture');

    assert.equal(selectWorkflow(registry, 'h3-continuity-v1').status, 'verified');
    assert.throws(
      () => selectWorkflow(registry, 'h3-r2v-configured-v1'),
      /experimental|configured/i
    );
  });

  it('allows a configured workflow only with the explicit experimental flag', () => {
    const { selectWorkflow } = loadSut();
    const { workflowPath } = writeWorkflowFixture();
    const registry = registryFor(workflowPath, 'sha256:fixture');

    assert.equal(
      selectWorkflow(registry, 'h3-r2v-configured-v1', { allowExperimental: true }).status,
      'configured'
    );
  });

  it('always rejects invalid workflows', () => {
    const { selectWorkflow } = loadSut();
    const { workflowPath } = writeWorkflowFixture();
    const registry = registryFor(workflowPath, 'sha256:fixture');

    assert.throws(
      () => selectWorkflow(registry, 'h3-r2v-invalid-v1', { allowExperimental: true }),
      /invalid/i
    );
  });

  it('loads a registry and rejects missing files or hash mismatches', () => {
    const { loadRegistry } = loadSut();
    const { root, workflowPath } = writeWorkflowFixture();
    const registryPath = path.join(root, 'registry.json');
    const registry = registryFor(workflowPath, 'sha256:fixture');
    fs.writeFileSync(registryPath, JSON.stringify(registry));

    assert.throws(() => loadRegistry(registryPath), /sha256|hash/i);
    fs.writeFileSync(registryPath, JSON.stringify({
      ...registry,
      workflows: registry.workflows.map((entry) => ({
        ...entry,
        workflowSha256: undefined,
      })),
    }));
    assert.throws(() => loadRegistry(registryPath), /sha256|hash/i);
  });
});
