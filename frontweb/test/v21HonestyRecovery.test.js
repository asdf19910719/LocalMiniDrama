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
