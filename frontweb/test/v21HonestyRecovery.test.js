import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('制作头 runningTasks：接真实运行任务计数（30s 轮询），预算摘要诚实占位', () => {
  const view = read('src/views/productionStudio/studio/StudioShell.vue')
  assert.match(view, /listV21Tasks\(\{ status: 'in_progress'/, '运行任务计数必须来自任务聚合端点 in_progress 口径')
  assert.match(view, /this\.runningTasks = .*total/, '徽标数字取自真实 total')
  assert.match(view, /setInterval/, '低频轮询保持计数新鲜')
  assert.match(view, /clearInterval\(this\.tasksTimer\)/, '卸载清理轮询')
  assert.match(view, /费用 · 本地 ¥0/, '预算摘要为本地执行 ¥0 的诚实口径')
})

test('项目列表归档页签：卡片菜单提供恢复项目入口（restoreProject 零调用清零）', () => {
  const view = read('src/views/productionStudio/ProjectsView.vue')
  assert.match(view, /v21\.restoreProject\(/, '归档项目恢复必须调用既有封装')
  assert.match(view, /恢复项目/, '菜单提供恢复项目动作')
  assert.match(view, /恢复失败，请重试|v21Toast/, '恢复失败不得静默')
})

test('项目素材回收站：筛选段提供回收站视图与恢复动作，删除文案指向本页回收站', () => {
  const view = read('src/views/productionStudio/ProjectAssetsView.vue')
  assert.match(view, /view === 'recycled'/, '存在回收站视图状态')
  assert.match(view, /recycled: this\.view === 'recycled'/, '列表请求带回收站口径')
  assert.match(view, /restoreOne/, '回收站卡片提供恢复动作')
  assert.match(view, /可在本页「回收站」筛选中恢复/, '删除确认文案指向本页回收站（不再指向高级数据工具）')
  assert.doesNotMatch(view, /可在高级数据工具中恢复删除/, '不得再承诺不存在的入口')
})

test('音色预设：撤除假波形装饰并明示暂无样音（收回试听承诺）', () => {
  const stage = read('src/views/productionStudio/studio/AssetsStage.vue')
  const presetRow = stage.slice(stage.indexOf('v-for="p in voicePresets"'), stage.indexOf('legacyVoiceUrl'))
  assert.doesNotMatch(presetRow, /v-wave/, '预设行不得保留假波形（无音频可播）')
  assert.match(presetRow, /暂无样音/, '预设行明示暂无样音')
})

test('分镜导入承诺收回：更多菜单按钮与空态文案不再出现「导入」', () => {
  const sb = read('src/views/productionStudio/studio/StoryboardStage.vue')
  assert.doesNotMatch(sb, /更新分镜结构 \/ 导入 \/ 导出/, '按钮文案不得承诺导入')
  assert.match(sb, /更新分镜结构 \/ 导出/, '按钮文案收敛为更新结构与导出')
  assert.doesNotMatch(sb, /或导入分镜结构/, '空态不得承诺导入分镜结构')
})

test('媒体库筛选收窄：移除无数据源的视频段选并说明真实口径', () => {
  const ml = read('src/views/productionStudio/MediaLibraryView.vue')
  assert.doesNotMatch(ml, /type === 'video'/, '不得保留无数据源的视频筛选段')
  assert.match(ml, /分镜视频请在分镜页查看/, '说明真实口径')
})

test('剧集来源标签：按 importSchema 区分小说拆集/制作包/外部 AI，不再把拆集集显示为手工创建', () => {
  const view = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.match(view, /importSchema/, '来源标签消费 importSchema')
  assert.match(view, /小说拆集/, '提供小说拆集标签')
  assert.match(view, /制作包导入/, '提供制作包导入标签')
  assert.match(view, /importSchemaLabel/, '导入来源抽屉协议行用用户语言')
})
