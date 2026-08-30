import request from '@/utils/request'

export const imageGenerationTaskAPI = {
  create(data) { return request.post('/image-generation-tasks', data) },
  get(taskId) { return request.get(`/image-generation-tasks/${encodeURIComponent(taskId)}`) },
  summary(dramaId) { return request.get(`/dramas/${encodeURIComponent(dramaId)}/image-generation-summary`) },
  environment(dramaId, params = {}) {
    const query = new URLSearchParams({ channel: params.channel || 'api' })
    if (params.targetType) query.set('targetType', params.targetType)
    if (params.targetId != null) query.set('targetId', params.targetId)
    return request.get(`/dramas/${encodeURIComponent(dramaId)}/image-generation-environment?${query.toString()}`)
  },
  getDefault(dramaId) { return request.get(`/dramas/${encodeURIComponent(dramaId)}/image-generation-default`) },
  setDefault(dramaId, channel) { return request.put(`/dramas/${encodeURIComponent(dramaId)}/image-generation-default`, { channel }) },
  createBatch(data) { return request.post('/image-generation-batches', data) },
  pauseBatch(id) { return request.post(`/image-generation-batches/${encodeURIComponent(id)}/pause`) },
  resumeBatch(id) { return request.post(`/image-generation-batches/${encodeURIComponent(id)}/resume`) },
  runNext(id) { return request.post(`/image-generation-batches/${encodeURIComponent(id)}/run-next`) },
  retry(id) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/retry`) },
  skip(id) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/skip`) },
  cancel(id) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/cancel`) },
  prepareSend(id) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/prepare-send`) },
  acknowledge(id, attemptId) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/acknowledge`, { attemptId }) },
  claimNext() { return request.post('/image-generation-tasks/claim-next') },
  failTask(id, message) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/fail`, { message }) },
  deferTask(id) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/defer`) },
  selectResult(id, resultId) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/select-result`, { resultId }) },
}
