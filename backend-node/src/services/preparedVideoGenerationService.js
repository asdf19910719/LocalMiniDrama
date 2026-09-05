const { resolveDefaultVideoConfig } = require('./videoConfigResolver');
const { isH3VideoConfig, VideoLifecycleError } = require('./unifiedVideoGenerationService');
const { createH3PromptDraftService } = require('./h3PromptDraftService');

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}

function readyDraft(draft) {
  return Boolean(draft) && (
    draft.status === 'valid'
    || (draft.status === 'needs_review' && Number(draft.semantic_review_confirmed) === 1)
  );
}

function createPreparedVideoGenerationService({
  db = null,
  log = console,
  workflowRegistry = null,
  lifecycleService = null,
  resolveRuntime = null,
  drafts = null,
  createVideoGeneration = null,
} = {}) {
  const draftService = drafts || (db ? createH3PromptDraftService({ workflowRegistry }) : null);
  const create = createVideoGeneration || lifecycleService?.createVideoGeneration?.bind(lifecycleService);
  if (typeof create !== 'function') throw new Error('Prepared video generation requires createVideoGeneration');
  const inFlight = new Map();

  function runtimeFor(input) {
    if (typeof resolveRuntime === 'function') return resolveRuntime(input);
    const resolved = resolveDefaultVideoConfig(db, { requestedModel: input.model });
    const workflowId = input.workflow_id || input.workflowId || resolved.model;
    return {
      ...resolved,
      isH3: isH3VideoConfig(resolved),
      configId: resolved.config.id,
      workflowId,
    };
  }

  async function prepareH3(input, runtime) {
    const storyboardId = Number(input.storyboard_id ?? input.storyboardId);
    if (!Number.isFinite(storyboardId)) {
      throw new VideoLifecycleError('H3_STORYBOARD_REQUIRED', 'H3 生成必须绑定项目分镜', 400);
    }
    const configId = runtime.configId ?? runtime.config?.id;
    const workflowId = runtime.workflowId ?? input.workflow_id ?? input.workflowId ?? runtime.model;
    const requestedDraftId = input.h3_prompt_draft_id ?? input.h3PromptDraftId;
    let draft = requestedDraftId != null && typeof draftService.getDraftById === 'function'
      ? draftService.getDraftById(db, requestedDraftId)
      : null;
    let reusedDraft = false;
    if (!draft && typeof draftService.getLatestDraft === 'function') {
      draft = draftService.getLatestDraft(db, storyboardId, String(configId), workflowId);
    }
    if (draft && readyDraft(draft)) {
      const freshness = typeof draftService.evaluateDraftFreshness === 'function'
        ? draftService.evaluateDraftFreshness(db, draft)
        : { stale: false };
      reusedDraft = !freshness.stale;
      if (freshness.stale) draft = null;
    } else if (draft?.status === 'needs_review') {
      throw new VideoLifecycleError('H3_SEMANTIC_REVIEW_REQUIRED', 'H3 音频语义需要人工确认后才能生成', 409);
    } else {
      draft = null;
    }
    if (!draft) {
      draft = await draftService.compileDraft(db, {}, log, {
        storyboardId,
        videoConfigId: configId,
        workflowId,
      });
      if (!readyDraft(draft)) {
        throw new VideoLifecycleError(
          draft?.status === 'needs_review' ? 'H3_SEMANTIC_REVIEW_REQUIRED' : 'H3_DRAFT_INVALID',
          draft?.status === 'needs_review' ? 'H3 音频语义需要人工确认后才能生成' : 'H3 提示词草稿校验失败',
          409,
          { draft_id: draft?.id ?? null },
        );
      }
    }
    const snapshot = parseObject(draft.reference_snapshot);
    const imageUrls = (Array.isArray(snapshot.slots) ? snapshot.slots : [])
      .filter((slot) => slot?.image_available && String(slot.image_url || '').trim())
      .map((slot) => String(slot.image_url).trim());
    const referenceAudios = Array.isArray(snapshot.audio) ? snapshot.audio : [];
    return {
      draft,
      reusedDraft,
      input: {
        ...input,
        storyboard_id: storyboardId,
        h3_prompt_draft_id: draft.id,
        workflow_id: workflowId,
        ...(imageUrls.length ? { reference_image_urls: imageUrls } : {}),
        reference_audios: referenceAudios,
      },
    };
  }

  async function prepareAndCreateVideoGeneration(input = {}) {
    const runtime = await runtimeFor(input);
    if (!runtime?.isH3) {
      return { generation: await create(input), draft: null, reusedDraft: false };
    }
    const key = [input.storyboard_id ?? input.storyboardId, runtime.configId ?? runtime.config?.id, runtime.workflowId ?? runtime.model].join(':');
    let preparation = inFlight.get(key);
    if (!preparation) {
      preparation = prepareH3(input, runtime).finally(() => inFlight.delete(key));
      inFlight.set(key, preparation);
    }
    // Only preparation is de-duplicated. Every caller still creates its own
    // candidate generation after sharing the same immutable prompt draft.
    const prepared = await preparation;
    const generation = await create(prepared.input);
    return { generation, draft: prepared.draft, reusedDraft: prepared.reusedDraft };
  }

  async function prepareAndCreateMany(inputs = []) {
    return Promise.all((Array.isArray(inputs) ? inputs : []).map(async (input) => {
      const storyboardId = input?.storyboard_id ?? input?.storyboardId ?? null;
      try {
        const result = await prepareAndCreateVideoGeneration(input || {});
        return { storyboard_id: storyboardId, status: 'created', generation_id: result.generation?.id ?? null, error: null };
      } catch (error) {
        return {
          storyboard_id: storyboardId,
          status: 'failed',
          generation_id: null,
          error: { code: error.code || 'VIDEO_PREPARATION_FAILED', message: error.message, details: error.details },
        };
      }
    }));
  }

  return { prepareAndCreateVideoGeneration, prepareAndCreateMany };
}

module.exports = { createPreparedVideoGenerationService, readyDraft };
