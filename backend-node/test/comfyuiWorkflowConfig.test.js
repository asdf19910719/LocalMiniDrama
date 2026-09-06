const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAndValidateComfyuiWorkflowConfig } = require('../src/services/comfyuiWorkflowConfig');

const registry = {
  workflows: [
    { id: 'ready', status: 'verified' },
    { id: 'second', status: 'verified' },
    { id: 'experimental', status: 'configured' },
    { id: 'broken', status: 'invalid' },
  ],
};

describe('ComfyUI workflow channel configuration', () => {
  it('trims and deduplicates models while preserving order', () => {
    assert.deepEqual(normalizeAndValidateComfyuiWorkflowConfig({ model: [' ready ', 'second', 'ready'], default_model: ' second ' }, registry), {
      model: ['ready', 'second'],
      default_model: 'second',
    });
  });

  it('rejects an empty allowlist and a default outside it', () => {
    assert.throws(() => normalizeAndValidateComfyuiWorkflowConfig({ model: [], default_model: '' }, registry), (error) => error.code === 'COMFYUI_WORKFLOW_LIST_EMPTY');
    assert.throws(() => normalizeAndValidateComfyuiWorkflowConfig({ model: ['ready'], default_model: 'second' }, registry), (error) => error.code === 'COMFYUI_DEFAULT_WORKFLOW_NOT_ALLOWED');
  });

  it('rejects missing, invalid and disabled experimental registry entries', () => {
    assert.throws(() => normalizeAndValidateComfyuiWorkflowConfig({ model: ['missing'], default_model: 'missing' }, registry), (error) => error.code === 'WORKFLOW_NOT_FOUND');
    assert.throws(() => normalizeAndValidateComfyuiWorkflowConfig({ model: ['broken'], default_model: 'broken' }, registry), (error) => error.code === 'WORKFLOW_INVALID');
    assert.throws(() => normalizeAndValidateComfyuiWorkflowConfig({ model: ['experimental'], default_model: 'experimental' }, registry), (error) => error.code === 'WORKFLOW_EXPERIMENTAL_REQUIRED');
    assert.deepEqual(normalizeAndValidateComfyuiWorkflowConfig(
      { model: ['experimental'], default_model: 'experimental' }, registry, { allowExperimental: true },
    ).model, ['experimental']);
  });
});
