import { computed, ref } from 'vue'
import { externalGenerationAPI } from '@/api/externalGeneration'

export function useExternalGeneration() {
  const state = ref('idle')
  const job = ref(null)
  const error = ref(null)
  const requestVersion = ref(0)
  const results = computed(() => (job.value?.attempts || []).flatMap((attempt) => (attempt.results || []).map((result) => ({ ...result, attempt }))))

  async function prepare(payload, references = []) {
    const version = ++requestVersion.value
    state.value = 'preparing'
    error.value = null
    try {
      const created = await externalGenerationAPI.createJob(payload)
      await externalGenerationAPI.prepareJob(created.id, references)
      const loaded = await externalGenerationAPI.getJob(created.id)
      if (version === requestVersion.value) {
        job.value = loaded
        state.value = 'ready'
      }
      return loaded
    } catch (e) {
      if (version === requestVersion.value) { error.value = e; state.value = 'failed' }
      throw e
    }
  }

  async function refresh() {
    if (!job.value) return null
    const version = ++requestVersion.value
    const loaded = await externalGenerationAPI.getJob(job.value.id)
    if (version === requestVersion.value) job.value = loaded
    return loaded
  }

  async function restoreLatest(dramaId, storyboardId) {
    const version = ++requestVersion.value
    error.value = null
    try {
      const loaded = await externalGenerationAPI.restoreLatestJob(dramaId, storyboardId)
      if (version === requestVersion.value) {
        job.value = loaded
        state.value = loaded ? ((loaded.attempts || []).some((attempt) => (attempt.results || []).length) ? 'review' : 'ready') : 'idle'
      }
      return loaded
    } catch (e) {
      if (version === requestVersion.value) { error.value = e; state.value = 'failed' }
      throw e
    }
  }

  async function createAttempt(input = {}) {
    if (!job.value) throw new Error('Prepare a job first')
    state.value = 'sending'
    error.value = null
    try {
      const attempt = await externalGenerationAPI.createAttempt(job.value.id, input)
      await refresh()
      state.value = 'generating'
      return attempt
    } catch (e) {
      error.value = e
      state.value = 'failed'
      throw e
    }
  }

  async function selectResult(resultId, storyboardId) {
    state.value = 'review'
    error.value = null
    try {
      const result = await externalGenerationAPI.selectResult(resultId, storyboardId)
      await refresh()
      return result
    } catch (e) {
      error.value = e
      state.value = 'failed'
      throw e
    }
  }

  return { state, job, results, error, prepare, restoreLatest, refresh, createAttempt, selectResult }
}
