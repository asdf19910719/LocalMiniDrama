import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('A2 完整性检查：DataToolsView 调真实 /datatools/integrity/run，演示数据移除', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /runIntegrity/, 'api 客户端应有 runIntegrity')
  const view = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(view, /runIntegrity/, '视图应调用真实完整性检查')
  assert.doesNotMatch(view, /正常 216/, '硬编码演示统计应移除')
  assert.match(view, /relocation:\s*\{\s*label:\s*'媒体重定位'/, '恢复落点：媒体重定位')
  assert.match(view, /reindex:\s*\{[^}]*重建任务索引/, '恢复落点：重建任务索引')
  assert.match(view, /cleanup:\s*\{[^}]*物理清理/, '恢复落点：物理清理')
  assert.match(view, /paths:\s*\{[^}]*查看路径配置/, '恢复落点：路径配置')
  assert.match(view, /severity/, '按严重级别渲染')
})
