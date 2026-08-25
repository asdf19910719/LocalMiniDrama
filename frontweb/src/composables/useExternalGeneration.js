import { ref } from 'vue'
import { externalGenerationAPI } from '@/api/externalGeneration'
export function useExternalGeneration() {
  const state = ref('idle'); const job = ref(null); const error = ref(null)
  async function prepare(payload, references = []) { state.value = 'preparing'; error.value = null; try { job.value = await externalGenerationAPI.createJob(payload); await externalGenerationAPI.prepareJob(job.value.id, references); state.value = 'ready'; return job.value } catch (e) { error.value = e; state.value = 'failed'; throw e } }
  async function refresh() { if (job.value) job.value = await externalGenerationAPI.getJob(job.value.id); return job.value }
  return { state, job, error, prepare, refresh }
}
