const { selectWorkflow } = require('../director/workflowRegistry');
const { resolveVideoProtocol } = require('./videoConfigResolver');

function selectionError(code, message, details) {
  const error = new Error(message || code);
  error.code = code;
  error.status = 400;
  if (details !== undefined) error.details = details;
  return error;
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function allowedModels(resolved) {
  const values = resolved?.config?.model;
  return (Array.isArray(values) ? values : values ? [values] : []).map(text).filter(Boolean);
}

function withSelectedModel(resolved, model) {
  return {
    ...resolved,
    model,
    protocol: resolveVideoProtocol(resolved.config, model),
  };
}

function resolveRequestedWorkflow({ input = {}, resolved, registry, allowExperimental = false } = {}) {
  if (!resolved?.config) {
    throw selectionError('VIDEO_CONFIG_MISSING', '视频生成配置缺失');
  }

  const provider = text(resolved.provider || resolved.config.provider).toLowerCase();
  const workflowId = text(input.workflow_id);
  const workflowIdAlias = text(input.workflowId);
  const requestedModel = text(input.model);
  const allowed = allowedModels(resolved);

  if (provider !== 'comfyui') {
    if (workflowId || workflowIdAlias) {
      throw selectionError('VIDEO_WORKFLOW_NOT_ALLOWED', '仅 ComfyUI 通道支持 workflow_id');
    }
    const model = requestedModel || text(resolved.model);
    if (model && !allowed.includes(model)) {
      throw selectionError('VIDEO_MODEL_NOT_ALLOWED', `模型不在当前通道白名单中: ${model}`);
    }
    return { selectedWorkflowId: null, workflow: null, resolved: withSelectedModel(resolved, model) };
  }

  const aliases = [workflowId, workflowIdAlias, requestedModel].filter(Boolean);
  const unique = [...new Set(aliases)];
  if (unique.length > 1) {
    throw selectionError('VIDEO_WORKFLOW_CONFLICT', 'model、workflow_id 与 workflowId 必须指向同一工作流', {
      model: requestedModel || null,
      workflow_id: workflowId || null,
      workflowId: workflowIdAlias || null,
    });
  }

  const selectedWorkflowId = unique[0]
    || text(resolved.config.default_model)
    || text(resolved.model)
    || allowed[0];
  if (!selectedWorkflowId || !allowed.includes(selectedWorkflowId)) {
    throw selectionError('VIDEO_WORKFLOW_NOT_ALLOWED', `工作流不在当前通道白名单中: ${selectedWorkflowId || '(empty)'}`);
  }

  let workflow;
  try {
    workflow = selectWorkflow(registry, selectedWorkflowId, { allowExperimental });
  } catch (error) {
    if (error.status == null) error.status = 400;
    throw error;
  }
  return {
    selectedWorkflowId,
    workflow,
    resolved: withSelectedModel(resolved, selectedWorkflowId),
  };
}

module.exports = { resolveRequestedWorkflow };
