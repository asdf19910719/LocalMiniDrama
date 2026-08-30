import request from '@/utils/request'

export const episodeGenerationProgressAPI = {
  get(episodeId) {
    return request.get(`/episodes/${encodeURIComponent(episodeId)}/generation-progress`)
  },
}
