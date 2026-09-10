import axios from 'axios'

// V2.1 Production Studio API 客户端（/api/v2 影子路由）
const http = axios.create({ baseURL: '/api/v2', timeout: 600000 })

function unwrap(res) {
  return res.data && res.data.data !== undefined ? res.data.data : res.data
}

function toError(err) {
  const code = err?.response?.data?.error?.code || 'NETWORK_ERROR'
  const message = err?.response?.data?.error?.message || err?.message || '请求失败'
  const status = err?.response?.status || 0
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

async function get(url, params) {
  try { return unwrap(await http.get(url, { params })) } catch (e) { throw toError(e) }
}
async function post(url, body) {
  try { return unwrap(await http.post(url, body || {})) } catch (e) { throw toError(e) }
}
async function put(url, body) {
  try { return unwrap(await http.put(url, body || {})) } catch (e) { throw toError(e) }
}
async function patch(url, body) {
  try { return unwrap(await http.patch(url, body || {})) } catch (e) { throw toError(e) }
}
async function del(url) {
  try { return unwrap(await http.delete(url)) } catch (e) { throw toError(e) }
}

export const v21 = {
  // 项目
  listProjects: (params) => get('/projects', params),
  createProject: (body) => post('/projects', body),
  getOverview: (projectId) => get(`/projects/${projectId}/overview`),
  updateProject: (projectId, body) => patch(`/projects/${projectId}`, body),
  applyStyle: (projectId, styleId) => put(`/projects/${projectId}/style`, { styleId }),
  deleteProject: (projectId) => del(`/projects/${projectId}`),
  restoreProject: (projectId) => post(`/projects/${projectId}/restore`),
  // 风格目录（复用既有接口）
  listStyles: async (params) => {
    const data = await axios.get('/api/v1/styles', { params }).then(unwrap)
    return data && Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : [])
  },
  // 剧集
  listEpisodes: (projectId, params) => get(`/projects/${projectId}/episodes`, params),
  createEpisode: (projectId, body) => post(`/projects/${projectId}/episodes`, body),
  listBlankEpisodes: (projectId) => get(`/projects/${projectId}/episodes/blank`),
  getEpisode: (episodeId) => get(`/episodes/${episodeId}`),
  renameEpisode: (episodeId, title) => patch(`/episodes/${episodeId}`, { title }),
  reorderEpisodes: (projectId, order) => put(`/projects/${projectId}/episodes/order`, { order }),
  deleteEpisode: (episodeId) => del(`/episodes/${episodeId}`),
  restoreEpisode: (episodeId) => post(`/episodes/${episodeId}/restore`),
  getImportSource: (episodeId) => get(`/episodes/${episodeId}/import-source`),
  // 剧本
  getScript: (episodeId) => get(`/episodes/${episodeId}/script`),
  saveScriptDraft: (episodeId, body) => put(`/episodes/${episodeId}/script/draft`, body),
  generateAiCandidate: (episodeId, body) => post(`/episodes/${episodeId}/script/ai-candidate`, body),
  applyAiCandidate: (episodeId, candidate) => post(`/episodes/${episodeId}/script/ai-candidate/apply`, { candidate }),
  confirmScript: (episodeId, expectedRevision) => post(`/episodes/${episodeId}/script/confirm`, { expectedRevision }),
  copyScriptHistory: (episodeId, revision) => post(`/episodes/${episodeId}/script/history/${revision}/copy`),
  // 项目素材
  listAssets: (projectId, params) => get(`/projects/${projectId}/assets`, params),
  createAsset: (projectId, body) => post(`/projects/${projectId}/assets`, body),
  getAssetDetail: (type, assetId) => get(`/assets/${type}/${assetId}`),
  generateAssetCandidate: (projectId, body) => post(`/projects/${projectId}/assets/generate-candidate`, body),
  useCandidate: (body) => post('/assets/use-candidate', body),
  deleteAsset: (type, assetId) => del(`/assets/${type}/${assetId}`),
  // 本集设定
  getEpisodeAssets: (episodeId) => get(`/episodes/${episodeId}/assets`),
  updateSelection: (episodeId, body) => put(`/episodes/${episodeId}/assets/selection`, body),
  enterStoryboard: (episodeId) => post(`/episodes/${episodeId}/enter-storyboard`),
  getMediaGuard: (episodeId, shot) => get(`/episodes/${episodeId}/media-guard`, { shot }),
  // 分镜
  createFromScript: (episodeId) => post(`/episodes/${episodeId}/storyboard/create-from-script`),
  getStoryboard: (episodeId) => get(`/episodes/${episodeId}/storyboard`),
  getShot: (shotId) => get(`/storyboards/${shotId}`),
  editSegment: (shotId, segmentId, body) => patch(`/storyboards/${shotId}/segments/${segmentId}`, body),
  splitSegment: (shotId, segmentId, atSeconds) => post(`/storyboards/${shotId}/segments/${segmentId}/split`, { atSeconds }),
  mergeSegment: (shotId, segmentId) => post(`/storyboards/${shotId}/segments/${segmentId}/merge`),
  getReferences: (shotId) => get(`/storyboards/${shotId}/references`),
  addReference: (shotId, body) => post(`/storyboards/${shotId}/references`, body),
  removeReference: (shotId, referenceId) => del(`/storyboards/${shotId}/references/${referenceId}`),
  getImagePrompt: (shotId) => get(`/storyboards/${shotId}/image-prompt`),
  editImagePrompt: (shotId, text) => put(`/storyboards/${shotId}/image-prompt`, { text }),
  resetImagePrompt: (shotId) => del(`/storyboards/${shotId}/image-prompt`),
  generateShotImage: (shotId, body) => post(`/storyboards/${shotId}/image/generate`, body),
  setShotImageCurrent: (shotId, candidateId) => post(`/storyboards/${shotId}/image/set-current`, { candidateId }),
  generateH3: (shotId, body) => post(`/storyboards/${shotId}/h3/generate`, body),
  saveH3: (shotId, text) => post(`/storyboards/${shotId}/h3/save`, { text }),
  getVideoQuote: (shotId, count) => get(`/storyboards/${shotId}/video/quote`, { count }),
  getVideoGuard: (shotId) => get(`/storyboards/${shotId}/video/guard`),
  submitVideo: (shotId, body) => post(`/storyboards/${shotId}/video/submit`, body),
  completeVideoTask: (taskId) => post(`/video-tasks/${taskId}/complete`),
  adoptVideo: (shotId, candidateId, body) => post(`/storyboards/${shotId}/video/adopt`, { candidateId, ...body }),
  undoAdoptVideo: (shotId) => post(`/storyboards/${shotId}/video/undo-adopt`),
  confirmFrameLink: (shotId) => post(`/storyboards/${shotId}/frame-link/confirm`),
  // 成片
  getCut: (episodeId) => get(`/episodes/${episodeId}/cut`),
  composeEpisode: (episodeId, settings) => post(`/episodes/${episodeId}/cut/compose`, settings),
  createWaiver: (body) => post('/cut/waivers', body),
  exportCut: (episodeId, format) => post(`/episodes/${episodeId}/cut/export`, { format }),
  // 直接 V2.1 制作包导入
  previewImportPackage: (projectId, body) => post(`/projects/${projectId}/episodes/import-v21/preview`, body),
  confirmImportPackage: (projectId, body) => post(`/projects/${projectId}/episodes/import-v21/confirm`, body),
  // 外部 AI 向导
  getWizard: (projectId, taskId) => get(`/projects/${projectId}/external-ai/wizard`, { taskId }),
  createPackage: (projectId, body) => post(`/projects/${projectId}/external-ai/package`, body),
  getExternalTask: (taskId) => get(`/external-ai/tasks/${taskId}`),
  downloadTask: async (taskId, format) => {
    const res = await http.get(`/external-ai/tasks/${taskId}/download`, { params: { format }, responseType: format === 'zip' ? 'blob' : 'text' })
    return { data: res.data, disposition: res.headers['content-disposition'] || '' }
  },
  validateResult: (taskId, resultJson) => post(`/external-ai/tasks/${taskId}/result/validate`, { resultJson }),
  previewImport: (taskId, resultJson) => post(`/external-ai/tasks/${taskId}/import/preview`, { resultJson }),
  confirmImport: (taskId, resultJson) => post(`/external-ai/tasks/${taskId}/import/confirm`, { resultJson }),
  cancelExternalTask: (taskId) => post(`/external-ai/tasks/${taskId}/cancel`),
}

export default v21
