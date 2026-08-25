const crypto = require('node:crypto');
const path = require('node:path');
const {
  buildStructuredWorkflowPrompt,
  readWorkflowTemplate,
  selectWorkflow,
  sha256File,
} = require('../../director/workflowRegistry');
const {
  validateH3Dimensions,
  validateVramBudget,
} = require('../../director/directorGenerationPolicy');

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

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

function contextSettings(context) {
  return {
    ...parseSettings(context?.config?.settings),
    ...parseSettings(context?.snapshot?.settings),
  };
}

function contextInput(context) {
  const input = context?.input || context?.request || context || {};
  const settings = contextSettings(context);
  return {
    ...input,
    width: input.width ?? settings.width,
    height: input.height ?? settings.height,
    frameRate: input.frameRate ?? input.frame_rate ?? settings.frame_rate,
    seed: input.seed ?? settings.seed,
    continuityMode: input.continuityMode ?? input.continuity_mode ?? settings.continuity_mode,
  };
}

function workflowIdFor(context) {
  const settings = contextSettings(context);
  return String(
    context?.workflowId
      || context?.model
      || context?.snapshot?.model
      || settings.workflow_id
      || context?.config?.default_model
      || ''
  ).trim();
}

function providerTaskIdFor(context) {
  const providerTaskId = String(context?.providerTaskId || context?.promptId || '').trim();
  if (!providerTaskId) throw new Error('COMFYUI_PROVIDER_TASK_ID_REQUIRED');
  return providerTaskId;
}

function normalizeVramMb(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount > 1024 * 1024 ? Math.round(amount / (1024 * 1024)) : Math.round(amount);
}

function detectedVramMb(systemStats) {
  const totals = (Array.isArray(systemStats?.devices) ? systemStats.devices : [])
    .map((device) => normalizeVramMb(device?.torch_vram_total || device?.vram_total))
    .filter((value) => value > 0);
  return totals.length ? Math.max(...totals) : 0;
}

function missingModels(selected, modelCatalog) {
  const available = new Set(Object.values(modelCatalog || {}).flat().map((value) => path.basename(String(value))));
  return selected.modelFiles.filter((file) => !available.has(path.basename(file)));
}

function modelFolders(selected) {
  return [...new Set((selected.runtimeLock?.models || [])
    .map((model) => String(model?.relativePath || '').replace(/\\/g, '/').split('/')[0])
    .filter(Boolean))];
}

