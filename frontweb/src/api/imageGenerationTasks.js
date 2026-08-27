import request from '@/utils/request'

export const imageGenerationTaskAPI = {
  create(data) { return request.post('/image-generation-tasks', data) },
  get(taskId) { return request.get(`/image-generation-tasks/${encodeURIComponent(taskId)}`) },
  summary(dramaId) { return request.get(`/dramas/${encodeURIComponent(dramaId)}/image-generation-summary`) },
  getDefault(dramaId) { return request.get(`/dramas/${encodeURIComponent(dramaId)}/image-generation-default`) },
  setDefault(dramaId, channel) { return request.put(`/dramas/${encodeURIComponent(dramaId)}/image-generation-default`, { channel }) },
  createBatch(data) { return request.post('/image-generation-batches', data) },
  pauseBatch(id) { return request.post(`/image-generation-batches/${encodeURIComponent(id)}/pause`) },
  resumeBatch(id) { return request.post(`/image-generation-batches/${encodeURIComponent(id)}/resume`) },
  runNext(id) { return request.post(`/image-generation-batches/${encodeURIComponent(id)}/run-next`) },
  retry(id) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/retry`) },
  skip(id) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/skip`) },
  cancel(id) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/cancel`) },
  selectResult(id, resultId) { return request.post(`/image-generation-tasks/${encodeURIComponent(id)}/select-result`, { resultId }) },
}
