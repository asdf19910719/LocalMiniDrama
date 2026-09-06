import request from '@/utils/request'

/**
 * 单集制作包导入 API。
 * 响应由 @/utils/request 拦截器解包:成功时直接返回 response.data.data,
 * 即 preview → { normalized_package, source_sha256, target_status, asset_matches, errors, warnings, stats },
 * importPackage → { episode_id, stats, warnings },
 * listBlankEpisodes → [{ id, episode_number, title }](仅空白集)。
 * HTTP 400/409 时拦截器会 ElMessage.error 后端 message 并 reject(error),组件 catch 可读 e.message。
 */
export const episodePackageAPI = {
  /** 生成新会话使用的轻量项目剧情上下文。 */
  getExternalAiContext(dramaId, params = {}) {
    return request.get(`/dramas/${dramaId}/external-ai/context`, { params })
  },
  /** 冻结当前项目资产并创建一次性的本集外部 AI 任务。 */
  createExternalAiTask(dramaId, payload = {}) {
    return request.post(`/dramas/${dramaId}/external-ai/tasks`, payload)
  },
  /** 下载由任务说明、资产清单和返回 Schema 组成的 ZIP。 */
  downloadExternalAiTask(packageId) {
    return request.get(`/external-ai/tasks/${encodeURIComponent(packageId)}/download`, {
      responseType: 'blob',
    })
  },
  /** 预览制作包(只读)。payload: { raw_json_text, filename, drama_id, target_episode_id } */
  preview(payload) {
    return request.post('/episodes/import-package/preview', payload || {})
  },
  /** 正式导入。payload: { raw_json_text, source_sha256, drama_id, target_episode_id, filename, decisions } */
  importPackage(payload) {
    return request.post('/episodes/import-package', payload || {})
  },
  /** 某剧的空白剧集列表(填充模式下拉数据源):[{ id, episode_number, title }] */
  listBlankEpisodes(dramaId) {
    return request.get(`/dramas/${dramaId}/blank-episodes`)
  },
  /** 读取该集最近一次外部制作包的原文、规范化快照和导入报告。 */
  getImportSource(episodeId) {
    return request.get(`/episodes/${encodeURIComponent(episodeId)}/import-source`)
  }
}
