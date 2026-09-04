'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256File } = require('../src/director/workflowRegistry');

const { analyzeWorkflowFile } = require('../scripts/registerComfyWorkflow');

const temporaryDirectories = [];

function workflowFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-workflow-analysis-'));
  temporaryDirectories.push(dir);
  const filePath = path.join(dir, 'formatted workflow.json');
  const source = [
    '  {',
    '    "prompt": {',
    '      "2": { "class_type": "SaveVideo", "inputs": { "filename_prefix": "demo" } },',
    '      "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model-a.safetensors" } },',
    '      "3": { "class_type": "CustomDirector", "inputs": {} }',
    '    }',
    '  }  ',
    '',
  ].join('\r\n');
  fs.writeFileSync(filePath, source);
  return { filePath, source };
}

afterEach(() => {
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('safe ComfyUI workflow analysis helper', () => {
  it('hashes original bytes, extracts class types, and emits an explicitly incomplete governance draft', () => {
    const { filePath } = workflowFixture();
    const result = analyzeWorkflowFile(filePath, {
      id: 'custom-director-v1',
      family: 'custom_family',
      adapter: 'custom_adapter',
      variant: 'local_variant',
    });

    assert.equal(result.entryDraft.workflowSha256, sha256File(filePath));
    assert.deepEqual(result.entryDraft.requiredNodes, ['CustomDirector', 'SaveVideo', 'UNETLoader']);
    assert.deepEqual(result.entryDraft.modelFiles, ['model-a.safetensors']);
    assert.equal(result.entryDraft.draft, true);
    assert.equal(result.entryDraft.status, 'draft');
    assert.deepEqual(result.entryDraft.execution, {
      promptContract: null,
      requiresPromptDraft: null,
      dimensions: null,
      references: null,
      vramPolicy: null,
      defaults: null,
    });
    assert.ok(result.diagnostics.missingGovernance.includes('execution.promptContract'));
    assert.ok(result.diagnostics.warnings.some((item) => item.includes('customNodes')));
  });

  it('rejects partial family, adapter, and variant metadata instead of inventing placeholders', () => {
    const { filePath } = workflowFixture();
    assert.throws(
      () => analyzeWorkflowFile(filePath, { family: 'custom_family' }),
      (error) => error.code === 'WORKFLOW_ADAPTER_METADATA_INCOMPLETE',
    );
  });

  it('prints JSON only and never mutates the workflow registry', () => {
    const { filePath } = workflowFixture();
    const registryPath = path.resolve(__dirname, '../configs/director-workflows.json');
    const registryBefore = fs.readFileSync(registryPath);
    const scriptPath = path.resolve(__dirname, '../scripts/registerComfyWorkflow.js');
    const child = spawnSync(process.execPath, [
      scriptPath,
      filePath,
      '--id', 'cli-draft',
      '--family', 'custom_family',
      '--adapter', 'custom_adapter',
      '--variant', 'local_variant',
    ], { encoding: 'utf8' });

    assert.equal(child.status, 0, child.stderr);
    const output = JSON.parse(child.stdout);
    assert.equal(output.entryDraft.id, 'cli-draft');
    assert.equal(output.entryDraft.workflowSha256, sha256File(filePath));
    assert.deepEqual(fs.readFileSync(registryPath), registryBefore);
    assert.equal(child.stderr, '');
  });
});
