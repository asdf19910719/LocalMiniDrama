import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('api 客户端：新增设置默认值与备份端点封装', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /getSettingsDefaults/, 'api：GET /settings/defaults')
  assert.match(api, /updateSettingsDefaults/, 'api：PUT /settings/defaults')
  assert.match(api, /runBackup/, 'api：POST /datatools/backup/run')
  assert.match(api, /backupStats/, 'api：GET /datatools/backup/stats')
})

test('① 设置表单含默认单集时长与备份保留天数，保存调 PUT /settings/defaults', () => {
  const view = read('src/views/productionStudio/SettingsView.vue')
  assert.match(view, /episodeDurationSeconds/, '表单应有默认单集时长字段')
  assert.match(view, /backupRetentionDays/, '表单应有备份保留天数字段')
  assert.match(view, /updateSettingsDefaults/, '保存应调用新端点 PUT /api/v2/settings/defaults')
  assert.match(view, /getSettingsDefaults/, '加载应拉取默认值')
  assert.match(view, /60\/90\/120|@click="form\.episodeDurationSeconds = 60"/, '时长应有 60/90/120 预设')
  assert.match(view, /不允许关闭备份保护/, '保留天数 0 时应提示禁止关闭备份保护')
  assert.match(view, /放弃更改/, '应有放弃更改按钮（恢复 savedForm）')
  assert.match(view, /savedForm/, '保存成功后 savedForm 同步（修复假保存）')
  assert.doesNotMatch(view, /window\.confirm|window\.alert|window\.prompt|alert\(/, '不得使用浏览器原生弹窗')
  assert.doesNotMatch(view, /comingSoon/, 'comingSoon 占位应移除')
})

test('② 备份区：真实统计 + 立即创建备份调 backup/run，成功提示路径', () => {
  const view = read('src/views/productionStudio/SettingsView.vue')
  assert.match(view, /backupStats\(\)/, '应拉取备份目录统计')
  assert.match(view, /backupCount/, '应显示备份数量')
  assert.match(view, /lastBackupAt/, '应显示最近备份时间')
  assert.match(view, /estimatedUsageBytes/, '应显示预计占用')
  assert.match(view, /暂不可用/, '统计加载失败应显示暂不可用而非假数据')
  assert.match(view, /runBackup\(\)/, '立即创建备份应调真实执行器')
  assert.match(view, /backupRunning/, '执行中防重复')
  assert.match(view, /backupResult/, '成功应提示备份路径')
  assert.match(view, /backupError/, '失败应有错误行')
})

test('③ 目录行：重新检测调专用只读端点 dirStatus（不再把展示串发给 workspaceCheck），默认态未检测', () => {
  const api = read('src/v21/api.js')
  const view = read('src/views/productionStudio/SettingsView.vue')
  assert.match(api, /dirStatus/, 'api：GET /datatools/dirs/status 只读目录状态')
  assert.match(view, /重新检测/, '每行目录应提供重新检测')
  assert.match(view, /未检测/, '静态“正常”徽标应改为未检测默认态')
  assert.match(view, /checkDir[\s\S]{0,400}dirStatus\(\)/, '重新检测应调用专用只读端点')
  assert.doesNotMatch(view, /checkDir\s*\([\s\S]{0,400}workspaceCheck/, '目录行不得再把展示串发给 workspaceCheck（副作用 + 假正常）')
  assert.match(view, /row\.checking/, '检测中应有 loading 态')
  assert.match(view, /目录不存在|exists/, '应消费 exists/writable/error 字段呈现状态')
  assert.match(view, /前往清理/, '临时目录行应有前往清理链接')
  assert.match(view, /\/settings\/data-tools/, '前往清理应路由到数据工具页')
})

test('④ dirty 守卫：beforeRouteLeave 离开确认（自建弹窗，不用 window.confirm）', () => {
  const view = read('src/views/productionStudio/SettingsView.vue')
  assert.match(view, /beforeRouteLeave/, '应注册组件内离开守卫')
  assert.match(view, /leaveConfirmOpen|leaveConfirm/, '离开确认应使用页面内弹窗')
  assert.doesNotMatch(view, /window\.confirm/, '不得用 window.confirm')
})

test('⑥ 迁移预览补“任务/备份”信息 tile（真实 activeTasks，不伪造数字）', () => {
  const view = read('src/views/productionStudio/SettingsView.vue')
  assert.match(view, /details\.activeTasks/, '任务 tile 应消费 workspaceCheck 返回的 activeTasks')
  assert.match(view, /迁移前自动创建备份/, '备份 tile 静态口径说明')
})

test('⑤ ProjectNewView：拉取全局默认，画幅/单集目标时长继承，提交带 targetDurationSeconds', () => {
  const api = read('src/v21/api.js')
  const view = read('src/views/productionStudio/ProjectNewView.vue')
  assert.match(view, /getSettingsDefaults/, 'mounted 应拉取 GET /settings/defaults')
  assert.match(view, /aspectRatio/, '画幅字段保留')
  assert.match(view, /单集目标时长/, '应新增单集目标时长输入')
  assert.match(view, /targetDurationSeconds/, '提交时应随 createProject 请求体带上 targetDurationSeconds')
  assert.match(view, /episodeDurationSeconds/, '时长状态字段与默认值闭环')
  assert.doesNotMatch(view, /alert\(/, '不得使用浏览器原生弹窗')
  assert.match(api, /getSettingsDefaults/, 'api 封装存在')
})
