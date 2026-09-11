import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))

test('canonical 路由：默认 /projects，单集四阶段，旧制作页路由删除', () => {
  const router = read('src/router/index.js')
  assert.match(router, /path: '\/', redirect: '\/projects'/)
  assert.match(router, /episodes\/:episodeId\/:stage\b/, '单集四阶段路由应接受任意 stage 值（未知值由 StudioShell 运行时回退）')
  assert.match(router, /pathMatch\(\.\*\)\*/, '应有 catch-all 路由兜底未知路径')
  assert.match(router, /NotFoundView/, 'catch-all 路由应指向 NotFoundView')
  for (const legacy of ['FilmList', 'DramaDetail', 'FilmCreate', 'DramaCanvas']) {
    assert.doesNotMatch(router, new RegExp(legacy), `路由不得引用旧页面 ${legacy}`)
    assert.equal(exists(`src/views/${legacy}.vue`), false, `旧页面 ${legacy}.vue 应已删除`)
  }
})

test('全局 Rail：仅 项目/资产库/任务/设置', () => {
  const app = read('src/App.vue')
  assert.match(app, /\/projects/)
  assert.match(app, /\/library/)
  assert.match(app, /\/tasks/)
  assert.match(app, /\/settings/)
})

test('新建项目：无时长/输出偏好字段', () => {
  const view = read('src/views/productionStudio/ProjectNewView.vue')
  assert.match(view, /项目名称/)
  assert.match(view, /画幅/)
  assert.match(view, /题材/)
  assert.doesNotMatch(view, /时长|duration|输出偏好|output/i)
})

test('单集阶段导航：剧本/设定/分镜/成片', () => {
  const shell = read('src/views/productionStudio/studio/StudioShell.vue')
  assert.match(shell, /剧本/)
  assert.match(shell, /设定/)
  assert.match(shell, /分镜/)
  assert.match(shell, /成片/)
  assert.match(shell, /\$router\.replace/, '未知 stage 应回退跳转到该集 /script')
  assert.match(shell, /正在打开剧本阶段/, '未知 stage 替换跳转生效前应有占位兜底')
})

test('本集设定：三 Tab 引用投影 + 进入分镜即时导航 + readiness 状态条', () => {
  const view = read('src/views/productionStudio/studio/AssetsStage.vue')
  assert.match(view, /角色/)
  assert.match(view, /场景/)
  assert.match(view, /道具/)
  assert.match(view, /进入分镜/)
  assert.match(view, /ready|needs-attention|snapshot-failed|script-unapproved/)
})

test('分镜页：五区要素与生成前联合检查', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  for (const keyword of ['用 H3 生成视频', '生成 H3 提示词', '生成分镜图', '首尾帧衔接', '用于本镜', '进入成片审核']) {
    assert.match(view, new RegExp(keyword), `分镜页缺少「${keyword}」`)
  }
})

