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

test('高级画布：页头与画布内明示节点为示例投影，不再暗示真实数据', () => {
  const cv = read('src/views/productionStudio/AdvancedCanvasView.vue')
  assert.match(cv, /示例投影/, '页头徽标明示示例投影')
  assert.match(cv, /示例数据/, '画布内说明节点与连线为示例数据')
  assert.doesNotMatch(cv, /标准页数据的投影/, '移除含混的「数据投影」口径')
})

test('查看风格抽屉：版本记录渲染真实应用历史，删除「暂未记录」假话', () => {
  const view = read('src/views/productionStudio/ProjectOverviewView.vue')
  const api = read('src/v21/api.js')
  assert.match(api, /listStyleVersions: \(projectId\)/, 'api 封装提供风格版本记录端点')
  assert.match(view, /listStyleVersions/, '抽屉打开时拉取真实版本记录')
  assert.match(view, /styleVersions/, '渲染版本记录列表')
  assert.doesNotMatch(view, /版本历史暂未记录/, '不得保留与事实不符的占位')
})

test('新建项目来源接续：novel/video 创建后直达对应导入向导（不落空列表）', () => {
  const view = read('src/views/productionStudio/ProjectNewView.vue')
  const branch = view.slice(view.indexOf("this.source === 'novel'"), view.indexOf('} else {'))
  assert.ok(branch.length > 0, 'novel/video 分支存在')
  assert.match(branch, /import-novel/, 'novel 来源直达小说拆集向导')
  assert.match(branch, /import-video/, 'video 来源直达已有视频登记向导')
  assert.doesNotMatch(branch, /`\$\{pid\}\/episodes`/, '不得再回空剧集列表')
})

test('外部 AI 上下文步：目标/素材/上下文版本/生成时间接真实数据，未建任务时诚实说明冻结时点', () => {
  const view = read('src/views/productionStudio/ExternalAiWizardView.vue')
  assert.match(view, /localNextNumber/, '本地计算下一集号（修复目标步集号空缺）')
  assert.match(view, /projectAssetCount/, '展示将冻结的素材对象数')
  assert.match(view, /task\?\.contextVersion/, '已建任务显示真实上下文版本指纹')
  assert.match(view, /task\?\.assetsDigest/, '显示素材快照摘要指纹')
  assert.match(view, /task\?\.createdAt/, '已建任务显示真实生成时间')
  assert.match(view, /创建任务包时/, '未建任务时说明数值冻结时点，不伪造')
  assert.doesNotMatch(view, /上下文由系统自动编译，生成时间与版本将冻结/, '移除静态占位文案')
})
