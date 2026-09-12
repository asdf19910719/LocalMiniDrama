import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const view = () => read('src/views/productionStudio/ProjectOverviewView.vue')

test('概览操作菜单：导出项目备份 + 高级数据工具 + 归档导入诚实文案（O1）', () => {
  const v = view()
  // 导出项目备份：菜单项存在且绑定导出方法
  assert.match(v, /导出项目备份/, '菜单应有「导出项目备份」项')
  assert.match(v, /exportBackup/, '应绑定 exportBackup 方法')
  const exportFn = v.match(/async exportBackup\(\) \{[\s\S]*?\n    \},/)
  assert.ok(exportFn, 'exportBackup 方法应存在')
  assert.match(exportFn[0], /\/export/, 'exportBackup 应调用导出端点')
  assert.match(exportFn[0], /responseType: 'blob'/, '导出应以 blob 下载文件')
  assert.match(exportFn[0], /catch/, '导出失败应有 catch')
  assert.match(exportFn[0], /opsError/, '导出失败错误应呈现（opsError）')
  // 高级数据工具：菜单项 router 到 /settings/data-tools
  assert.match(v, /高级数据工具/, '菜单应有「高级数据工具」项')
  assert.match(v, /\/settings\/data-tools/, '高级数据工具应链接到 /settings/data-tools')
  // 归档导入：文案改名 + 作用域副文案（不假装项目内恢复）
  assert.match(v, /从归档导入（创建新项目）/, '导入菜单文案应为「从归档导入（创建新项目）」')
  assert.match(v, /归档导入不会覆盖现有项目；项目内恢复需在高级数据工具处理/, '应有归档导入作用域副文案')
  assert.doesNotMatch(v, /从备份恢复/, '旧文案「从备份恢复」应移除')
})

test('概览操作菜单不再整层点击即关（导出失败需保留菜单呈现错误）', () => {
  const v = view()
  assert.doesNotMatch(v, /class="card more-pop" @click="opsOpen = false"/, '弹出菜单容器不得整层点击即关闭')
})

test('四阶段汇总卡可点击：router push 携带 stage query（O2）', () => {
  const v = view()
  assert.match(v, /goStage/, '阶段卡应绑定 goStage')
  const goStage = v.match(/goStage\(key\) \{[\s\S]*?\n    \},/)
  assert.ok(goStage, 'goStage 方法应存在')
  assert.match(goStage[0], /\/projects\/\$\{this\.projectId\}\/episodes/, 'goStage 应跳转剧集页')
  assert.match(goStage[0], /stage: key/, 'goStage 应携带 stage query')
  assert.match(v, /@click="goStage\(key\)"/, '阶段卡应绑定 @click="goStage(key)"')
  assert.match(v, /stage-card:hover/, '阶段卡应有 hover 可点击态')
  assert.match(v, /cursor: pointer/, '阶段卡应呈现可点击光标')
})

test('项目素材摘要卡：消费 assetsAggregate + 打开项目素材（O6）', () => {
  const v = view()
  assert.match(v, /assetsAggregate/, '应消费 assetsAggregate')
  assert.match(v, /overview\.assetsAggregate/, '摘要卡应读取 overview.assetsAggregate')
  assert.match(v, /个对象/, '应呈现对象数')
  assert.match(v, /个缺少当前图/, '应呈现缺失当前图数')
  assert.match(v, /打开项目素材/, '应有「打开项目素材」入口')
  const summary = v.match(/assets-summary[\s\S]*?<!-- 项目画面风格 -->/)
  assert.ok(summary, '素材摘要卡应存在')
  assert.match(summary[0], /v-if="overview && overview\.assetsAggregate"/, '字段缺失时整卡不渲染')
  assert.match(summary[0], /\/projects\/\$\{projectId\}\/assets/, '摘要卡应 router 到项目素材页')
})

