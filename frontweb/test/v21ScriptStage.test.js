import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = () => fs.readFileSync(path.join(root, 'src/views/productionStudio/studio/ScriptStage.vue'), 'utf8')

test('B8 AI 动作映射：下拉与浮层统一为 continue/polish/rewrite/expand/condense，缩写不再映射 polish', () => {
  const view = read()
  // 下拉五项动作
  assert.match(view, /aiMenuAction\('continue'\)/, '下拉：续写')
  assert.match(view, /aiMenuAction\('polish'\)/, '下拉：润色')
  assert.match(view, /aiMenuAction\('rewrite'\)/, '下拉：改写选段')
  assert.match(view, /aiMenuAction\('expand'\)/, '下拉：扩写选段')
  assert.match(view, /aiMenuAction\('shorten'\)/, '下拉：缩写选段')
  // 动作→mode 映射：改写=rewrite、扩写=expand、缩写=condense
  assert.match(view, /shorten: 'condense'/, '缩写必须映射 condense')
  assert.match(view, /rewrite: 'rewrite'/, '改写必须映射 rewrite')
  assert.match(view, /expand: 'expand'/, '扩写必须映射 expand')
  assert.doesNotMatch(view, /shorten: 'polish'/, '缩写不得再映射 polish')
  assert.doesNotMatch(view, /expand: 'continue'/, '扩写不得再映射 continue')
  // 浮层入口动作键与下拉一致
  assert.match(view, /selectionAi\('rewrite'\)/, '浮层：改写')
  assert.match(view, /selectionAi\('expand'\)/, '浮层：扩写')
  assert.match(view, /selectionAi\('shorten'\)/, '浮层：缩写')
})

test('B8 无选区守卫：选区类动作缺选区时给出用户提示（后端 400 兜底仍在）', () => {
  const view = read()
  assert.match(view, /请先在正文中选择要处理的文本/, '用户可读提示')
})

test('B9 影响明细：查看影响明细按钮切换明细区，不再是关闭弹窗', () => {
  const view = read()
  const btnLine = view.split('\n').find((l) => l.includes('查看影响明细'))
  assert.ok(btnLine, '按钮存在')
  assert.doesNotMatch(btnLine, /confirmOpen = false/, '按钮不得只是关闭弹窗')
  assert.match(btnLine, /confirmDetailOpen/, '按钮切换明细区开关')
  assert.match(view, /confirmDetailOpen/, '存在明细区状态')
  assert.match(view, /detailItems/, '明细区按三类渲染')
  assert.match(view, /v-else[^>]*>无</, '空类显示“无”')
})

test('409 保存冲突：走对比解决流（P0-14），主 CTA 变“解决版本冲突”打开冲突 Modal', () => {
  const view = read()
  assert.match(view, /saveConflict/, '存在保存冲突状态')
  assert.match(view, /解决版本冲突/, '主按钮提供解决版本冲突入口')
  assert.match(view, /e\.code === 'REVISION_CONFLICT' \|\| e\.status === 409/, '按错误码或 409 状态判定')
  assert.match(view, /conflictModalOpen/, '409 打开冲突对比 Modal')
  assert.match(view, /conflictServerText/, '拉取服务端草稿内容做真实对比')
  assert.match(view, /loadServerVersion/, '提供「载入最新版本（放弃本机修改）」动作')
  assert.match(view, /overwriteServerVersion/, '覆盖服务端必须走显式确认动作')
  assert.doesNotMatch(view, /retrySave/, '不得保留静默覆盖式重试保存')
})

test('doConfirm 失败兜底：catch 内提示错误且弹窗保持打开', () => {
  const view = read()
  const src = view.slice(view.indexOf('async doConfirm'), view.indexOf('async applyCandidate'))
  const catchPart = src.slice(src.indexOf('} catch'))
  assert.ok(catchPart.length > 0, 'doConfirm 有 catch')
  assert.doesNotMatch(catchPart, /confirmOpen = false/, '失败时弹窗保持打开')
  assert.match(catchPart, /confirmError|setSave/, '失败有用户可读提示')
  assert.match(view, /v-if="confirmError"/, '弹窗内展示确认失败提示')
})
