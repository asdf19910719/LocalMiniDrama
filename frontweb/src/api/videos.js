import request from '@/utils/request'

export const videosAPI = {
  list(params) {
    return request.get('/videos', { params: params || {} })
  },
  get(id) {
    return request.get(`/videos/${id}`)
  },
  async getDefaultConfig() {
    const rows = await request.get('/ai-configs', { params: { service_type: 'video' } })
    return (Array.isArray(rows) ? rows : []).find((item) => item.is_active && item.is_default) || null
  },
  /** 创建单条分镜视频生成任务，body: { drama_id, storyboard_id, prompt, image_url?, model?, ... } */
  create(body) {
    return request.post('/videos', body)
  },
  async prepareAndCreate(body) {
    const result = await request.post('/videos/prepared', body)
    return result?.generation || result
  },
  prepareAndCreateMany(inputs) {
    return request.post('/videos/prepared/batch', { inputs: Array.isArray(inputs) ? inputs : [] })
  },
  capabilities() {
    return request.get('/videos/capabilities')
  },
  previewH3Prompt(body) {
    return request.post('/videos/h3-preview', body)
  },
  cancel(id) {
    return request.post(`/videos/${id}/cancel`)
  },
  retry(id) {
    return request.post(`/videos/${id}/retry`)
  },
  /** 失败后复用已存上游 task 继续轮询，返回 video_generations 记录（含 task_id） */
  resumePoll(id) {
    return request.post(`/videos/${id}/resume-poll`)
  },
  getCandidateHistory(storyboardId) {
    return request.get(`/director/shots/${storyboardId}/candidates`)
  },
  generateCandidates(storyboardId, body) {
    return request.post(`/director/shots/${storyboardId}/generate`, body)
  },
  cancelCandidate(candidate) {
    const videoId = candidate?.video_generation_id || candidate?.video_generation?.id
    if (videoId != null) return request.post(`/videos/${videoId}/cancel`)
    return request.post(`/director/jobs/${candidate?.job_id}/cancel`)
  },
  retryCandidate(candidate) {
    const videoId = candidate?.video_generation_id || candidate?.video_generation?.id
    if (videoId != null) return request.post(`/videos/${videoId}/retry`)
    return request.post(`/director/jobs/${candidate?.job_id}/retry`)
  },
  selectCandidate(groupId, candidateId, reason, selectedBy = 'user') {
    return request.post(`/director/candidates/${groupId}/select`, {
      candidate_id: candidateId,
      reason,
      selected_by: selectedBy,
    })
  },
  listAnchors(artifactId) {
    return request.get(`/director/artifacts/${artifactId}/anchors`)
  },
  createAnchor(body) {
    return request.post('/director/anchors', body)
  },
  analyzeCandidate(candidate) {
    const artifactId = candidate?.artifact?.id || candidate?.artifact_id
    if (!artifactId || String(artifactId).startsWith('pending-video-')) {
      return Promise.reject(new Error('当前候选没有可检查的本地产物'))
    }
    return request.post(`/director/artifacts/${artifactId}/analyze`)
  },
}
