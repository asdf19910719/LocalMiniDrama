import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Task 3.6 剧集中心 P1：行菜单六项 / 归档恢复 / 排序 / 阶段筛选 / 目标选择器 / 导入回写
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const view = () => read('src/views/productionStudio/ProjectEpisodesView.vue')
const api = () => read('src/v21/api.js')

test('T3.6 ① 行菜单固定六项（重命名/复制为草稿/设置目标时长/调整集序/删除/查看导入来源）', () => {
  const v = view()
  for (const label of ['重命名', '复制为草稿', '设置目标时长', '调整集序', '删除（回收站）', '查看导入来源']) {
    assert.match(v, new RegExp(label), `行菜单缺少「${label}」`)
  }
  // 六项均从行内 more 菜单触发
  assert.match(v, /rowMenuId === ep\.id/, '行菜单仍由 rowMenuId 控制展开')
})

test('T3.6 ① 复制为草稿：调用 copy-draft 端点，成功后刷新并高亮新集', () => {
  const v = view()
  assert.match(v, /v21\.copyEpisodeDraft\(/, '应调用 api 封装 copyEpisodeDraft')
  assert.match(v, /草稿副本/, '成功提示应含「草稿副本」')
  assert.match(api(), /copyEpisodeDraft: \(episodeId\) => post\(`\/episodes\/\$\{episodeId\}\/copy-draft`\)/, 'api.js 应有 copy-draft 封装')
})

test('T3.6 ② 已归档筛选与恢复入口；空白筛选段存在', () => {
  const v = view()
  assert.match(v, /已归档/, '第一层筛选应有「已归档」段')
  assert.match(v, /空白 /, '第一层筛选应有「空白」段')
  assert.match(v, /restoreEpisode\(/, '归档行应提供恢复入口调用 restoreEpisode')
  assert.match(v, /status === 'archived'/, '归档筛选应向后端传 status=archived')
})

test('T3.6 ③ 阶段筛选（剧本/设定/分镜/成片）消费 ?stage= 深链并清除 query', () => {
  const v = view()
  assert.match(v, /\$route\.query\.stage/, '应读取 stage query 深链')
  for (const label of ['全部阶段', '剧本', '设定', '分镜', '成片']) {
    assert.match(v, new RegExp(label), `阶段筛选缺少「${label}」`)
  }
  assert.match(v, /\$router\.replace\(/, '消费后应清除 query（router.replace）')
})

test('T3.6 ④ 新建剧集走 listBlankEpisodes 目标选择器，无自由集号输入', () => {
  const v = view()
  assert.match(v, /v21\.listBlankEpisodes\(this\.projectId\)/, '新建剧集应拉取空白剧集列表')
  assert.match(v, /创建第/, '应提供「创建第 N 集」主选项（后端下一可用号）')
  assert.doesNotMatch(v, /newEpNumber/, '不得再有自由集号数字输入（防撞号）')
})

test('T3.6 ⑤ 查看导入来源抽屉调用 getImportSource 渲染来源字段', () => {
  const v = view()
  assert.match(v, /v21\.getImportSource\(/, '应调用 getImportSource')
  assert.match(v, /本集为直接创建，无导入来源/, '无记录时应显示直接创建文案')
  assert.match(v, /sourceSha256/, '应渲染 SHA-256 字段')
  assert.match(v, /sourceFilename/, '应渲染文件名字段')
  assert.match(v, /schemaVersion/, '应渲染协议版本字段')
})

test('T3.6 ⑥ 排序选择器传 sort（集号升序默认 / 最近工作）', () => {
  const v = view()
  assert.match(v, /集号升序/, '排序下拉应有「集号升序（默认）」')
  assert.match(v, /最近工作/, '排序下拉应有「最近工作」')
  assert.match(v, /v21\.listEpisodes\(this\.projectId,\s*\{[^}]*sort/, 'load 应把 sort 传给列表接口')
})

test('T3.6 ⑦ 设置目标时长走 PATCH targetDuration（Modal 预设+清除）', () => {
  const v = view()
  assert.match(v, /targetDuration/, '应使用 targetDuration 参数')
  for (const preset of ['60', '90', '120']) {
    assert.match(v, new RegExp(`[^0-9]${preset}[^0-9]`), `目标时长应含 ${preset} 秒预设`)
  }
  assert.match(api(), /targetDuration/, 'api.js PATCH 封装应支持 targetDuration')
})
