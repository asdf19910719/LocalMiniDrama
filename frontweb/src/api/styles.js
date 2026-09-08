import request from '@/utils/request'

export const stylesAPI = {
  list(params) {
    return request.get('/styles', { params: params || {} })
  },
  get(id) {
    return request.get(`/styles/${encodeURIComponent(id)}`)
  },
  create(data) {
    return request.post('/styles/custom', data)
  },
  update(id, data) {
    return request.put(`/styles/custom/${encodeURIComponent(id)}`, data)
  },
  remove(id) {
    return request.delete(`/styles/custom/${encodeURIComponent(id)}`)
  },
}
