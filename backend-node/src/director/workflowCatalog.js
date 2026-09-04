function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function workflowAvailability(workflow, allowExperimental) {
  if (workflow.status === 'invalid') return { selectable: false, unavailableReason: 'WORKFLOW_INVALID' };
  if (workflow.status === 'configured' && allowExperimental !== true) {
    return { selectable: false, unavailableReason: 'WORKFLOW_EXPERIMENTAL_REQUIRED' };
  }
  return { selectable: true, unavailableReason: null };
}

function catalogItem(workflow, options = {}) {
  const availability = workflowAvailability(workflow, options.allowExperimental);
  return {
    id: workflow.id,
    status: workflow.status,
    ...availability,
    variant: workflow.variant || null,
    family: workflow.family || null,
    adapter: workflow.adapter || null,
    adapterVersion: workflow.adapterVersion || null,
    workflowSha256: workflow.workflowSha256 || null,
    execution: clone(workflow.execution) || null,
    capabilities: clone(workflow.capabilities) || null,
  };
}

function listWorkflowCatalog(registry, options = {}) {
  if (!registry || !Array.isArray(registry.workflows)) {
    const error = new Error('registry must contain workflows[]');
    error.code = 'WORKFLOW_REGISTRY_INVALID';
    throw error;
  }
  return registry.workflows.map((workflow) => catalogItem(workflow, options));
}

module.exports = { listWorkflowCatalog, catalogItem };
