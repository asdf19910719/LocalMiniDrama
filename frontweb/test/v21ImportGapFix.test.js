import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Task 4.7 · 小说/已有视频导入补全合同：
// ① Novel 模板渲染 error 与「重新解析」，结果页说明失败/跳过集可重解析；
// ② SourceVideo 目标选择调用 listBlankEpisodes 且无全部剧集下拉；
// ③ 登记表单含 sha256/fileSize/mediaInfo 并随提交；
// ④ 成功跳转使用登记返回的 episodeId。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('4.7-① 小说拆集：错误条 danger + 重新解析（保留输入重跑预览）+ 结果页重解析说明', () => {
  const view = read('src/views/productionStudio/NovelImportView.vue')
  assert.match(view, /v-if="error"/, '模板应渲染 error')
  assert.match(view, /重新解析/, '错误条应有「重新解析」按钮（用当前输入重跑 preview）')
  assert.match(view, /var\(--danger\)/, '错误条应为 danger 样式')
  assert.match(view, /失败\/跳过集可修改文本后重新解析/, '结果页应说明失败/跳过集可修改文本后重新解析')
  assert.doesNotMatch(view, /alert\(|window\.confirm/, '不使用浏览器原生弹窗')
})

test('4.7-② 源视频：目标选择 = listBlankEpisodes 空白集 + 创建第 N 集，无全部剧集下拉', () => {
  const view = read('src/views/productionStudio/SourceVideoView.vue')
  assert.match(view, /listBlankEpisodes/, '目标选择应拉取空白剧集')
  assert.match(view, /创建第/, '应有「创建第 N 集」选项')
  assert.doesNotMatch(view, /v-for="ep in episodes"/, '不应再有全部剧集下拉选项')
  assert.match(view, /createEpisode/, '创建新集 = 先 createEpisode 再登记')
})

test('4.7-③ 源视频：表单含 SHA-256 / 文件大小 / 媒体信息并随登记提交', () => {
  const view = read('src/views/productionStudio/SourceVideoView.vue')
  assert.match(view, /可留空；用于后续媒体一致性校验/, 'SHA-256 输入占位说明')
  assert.match(view, /sha256/, '表单含 sha256 字段')
  assert.match(view, /fileSize/, '表单含 fileSize 字段')
  assert.match(view, /mediaInfo/, '表单含 mediaInfo 字段')
  // 随登记提交：registerSourceVideo 请求体包含三个字段
  const body = view.match(/registerSourceVideo\([\s\S]*?\}\)/)?.[0] || ''
  assert.match(body, /sha256/, '登记请求体应带 sha256')
  assert.match(body, /fileSize/, '登记请求体应带 fileSize')
  assert.match(body, /mediaInfo/, '登记请求体应带 mediaInfo')
  assert.match(body, /episodeId/, '登记请求体应带 episodeId')
})

test('4.7-④ 源视频：成功跳转成片页使用登记返回的 episodeId 并提示关联使用', () => {
  const view = read('src/views/productionStudio/SourceVideoView.vue')
  assert.match(view, /registeredEpisodeId\s*=\s*res\.episodeId/, '应从登记响应读取 episodeId')
  assert.match(view, /episodes\/\$\{registeredEpisodeId\}\/cut/, '成片页跳转应使用登记返回的 episodeId 与正确路由（:stage 单段，无 /stage 前缀）')
  assert.match(view, /已登记，请在成片页关联使用/, '应提示到成片页关联使用')
  assert.doesNotMatch(view, /note/, '不应依赖 note 文本回显口径')
})
