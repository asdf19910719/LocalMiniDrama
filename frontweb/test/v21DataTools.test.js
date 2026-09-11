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

test('A3/A5 物理清理与媒体重定位：真实执行器 + 无 window.confirm/alert/prompt', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /cleanupDryRun/, 'api：清理 dry-run')
  assert.match(api, /cleanupExecute/, 'api：清理执行')
  assert.match(api, /relocationScan/, 'api：重定位扫描')
  assert.match(api, /relocationConfirm/, 'api：重定位确认')
  const view = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(view, /runCleanupDryRun/, '清理 dry-run 真实调用')
  assert.match(view, /executeCleanup/, '清理真实执行')
  assert.match(view, /runRelocScan/, '重定位真实扫描')
  assert.match(view, /executeReloc/, '重定位真实确认')
  assert.match(view, /确认更新媒体路径/, '重定位确认走专用 Modal')
  assert.match(view, /永久清理/, '清理确认文本门禁')
  assert.doesNotMatch(view, /window\.confirm|window\.alert|window\.prompt|alert\(/, '本视图不得再使用浏览器原生弹窗')
  assert.doesNotMatch(view, /演示|占位/, '不得残留演示占位文案')
})

test('A4 工作区迁移向导：SettingsView 串六步真实执行器，按钮解禁', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /workspaceCheck/, 'api：迁移检查')
  assert.match(api, /workspacePreview/, 'api：范围预览')
  assert.match(api, /workspaceMigrate/, 'api：迁移执行')
  const view = read('src/views/productionStudio/SettingsView.vue')
  assert.match(view, /runWorkspaceCheck/, '检查步骤真实调用')
  assert.match(view, /runWorkspaceMigrate/, '迁移真实执行')
  assert.match(view, /确认迁移并重新打开/, '设计稿 24 的确认按钮保留')
  assert.doesNotMatch(view, /disabled title="工作区迁移执行器将在后续版本接入"/, '执行器已接入，禁用占位应移除')
  assert.match(view, /重新打开工作区/, '完成提示保留')
})

// ---- Task 4.4 高级数据工具补全（迁移记录真实化 / 重定位五态 / 清理二次确认） ----

test('Task 4.4 迁移与恢复记录真实化：调用 /datatools/migrations，静态 COMMITTED 占位移除', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /migrations:\s*\(\)\s*=>\s*get\('\/datatools\/migrations'\)/, 'api：GET /datatools/migrations')
  const view = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(view, /loadMigrations/, '迁移记录区真实加载')
  assert.match(view, /v21\.migrations\(\)/, '调用真实迁移记录端点')
  assert.match(view, /journal\.status/, '渲染 journal 真实状态')
  assert.match(view, /backups/, '渲染备份列表（时间+大小）')
  assert.match(view, /重试/, '接口失败显示错误并可重试')
  assert.doesNotMatch(view, /V2\.1 正式迁移/, '静态占位卡标题应移除')
  assert.doesNotMatch(view, /状态 COMMITTED · 目标版本/, '硬编码 COMMITTED 文案应移除')
})

test('Task 4.4 failed 态恢复动作诚实化：查看迁移日志/备份位置/人工回滚说明，无自动回滚按钮', () => {
  const view = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(view, /查看迁移日志/, 'journal 原始 JSON 日志抽屉入口')
  assert.match(view, /备份位置/, 'failed 态备份位置行')
  assert.match(view, /人工执行/, '回滚需按迁移报告人工执行的诚实说明')
  assert.doesNotMatch(view, /自动回滚|一键回滚/, '后端无自动回滚能力，不得提供自动回滚按钮')
})

test('Task 4.4 重定位五态：标签映射 + 阻断禁勾选 + evidence 渲染 + 确认摘要统计', () => {
  const view = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(view, /hash_mismatch/, 'hash 不一致态')
  assert.match(view, /path_escape/, '路径越界态')
  assert.match(view, /hash 不一致 · 阻断/, '阻断态用户语言标签')
  assert.match(view, /路径越界 · 阻断/, '阻断态用户语言标签')
  assert.match(view, /isRelocBlocked/, '阻断态判定')
  assert.match(view, /:disabled="isRelocBlocked\(row\)/, '阻断态行禁勾选')
  assert.match(view, /row\.evidence/, '匹配证据 evidence 渲染')
  assert.match(view, /阻断跳过/, '确认摘要统计行（将更新 N 项 · 阻断跳过 M 项）')
})

test('Task 4.4 清理二次确认：输入确认文本后仍需第二层确认才调 cleanupExecute', () => {
  const view = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(view, /确认执行物理清理/, '第二层确认弹窗（列出文件数与总大小）')
  assert.match(view, /v-if="cleanupFinalOpen"/, '第二层确认走专用 Modal')
  assert.match(view, /cleanupFinalOpen = true/, '第一层确认文本通过后先打开第二层，而非直接执行')
  assert.doesNotMatch(view, /cleanupConfirmText !== '永久清理'[^>]*@click="executeCleanup"/, '第一层按钮不得直接调 executeCleanup')
  assert.match(view, /@click="executeCleanup"/, 'executeCleanup 由第二层确认触发')
})

test('Task 4.4 重定位执行结果渲染 relocDone（已更新/失败/报告位置，用 confirm 返回字段）', () => {
  const view = read('src/views/productionStudio/DataToolsView.vue')
  assert.match(view, /v-if="relocDone"/, '执行结果真实渲染（relocDone 不再是死状态）')
  assert.match(view, /relocDone\.updated/, '已更新计数消费 confirm 返回字段')
  assert.match(view, /relocDone\.skipped/, '未更新/失败项消费 confirm 返回字段')
  assert.match(view, /v-if="relocDone\.reportPath"/, '报告位置仅在后端返回时渲染（不伪造）')
})
