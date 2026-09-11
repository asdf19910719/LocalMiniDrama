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
