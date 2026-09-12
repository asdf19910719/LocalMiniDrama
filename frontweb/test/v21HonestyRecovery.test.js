import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('制作头 runningTasks：接真实运行任务计数（30s 轮询），预算摘要诚实占位', () => {
  const view = read('src/views/productionStudio/studio/StudioShell.vue')
  assert.match(view, /listV21Tasks\(\{ status: 'in_progress'/, '运行任务计数必须来自任务聚合端点 in_progress 口径')
  assert.match(view, /this\.runningTasks = .*total/, '徽标数字取自真实 total')
  assert.match(view, /setInterval/, '低频轮询保持计数新鲜')
  assert.match(view, /clearInterval\(this\.tasksTimer\)/, '卸载清理轮询')
  assert.match(view, /费用 · 本地 ¥0/, '预算摘要为本地执行 ¥0 的诚实口径')
})

test('项目列表归档页签：卡片菜单提供恢复项目入口（restoreProject 零调用清零）', () => {
  const view = read('src/views/productionStudio/ProjectsView.vue')
  assert.match(view, /v21\.restoreProject\(/, '归档项目恢复必须调用既有封装')
  assert.match(view, /恢复项目/, '菜单提供恢复项目动作')
  assert.match(view, /恢复失败，请重试|v21Toast/, '恢复失败不得静默')
})

test('项目素材回收站：筛选段提供回收站视图与恢复动作，删除文案指向本页回收站', () => {
  const view = read('src/views/productionStudio/ProjectAssetsView.vue')
  assert.match(view, /view === 'recycled'/, '存在回收站视图状态')
  assert.match(view, /recycled: this\.view === 'recycled'/, '列表请求带回收站口径')
  assert.match(view, /restoreOne/, '回收站卡片提供恢复动作')
  assert.match(view, /可在本页「回收站」筛选中恢复/, '删除确认文案指向本页回收站（不再指向高级数据工具）')
  assert.doesNotMatch(view, /可在高级数据工具中恢复删除/, '不得再承诺不存在的入口')
})
