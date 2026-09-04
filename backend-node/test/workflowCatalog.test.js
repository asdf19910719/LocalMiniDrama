const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { listWorkflowCatalog } = require('../src/director/workflowCatalog');

const registry = {
  workflows: [
    { id: 'verified', status: 'verified', family: 'video', variant: 'v1', adapter: 'a', execution: { promptContract: 'free_text_v1' }, capabilities: { modes: ['text'] } },
    { id: 'configured', status: 'configured', execution: { promptContract: 'free_text_v1' }, capabilities: {} },
    { id: 'invalid', status: 'invalid', execution: { promptContract: 'free_text_v1' }, capabilities: {} },
  ],
};

describe('workflow catalog', () => {
  it('keeps every governance state and exposes execution metadata', () => {
    const items = listWorkflowCatalog(registry, { allowExperimental: false });
    assert.deepEqual(items.map(({ id, selectable, unavailableReason }) => ({ id, selectable, unavailableReason })), [
      { id: 'verified', selectable: true, unavailableReason: null },
      { id: 'configured', selectable: false, unavailableReason: 'WORKFLOW_EXPERIMENTAL_REQUIRED' },
      { id: 'invalid', selectable: false, unavailableReason: 'WORKFLOW_INVALID' },
    ]);
    assert.deepEqual(items[0].execution, { promptContract: 'free_text_v1' });
    assert.deepEqual(items[0].capabilities, { modes: ['text'] });
  });

  it('makes configured workflows selectable only with the global switch', () => {
    const items = listWorkflowCatalog(registry, { allowExperimental: true });
    assert.equal(items.find((item) => item.id === 'configured').selectable, true);
    assert.equal(items.find((item) => item.id === 'invalid').selectable, false);
  });
});
