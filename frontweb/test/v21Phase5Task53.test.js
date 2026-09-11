import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Task 5-C（Phase 5 横切 C）：制作头切集守卫 / 归档导入真实校验 / P2 批量清理 的合同断言。
// 断言先行（TDD）：实现于 StudioShell.vue、ScriptStage.vue、ArchiveImportView.vue、
// ProjectEpisodesView.vue、StoryboardStage.vue、DataToolsView.vue 与 v21/api.js。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('① 制作头：剧集下拉（listEpisodes）+ dirty 切换守卫 + warn 徽标 title + 非剧本阶段保存态透传', () => {
  const shell = read('src/views/productionStudio/studio/StudioShell.vue')
  // 剧集下拉：数据来自 v21.listEpisodes，选择即切换
  assert.match(shell, /v21\.listEpisodes\(/, '制作头加载同项目全部剧集')
  assert.match(shell, /<select[^>]*@change="onEpisodePick"/s, '剧集下拉选择触发切换')
  assert.match(shell, /onEpisodePick/, '存在切换处理方法')
  // 切换守卫：dirty 时不出直切，出两按钮守卫
  assert.match(shell, /saveState\.dirty/, '守卫读取 studioSave 通道的 dirty 标记')
  assert.match(shell, /保存并切换/, '守卫提供“保存并切换”')
  assert.match(shell, /放弃并切换/, '守卫提供“放弃并切换”')
  assert.match(shell, /pendingEpisodeId/, '守卫暂存目标剧集，切换经守卫放行')
  assert.match(shell, /episodes\/\$\{[^}]+\}\/\$\{[^}]*stage/, '切换保持当前阶段（router.push 该集同阶段）')
  // warn 徽标 title：把 meta 拼进 title
  assert.match(shell, /:title="[^"]*st\.meta/, 'warn 徽标 title 携带阶段 meta 说明')
  // 保存态透传：非剧本阶段显示真实语义
  assert.match(shell, /更改实时生效/, '非剧本阶段文案为“更改实时生效”')

  // ScriptStage 通过 studioSave 通道上报 dirty 与保存方法
  const script = read('src/views/productionStudio/studio/ScriptStage.vue')
  assert.match(script, /studioSave\.dirty\s*=/, 'ScriptStage 向通道上报 dirty')
  assert.match(script, /studioSave\.save\s*=/, 'ScriptStage 向通道注册保存方法（供“保存并切换”调用）')

  // 评审 C1：动态组件随集重建 + 卸载前清自动保存定时器（防跨集写稿/放弃后仍写库）
  assert.match(shell, /<component[^>]*:key="episodeId"/s, '阶段组件以 episodeId 为 key，切集强制重建')
  assert.match(script, /beforeUnmount\(\) \{\s*clearTimeout\(this\.timer\)/, 'ScriptStage 卸载前清 800ms 自动保存定时器')
})

