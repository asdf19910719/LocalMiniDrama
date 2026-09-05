const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateWorkflowExecution,
  workflowRequiresDraft,
  resolveWorkflowParameters,
  validateWorkflowReferences,
} = require('../src/director/workflowExecutionPolicy');

function execution(overrides = {}) {
  return {
    promptContract: 'free_text_v1',
    requiresPromptDraft: false,
    dimensions: { minWidth: 64, maxWidth: 1920, minHeight: 64, maxHeight: 1080, multipleOf: 8 },
    references: { min: 0, max: 3 },
    vramPolicy: 'none',
    defaults: { width: 1280, height: 720, durationSeconds: 6, frameRate: 25, seed: 7 },
    ...overrides,
  };
}

describe('workflow execution policy', () => {
  it('normalizes an explicit free-text execution contract', () => {
    const value = validateWorkflowExecution(execution(), 'free-workflow');
    assert.deepEqual(value.defaults, {
      width: 1280,
      height: 720,
      durationSeconds: 6,
      frameRate: 25,
      seed: 7,
    });
    assert.equal(value.promptContract, 'free_text_v1');
  });

  it('rejects incomplete and internally inconsistent contracts', () => {
    assert.throws(
      () => validateWorkflowExecution(null, 'missing'),
      (error) => error.code === 'WORKFLOW_EXECUTION_INVALID',
    );
    assert.throws(
      () => validateWorkflowExecution(execution({ promptContract: 'adapter_implies_h3' }), 'bad-prompt'),
      (error) => error.code === 'WORKFLOW_EXECUTION_INVALID',
    );
    assert.throws(
      () => validateWorkflowExecution(execution({ references: { min: 4, max: 2 } }), 'bad-refs'),
      (error) => error.code === 'WORKFLOW_EXECUTION_INVALID',
    );
  });

  it('rejects empty and boolean numeric fields instead of coercing them to numbers', () => {
    for (const invalidExecution of [
      execution({ references: { min: null, max: 3 } }),
      execution({ references: { min: 0, max: null } }),
      execution({ defaults: { ...execution().defaults, seed: null } }),
      execution({ references: { min: false, max: 3 } }),
      execution({ defaults: { ...execution().defaults, seed: ' ' } }),
      execution({ references: { min: [], max: 3 } }),
      execution({ defaults: { ...execution().defaults, seed: [1] } }),
    ]) {
      assert.throws(
        () => validateWorkflowExecution(invalidExecution, 'null-number'),
        (error) => error.code === 'WORKFLOW_EXECUTION_INVALID',
      );
    }
  });

  it('requires a draft only when the execution contract says so', () => {
    assert.equal(workflowRequiresDraft({ adapter: 'anything', execution: execution() }), false);
    assert.equal(workflowRequiresDraft({ adapter: null, execution: execution({ requiresPromptDraft: true }) }), true);
  });

  it('resolves request, per-workflow, legacy-default, and registry defaults in order', () => {
    const workflow = { id: 'free-workflow', execution: execution() };
    const config = {
      default_model: 'official',
      settings: JSON.stringify({
        width: 1312,
        height: 736,
        workflow_overrides: { 'free-workflow': { width: 1024, height: 576, frame_rate: 30 } },
      }),
    };
    assert.deepEqual(resolveWorkflowParameters(workflow, { width: 1152 }, config), {
      width: 1152,
      height: 576,
      durationSeconds: 6,
      frameRate: 30,
      seed: 7,
    });
  });

  it('validates dimensions and reference counts against the selected workflow', () => {
    const workflow = { id: 'free-workflow', execution: execution() };
    assert.throws(
      () => resolveWorkflowParameters(workflow, { width: 1025 }, {}),
      (error) => error.code === 'VIDEO_DIMENSIONS_INVALID',
    );
    assert.deepEqual(validateWorkflowReferences(workflow, ['a', 'b', 'c']), ['a', 'b', 'c']);
    assert.throws(
      () => validateWorkflowReferences(workflow, ['a', 'b', 'c', 'd']),
      (error) => error.code === 'VIDEO_REFERENCE_COUNT_INVALID',
    );
  });
});
