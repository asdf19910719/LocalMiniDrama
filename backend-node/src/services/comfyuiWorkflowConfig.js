const { selectWorkflow } = require('../director/workflowRegistry');

function configError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = 400;
  return error;
}

function modelValues(value) {
  let values = value;
  if (!Array.isArray(values) && typeof values === 'string') {
    try { values = JSON.parse(values); } catch (_) { values = [values]; }
  }
  if (!Array.isArray(values)) values = values == null ? [] : [values];
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeAndValidateComfyuiWorkflowConfig(candidate = {}, registry, options = {}) {
  const model = modelValues(candidate.model);
  if (!model.length) {
    throw configError('COMFYUI_WORKFLOW_LIST_EMPTY', 'ComfyUI 视频通道至少需要选择一个工作流');
  }
  const defaultModel = String(candidate.default_model || '').trim();
  if (!defaultModel || !model.includes(defaultModel)) {
    throw configError('COMFYUI_DEFAULT_WORKFLOW_NOT_ALLOWED', '默认工作流必须属于当前通道白名单');
  }
  for (const workflowId of model) {
    try {
      selectWorkflow(registry, workflowId, { allowExperimental: options.allowExperimental === true });
    } catch (error) {
      if (error.status == null) error.status = 400;
      throw error;
    }
  }
  return { model, default_model: defaultModel };
}

module.exports = { normalizeAndValidateComfyuiWorkflowConfig, modelValues };
