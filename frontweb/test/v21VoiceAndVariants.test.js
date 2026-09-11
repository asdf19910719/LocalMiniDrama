import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('B4 人物音色真实来源：上传接 sd2-voice-upload、素材库、audio 试听、voice 指针持久化', () => {
  const view = read('src/views/productionStudio/studio/AssetsStage.vue')
  assert.match(view, /sd2-voice-upload/, '上传音频接既有角色音色上传端点')
  assert.match(view, /character-library/, '素材库音色接 characterLibrary')
  assert.match(view, /<audio /, '有音频文件时用 audio 试听')
  assert.match(view, /seedance2_voice_asset/, '读取角色已认证音色资产')
  assert.match(view, /saveVoice[\s\S]*updateSelection/, '完成时经 updateSelection 持久化 voice 指针')
  assert.match(view, /从音视频提取/, '提取入口保留')
  assert.match(view, /P2/, '提取标注 P2（依赖 Provider）')
  const backend = read('../backend-node/src/v21/assets/episodeAssetsService.js')
  assert.match(backend, /voice_json/, '后端选择表持久化 voice_json')
})

test('B5 新增状态：接 POST /characters/:id/variants 并刷新详情', () => {
  const view = read('src/views/productionStudio/studio/AssetsStage.vue')
  assert.match(view, /variantModalOpen/, '新增状态走专用 Modal')
  assert.match(view, /\/variants/, '调用人物状态创建端点')
  assert.match(view, /createVariant/, '创建后刷新详情')
  assert.doesNotMatch(view, /comingSoon|window\.prompt|window\.confirm|alert\(/, '本视图占位与原生弹窗清除')
})

test('T1.2 B4：notice 提示条真实渲染，v21 调用失败写 notice 不再静默', () => {
  const view = read('src/views/productionStudio/studio/AssetsStage.vue')
  assert.match(view, /<div v-if="notice" class="notice-strip warn"/, 'readiness 附近有 notice 呈现点')
  const methodBody = (name) => {
    const start = view.indexOf('async ' + name + '(')
    if (start === -1) return null
    const end = view.indexOf('\n    },', start)
    return end === -1 ? null : view.slice(start, end)
  }
  for (const fn of ['selectState', 'saveVoice', 'confirmImageUrl', 'generate', 'useCandidate', 'enterStoryboard']) {
    const body = methodBody(fn)
    assert.ok(body, `方法 ${fn} 存在`)
    assert.match(body, /catch \(e\) \{\s*this\.notice/, `${fn} 失败写 notice`)
  }
})

test('T1.2 B5：状态 chip 与保存音色均携带 stateId/mediaVersionId 指针', () => {
  const view = read('src/views/productionStudio/studio/AssetsStage.vue')
  const selectState = view.match(/async selectState\(st\) \{[\s\S]*?\n    \},/)
  assert.ok(selectState, '状态点击走 selectState 方法')
  assert.match(selectState[0], /v21\.updateSelection\(this\.episodeId/, '状态点击持久化')
  assert.match(selectState[0], /stateId: st\.id/, '携带新 stateId')
  assert.match(selectState[0], /mediaVersionId: this\.selectionMediaVersionId \?\? null/, '携带当前媒体指针')
  const saveVoice = view.match(/async saveVoice\(\) \{[\s\S]*?\n    \},/)
  assert.match(saveVoice[0], /stateId: this\.selectedStateId \|\| ''/, '保存音色携带 stateId')
  assert.match(saveVoice[0], /mediaVersionId: this\.selectionMediaVersionId \?\? null/, '保存音色不再清空媒体指针')
  assert.match(view, /selectionMediaVersionId = item\.mediaVersionId/, '打开详情时从本集引用合并选择指针')
})

test('T1.2 B6：素材上传走 candidates/upload 候选端点（后端同步落地）', () => {
  const view = read('src/views/productionStudio/studio/AssetsStage.vue')
  assert.match(view, /v21\.uploadAssetCandidate\(this\.detail\.assetType, this\.detail\.id, url\)/, '上传调用素材候选端点')
  assert.match(view, /已添加候选/, '上传成功 notice 提示')
  assert.doesNotMatch(view, /uploadShotImage/, '本视图不再调用分镜图片上传端点')
  const api = read('src/v21/api.js')
  assert.match(api, /uploadAssetCandidate: \(type, assetId, imageUrl\) => post\(`\/assets\/\$\{type\}\/\$\{assetId\}\/candidates\/upload`/, 'api 封装指向素材候选上传')
  const routes = read('../backend-node/src/v21/routes.js')
  assert.match(routes, /assets\/:type\/:assetId\/candidates\/upload/, '后端注册素材候选上传路由')
  const service = read('../backend-node/src/v21/assets/assetQueryService.js')
  assert.match(service, /MISSING_IMAGE_URL/, '缺 imageUrl 返回 400 MISSING_IMAGE_URL')
  assert.match(service, /'upload'/, '候选 provider 记为 upload')
})
