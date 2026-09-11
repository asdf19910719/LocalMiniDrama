import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('B2 小说拆集向导：三步向导接 /import-novel/preview|confirm，剧集页入口直达', () => {
  const router = read('src/router/index.js')
  assert.match(router, /import-novel/, '路由应有 import-novel')
  assert.match(router, /NovelImportView/, '应注册 NovelImportView')
  const api = read('src/v21/api.js')
  assert.match(api, /previewNovelSplit/)
  assert.match(api, /confirmNovelSplit/)
  const view = read('src/views/productionStudio/NovelImportView.vue')
  assert.match(view, /粘贴小说或长文本/, '步骤 1：粘贴/上传文本')
  assert.match(view, /章节预览/, '步骤 2：章节列表')
  assert.match(view, /suggestedEpisodeNumber/, '建议集号')
  assert.match(view, /conflict/, '冲突集号 warn')
  assert.match(view, /零媒体任务/, '零媒体任务合同明示')
  assert.doesNotMatch(view, /alert\(|window\.confirm/, '不使用浏览器原生弹窗')
  const episodes = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.doesNotMatch(episodes, /comingSoon\('小说 \/ 长文本拆集'\)/, '剧集页小说拆集入口不再占位')
  assert.match(episodes, /episodes\/import-novel/, '入口直达向导')
})

test('B3 从已有视频开始剪辑：目标集选择 + 许可确认 + 零生成登记', () => {
  const router = read('src/router/index.js')
  assert.match(router, /import-video/, '路由应有 import-video')
  assert.match(router, /SourceVideoView/, '应注册 SourceVideoView')
  const api = read('src/v21/api.js')
  assert.match(api, /registerSourceVideo/, 'api 应有来源视频登记')
  const view = read('src/views/productionStudio/SourceVideoView.vue')
  assert.match(view, /选择目标剧集/, '选择目标集')
  assert.match(view, /listBlankEpisodes|isBlank/, '复用空白剧集拉取')
  assert.match(view, /本地路径/, '本地路径输入')
  assert.match(view, /合法使用权/, '许可确认')
  assert.match(view, /零生成/, '零生成合同明示')
  assert.match(view, /episodes\/\$\{registeredEpisodeId\}\/cut/, '登记后跳转成片页（studio 路由为 :stage 单段，无 /stage 前缀）')
  const episodes = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.doesNotMatch(episodes, /comingSoon\('从已有视频开始剪辑'\)/, '剧集页来源视频入口不再占位')
})
