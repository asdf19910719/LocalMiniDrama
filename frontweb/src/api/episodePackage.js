import request from '@/utils/request'

/**
 * 单集制作包导入 API。
 * 响应由 @/utils/request 拦截器解包:成功时直接返回 response.data.data,
 * 即 preview → { normalized_package, source_sha256, target_status, asset_matches, errors, warnings, stats },
 * importPackage → { episode_id, stats, warnings }。
 * HTTP 400/409 时拦截器会 ElMessage.error 后端 message 并 reject(error),组件 catch 可读 e.message。
 */
export const episodePackageAPI = {
  /** 预览制作包(只读)。payload: { raw_json_text, filename, drama_id, target_episode_id } */
  preview(payload) {
    return request.post('/episodes/import-package/preview', payload || {})
  },
  /** 正式导入。payload: { raw_json_text, source_sha256, drama_id, target_episode_id, filename, decisions } */
  importPackage(payload) {
    return request.post('/episodes/import-package', payload || {})
  }
}