test('② 归档导入：validate() 调 /archive/validate 并渲染检查矩阵；unsupported 呈现版本说明；导入动作保持现状', async () => {
  // api 层：真实导出 validateArchive 函数（行为断言，不发请求）
  const { v21 } = await import('../src/v21/api.js')
  assert.equal(typeof v21.validateArchive, 'function', 'v21.validateArchive 存在')

  const view = read('src/views/productionStudio/ArchiveImportView.vue')
  assert.match(view, /v21\.validateArchive\(/, 'validate() 调用新校验端点')
  assert.match(view, /localPath/, '保留路径输入（本地 zip 路径）')
  // 校验失败保留输入可重试：validate 流程不得清空 localPath
  assert.doesNotMatch(view, /this\.localPath\s*=\s*['"`]{2}/, '失败重试不清空路径输入')
  // 三条静态检查行替换为返回的检查矩阵渲染（行内渲染后端下发的 label/status/detail）
  assert.match(view, /v-for="c in [^"]*checks/, '渲染后端返回的检查矩阵')
  assert.match(view, /\{\{ c\.label \}\}/, '矩阵行渲染后端标签')
  assert.match(view, /\{\{ c\.detail \}\}/, '矩阵行渲染原因明细')
  assert.match(view, /通过/, '矩阵呈现通过态')
  assert.match(view, /警告/, '矩阵呈现警告态')
  assert.match(view, /阻断/, '矩阵呈现阻断态')
  // 概要指标
  assert.match(view, /summary\??\.projectName/, '概要显示项目名')
  assert.match(view, /summary\??\.episodeCount/, '概要显示剧集数')
  assert.match(view, /summary\??\.mediaCount/, '概要显示媒体文件数')
  assert.match(view, /summary\??\.estimatedSizeBytes/, '概要显示预计大小')
  // unsupported 态：版本说明 + 重新选择
  assert.match(view, /unsupported/, '存在 unsupported 分支')
  assert.match(view, /检测到归档版本/, 'unsupported 呈现版本说明')
  // 导入动作保持现状且注明不覆盖
  assert.match(view, /\/api\/v1\/dramas\/import/, '导入动作保持 POST /api/v1/dramas/import')
  assert.match(view, /导入不覆盖现有项目/, '页面注明导入不覆盖现有项目')
  // 评审 M2：error 态禁用导入；校验与导入同一路径（路径漂移需重新校验）
  assert.match(view, /存在阻断项，无法导入/, 'overall error 时禁用导入并提示')
  assert.match(view, /pathDrifted/, '存在路径漂移判定（validate 与导入同一 path）')
  assert.match(view, /重新校验/, '路径漂移提供重新校验动作')
})

test('③ P2-1 剧集中心：completed 剧集主按钮为“查看成片”', () => {
  const view = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.match(view, /ep\.status === 'completed'[^>]*>查看成片|查看成片</, 'completed 行主按钮文案为查看成片')
  assert.match(view, /openCut\(ep\)/, '查看成片走 openCut')
  const fn = view.match(/openCut\(ep\) \{[\s\S]*?\n    \},/)
  assert.ok(fn, 'openCut 方法存在')
  assert.match(fn[0], /\/cut/, 'openCut 跳转该集成片阶段')
})

test('④ P2-3 分镜候选/播放器 stale 标注：消费 staleVideos 与 completion.staleShots，加“基于旧分镜图”小标', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  assert.match(view, /staleVideoIds/, '记录 setImageCurrent 返回的 staleVideos（候选 id）')
  assert.match(view, /staleVideos/, '消费后端返回的 staleVideos')
  assert.match(view, /isCandidateStale/, '存在候选级 stale 判定（合并 staleVideos 与 staleShots）')
  assert.match(view, /基于旧分镜图/, '播放器/候选条呈现“基于旧分镜图”小标')
})

test('⑤ P2 批量清理：镜头轨筛选 / H3 文案 / 空态副文案 / 迁移徽标 / 搜索防抖', () => {
  // P2-2 镜头轨筛选补“失败/处理中”，且筛选真实生效（trackFilter 参与镜头轨过滤）+ 预检提供 processing
  const sb = read('src/views/productionStudio/studio/StoryboardStage.vue')
  assert.match(sb, /trackFilter === 'failed'/, '镜头轨新增“失败”筛选项')
  assert.match(sb, /trackFilter === 'processing'/, '镜头轨新增“处理中”筛选项')
  assert.match(sb, /filteredShots/, '镜头轨渲染经过 trackFilter 过滤（筛选真实生效）')
  assert.match(sb, /getBatchPrecheck/, '加载时拉取预检（失败/处理中计数来源）')
  assert.match(sb, /trackStats/, '保存预检的失败/处理中统计')
  assert.match(sb, /处理中/, '“处理中”文案存在')
  // P2-4 H3 按钮文案
  assert.match(sb, /h3\.draftId \? '重新生成 H3 提示词' : '生成 H3 提示词'/, 'H3 主按钮完整文案')
  assert.doesNotMatch(sb, /h3\.draftId \? '重新生成' :/, '旧短文案清除')
  // P2-5 分镜空态副文案
  assert.match(sb, /从已确认剧本创建镜头，或导入分镜结构/, '空态补副文案（导入为后续后端工作，仅文案）')

  // P2-6 DataToolsView 迁移区徽标加载中显示“读取中…”
  const dt = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(dt, /读取中…/, '迁移徽标加载态文案')
  assert.match(dt, /migrationsLoading \|\| !migrationsLoaded \? '读取中…' : '无记录'/, '徽标三态：加载中/无记录/状态')

  // P2-7 剧集中心搜索防抖 280ms（对齐 ProjectsView）
  const ep = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.match(ep, /clearTimeout\(this\.searchTimer\)/, '输入防抖先清旧计时器')
  assert.match(ep, /setTimeout\([\s\S]{0,120}280\)/, '280ms 防抖（对齐 ProjectsView）')
})