test('分镜页交互修复：批量/引用按钮走加载函数，时段移动错误呈现（B1/B2/B3）', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  // B1：批量生成按钮必须先走 openBatch 预检（直接置 batchOpen = true 会因 batch 为空渲染崩溃）
  assert.match(view, /@click="openBatch"/, '批量生成按钮应绑定 openBatch')
  assert.doesNotMatch(view, /@click="batchOpen = true"/, '批量生成按钮不得绕过 openBatch 直接开门')
  const openBatch = view.match(/async openBatch\(\) \{[\s\S]*?\n    \},/)
  assert.ok(openBatch, 'openBatch 方法存在')
  assert.match(openBatch[0], /getBatchPrecheck/, 'openBatch 应先拉批量预检数据')
  assert.match(openBatch[0], /batchOpen = true/, 'openBatch 拉到数据后才开门')
  assert.match(openBatch[0], /catch/, 'openBatch 加载失败应有 catch 兜底')
  // 抽屉模板对 batch 字段做防御（任何时序下不渲染崩溃），并展示预检计数
  assert.match(view, /\(batch\.missingImages \|\| \[\]\)\.length/, '缺失分镜图计数应做空值防御')
  assert.match(view, /\(batch\.missingVideos \|\| \[\]\)\.length/, '缺失视频计数应做空值防御')
  assert.match(view, /\(batch\.failed \|\| \[\]\)\.length/, '失败任务计数应做空值防御')
  // B2：管理镜头引用按钮必须先走 openRefManage 拉素材池
  assert.match(view, /@click="openRefManage"/, '管理镜头引用按钮应绑定 openRefManage')
  assert.doesNotMatch(view, /@click="refManageOpen = true"/, '引用按钮不得绕过 openRefManage 直接开门')
  const openRefManage = view.match(/async openRefManage\(\) \{[\s\S]*?\n    \},/)
  assert.ok(openRefManage, 'openRefManage 方法存在')
  assert.match(openRefManage[0], /listAssets/, 'openRefManage 应先拉项目素材池')
  assert.match(openRefManage[0], /catch/, 'openRefManage 加载失败应有 catch 兜底')
  // 素材池过滤已在本镜引用中的素材（对照 references），添加/移除后随之刷新
  assert.match(view, /addableAssets/, '素材池应使用过滤后的 addableAssets')
  const addable = view.match(/addableAssets\(\) \{[\s\S]*?\n    \},/)
  assert.ok(addable, 'addableAssets 计算属性存在')
  assert.match(addable[0], /referencedAssetIds/, '素材池应排除已在本镜引用中的素材')
  assert.match(addable[0], /blocked/, '素材池应排除未就绪（blocked）素材')
  // B3：时段上移/下移失败（如边界越界 400）须经 catch 呈现到 notice
  const moveFn = view.match(/async move\(seg, direction\) \{[\s\S]*?\n    \},/)
  assert.ok(moveFn, 'move 方法存在')
  assert.match(moveFn[0], /v21\.moveSegment\(this\.currentShotId, seg\.id, direction\)/, 'move 应调用 moveSegment 封装')
  assert.match(moveFn[0], /catch/, 'moveSegment 失败应有 catch')
  assert.match(moveFn[0], /this\.notice = /, 'moveSegment 失败应呈现到 notice 条')
})

test('分镜页确认抽屉：H3 生成确认前置（人工保护需勾选覆盖）', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  // H3 生成按钮必须先走确认抽屉，不得直连 v21.generateH3
  assert.match(view, /@click="openH3Sheet"/, 'H3 生成按钮应绑定 openH3Sheet 打开确认抽屉')
  assert.doesNotMatch(view, /@click="generateH3"/, 'H3 生成按钮不得绕过抽屉直连 generateH3')
  const openH3Sheet = view.match(/openH3Sheet\(\) \{[\s\S]*?\n    \},/)
  assert.ok(openH3Sheet, 'openH3Sheet 方法存在')
  // 抽屉展示结构输入（时段数/引用槽位数）与来源说明
  assert.match(view, /时段数/, '确认抽屉应展示时段数')
  assert.match(view, /引用槽位/, '确认抽屉应展示引用槽位数')
  assert.match(view, /基于当前时段与引用状态/, '确认抽屉应标注生成来源')
  assert.match(view, /重新生成不会覆盖人工修改/, '确认抽屉应说明人工草稿保护语义')
  // 确认方法调 v21.generateH3，受保护时透传后端 confirmOverwrite 参数
  const confirmFn = view.match(/async confirmGenerateH3\(\) \{[\s\S]*?\n    \},/)
  assert.ok(confirmFn, 'confirmGenerateH3 方法存在')
  assert.match(confirmFn[0], /v21\.generateH3\(this\.currentShotId/, '确认方法应调用 v21.generateH3')
  assert.match(confirmFn[0], /confirmOverwrite: true/, '受保护时确认方法应透传 confirmOverwrite: true')
  // 受保护（h3.manuallyEdited）时必须勾选「我确认覆盖人工修改」才能提交
  assert.match(view, /我确认覆盖人工修改/, '抽屉应有覆盖人工修改确认勾选')
  assert.match(confirmFn[0], /manuallyEdited/, '确认方法应检测 h3.manuallyEdited 保护态')
  assert.match(confirmFn[0], /h3ConfirmOverwrite/, '确认方法应以勾选状态为提交前置')
  // 提交中防重复与抽屉内错误呈现
  assert.match(confirmFn[0], /h3Generating/, '确认方法应有提交中防重复标记')
  assert.match(view, /h3SheetError/, '抽屉内应有错误行呈现')
})

