import request from '@/utils/request'
const withKey = (payload = {}) => ({ ...payload, headers: { 'Idempotency-Key': crypto.randomUUID() } })
export const externalGenerationAPI = {
  createJob(payload) { return request.post('/external-generation/jobs', payload, withKey()) },
  prepareJob(jobId, references) { return request.post(`/external-generation/jobs/${jobId}/prepare`, { references }, withKey()) },
  createAttempt(jobId, payload) { return request.post(`/external-generation/jobs/${jobId}/attempts`, payload, withKey()) },
  getJob(jobId) { return request.get(`/external-generation/jobs/${jobId}`) },
  attachSession(dramaId, payload) { return request.post(`/external-generation/dramas/${dramaId}/session/attach`, payload, withKey()) },
  selectResult(resultId, storyboardId) { return request.post(`/external-generation/results/${resultId}/rebind`, { storyboardId }, withKey()) },
}
