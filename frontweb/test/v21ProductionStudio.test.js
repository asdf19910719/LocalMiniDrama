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
