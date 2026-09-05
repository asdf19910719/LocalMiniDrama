import request from '@/utils/request'

export const videoUpscaleAPI = {
  capabilities() {
    return request.get('/video-upscale/capabilities')
  },
  getJob(id) {
    return request.get(`/video-upscale/jobs/${encodeURIComponent(id)}`)
  },
  retry(id) {
    return request.post(`/video-upscale/jobs/${encodeURIComponent(id)}/retry`)
  },
  skip(id) {
    return request.post(`/video-upscale/jobs/${encodeURIComponent(id)}/skip`)
  },
  cancel(id) {
    return request.post(`/video-upscale/jobs/${encodeURIComponent(id)}/cancel`)
  },
}
