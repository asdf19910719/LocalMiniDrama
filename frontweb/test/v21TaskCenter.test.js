import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const view = read('src/views/productionStudio/TasksView.vue')
const api = read('src/v21/api.js')

test('任务中心：改走 V2.1 聚合端点，不再直调旧 /api/v1/tasks（P0-2）', () => {
  assert.doesNotMatch(view, /api\/v1\/tasks/, '不得再调用缺 resource_id 即恒 400 的旧端点')
  assert.match(view, /v21\.listV21Tasks/, 'load 应走 v21.listV21Tasks 封装')
  assert.match(api, /listV21Tasks: \(params\) => get\('\/tasks', params\)/, 'api 封装应存在且指向 /api/v2/tasks')
})

test('任务中心：三页签用 status 过滤参数请求（进行中/需要处理/已完成）', () => {
  assert.match(view, /status: this\.tab/, '当前页签应以 status 参数发请求')
  for (const tab of ['in_progress', 'attention', 'done']) {
    assert.match(view, new RegExp(tab), `缺少页签值 ${tab}`)
  }
  assert.match(view, /listV21Tasks\(\{ status: 'in_progress'/, '页签计数经 status 参数拉取')
  assert.match(view, /page_size: 1/, '页签计数请求应为轻量分页')
})

test('任务中心：失败呈现为错误横幅 + 重新加载，轮询失败不吞错', () => {
  assert.match(view, /loadError/, '应有加载错误状态')
  assert.match(view, /重新加载/, '错误横幅应有重新加载按钮')
  assert.match(view, /catch \(e\) \{[\s\S]*?this\.loadError = /, 'catch 必须把错误写入可见状态')
  assert.match(view, /setInterval\(\(\) => this\.load\(\), 5000\)/, '保留 5s 轮询')
})

test('任务中心：新字段渲染（title/statusMessage/progress/target）与「打开对象」路由', () => {
  assert.match(view, /\{\{ t\.title \}\}/, '任务行应显示后端标题')
  assert.match(view, /statusMessage/, '详情应显示状态信息（message/error）')
  assert.match(view, /打开对象/, 'target 有值时应显示打开对象按钮')
  assert.match(
    view,
    /\/projects\/\$\{tg\.projectId\}\/episodes\/\$\{tg\.episodeId\}\/\$\{tg\.stage\}/,
    '打开对象应路由到 /projects/:projectId/episodes/:episodeId/:stage'
  )
})

test('任务中心：取消——external 必须走 cancelExternalTask，其余类型给说明性提示', () => {
  assert.match(api, /cancelExternalTask: \(taskId\) => post\(`\/external-ai\/tasks\/\$\{taskId\}\/cancel`\)/)
  assert.match(view, /v21\.cancelExternalTask\(task\.sourceId\)/, 'external 类取消应调 cancelExternalTask')
  assert.match(view, /暂不支持在任务中心直接取消/, '其余类型点击取消应显示说明性提示')
})
