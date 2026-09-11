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
