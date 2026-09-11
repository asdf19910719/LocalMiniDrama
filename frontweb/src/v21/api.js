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
  // 数据工具（完整性检查 / 物理清理 / 媒体重定位）
  runIntegrity: () => post('/datatools/integrity/run'),
  cleanupDryRun: () => post('/datatools/cleanup/dry-run'),
  cleanupExecute: (items, confirmText) => post('/datatools/cleanup/execute', { items, confirmText }),
  relocationScan: (dir) => post('/datatools/relocation/scan', { dir }),
  relocationConfirm: (items) => post('/datatools/relocation/confirm', { items }),
  workspaceCheck: (dir) => post('/datatools/workspace/check', { dir }),
  workspacePreview: (dir) => post('/datatools/workspace/preview', { dir }),
  workspaceMigrate: (dir, confirmText) => post('/datatools/workspace/migrate', { dir, confirmText }),
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
  getDeleteImpact: (episodeId) => get(`/episodes/${episodeId}/delete-impact`),
  // 小说拆集 / 来源视频
  previewNovelSplit: (projectId, body) => post(`/projects/${projectId}/episodes/import-novel/preview`, body),
  confirmNovelSplit: (projectId, body) => post(`/projects/${projectId}/episodes/import-novel/confirm`, body),
  registerSourceVideo: (projectId, body) => post(`/projects/${projectId}/episodes/source-video`, body),
  // 自由创作入库（复用 v1 资产库 create 端点：kind = character|scene|prop）
  addToLibrary: async (kind, body) => {
    try { return unwrap(await axios.post(`/api/v1/${kind}-library`, body)) } catch (e) { throw toError(e) }
  },
  // 剧本
  getScript: (episodeId) => get(`/episodes/${episodeId}/script`),
  getStageNav: (episodeId) => get(`/episodes/${episodeId}/script/stage-nav`),
  getSceneStats: (episodeId) => get(`/episodes/${episodeId}/script/scene-stats`),
  getConfirmPreview: (episodeId) => get(`/episodes/${episodeId}/script/confirm-preview`),
  getScriptDiff: (episodeId, from, to) => get(`/episodes/${episodeId}/script/diff`, { from, to }),
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
  // 项目素材：URL 上传候选（仅入候选，不改当前图；Task 1.2 将在后端实现该端点）
  uploadAssetCandidate: (type, assetId, imageUrl) => post(`/assets/${type}/${assetId}/candidates/upload`, { imageUrl }),
  // 项目素材恢复（后端已有 POST /assets/:type/:assetId/restore）
  restoreAsset: (type, assetId) => post(`/assets/${type}/${assetId}/restore`),
  // 本集设定
  getEpisodeAssets: (episodeId) => get(`/episodes/${episodeId}/assets`),
  updateSelection: (episodeId, body) => put(`/episodes/${episodeId}/assets/selection`, body),
  enterStoryboard: (episodeId) => post(`/episodes/${episodeId}/enter-storyboard`),
  getMediaGuard: (episodeId, shot) => get(`/episodes/${episodeId}/media-guard`, { shot }),
  // 分镜
  createFromScript: (episodeId) => post(`/episodes/${episodeId}/storyboard/create-from-script`),
  previewStructureDiff: (episodeId) => get(`/episodes/${episodeId}/storyboard/structure-diff`),
  applyStructureDiff: (episodeId, diff) => post(`/episodes/${episodeId}/storyboard/apply-structure-diff`, { diff }),
  getStoryboard: (episodeId) => get(`/episodes/${episodeId}/storyboard`),
  getShotPackage: (episodeId) => get(`/episodes/${episodeId}/storyboard/shot-package`),
  getShot: (shotId) => get(`/storyboards/${shotId}`),
  editSegment: (shotId, segmentId, body) => patch(`/storyboards/${shotId}/segments/${segmentId}`, body),
  splitSegment: (shotId, segmentId, atSeconds) => post(`/storyboards/${shotId}/segments/${segmentId}/split`, { atSeconds }),
  mergeSegment: (shotId, segmentId) => post(`/storyboards/${shotId}/segments/${segmentId}/merge`),
  // 分镜时段移动（后端 storyboardService.moveSegment(shotId, segmentId, direction)）
  moveSegment: (shotId, segmentId, direction) => post(`/storyboards/${shotId}/segments/${segmentId}/move`, { direction }),
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
  getVideoTaskStatus: (taskId) => get(`/video-tasks/${taskId}/status`),
  cancelVideoTask: (taskId, reason) => post(`/video-tasks/${taskId}/cancel`, { reason }),
  adoptVideo: (shotId, candidateId, body) => post(`/storyboards/${shotId}/video/adopt`, { candidateId, ...body }),
  undoAdoptVideo: (shotId) => post(`/storyboards/${shotId}/video/undo-adopt`),
  confirmFrameLink: (shotId) => post(`/storyboards/${shotId}/frame-link/confirm`),
  getBatchPrecheck: (episodeId) => get(`/episodes/${episodeId}/storyboard/batch-precheck`),
  runBatch: (episodeId, action) => post(`/episodes/${episodeId}/storyboard/batch/${action}`),
  getVideoHistory: (shotId) => get(`/storyboards/${shotId}/video/history`),
  retryVideoTask: (taskId) => post(`/video-tasks/${taskId}/retry`),
  uploadShotImage: (shotId, body) => post(`/storyboards/${shotId}/image/upload`, body),
  mockQuickGenerate: (kind, prompt) => post('/quick-create/generate', { kind, prompt }),
  mockQuickComplete: (taskId) => post(`/quick-create/complete`, { taskId }),
  // 成片
  getCut: (episodeId) => get(`/episodes/${episodeId}/cut`),
  composeEpisode: (episodeId, settings) => post(`/episodes/${episodeId}/cut/compose`, settings),
  // 成片合成取消（后端已有 POST /episodes/:episodeId/cut/cancel）
  cancelCutCompose: (episodeId) => post(`/episodes/${episodeId}/cut/cancel`),
  createWaiver: (body) => post('/cut/waivers', body),
  exportCut: (episodeId, format) => post(`/episodes/${episodeId}/cut/export`, { format }),
  // V2.1 任务中心聚合列表（Task 1.6 将在后端实现 GET /api/v2/tasks）
  listV21Tasks: (params) => get('/tasks', params),
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
