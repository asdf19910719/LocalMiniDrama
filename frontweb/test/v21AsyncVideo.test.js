import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('C3 视频生成异步化：提交后轮询状态并支持取消，不再立即 complete', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /getVideoTaskStatus/, 'api：任务状态轮询')
  assert.match(api, /cancelVideoTask/, 'api：任务取消')
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  assert.doesNotMatch(view, /await v21\.completeVideoTask\(task\.taskId\)/, '提交后不得立即逐任务 complete')
  assert.match(view, /activeVideoTasks/, '进行中任务列表')
  assert.match(view, /startPolling/, '轮询驱动状态推进')
  assert.match(view, /cancelTask/, '取消当前任务')
  assert.match(view, /演示运行态/, 'mock 延迟演示入口')
  const backend = read('../backend-node/src/v21/mockProvider.js')
  assert.match(backend, /delayMs/, 'mock 通道支持可选延迟')
})

test('C6 生成 Sheet 通道/费用真实化：报价来自接口，硬编码移除', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  assert.match(view, /loadSheetQuote/, '打开 Sheet 拉取真实报价')
  assert.match(view, /sheetQuote/, '报价数据驱动展示')
  assert.match(view, /Provider 未返回价格|estimatedCost/, '费用口径来自报价')
  assert.doesNotMatch(view, />mock 本地执行 · ¥0<\/b>/, '模板中硬编码通道费用移除（mock 兜底文案仅在 computed 中）')
})
