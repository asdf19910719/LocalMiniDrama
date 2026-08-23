import request from '@/utils/request'

export const directorAPI = {
  getShotCandidates(shotId) {
    return request.get(`/director/shots/${shotId}/candidates`)
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
}