test('分镜页确认抽屉：分镜图候选先预览再采纳', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  // 候选缩略图点击只打开预览抽屉，不得直接采纳
  assert.match(view, /@click="previewImageCandidate\(c\)"/, '候选点击应绑定 previewImageCandidate 打开预览抽屉')
  assert.doesNotMatch(view, /@click="setCurrentImage\(c\)"/, '候选点击不得直接 setCurrentImage 采纳')
  const previewFn = view.match(/previewImageCandidate\(candidate\) \{[\s\S]*?\n    \},/)
  assert.ok(previewFn, 'previewImageCandidate 方法存在')
  assert.match(previewFn[0], /imgPreviewOpen = true/, 'previewImageCandidate 应打开预览抽屉')
  // 预览抽屉：大图 + 图片提示词 + 「设为当前分镜图」按钮确认后才采纳
  assert.match(view, /设为当前分镜图/, '预览抽屉应有「设为当前分镜图」按钮')
  const confirmSet = view.match(/async confirmSetCurrentImage\(\) \{[\s\S]*?\n    \},/)
  assert.ok(confirmSet, 'confirmSetCurrentImage 方法存在')
  assert.match(confirmSet[0], /setCurrentImage\(this\.imgPreview\)/, '确认方法应调用 setCurrentImage 采纳候选')
  assert.match(view, /分镜图提示词/, '预览抽屉应展示该图图片提示词')
  assert.match(confirmSet[0], /imgPreviewBusy/, '采纳确认应有提交中防重复标记')
  assert.match(view, /imgPreviewError/, '预览抽屉内应有错误行呈现')
})

test('分镜页确认抽屉：进入成片审核前展示三组计数摘要', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  // 进入成片审核按钮必须先走摘要抽屉，不得直连 push cut 路由
  assert.match(view, /@click="openCutSummary"/, '进入成片审核按钮应绑定 openCutSummary')
  assert.doesNotMatch(view, /@click="\$router\.push\(`\/projects\/\$\{projectId\}\/episodes\/\$\{episodeId\}\/cut`\)"/, '按钮不得绕过摘要抽屉直接 push cut 路由')
  const openFn = view.match(/async openCutSummary\(\) \{[\s\S]*?\n    \},/)
  assert.ok(openFn, 'openCutSummary 方法存在')
  assert.match(openFn[0], /getBatchPrecheck/, 'openCutSummary 应拉取批量预检作为计数数据源')
  assert.match(openFn[0], /catch/, '预检失败应有 catch 兜底')
  // 摘要三组计数：需确认 / 尚未生成 / 生成失败
  assert.match(view, /需确认/, '摘要应含「候选未采用/需确认」计数')
  assert.match(view, /尚未生成/, '摘要应含「尚未生成」计数')
  assert.match(view, /生成失败/, '摘要应含「生成失败」计数')
  assert.match(view, /cutSummary\./, '摘要计数应渲染 cutSummary 数据')
  // 「仍要进入」方法才 push cut 路由；「留在分镜」仅关门
  assert.match(view, /仍要进入成片审核/, '摘要抽屉应有「仍要进入成片审核」按钮')
  assert.match(view, /留在分镜/, '摘要抽屉应有「留在分镜」按钮')
  const goCut = view.match(/goCutReview\(\) \{[\s\S]*?\n    \},/)
  assert.ok(goCut, 'goCutReview 方法存在')
  assert.match(goCut[0], /\$router\.push\(`\/projects\/\$\{this\.projectId\}\/episodes\/\$\{this\.episodeId\}\/cut`\)/, '仍要进入应 push cut 路由')
  assert.match(view, /cutSummaryError/, '摘要抽屉内应有错误行呈现')
})

