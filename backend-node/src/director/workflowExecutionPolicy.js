'use strict';

const PROMPT_CONTRACTS = new Set(['h3_director_v1', 'free_text_v1']);
const VRAM_POLICIES = new Set(['h3_estimate', 'none']);

function policyError(workflowId, message, code = 'WORKFLOW_EXECUTION_INVALID') {
  const error = new Error(`工作流 ${workflowId || '(unknown)'} 执行契约无效：${message}`);
  error.code = code;
  error.status = 400;
  return error;
}

function positiveInteger(value, field, workflowId, { allowZero = false } = {}) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) {
    throw policyError(workflowId, `${field} 必须是${allowZero ? '非负' : '正'}整数`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (allowZero ? number < 0 : number <= 0)) {
    throw policyError(workflowId, `${field} 必须是${allowZero ? '非负' : '正'}整数`);
  }
  return number;
}

function positiveNumber(value, field, workflowId) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) {
    throw policyError(workflowId, `${field} 必须大于 0`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw policyError(workflowId, `${field} 必须大于 0`);
  return number;
}

function validateWorkflowExecution(execution, workflowId = '') {
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    throw policyError(workflowId, '缺少 execution 对象');
  }
  const promptContract = String(execution.promptContract || '').trim();
  if (!PROMPT_CONTRACTS.has(promptContract)) throw policyError(workflowId, `不支持 promptContract=${promptContract || '(empty)'}`);
  if (typeof execution.requiresPromptDraft !== 'boolean') throw policyError(workflowId, 'requiresPromptDraft 必须是布尔值');
  const vramPolicy = String(execution.vramPolicy || '').trim();
  if (!VRAM_POLICIES.has(vramPolicy)) throw policyError(workflowId, `不支持 vramPolicy=${vramPolicy || '(empty)'}`);

  const dimensions = execution.dimensions;
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) throw policyError(workflowId, '缺少 dimensions');
  const normalizedDimensions = {
    minWidth: positiveInteger(dimensions.minWidth, 'dimensions.minWidth', workflowId),
    maxWidth: positiveInteger(dimensions.maxWidth, 'dimensions.maxWidth', workflowId),
    minHeight: positiveInteger(dimensions.minHeight, 'dimensions.minHeight', workflowId),
    maxHeight: positiveInteger(dimensions.maxHeight, 'dimensions.maxHeight', workflowId),
    multipleOf: positiveInteger(dimensions.multipleOf, 'dimensions.multipleOf', workflowId),
  };
  if (normalizedDimensions.maxWidth < normalizedDimensions.minWidth
    || normalizedDimensions.maxHeight < normalizedDimensions.minHeight) {
    throw policyError(workflowId, 'dimensions 最大值不得小于最小值');
  }

  const references = execution.references;
  if (!references || typeof references !== 'object' || Array.isArray(references)) throw policyError(workflowId, '缺少 references');
  const normalizedReferences = {
    min: positiveInteger(references.min, 'references.min', workflowId, { allowZero: true }),
    max: positiveInteger(references.max, 'references.max', workflowId, { allowZero: true }),
  };
  if (normalizedReferences.max < normalizedReferences.min) throw policyError(workflowId, 'references.max 不得小于 min');

  const defaults = execution.defaults;
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) throw policyError(workflowId, '缺少 defaults');
  const normalizedDefaults = {
    width: positiveInteger(defaults.width, 'defaults.width', workflowId),
    height: positiveInteger(defaults.height, 'defaults.height', workflowId),
    durationSeconds: positiveNumber(defaults.durationSeconds, 'defaults.durationSeconds', workflowId),
    frameRate: positiveNumber(defaults.frameRate, 'defaults.frameRate', workflowId),
    seed: positiveInteger(defaults.seed, 'defaults.seed', workflowId, { allowZero: true }),
  };
  validateDimensions(normalizedDefaults, normalizedDimensions, workflowId);
  return {
    promptContract,
    requiresPromptDraft: execution.requiresPromptDraft,
    dimensions: normalizedDimensions,
    references: normalizedReferences,
    vramPolicy,
    defaults: normalizedDefaults,
  };
}

function validateDimensions(value, dimensions, workflowId) {
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < dimensions.minWidth || width > dimensions.maxWidth
    || height < dimensions.minHeight || height > dimensions.maxHeight
    || width % dimensions.multipleOf !== 0 || height % dimensions.multipleOf !== 0) {
    const error = new Error(`工作流 ${workflowId} 尺寸必须在允许范围内且为 ${dimensions.multipleOf} 的倍数`);
    error.code = 'VIDEO_DIMENSIONS_INVALID';
    error.status = 400;
    throw error;
  }
  return { width, height };
}

function parseSettings(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function resolveWorkflowParameters(workflow, input = {}, config = {}) {
  const execution = validateWorkflowExecution(workflow?.execution, workflow?.id);
  const settings = parseSettings(config.settings);
  const overrides = parseSettings(settings.workflow_overrides?.[workflow.id]);
  const legacy = String(config.default_model || '') === String(workflow.id || '') ? settings : {};
  const defaults = execution.defaults;
  const params = {
    width: Number(firstDefined(input.width, overrides.width, legacy.width, defaults.width)),
    height: Number(firstDefined(input.height, overrides.height, legacy.height, defaults.height)),
    durationSeconds: Number(firstDefined(input.durationSeconds, input.duration, overrides.durationSeconds, overrides.duration, legacy.durationSeconds, legacy.duration, defaults.durationSeconds)),
    frameRate: Number(firstDefined(input.frameRate, input.frame_rate, overrides.frameRate, overrides.frame_rate, legacy.frameRate, legacy.frame_rate, defaults.frameRate)),
    seed: Number(firstDefined(input.seed, overrides.seed, legacy.seed, defaults.seed)),
  };
  validateDimensions(params, execution.dimensions, workflow.id);
  if (!Number.isFinite(params.durationSeconds) || params.durationSeconds <= 0
    || !Number.isFinite(params.frameRate) || params.frameRate <= 0
    || !Number.isSafeInteger(params.seed) || params.seed < 0) {
    throw policyError(workflow.id, '时长、帧率或随机种子无效', 'VIDEO_PARAMETERS_INVALID');
  }
  return params;
}

function workflowRequiresDraft(workflow) {
  return workflow?.execution?.requiresPromptDraft === true;
}

function validateWorkflowReferences(workflow, references) {
  const execution = validateWorkflowExecution(workflow?.execution, workflow?.id);
  const list = Array.isArray(references) ? references : (references == null || references === '' ? [] : [references]);
  if (list.length < execution.references.min || list.length > execution.references.max) {
    const error = new Error(`工作流 ${workflow?.id || ''} 参考图数量必须为 ${execution.references.min}-${execution.references.max} 张`);
    error.code = 'VIDEO_REFERENCE_COUNT_INVALID';
    error.status = 400;
    throw error;
  }
  return list;
}

module.exports = {
  PROMPT_CONTRACTS,
  VRAM_POLICIES,
  validateWorkflowExecution,
  workflowRequiresDraft,
  resolveWorkflowParameters,
  validateWorkflowReferences,
};
