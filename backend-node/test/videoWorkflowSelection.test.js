const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { resolveRequestedWorkflow } = require('../src/services/videoWorkflowSelection');

const registry = {
  workflows: [
    { id: 'official', status: 'verified', execution: {} },
    { id: 'alternate', status: 'verified', execution: {} },
    { id: 'experimental', status: 'configured', execution: {} },
  ],
};

function resolved(provider = 'comfyui') {
  return {
    provider,
    protocol: provider === 'comfyui' ? 'openai' : 'volcengine',
    model: 'official',
    config: {
      provider,
      api_protocol: provider === 'comfyui' ? '' : 'volcengine',
      base_url: 'http://127.0.0.1:8188',
      model: ['official', 'alternate', 'experimental'],
      default_model: 'official',
    },
  };
}

describe('resolveRequestedWorkflow', () => {
  it('uses the channel default and accepts equal aliases', () => {
    assert.equal(resolveRequestedWorkflow({ input: {}, resolved: resolved(), registry }).selectedWorkflowId, 'official');
    const selected = resolveRequestedWorkflow({
      input: { model: 'alternate', workflow_id: 'alternate', workflowId: 'alternate' },
      resolved: resolved(),
      registry,
    });
    assert.equal(selected.selectedWorkflowId, 'alternate');
    assert.equal(selected.resolved.model, 'alternate');
  });

  it('rejects conflicting aliases before membership checks', () => {
    assert.throws(
      () => resolveRequestedWorkflow({ input: { model: 'missing', workflow_id: 'alternate' }, resolved: resolved(), registry }),
      (error) => error.code === 'VIDEO_WORKFLOW_CONFLICT' && error.status === 400,
    );
  });

  it('rejects a ComfyUI workflow outside the channel allowlist', () => {
    assert.throws(
      () => resolveRequestedWorkflow({ input: { workflow_id: 'missing' }, resolved: resolved(), registry }),
      (error) => error.code === 'VIDEO_WORKFLOW_NOT_ALLOWED',
    );
  });

  it('preserves the configured official H3 and TE-Speed switch pair', () => {
    const h3Registry = {
      workflows: [
        { id: 'minimax_h3_director_r2v', status: 'verified', execution: {} },
        { id: 'minimax_h3_director_r2v_te_speed', status: 'verified', execution: {} },
      ],
    };
    const h3Resolved = resolved();
    h3Resolved.model = 'minimax_h3_director_r2v';
    h3Resolved.config.model = ['minimax_h3_director_r2v'];
    h3Resolved.config.default_model = 'minimax_h3_director_r2v';

    const selected = resolveRequestedWorkflow({
      input: { workflow_id: 'minimax_h3_director_r2v_te_speed' },
      resolved: h3Resolved,
      registry: h3Registry,
    });
    assert.equal(selected.selectedWorkflowId, 'minimax_h3_director_r2v_te_speed');
  });

  it('applies the experimental switch consistently', () => {
    assert.throws(
      () => resolveRequestedWorkflow({ input: { workflow_id: 'experimental' }, resolved: resolved(), registry }),
      (error) => error.code === 'WORKFLOW_EXPERIMENTAL_REQUIRED',
    );
    assert.equal(resolveRequestedWorkflow({
      input: { workflow_id: 'experimental' }, resolved: resolved(), registry, allowExperimental: true,
    }).workflow.id, 'experimental');
  });

  it('rejects workflow aliases for non-ComfyUI providers while preserving model selection', () => {
    assert.throws(
      () => resolveRequestedWorkflow({ input: { workflow_id: 'official' }, resolved: resolved('volces'), registry }),
      (error) => error.code === 'VIDEO_WORKFLOW_NOT_ALLOWED',
    );
    const selected = resolveRequestedWorkflow({ input: { model: 'alternate' }, resolved: resolved('volces'), registry });
    assert.equal(selected.workflow, null);
    assert.equal(selected.resolved.model, 'alternate');
  });
});