test('分镜页：?shot= 定位消费 + 生成历史经 openHistory 加载', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  // mounted/created 消费 route.query.shot：合法时选中该镜头并清除 query
  assert.match(view, /consumeShotQuery/, '应有 consumeShotQuery 消费 ?shot= 定位参数')
  const consumeFn = view.match(/async consumeShotQuery\(\) \{[\s\S]*?\n    \},/)
  assert.ok(consumeFn, 'consumeShotQuery 方法存在')
  assert.match(consumeFn[0], /\$route\.query\.shot/, '应读取 route.query.shot')
  assert.match(consumeFn[0], /selectShot/, '合法 shotId 应复用 selectShot 选中')
  assert.match(consumeFn[0], /\$router\.replace/, '消费后应 replace 清除 query')
  // 评审修复：selectShot 失败时 query 也必须清理（finally），且失败走页内错误提示
  assert.match(consumeFn[0], /finally/, '清 query 应在 finally 中（selectShot 失败也清理）')
  assert.match(consumeFn[0], /catch/, 'selectShot 失败应有 catch 页内提示')
  // 生成历史按钮走 openHistory（清空→拉取→开门），不得直连 historyOpen = true
  assert.match(view, /@click="openHistory\(\)"/, '生成历史按钮应绑定 openHistory')
  assert.doesNotMatch(view, /@click="historyOpen = true"/, '生成历史按钮不得绕过加载直连开门')
  const openHistory = view.match(/async openHistory\(\) \{[\s\S]*?\n    \},/)
  assert.ok(openHistory, 'openHistory 方法存在')
  assert.match(openHistory[0], /this\.history = \{\}/, 'openHistory 应先清空陈旧 history')
  assert.match(openHistory[0], /loadHistory\(\)/, 'openHistory 应拉取本镜历史')
  assert.match(openHistory[0], /historyOpen = true/, 'openHistory 拉取后才开门')
  // 切镜时若历史抽屉已开则重拉，避免展示上一镜的陈旧数据
  const selectShot = view.match(/async selectShot\(shotId\) \{[\s\S]*?\n    \},/)
  assert.ok(selectShot, 'selectShot 方法存在')
  assert.match(selectShot[0], /historyOpen[\s\S]*?loadHistory/, '切镜时历史抽屉已开应重拉历史')
})

test('分镜页评审修复：retryCandidate 先拉本镜历史再查找，不做静默兜底提交', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  const retryFn = view.match(/async retryCandidate\(candidate\) \{[\s\S]*?\n    \},/)
  assert.ok(retryFn, 'retryCandidate 方法存在')
  // 历史抽屉未开过时 this.history 为空——重试前必须先拉取本镜历史
  assert.match(retryFn[0], /v21\.getVideoHistory\(this\.currentShotId\)/, '重试前应先拉取本镜历史')
  assert.match(retryFn[0], /catch/, '历史拉取失败应有 catch')
  assert.match(retryFn[0], /this\.notice = /, '历史拉取失败应给可读提示')
  // 找不到原任务：可读提示，而非静默 submitVideo 按默认输入新建任务
  assert.match(retryFn[0], /未找到该候选/, '找不到原任务应给可读提示')
  assert.doesNotMatch(retryFn[0], /v21\.submitVideo/, '不得静默兜底 submitVideo 新建默认任务')
  // 找到原任务仍走 retryTask 重试
  assert.match(retryFn[0], /retryTask\(task\.taskId\)/, '找到原任务后走 retryTask 重试')
})

test('v21-ui.css：notice-strip danger 变体（T2.1 成片页失败条依赖）', () => {
  const css = read('src/styles/v21-ui.css')
  assert.match(css, /\.notice-strip\.danger/, 'notice-strip 应有 danger 变体')
  assert.match(css, /\.notice-strip\.danger[^}]*--danger-subtle/, 'danger 变体应使用 --danger-subtle 令牌')
})

test('成片页：审片+合片单屏；门禁禁用可解释；导出 MP4/SRT', () => {
  const view = read('src/views/productionStudio/studio/CutStage.vue')
  for (const keyword of ['生成成片', '连续播放', '回分镜修复', '导出 MP4', '导出 SRT', '成片设置']) {
    assert.match(view, new RegExp(keyword), `成片页缺少「${keyword}」`)
  }
})

test('外部 AI 向导：8 步流程且全程零媒体任务文案', () => {
  const view = read('src/views/productionStudio/ExternalAiWizardView.vue')
  for (const keyword of ['选择目标', '自动汇总上下文', '补充说明|补充本次要求', '任务包', '等待外部结果', '结果 JSON', '预览导入', '已导入草稿', '非空剧集永不可写入']) {
    assert.match(view, new RegExp(keyword), `向导缺少「${keyword}」`)
  }
  assert.match(view, /不会创建图片\/视频\/音频任务|零媒体任务|零费用/)
})

test('剧集页：新建剧集直达剧本 + 导入/协作菜单 + 回收站删除（无归档字样）', () => {
  const view = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.match(view, /新建剧集/)
  assert.match(view, /导入 \/ 协作|导入\/协作/)
  assert.match(view, /外部 AI 制作/)
  assert.match(view, /回收站/)
  assert.doesNotMatch(view, /归档|目标时长/)
})
