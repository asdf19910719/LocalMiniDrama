import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Task 5-A（Phase 5 横切）：全局 toast / Esc 关闭总线 / 原生弹窗清零 / 评审累积小修的合同断言。
// 断言先行（TDD）：实现于 frontweb/src/v21/ui.js、escBus.js、escMixin.js 与各视图。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// Node 环境无 window：ui.js 以 window 为事件通道，测试用真实 EventTarget 充当 window
if (typeof globalThis.window === 'undefined') globalThis.window = new EventTarget()

test('① v21Toast 派发 v21:toast 事件；App.vue 挂载唯一容器并监听入队、3.5s 出队', async () => {
  const { v21Toast } = await import('../src/v21/ui.js')
  const received = []
  const onToast = (e) => received.push(e.detail)
  window.addEventListener('v21:toast', onToast)
  try {
    v21Toast('入库成功')
    v21Toast('删除失败', 'danger')
  } finally {
    window.removeEventListener('v21:toast', onToast)
  }
  assert.equal(received.length, 2, '两次调用各派发一个事件')
  assert.equal(received[0].message, '入库成功')
  assert.equal(received[0].type, 'ok', '默认色调为 ok')
  assert.equal(received[1].message, '删除失败')
  assert.equal(received[1].type, 'danger')
  for (const d of received) {
    assert.equal(typeof d.id, 'number', 'detail 携带去重 id')
    assert.ok(Number.isFinite(d.id))
  }
  assert.notEqual(received[0].id, received[1].id, 'id 不重复')

  const app = read('src/App.vue')
  assert.match(app, /v21:toast/, 'App.vue 监听 v21:toast 事件')
  assert.match(app, /v21-toasts/, 'App.vue 挂载 toast 容器')
  assert.match(app, /v21-toast\b/, '容器内渲染 .v21-toast 卡片')
  assert.match(app, /3500|3_500/, 'App.vue 以 3.5s 定时出队')
  const css = read('src/styles/v21-ui.css')
  assert.match(css, /\.v21-root \.v21-toast \{/, 'v21-ui.css 定义 .v21-toast 深色卡样式')
  assert.match(css, /\.v21-toast\.danger/, 'danger 色调样式存在')
  assert.match(css, /position: fixed.*bottom/s, '容器固定于右下')
})

test('② escBus：后注册先调用；返回 true 表示已消费并停止分发；解绑后不再收到', async () => {
  const escBus = await import('../src/v21/escBus.js')
  const { subscribeEsc, unsubscribeEsc, dispatchEsc } = escBus
  const calls = []
  const outer = () => { calls.push('outer'); return true }
  const inner = () => { calls.push('inner'); return true }
  const noop = () => { calls.push('noop'); return false }
  const tail = () => { calls.push('tail') }

  assert.equal(dispatchEsc(), false, '无订阅者时未被消费')

  const offTail = subscribeEsc(tail)
  subscribeEsc(outer)
  subscribeEsc(inner)
  subscribeEsc(noop)
  assert.equal(dispatchEsc(), true, '有订阅者消费时返回 true')
  assert.deepEqual(calls, ['noop', 'inner'], '后注册先调用；noop 不消费 → inner 消费并停止（outer/tail 未被调用）')

  calls.length = 0
  unsubscribeEsc(noop)
  assert.equal(dispatchEsc(), true)
  assert.deepEqual(calls, ['inner'], '解绑后的订阅者不再收到分发')

  calls.length = 0
  unsubscribeEsc(inner)
  assert.equal(dispatchEsc(), true)
  assert.deepEqual(calls, ['outer'], '无消费能力的订阅者不阻断链，链上后续订阅者可达')

  calls.length = 0
  unsubscribeEsc(outer)
  assert.equal(dispatchEsc(), false, '只剩不消费的订阅者时未被消费')
  assert.deepEqual(calls, ['tail'], '链尾订阅者仍被调用')

  // subscribeEsc 返回的解绑函数可用
  const seen = []
  const offOnce = subscribeEsc(() => { seen.push('x'); return true })
  offOnce()
  assert.equal(dispatchEsc(), false, '经返回的解绑函数解绑后不再收到分发')
  assert.deepEqual(seen, [])

  // escMixin：bindEsc 注册、组件卸载（beforeUnmount）自动解绑
  const mixin = (await import('../src/v21/escMixin.js')).default
  assert.equal(typeof mixin.methods.bindEsc, 'function', 'mixin 提供 bindEsc')
  assert.equal(mixin.data().escHandlers.length, 0, 'mixin data 提供 escHandlers 数组')
  const ctx = { escHandlers: [] }
  const seen2 = []
  mixin.methods.bindEsc.call(ctx, () => { seen2.push('hit'); return true })
  assert.equal(dispatchEsc(), true)
  assert.deepEqual(seen2, ['hit'], 'bindEsc 注册的处理函数参与分发')
  mixin.beforeUnmount.call(ctx)
  assert.equal(dispatchEsc(), false, 'beforeUnmount 自动解绑，无泄漏')
})

test('③ 生产视图域无原生 alert/confirm（productionStudio/** 与 v21/** 全目录扫描）', () => {
  const dirs = ['src/views/productionStudio', 'src/v21']
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(rel)
      else if (/\.(vue|js)$/.test(entry.name)) files.push(rel)
    }
  }
  dirs.forEach(walk)
  files.push('src/App.vue')
  assert.ok(files.length > 20, '扫描到生产视图域文件')

  // 方法定义（async confirm() / function confirm()）不是原生弹窗调用，先剔除再断言
  const stripDefinitions = (text) => text.replace(/\b(?:async|function)\s+(?:alert|confirm)\s*\(/g, 'defined(')
  const offender = []
  for (const rel of files) {
    const hit = stripDefinitions(read(rel)).match(/(^|[^\w.$])(window\.)?(alert|confirm)\s*\(/)
    if (hit) offender.push(`${rel}: ${hit[0].trim()}`)
  }
  assert.deepEqual(offender, [], `生产视图域不得调用原生 alert/confirm，残留：${offender.join('；')}`)
})

test('④ P4.4 I-1：无 hash 基线的 unique 命中 evidence 注明未记录内容 hash、未校验', () => {
  const svc = read('../backend-node/src/v21/datatools/relocationService.js')
  assert.match(svc, /文件名唯一命中（未记录内容 hash，未校验）/, '文件名唯一命中且无 hash 基线的分支注明未校验')
  assert.match(svc, /按文件大小收敛为唯一（未记录内容 hash，未校验）/, '按大小收敛为唯一的分支注明未校验')
  const marks = svc.match(/未记录内容 hash，未校验/g) || []
  assert.ok(marks.length >= 2, `至少两处 evidence 追加说明，实际 ${marks.length} 处`)
  // 后端既有断言不被破坏：hash 一致 / 不一致 / 越界文案仍在
  assert.match(svc, /内容 hash 一致/)
  assert.match(svc, /内容 hash 不一致/)
  assert.match(svc, /受控工作区根（/)
})

test('⑤ P4.4 M-1：isRelocBlocked 不再把 none（未找到）计入阻断集合', () => {
  const view = read('src/views/productionStudio/DataToolsView.vue')
  const fn = view.match(/isRelocBlocked\(row\) \{[\s\S]*?\n    \},/)
  assert.ok(fn, 'isRelocBlocked 方法存在')
  assert.match(fn[0], /hash_mismatch/, 'hash 不一致仍阻断')
  assert.match(fn[0], /path_escape/, '路径越界仍阻断')
  assert.doesNotMatch(fn[0], /'none'/, '未找到不算阻断跳过（归入“未找到”计数）')
})

test('⑥ P4.4 M-2：迁移 journal 未完成加载时显示读取中，完成后才显示暂无', () => {
  const view = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(view, /正在读取迁移记录…/, '加载态文案存在')
  assert.match(view, /暂无迁移 journal/, '完成后的空态文案保留')
  assert.match(view, /migrationsLoaded/, '存在“已完成加载”标记，用于区分两种空态')
  const order = view.indexOf('正在读取迁移记录…')
  const empty = view.indexOf('暂无迁移 journal')
  assert.ok(order > 0 && empty > order, '加载态分支先于空态分支（v-if/v-else-if/v-else 顺序）')
})

test('⑦ 附带合同：Esc 已接线到有遮罩层的视图；指定成功场景改用 toast', () => {
  // Esc 接线视图（EpisodePackageImportView 无遮罩层，豁免）
  for (const rel of [
    'src/views/productionStudio/studio/AssetsStage.vue',
    'src/views/productionStudio/studio/StoryboardStage.vue',
    'src/views/productionStudio/studio/ScriptStage.vue',
    'src/views/productionStudio/studio/CutStage.vue',
    'src/views/productionStudio/ProjectAssetsView.vue',
    'src/views/productionStudio/LibraryView.vue',
    'src/views/productionStudio/ProjectOverviewView.vue',
    'src/views/productionStudio/TasksView.vue',
    'src/views/productionStudio/ProjectEpisodesView.vue',
    'src/views/productionStudio/QuickCreateView.vue',
    'src/views/productionStudio/DataToolsView.vue',
    'src/views/productionStudio/AiConfigV21View.vue',
    'src/views/productionStudio/ExternalAiWizardView.vue',
    'src/views/productionStudio/SettingsView.vue',
  ]) {
    const view = read(rel)
    assert.match(view, /escMixin/, `${rel} 引入 escMixin`)
    assert.match(view, /bindEsc\(/, `${rel} 绑定 Esc 处理函数`)
  }

  const lib = read('src/views/productionStudio/LibraryView.vue')
  assert.match(lib, /v21Toast\(/, 'LibraryView 使用 v21Toast')
  assert.doesNotMatch(lib, /(^|[^\w.$])alert\(/, 'LibraryView 无裸 alert')

  const qc = read('src/views/productionStudio/QuickCreateView.vue')
  assert.match(qc, /v21Toast\('已加入个人资产库'\)/, 'QuickCreateView 归档成功走 toast（遮罩层反馈）')

  const ov = read('src/views/productionStudio/ProjectOverviewView.vue')
  assert.match(ov, /v21Toast\(.*导出/, 'ProjectOverviewView 导出成功走 toast')

  const ep = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.match(ep, /v21Toast\(`已恢复第 \$\{ep\.episodeNumber\} 集`\)/, 'P3.6 恢复剧集成功走 toast')

  const pa = read('src/views/productionStudio/ProjectAssetsView.vue')
  assert.match(pa, /已删除剧集/, 'P3.1 usage 列表对软删剧集显示“已删除剧集”')
  assert.match(pa, /episodeNumber != null/, '软删判定：episodeNumber 为 null（后端口径）时不可跳转')
})
