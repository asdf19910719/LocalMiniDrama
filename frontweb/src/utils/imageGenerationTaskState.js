const POLLING_STATUSES = new Set(['submitted', 'generating'])

export function normalizeImageGenerationTask(task) {
  if (!task || typeof task !== 'object') return task
  const nestedCandidates = (task.external_job?.attempts || [])
    .flatMap((attempt) => Array.isArray(attempt?.results) ? attempt.results : [])
  const candidates = Array.isArray(task.candidates) && task.candidates.length
    ? task.candidates
    : nestedCandidates
  return { ...task, candidates }
}

export function shouldPollImageGenerationTask(task) {
  return task?.generation_channel === 'chatgpt_web' && POLLING_STATUSES.has(task?.status)
}

export function shouldRecoverImageGenerationTask(task) {
  return task?.generation_channel === 'chatgpt_web' && (
    POLLING_STATUSES.has(task?.status)
    || (task?.status === 'needs_review' && task?.error_code === 'result_timeout')
  )
}

export function shouldReattachImageGenerationTask({ currentTaskId, activeTaskId, allowReattach = true }) {
  return Boolean(allowReattach && activeTaskId && currentTaskId !== activeTaskId)
}

export function resolveChatGPTPrepareAction(prepared) {
  if (!prepared?.already_submitted) return 'send'
  return ['submitted', 'generating'].includes(prepared?.task?.status) ? 'recover' : 'review'
}
