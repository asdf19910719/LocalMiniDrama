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
