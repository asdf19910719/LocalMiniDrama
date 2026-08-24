import request from '@/utils/request'

export const directorAPI = {
  getQueue() {
    return request.get('/director/queue')
  },
  getStorage() {
    return request.get('/director/storage')
  },
  cleanupStorage(payload = {}) {
    return request.post('/director/storage/cleanup', payload)
  },
  createBundle(artifactIds) {
    return request.post('/director/bundles', { artifactIds })
  },
  restoreBundle(bundleName) {
    return request.post('/director/bundles/restore', { bundleName })
  },
  generateCandidates(shotId, payload) {
    return request.post(`/director/shots/${shotId}/generate`, payload)
  },
  getShotCandidates(shotId) {
    return request.get(`/director/shots/${shotId}/candidates`)
  },
  getJob(jobId) {
    return request.get(`/director/jobs/${jobId}`)
  },
  cancelJob(jobId) {
    return request.post(`/director/jobs/${jobId}/cancel`)
  },
  retryJob(jobId) {
    return request.post(`/director/jobs/${jobId}/retry`)
  },
  createCandidateGroup(shotId, candidates) {
    return request.post(`/director/shots/${shotId}/candidates`, { candidates })
  },
  getCandidateGroup(groupId) {
    return request.get(`/director/candidates/${groupId}`)
  },
  reviewCandidateGroup(groupId) {
    return request.post(`/director/candidates/${groupId}/review`)
  },
  selectCandidate(groupId, candidateId, reason, selectedBy = 'user') {
    return request.post(`/director/candidates/${groupId}/select`, {
      candidate_id: candidateId,
      reason,
      selected_by: selectedBy,
    })
  },
  getTimelineStatus(timelineId) {
    return request.get(`/director/timelines/${timelineId}`)
  },
  createTimeline(payload) {
    return request.post('/director/timelines', payload)
  },
  renderTimeline(timelineId) {
    return request.post(`/director/timelines/${timelineId}/render`)
  },
  createAnchor(payload) {
    return request.post('/director/anchors', payload)
  },
  listAnchors(artifactId) {
    return request.get(`/director/artifacts/${artifactId}/anchors`)
  },
  analyzeArtifact(artifactId) {
    return request.post(`/director/artifacts/${artifactId}/analyze`)
  },
}