test('查看风格：只读抽屉（来源/视觉规则/使用口径/版本记录，不伪造历史）（O3）', () => {
  const v = view()
  assert.match(v, /查看风格/, '风格卡应有「查看风格」按钮')
  assert.match(v, /openStyleDrawer/, '查看风格应绑定 openStyleDrawer')
  // 抽屉内容：名称/描述来自目录条目 + 视觉规则（描述字段）
  assert.match(v, /currentStyle/, '应有 currentStyle 计算属性解析目录条目')
  assert.match(v, /视觉规则/, '抽屉应有视觉规则区')
  assert.match(v, /currentStyle\.descriptionZh/, '视觉规则应来自目录条目描述字段')
  // 使用与影响口径（固定文案）
  assert.match(v, /项目内未来生成默认使用该风格；更换风格不会自动重新生成已有素材/, '抽屉应有使用与影响口径说明')
  // 版本记录：接真实应用历史（listStyleVersions）；无记录时据实显示「还没有更换风格的记录」
  assert.match(v, /listStyleVersions/, '抽屉应拉取真实风格版本记录')
  assert.match(v, /styleVersions/, '应渲染版本记录列表')
  assert.match(v, /本项目还没有更换风格的记录/, '无版本事件时据实显示，不伪造')
  assert.doesNotMatch(v, /版本历史暂未记录/, '旧占位文案（与事实不符）应清除')
  assert.match(v, /styleDrawerOpen/, '查看风格应为独立只读抽屉')
})

test('更换风格：影响确认弹窗前置，确认后才调 applyStyle（O4/O5）', () => {
  const v = view()
  // 选择步页脚不得直连 applyStyle
  assert.match(v, /confirmApplyStyle/, '应有 confirmApplyStyle 确认方法')
  assert.match(v, /@click="confirmApplyStyle"/, '「确认更换」应绑定 confirmApplyStyle')
  const confirmFn = v.match(/async confirmApplyStyle\(\) \{[\s\S]*?\n    \},/)
  assert.ok(confirmFn, 'confirmApplyStyle 方法应存在')
  assert.match(confirmFn[0], /v21\.applyStyle/, '确认方法才调用 v21.applyStyle')
  assert.match(confirmFn[0], /catch/, '应用风格失败应有 catch')
  // 三条确认口径
  assert.match(v, /确认后创建新风格版本/, '确认口径①')
  assert.match(v, /已引用素材与候选不自动重新生成/, '确认口径②')
  assert.match(v, /历史版本保留可回看/, '确认口径③')
  // 两步结构：选择步按钮为进入确认，不再单步直应用
  assert.match(v, /styleStep/, '风格弹窗应有分步状态')
  assert.doesNotMatch(v, /@click="applyStyle"/, '不得存在直连 applyStyle 的按钮')
})

test('风格 Modal 三标签：预设/我的/自定义，按 type 过滤或诚实禁用（O5）', () => {
  const v = view()
  assert.match(v, /预设风格/, '预设风格 tab 应存在')
  assert.match(v, /我的风格/, '我的风格 tab 应存在')
  assert.match(v, /自定义风格/, '自定义风格 tab 应存在')
  assert.match(v, /styleTab/, '应有 styleTab 状态')
  // /api/v1/styles 支持 type 过滤：预设=system、我的=custom 均可真实拉取
  const loadStyles = v.match(/async loadStyles\([\s\S]*?\n    \},/)
  assert.ok(loadStyles, 'loadStyles 方法应存在')
  assert.match(loadStyles[0], /query\.type = 'system'/, '预设风格 tab 应按 type=system 过滤')
  assert.match(loadStyles[0], /query\.type = 'custom'/, '我的风格 tab 应按 type=custom 过滤')
  // 自定义风格 tab：无安装目录支持 → 禁用态 + 说明
  assert.match(v, /安装自定义风格目录后开放/, '自定义风格 tab 应诚实禁用并说明')
})

test('概览加载失败不伪装：catch + 错误卡 + 重试（O7；Task 5-B 收口为 StateBlock 统一呈现）', () => {
  const v = view()
  const load = v.match(/async load\(\) \{[\s\S]*?\n    \},/)
  assert.ok(load, 'load 方法应存在')
  assert.match(load[0], /catch/, 'load 应有 catch')
  assert.match(load[0], /loadError/, '失败应记录 loadError')
  assert.match(v, /项目信息加载失败/, '模板应有失败错误卡')
  assert.match(v, /@retry="load"/, '应有「重试」按钮经 StateBlock 绑 load')
})
