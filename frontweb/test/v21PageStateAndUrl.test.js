import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Task 5-B（Phase 5 横切 B）：页面状态机统一（loading/error/empty 三分）+ URL 可恢复核心 4 处的合同断言。
// 断言先行（TDD）：实现于 frontweb/src/components/v21/StateBlock.vue、v21-ui.css 与各视图。
// 统一规则：加载完成前不渲染空态（StateBlock 链 v-if loading / v-else-if error / v-else 守卫）。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const viewFile = (p) => read(`src/views/productionStudio/${p}`)
const loadFnOf = (src) => src.match(/async load\(\) \{[\s\S]*?\n    \}/)

test('① StateBlock 组件存在且三分渲染（loading 骨架 / error 重试 / empty 插槽），样式入 v21-ui.css', () => {
  const comp = read('src/components/v21/StateBlock.vue')
  // props 契约：state / message / retry / icon
  for (const prop of ['state: { type: String', 'message: { type: String', 'retry: { type: Boolean', 'icon: { type: String']) {
    assert.ok(comp.includes(prop), `缺少 prop ${prop}`)
  }
  // loading 分支：骨架在前，绝不渲染空态/错误文案
  assert.match(comp, /v-if="state === 'loading'/, '应有 loading 分支')
  assert.match(comp, /v21-state-skeleton/, 'loading 分支渲染骨架')
  // error 分支：danger 消息 + 重试按钮（emit retry）
  assert.match(comp, /v-else-if="state === 'error'/, '应有 error 分支')
  assert.match(comp, /\$emit\('retry'\)/, 'error 分支重试按钮应 emit retry')
  // empty 分支：消息 + 动作插槽
  assert.match(comp, /<slot><\/slot>/, 'empty 分支应提供动作插槽')
  // 三分支互斥链（state!=='loading' 才可能渲染 empty）
  assert.ok(
    comp.indexOf("state === 'loading'") < comp.indexOf("state === 'error'") &&
    comp.indexOf("state === 'error'") < comp.indexOf('<slot>'),
    '分支顺序应为 loading → error → empty'
  )

  const css = read('src/styles/v21-ui.css')
  assert.match(css, /\.v21-root \.v21-state \{/, 'v21-ui.css 定义 .v21-state 基础样式')
  assert.match(css, /\.v21-state-skeleton/, '骨架样式存在')
  assert.match(css, /\.v21-state-error/, 'error 色调样式存在')
})

test('② ProjectsView：load 失败呈现 + 加载骨架守卫空态 + 筛选空区分并可清除条件', () => {
  const src = viewFile('ProjectsView.vue')
  assert.match(src, /import StateBlock from '@\/components\/v21\/StateBlock\.vue'/, '应引入 StateBlock')
  assert.match(src, /components: \{ StateBlock \}/, '应注册 StateBlock')
  // 三分链：loading 骨架 → error 重试 → 内容
  assert.match(src, /<StateBlock v-if="loading && !loaded" state="loading"/, '加载中渲染骨架')
  assert.match(src, /<StateBlock v-else-if="loadError" state="error"/, '失败渲染错误态')
  assert.match(src, /@retry="load"/, '错误态重试按钮回调 load')
  // load：try/catch 呈现 + finally 复位 + loaded 标志
  const loadFn = loadFnOf(src)
  assert.ok(loadFn, '应能定位 load 方法')
  assert.match(loadFn[0], /catch/, 'load 应有 catch')
  assert.match(loadFn[0], /this\.loadError = /, '失败应写入可见错误状态')
  assert.match(loadFn[0], /finally \{[\s\S]*?this\.loading = false/, 'loading 应在 finally 复位')
  assert.match(loadFn[0], /this\.loaded = true/, '成功后才置 loaded（空态守卫）')
  // 空态区分：筛选无结果 vs 真空态，附清除条件
  assert.match(src, /清除条件/, '筛选空态应提供「清除条件」')
  assert.match(src, /clearFilters\(\) \{/, '应提供 clearFilters 方法')
  assert.match(src, /hasFilter/, '应以 hasFilter 区分筛选空与真空态')
  assert.match(src, /还没有项目/, '真空态文案保留')
})

test('③ ProjectOverviewView：加载中显示骨架占位而非空数据渲染', () => {
  const src = viewFile('ProjectOverviewView.vue')
  assert.match(src, /import StateBlock from '@\/components\/v21\/StateBlock\.vue'/, '应引入 StateBlock')
  assert.match(src, /<StateBlock v-if="loading && !overview && !loadError" state="loading"/, '加载中且无数据时渲染骨架')
  assert.match(src, /<StateBlock v-else-if="loadError" state="error"/, '失败渲染错误态（P3.5 已有 loadError，收口为统一呈现）')
  const loadFn = loadFnOf(src)
  assert.ok(loadFn, '应能定位 load 方法')
  assert.match(loadFn[0], /finally \{[\s\S]*?this\.loading = false/, 'loading 应在 finally 复位')
})

test('④ ProjectEpisodesView：load 失败呈现 + 空态不抢跑 + ?status=&q= 筛选恢复', () => {
  const src = viewFile('ProjectEpisodesView.vue')
  assert.match(src, /import StateBlock from '@\/components\/v21\/StateBlock\.vue'/, '应引入 StateBlock')
  assert.match(src, /<StateBlock v-if="loading && !loaded" state="loading"/, '加载中渲染骨架')
  assert.match(src, /<StateBlock v-else-if="loadError" state="error"/, '失败渲染错误态')
  const loadFn = loadFnOf(src)
  assert.ok(loadFn, '应能定位 load 方法')
  assert.match(loadFn[0], /catch/, 'load 应有 catch（失败不再伪装空列表）')
  assert.match(loadFn[0], /this\.loadError = /, '失败应写入可见错误状态')
  assert.match(loadFn[0], /this\.loaded = true/, '成功后才置 loaded（空态守卫）')
  assert.match(src, /<div v-else class="ep-list">/, '列表区挂载于状态链 v-else（加载完成前不渲染空态）')
  // URL 恢复：?status=&q= 消费 + replace 写入
  assert.match(src, /\$route\.query\.status/, '应消费 ?status=')
  assert.match(src, /\$route\.query\.q/, '应消费 ?q=')
  const writeFn = src.match(/writeFilterUrl\(\) \{[\s\S]*?\n    \},/)
  assert.ok(writeFn, '应有 writeFilterUrl 写入筛选参数')
  assert.match(writeFn[0], /\$router\.replace/, '写入应使用 router.replace')
  assert.match(src, /setStatus\(s\) \{ this\.status = s; this\.writeFilterUrl\(\)/, '切换状态页签应写入 URL')
  assert.match(src, /onSearchInput\(\)/, '搜索输入应经 onSearchInput 同步 URL')
})

test('⑤ LibraryView：加载失败不再静默 + loaded 时序正确 + 筛选空与真空态区分', () => {
  const src = viewFile('LibraryView.vue')
  assert.match(src, /import StateBlock from '@\/components\/v21\/StateBlock\.vue'/, '应引入 StateBlock')
  assert.match(src, /<StateBlock v-if="loading && !loaded" state="loading"/, '加载中渲染骨架')
  assert.match(src, /<StateBlock v-else-if="loadError" state="error"/, '失败渲染错误态（不再保留空态伪装）')
  const loadFn = loadFnOf(src)
  assert.ok(loadFn, '应能定位 load 方法')
  assert.match(loadFn[0], /this\.loadError = /, '失败应写入可见错误状态（原 catch 静默）')
  assert.match(loadFn[0], /finally \{[\s\S]*?this\.loading = false/, 'loading 应在 finally 复位')
  // loaded 必须在首个 await 之后才置位（修复“加载中即视为已加载”的时序缺陷）
  const awaitIdx = loadFn[0].indexOf('await')
  const loadedIdx = loadFn[0].indexOf('this.loaded = true')
  assert.ok(awaitIdx > -1 && loadedIdx > awaitIdx, 'loaded 应在数据到达后才置位')
  // 空态区分
  assert.match(src, /hasFilter/, '应以 hasFilter 区分筛选空与真空态')
  assert.match(src, /清除条件/, '筛选空态应提供「清除条件」')
  assert.match(src, /资产库为空/, '真空态文案保留')
})

test('⑥ AssetsStage：加载期间不闪现「本集剧本没有引用…」空态文案（G6）', () => {
  const src = viewFile('studio/AssetsStage.vue')
  assert.match(src, /v-if="!loading && \(referenced\[tab\] \|\| \[\]\)\.length === 0"/, '空态文案必须带 !loading 守卫')
  const loadFn = loadFnOf(src)
  assert.ok(loadFn, '应能定位 load 方法')
  assert.match(loadFn[0], /this\.loading = true/, 'load 应置 loading')
  assert.match(loadFn[0], /finally \{[\s\S]*?this\.loading = false/, 'loading 应在 finally 复位')
  assert.match(loadFn[0], /catch/, 'load 失败经 notice 呈现（已具备，回归守卫）')
})

test('⑦ CutStage：补加载态与失败呈现（G8），内容挂载于状态链 v-else', () => {
  const src = viewFile('studio/CutStage.vue')
  assert.match(src, /import StateBlock from '@\/components\/v21\/StateBlock\.vue'/, '应引入 StateBlock')
  assert.match(src, /<StateBlock v-if="loading && !loaded" state="loading"/, '加载中渲染骨架')
  assert.match(src, /<StateBlock v-else-if="loadError[^"]*" state="error"/, '失败渲染错误态')
  const loadFn = loadFnOf(src)
  assert.ok(loadFn, '应能定位 load 方法')
  assert.match(loadFn[0], /catch/, 'load 应有 catch（原为无兜底裸 await）')
  assert.match(loadFn[0], /this\.loadError = /, '失败应写入可见错误状态')
  assert.match(loadFn[0], /this\.loaded = true/, '成功后才置 loaded')
  assert.match(src, /<template v-else>/, '工作台内容挂载于状态链 v-else')
})

test('⑧ TasksView：空态不抢跑 + ?tab= 页签恢复（?focus= 保留）', () => {
  const src = viewFile('TasksView.vue')
  assert.match(src, /import StateBlock from '@\/components\/v21\/StateBlock\.vue'/, '应引入 StateBlock')
  assert.match(src, /<StateBlock v-if="loading && !loaded && !loadError" state="loading"/, '首次加载渲染骨架')
  assert.match(src, /v-if="!loadError && loaded && !loading && displayedTasks\.length === 0"/, '空态文案必须带 loaded/!loading 守卫')
  const loadFn = loadFnOf(src)
  assert.ok(loadFn, '应能定位 load 方法')
  assert.match(loadFn[0], /this\.loaded = true/, '成功后才置 loaded')
  // ?tab= 恢复：消费 + watcher 写回
  assert.match(src, /\$route\?\.query\?\.tab|\$route\.query\.tab/, '应消费 ?tab=')
  const consumeTab = src.match(/consumeTabQuery\(\) \{[\s\S]*?\n    \},/)
  assert.ok(consumeTab, '应有 consumeTabQuery 方法')
  const writeTab = src.match(/writeTabUrl\(\) \{[\s\S]*?\n    \},/)
  assert.ok(writeTab, '应有 writeTabUrl 方法')
  assert.match(writeTab[0], /\$router\.replace/, '页签写入应使用 router.replace')
  assert.match(src, /tab\(\) \{ this\.writeTabUrl\(\); this\.load\(\) \},/, '切换页签应写 URL 并重载')
  // ?focus= 深链既有行为不被破坏
  assert.match(src, /consumeFocusQuery/, '?focus= 深链消费保留')
})

test('⑨ ProjectAssetsView：load 补 catch + ?asset=<type>:<id> 打开详情、写入与清除（ASSETS-030）', () => {
  const src = viewFile('ProjectAssetsView.vue')
  assert.match(src, /import StateBlock from '@\/components\/v21\/StateBlock\.vue'/, '应引入 StateBlock')
  assert.match(src, /<StateBlock v-if="loading && !loaded" state="loading"/, '加载中渲染骨架')
  assert.match(src, /<StateBlock v-else-if="loadError" state="error"/, '失败渲染错误态')
  const loadFn = loadFnOf(src)
  assert.ok(loadFn, '应能定位 load 方法')
  assert.match(loadFn[0], /catch/, 'load 应有 catch（原为无兜底裸 await）')
  assert.match(loadFn[0], /this\.loadError = /, '失败应写入可见错误状态')
  assert.match(loadFn[0], /this\.loaded = true/, '成功后才置 loaded（空态守卫）')
  // ?asset= 消费：<type>:<id> 定位素材并打开详情
  const consume = src.match(/consumeAssetQuery\(\) \{[\s\S]*?\n    \},/)
  assert.ok(consume, '应有 consumeAssetQuery 方法')
  assert.match(consume[0], /\$route\.query\.asset/, '应消费 ?asset=')
  assert.match(consume[0], /openDetail/, '命中素材应打开详情抽屉')
  assert.match(consume[0], /clearAssetQuery/, '未命中应清除参数')
  // 打开详情写参数、关闭清除
  const openDetail = src.match(/async openDetail\(item\) \{[\s\S]*?\n    \},/)
  assert.ok(openDetail, '应能定位 openDetail')
  assert.match(openDetail[0], /writeAssetUrl/, '打开详情应写入 ?asset=')
  const writeAsset = src.match(/writeAssetUrl\(\) \{[\s\S]*?\n    \},/)
  assert.ok(writeAsset, '应有 writeAssetUrl 方法')
  assert.match(writeAsset[0], /\$router\.replace/, '写入应使用 router.replace')
  assert.match(writeAsset[0], /assetType[\s\S]*?:[\s\S]*?id/, '参数形态应为 <type>:<id>')
  const closeDetail = src.match(/closeDetail\(\) \{[\s\S]*?\n    \},/)
  assert.ok(closeDetail, '应有 closeDetail 方法')
  assert.match(closeDetail[0], /clearAssetQuery/, '关闭详情应清除 ?asset=')
  assert.match(src, /@click="closeDetail"/, '抽屉关闭入口应走 closeDetail（保留列表筛选，仅清 asset 参数）')
})

test('⑩ StoryboardStage：?scene= 恢复场次 + 切换场次/镜头 replace 写入（?shot= 保留）', () => {
  const src = viewFile('studio/StoryboardStage.vue')
  const consumeFn = src.match(/async consumeShotQuery\(\) \{[\s\S]*?\n    \},/)
  assert.ok(consumeFn, 'consumeShotQuery 方法存在')
  assert.match(consumeFn[0], /query\.shot|\$route\.query\.shot/, '应消费 ?shot= 定位镜头')
  assert.match(consumeFn[0], /selectShot/, '合法 shotId 应复用 selectShot 选中')
  assert.match(consumeFn[0], /catch/, 'selectShot 失败应有 catch 页内提示')
  assert.match(consumeFn[0], /query\.scene|\$route\.query\.scene/, '应消费 ?scene= 恢复场次筛选')
  assert.match(consumeFn[0], /writeSceneShotUrl/, '消费后写回 URL（刷新可恢复）')
  // 写入：router.replace 携带 scene + shot
  const writeFn = src.match(/writeSceneShotUrl\(\) \{[\s\S]*?\n    \},/)
  assert.ok(writeFn, '应有 writeSceneShotUrl 方法')
  assert.match(writeFn[0], /\$router\.replace/, '写入应使用 router.replace（不产生历史记录）')
  assert.match(writeFn[0], /query\.scene/, '写入应包含 scene 参数')
  assert.match(writeFn[0], /query\.shot/, '写入应包含 shot 参数')
  // 切换场次/镜头时写入
  const selectShot = src.match(/async selectShot\(shotId\) \{[\s\S]*?\n    \},/)
  assert.ok(selectShot, 'selectShot 方法存在')
  assert.match(selectShot[0], /writeSceneShotUrl/, '切换镜头时应 replace 写入 URL')
  assert.match(selectShot[0], /historyOpen[\s\S]*?loadHistory/, '切镜时历史抽屉已开应重拉历史（既有行为）')
  assert.match(src, /sceneFilter\(\) \{ this\.writeSceneShotUrl\(\) \},/, '切换场次时（watcher）应 replace 写入 URL')
})

test('⑪ DataToolsView：P4.4 后各工具加载已具备 catch 与加载/空态区分（回归守卫，跳过改动）', () => {
  const src = viewFile('DataToolsView.vue')
  assert.match(src, /scanError/, '完整性检查失败呈现（已具备）')
  assert.match(src, /migrationsError/, '迁移记录失败呈现（已具备）')
  assert.match(src, /cleanupError/, '物理清理失败呈现（已具备）')
  assert.match(src, /relocError/, '媒体重定位失败呈现（已具备）')
  assert.match(src, /migrationsLoaded/, '迁移记录空态带已加载守卫（M-2，已具备）')
})
