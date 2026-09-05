const H3_OFFICIAL_WORKFLOW_ID = 'minimax_h3_director_r2v';
const H3_TE_SPEED_WORKFLOW_ID = 'minimax_h3_director_r2v_te_speed';
const SWITCHABLE_H3_WORKFLOW_IDS = new Set([
  H3_OFFICIAL_WORKFLOW_ID,
  H3_TE_SPEED_WORKFLOW_ID,
]);

function isSwitchableH3WorkflowPair(configuredWorkflowId, requestedWorkflowId) {
  const configured = String(configuredWorkflowId || '').trim();
  const requested = String(requestedWorkflowId || '').trim();
  return configured !== requested
    && SWITCHABLE_H3_WORKFLOW_IDS.has(configured)
    && SWITCHABLE_H3_WORKFLOW_IDS.has(requested);
}

module.exports = {
  H3_OFFICIAL_WORKFLOW_ID,
  H3_TE_SPEED_WORKFLOW_ID,
  SWITCHABLE_H3_WORKFLOW_IDS,
  isSwitchableH3WorkflowPair,
};
