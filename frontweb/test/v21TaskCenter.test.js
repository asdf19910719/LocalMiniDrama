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

// ===== T4.1 任务中心筛选器 / 分页 / 详情四区 / focus 深链（合同断言）=====

test('T4.1 筛选器：类型/项目下拉存在，类型变化触发带 type 参数的请求并回到第 1 页', () => {
  assert.match(view, /v-model="typeFilter"/, '工具栏应有类型下拉（v-model=typeFilter）')
  assert.match(view, /<option value="">全部类型<\/option>/, '类型下拉应有「全部类型」空选项')
  assert.match(view, /<option value="image">图片<\/option>/, '类型下拉应有「图片」选项')
  assert.match(view, /<option value="video">视频<\/option>/, '类型下拉应有「视频」选项')
  assert.match(view, /<option value="external">外部协作<\/option>/, '类型下拉应有「外部协作」选项')
  assert.match(view, /<option value="compose">整集合成<\/option>/, '类型下拉应有「整集合成」选项')
  assert.match(view, /<option value="quick-create">自由创作<\/option>/, '类型下拉应有「自由创作」选项')
  assert.match(view, /v-model="projectFilter"/, '工具栏应有项目下拉（v-model=projectFilter）')
  assert.match(view, /<option value="">全部项目<\/option>/, '项目下拉应有「全部项目」空选项')
  assert.match(view, /if \(this\.typeFilter\) params\.type = this\.typeFilter/, '类型筛选应映射为请求的 type 参数')
  assert.match(view, /typeFilter\(\) \{ this\.load\(\) \},/, '类型筛选变化应触发重新加载（回到第 1 页）')
  // 项目筛选为客户端过滤：选项来自当前 items 的 target.projectId 去重，不新增后端
  assert.match(view, /projectOptions\(\)[\s\S]{0,400}target\?\.projectId/, '项目选项应从当前 items 的 target.projectId 去重生成')
  assert.match(view, /String\(t\.target\?\.projectId\) === this\.projectFilter/, '项目筛选应以客户端过滤实现')
  assert.match(view, /v-for="t in displayedTasks"/, '列表应渲染项目筛选后的 displayedTasks')
})

test('T4.1 分页：底部「加载更多」按 page+1 追加，显示「共 N 项」总数', () => {
  assert.match(view, /共 \{\{ total \}\} 项/, '列表底部应显示总数')
  assert.match(view, /加载更多/, '列表底部应有加载更多按钮')
  assert.match(view, /v-if="hasMore"/, '加载更多按钮应以 hasMore 控制可见性')
  assert.match(view, /hasMore\(\) \{ return this\.all\.length < this\.total \},/, 'hasMore 应比较已加载数与服务端总数')
  const fn = view.match(/async loadMore\(\) \{[\s\S]*?\n    \},/)
  assert.ok(fn, '应有独立 loadMore 方法')
  assert.match(fn[0], /this\.page \+ 1/, 'loadMore 应以 page+1 请求下一页')
  assert.match(fn[0], /this\.all = this\.all\.concat\(items\)/, 'loadMore 应追加而非覆盖列表')
  assert.match(fn[0], /this\.page \+= 1/, 'loadMore 成功后应推进页码')
})

test('T4.1 详情抽屉：Provider/规格、时间与费用、错误与恢复、输入快照四区', () => {
  const drawer = view.slice(view.indexOf('任务详情抽屉'), view.indexOf('</aside>'))
  assert.ok(drawer.includes('任务详情抽屉'), '应能定位详情抽屉模板')
  assert.match(drawer, /Provider \/ 规格/, '抽屉应有「Provider / 规格」区')
  assert.match(drawer, /typeShortLabel\(detail\.taskType\)/, 'Provider 区应以用户语言显示任务类型')
  assert.match(drawer, /sourceTagLabel\(detail\.source\)/, 'Provider 区应显示执行方式来源标签')
  assert.match(view, /\{ async: '本地任务', external: '外部任务', compose: '合成任务' \}/, '来源标签应为 本地任务/外部任务/合成任务')
  assert.match(view, /image: '图片', video: '视频', external: '外部协作', compose: '合成'/, '类型用户语言短标签应含 图片/视频/外部协作/合成')
  assert.match(view, /'quick-create': '自由创作'/, '类型短标签应含 自由创作')
  assert.match(drawer, /时间与费用/, '抽屉应有「时间与费用」区')
  assert.match(drawer, /创建时间/, '时间区应显示创建时间')
  assert.match(drawer, /更新时间/, '时间区应显示更新时间')
  assert.match(drawer, /完成时间/, '时间区应显示完成时间')
  assert.match(view, /if \(task\.source === 'external'\) return '费用由外部服务结算'/, 'external 无 costNote 时应显示外部结算说明')
  assert.match(view, /return '本地执行 · 不产生 API 费用'/, 'async/compose 无 costNote 时应显示本地执行说明')
  assert.match(drawer, /错误与恢复/, '抽屉应有「错误与恢复」区')
  assert.match(view, /failedRetryable\(task\)[\s\S]{0,120}\['async', 'compose'\]\.includes\(task\.source\)/, 'failedRetryable 应覆盖 async/compose 失败任务')
  assert.match(drawer, /v-if="failedRetryable\(detail\)"/, '错误区应为 async/compose 失败任务提供内联恢复按钮')
  assert.match(drawer, /打开外部向导/, 'external 失败场景应换为「打开外部向导」按钮')
  assert.match(view, /external-ai\?taskId=/, '打开外部向导应带 taskId 以便向导恢复')
  assert.match(drawer, /输入快照/, '抽屉应有「输入快照」区')
})

test('T4.1 深链：消费 ?focus=<id> 自动切页签、打开详情抽屉并清除 query', () => {
  assert.match(view, /this\.\$route\?\.query\?\.focus/, '应读取 URL 中的 focus 深链参数')
  const fn = view.match(/async consumeFocusQuery\(\) \{[\s\S]*?\n    \},/)
  assert.ok(fn, '应有独立的深链消费方法 consumeFocusQuery')
  assert.match(fn[0], /statusTab\(target\.status\)/, '应按任务状态自动切换到所在页签')
  assert.match(fn[0], /openDetail\(target\)/, '应打开该任务的详情抽屉')
  assert.match(fn[0], /\$router\.replace\(\{ query: \{\} \}\)/, '消费后应以 replace 清除 query')
  assert.match(view, /statusTab\(status\) \{[\s\S]{0,200}'attention'/, '应有 status→页签映射（failed/waiting_external → attention）')
})
