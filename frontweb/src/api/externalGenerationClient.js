function createKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `external-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createExternalGenerationAPI(request, keyFactory = createKey) {
  if (!request) throw new Error('request client is required');
  const config = () => ({ headers: { 'Idempotency-Key': keyFactory() } });
  return {
    createJob(payload) { return request.post('/external-generation/jobs', payload, config()); },
    prepareJob(jobId, references) { return request.post(`/external-generation/jobs/${encodeURIComponent(jobId)}/prepare`, { references }, config()); },
    createAttempt(jobId, payload) { return request.post(`/external-generation/jobs/${encodeURIComponent(jobId)}/attempts`, payload, config()); },
    listJobs(dramaId) { return request.get(`/external-generation/dramas/${encodeURIComponent(dramaId)}/jobs`); },
    recordAttemptEvent(attemptId, payload) { return request.post(`/external-generation/attempts/${encodeURIComponent(attemptId)}/events`, payload, config()); },
    importResult(formData) { return request.post('/external-generation/results/import', formData, config()); },
    getJob(jobId) { return request.get(`/external-generation/jobs/${encodeURIComponent(jobId)}`); },
    attachSession(dramaId, payload) { return request.post(`/external-generation/dramas/${encodeURIComponent(dramaId)}/session/attach`, payload, config()); },
    selectResult(resultId, storyboardId) { return request.post(`/external-generation/results/${encodeURIComponent(resultId)}/rebind`, { storyboardId }, config()); },
  };
}
