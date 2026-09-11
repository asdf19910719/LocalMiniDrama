import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const view = () => read('src/views/productionStudio/ProjectAssetsView.vue')

test('B7 删除确认先行：删除按钮不再直连 deleteAsset，走自建确认弹窗', () => {
  const src = view()
  // 模板与脚本里全流程只允许出现一次 deleteAsset 调用（确认后才删）
  const calls = src.match(/v21\.deleteAsset\(/g) || []
  assert.equal(calls.length, 1, 'deleteAsset 全流程只调一次')
  // 删除按钮绑定确认入口，不再直连 remove/deleteAsset
  assert.match(src, /@click="askRemove"/, '删除按钮应绑定 askRemove 确认入口')
  assert.doesNotMatch(src, /@click="remove"/, '删除按钮不得直连 remove')
  // 存在自建确认弹窗状态位与确认执行方法
  assert.match(src, /removeOpen/, '存在删除确认弹窗状态位 removeOpen')
  assert.match(src, /confirmRemove/, '存在确认删除方法 confirmRemove')
  // 弹窗文案：回收站语义 + 可恢复说明，取消/确认两按钮
  assert.match(src, /移入回收站/, '弹窗标题为「移入回收站」')
  assert.match(src, /可恢复删除|高级数据工具恢复/, '弹窗说明包含可恢复语义')
  assert.match(src, /confirmRemove\(\)[\s\S]*?已移入回收站|已移入回收站[\s\S]*?confirmRemove\(\)/, '删除成功后有提示')
})

test('P0-7 生成确认 Sheet：两个生成入口都改为打开确认 Sheet，确认后才生成', () => {
  const src = view()
  // 两个生成入口（候选行 + 与页脚按钮）都绑定 openGenSheet，不再直连 generate
  assert.doesNotMatch(src, /@click="generate"/, '生成入口不得直连 generate')
  const entries = src.match(/@click="openGenSheet"/g) || []
  assert.equal(entries.length, 2, '候选行"+"与页脚「生成候选」两个入口都绑定 openGenSheet')
  // Sheet 状态位与确认方法存在
  assert.match(src, /genSheetOpen/, '存在生成确认 Sheet 状态位 genSheetOpen')
  assert.match(src, /confirmGenerate/, '存在确认生成方法 confirmGenerate')
  // Sheet 固定顺序内容：对象 → 生成通道 → 参数 → 任务与费用摘要
  assert.match(src, /生成通道/, 'Sheet 展示生成通道')
  assert.match(src, /本地生成/, '通道口径为本地生成（mock 默认）')
  assert.match(src, /不产生 API 费用/, '费用摘要标注本地生成不产生 API 费用')
  assert.match(src, /画布尺寸/, 'Sheet 展示画布尺寸参数')
  assert.match(src, /genPrompt/, 'Sheet 内提示词可编辑（genPrompt）')
  assert.match(src, /1 个生成任务/, 'Sheet 展示任务与费用摘要')
  // 确认方法调用 generateAssetCandidate 且提交 Sheet 内编辑后的 prompt
  const fn = src.match(/async confirmGenerate\(\)[\s\S]*?\n    \},\n/)
  assert.ok(fn, '能定位 confirmGenerate 方法体')
  assert.match(fn[0], /v21\.generateAssetCandidate\(/, 'confirmGenerate 调用 generateAssetCandidate')
  assert.match(fn[0], /prompt: this\.genPrompt/, '提交 Sheet 内编辑后的 prompt')
  // 成功提示与防重复提交
  assert.match(fn[0], /已生成候选/, '生成成功提示「已生成候选」')
  assert.match(src, /:disabled="generating"/, '提交中按钮禁用防重复提交')
})
