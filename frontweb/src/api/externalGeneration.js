import request from '@/utils/request'
const config = () => ({ headers: { 'Idempotency-Key': crypto.randomUUID() } })
export const externalGenerationAPI = {
  createJob(payload) { return request.post('/external-generation/jobs', payload, config()) },
  prepareJob(jobId, references) { return request.post(`/external-generation/jobs/${jobId}/prepare`, { references }, config()) },
  createAttempt(jobId, payload) { return request.post(`/external-generation/jobs/${jobId}/attempts`, payload, config()) },
  getJob(jobId) { return request.get(`/external-generation/jobs/${jobId}`) },
  attachSession(dramaId, payload) { return request.post(`/external-generation/dramas/${dramaId}/session/attach`, payload, config()) },
  selectResult(resultId, storyboardId) { return request.post(`/external-generation/results/${resultId}/rebind`, { storyboardId }, config()) },
}
