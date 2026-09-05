import request from '@/utils/request'

export const episodeAudioAPI = {
  updatePlan(episodeId, audioPlan, unlockFields = []) {
    return request.patch(`/episodes/${episodeId}/audio-plan`, { audio_plan: audioPlan, unlock_fields: unlockFields })
  },
  planWithAI(episodeId) {
    return request.post(`/episodes/${episodeId}/audio-plan/plan`)
  },
}