function createComfyUIVideoProvider({
  registry,
  comfyClient,
  createComfyClient,
  gpuMutex,
  allowExperimental = false,
  leaseMs = 30 * 60 * 1000,
} = {}) {
  if (!registry) throw new Error('ComfyUI video provider requires a workflow registry');
  if (!comfyClient) throw new Error('ComfyUI video provider requires a ComfyUI client');
  if (!gpuMutex) throw new Error('ComfyUI video provider requires a GPU mutex');

  const leases = new Map();

  function select(context) {
    const workflowId = workflowIdFor(context);
    if (!workflowId) throw new Error('COMFYUI_WORKFLOW_ID_REQUIRED');
    return selectWorkflow(registry, workflowId, { allowExperimental });
  }

  function clientForConnection(context) {
    const baseUrl = String(context?.base_url || context?.config?.base_url || '').trim().replace(/\/$/, '');
    return baseUrl && typeof createComfyClient === 'function'
      ? createComfyClient(baseUrl)
      : comfyClient;
  }

  function releaseLease(providerTaskId) {
    const handle = leases.get(providerTaskId);
    if (!handle) return false;
    leases.delete(providerTaskId);
    return gpuMutex.release(handle);
  }

  function maintainActiveLease(providerTaskId, context) {
    const activeLeaseMs = Number(context.leaseMs || leaseMs);
    const existing = leases.get(providerTaskId);
    if (existing) {
      const renewed = gpuMutex.renew(existing, { leaseMs: activeLeaseMs });
      if (renewed) {
        leases.set(providerTaskId, renewed);
        return renewed;
      }
      leases.delete(providerTaskId);
    }
    const owner = String(context.taskId || context.videoGenerationId || `comfyui-recovered-${providerTaskId}`);
    const acquired = gpuMutex.acquire(owner, { leaseMs: activeLeaseMs });
    leases.set(providerTaskId, acquired);
    return acquired;
  }

  function normalized(providerTaskId, status, progress, output = null) {
    return {
      providerTaskId,
      status,
      progress: Number.isFinite(Number(progress)) ? Number(progress) : 0,
      output,
    };
  }

  async function submit(context = {}) {
    const selected = select(context);
    const input = contextInput(context);
    const dimensions = validateH3Dimensions(input);
    const normalizedInput = { ...input, ...dimensions };
    const settings = contextSettings(context);
    validateVramBudget(normalizedInput, {
      totalVramMb: settings.vram_budget_mb || process.env.DIRECTOR_VRAM_MB || 16303,
      reserveMb: settings.vram_reserve_mb || 512,
    });
    const template = readWorkflowTemplate(selected.workflowPath);
    const prompt = buildStructuredWorkflowPrompt(template, normalizedInput);
    const owner = String(context.taskId || context.videoGenerationId || `comfyui-${crypto.randomUUID()}`);
    const handle = gpuMutex.acquire(owner, { leaseMs: Number(context.leaseMs || leaseMs) });
    try {
      const submitted = await comfyClient.submitWorkflow({
        registry,
        workflowId: selected.id,
        prompt,
        inputs: normalizedInput,
        clientId: context.clientId,
      });
      leases.set(submitted.promptId, handle);
      return normalized(submitted.promptId, 'running', 0);
    } catch (error) {
      gpuMutex.release(handle);
      throw error;
    }
  }

  async function resolveCompletedOutput(context, providerTaskId, state) {
    if (state.output) return state.output;
    if (!state.history || typeof comfyClient.downloadOutput !== 'function') return state.history || null;
    const downloaded = await comfyClient.downloadOutput({
      history: state.history,
      promptId: providerTaskId,
      outputFileName: context.outputFileName,
    });
    const ffprobe = typeof comfyClient.probeArtifact === 'function'
      ? await comfyClient.probeArtifact(downloaded.artifactPath)
      : null;
    return { ...downloaded, ffprobe, history: state.history };
  }

  async function query(context = {}) {
    const providerTaskId = providerTaskIdFor(context);
    const state = await comfyClient.getPromptStatus(providerTaskId);
    const terminal = TERMINAL_STATUSES.has(state.status);
    if (terminal) releaseLease(providerTaskId);
    else maintainActiveLease(providerTaskId, context);
    const output = state.status === 'completed'
      ? await resolveCompletedOutput(context, providerTaskId, state)
      : state.output || null;
    return normalized(providerTaskId, state.status, state.progress, output);
  }

  async function cancel(context = {}) {
    const providerTaskId = providerTaskIdFor(context);
    await comfyClient.cancel(providerTaskId);
    releaseLease(providerTaskId);
    return normalized(providerTaskId, 'cancelled', 100);
  }

  async function recover(context = {}) {
    return query(context);
  }

  async function testConnection(context = {}) {
    const selected = select(context);
    const dimensions = validateH3Dimensions(contextInput(context));
    const connectionClient = clientForConnection(context);
    const actualSha256 = sha256File(selected.workflowPath);
    if (actualSha256 !== selected.workflowSha256) {
      throw new Error(`ComfyUI 工作流 SHA-256 校验失败: ${selected.id}`);
    }

    const systemStats = await connectionClient.getSystemStats();
    const queue = await connectionClient.getQueue();
    const objectInfo = await connectionClient.getObjectInfo();
    const folders = modelFolders(selected);
    const models = await connectionClient.getModels(folders);

    const requiredNodes = [...new Set([...(selected.requiredNodes || []), ...(selected.customNodes || [])])];
    const absentNodes = requiredNodes.filter((node) => !Object.prototype.hasOwnProperty.call(objectInfo || {}, node));
    if (absentNodes.length) throw new Error(`ComfyUI 缺少必需节点: ${absentNodes.join(', ')}`);
    const absentModels = missingModels(selected, models);
    if (absentModels.length) throw new Error(`ComfyUI 缺少必需模型: ${absentModels.join(', ')}`);

    const totalVramMb = detectedVramMb(systemStats);
    if (!totalVramMb) throw new Error('ComfyUI 未返回可用的 GPU 显存信息');
    const settings = contextSettings(context);
    const vram = validateVramBudget(dimensions, {
      totalVramMb: Math.min(totalVramMb, Number(settings.vram_budget_mb || totalVramMb)),
      reserveMb: Number(settings.vram_reserve_mb || 512),
    });

    return normalized(null, 'completed', 100, {
      workflow: { id: selected.id, status: selected.status, sha256: actualSha256 },
      queue,
      nodes: { required: requiredNodes },
      models: { required: [...selected.modelFiles], folders },
      vram: { ...vram, totalVramMb },
      inferenceStarted: false,
    });
  }

  return { submit, query, cancel, recover, testConnection };
}

module.exports = { createComfyUIVideoProvider };
