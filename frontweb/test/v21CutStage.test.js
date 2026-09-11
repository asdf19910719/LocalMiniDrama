import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const view = () => read('src/views/productionStudio/studio/CutStage.vue')

test('P0-11 生成成片：按钮绑定确认抽屉而非直连 compose', () => {
  const v = view()
  const hit = v.match(/<button[^>]*>[^<]*生成成片/)
  assert.ok(hit, '生成成片按钮存在')
  const open = v.slice(0, hit.index + hit[0].length)
  const tag = open.slice(open.lastIndexOf('<button'))
  assert.match(tag, /@click="openComposeConfirm"/, '生成成片应先打开确认抽屉')
  assert.doesNotMatch(tag, /@click="compose"/, '生成成片不得直连 compose')
  assert.match(v, /composeConfirmOpen/, '确认抽屉开合状态存在')
  assert.match(v, /确认生成/, '抽屉内有确认生成按钮')
  assert.match(v, /整集 BGM/, '抽屉展示设置摘要：BGM')
  assert.match(v, /旁白 TTS/, '抽屉展示设置摘要：旁白')
  assert.match(v, /字幕烧录/, '抽屉展示设置摘要：字幕')
  assert.match(v, /超分增强/, '抽屉展示设置摘要：超分')
})

test('P0-11 合成进行中：不确定进度条 + 请求取消调用 cancelCutCompose', () => {
  const v = view()
  assert.match(v, /正在合成/, '进行中提示文案')
  assert.match(v, /progress indeterminate/, '不确定进度条')
  assert.match(v, /请求取消/, '请求取消按钮')
  const fn = v.match(/async requestCancel\(\) \{[\s\S]*?\n    \},/)
  assert.ok(fn, 'requestCancel 方法存在')
  assert.match(fn[0], /v21\.cancelCutCompose\(this\.episodeId\)/, '应调用 cancelCutCompose 封装')
  assert.match(fn[0], /已请求取消，任务记录与设置已保留/, '取消成功后的用户文案')
  assert.match(fn[0], /await this\.load\(\)/, '取消后刷新 getCut 校正状态')
})

test('P0-11 状态可恢复：versions 里 composing/failed 回页后仍呈现进行中/失败条', () => {
  const v = view()
  assert.match(v, /composingVersion/, '从 versions 识别 composing（离开再回来不丢状态）')
  assert.match(v, /composeInFlight/, '提交等待中与 composing 归并为进行中')
  assert.match(v, /latestFailed/, '最新版本 failed 呈现失败条')
})

test('P0-11 失败重试：非取消失败提供按原设置重试（复用该版本 settings）；取消显示已取消', () => {
  const v = view()
  assert.match(v, /按原设置重试/, '失败条含按原设置重试按钮')
  const fn = v.match(/async retryFailed\(\) \{[\s\S]*?\n    \},/)
  assert.ok(fn, 'retryFailed 方法存在')
  assert.match(fn[0], /settings/, '重试应复用原版本 settings')
  assert.match(fn[0], /this\.compose\(/, '重试走同一 compose 流程')
  assert.match(v, /已取消/, '取消产生的 failed 版本显示已取消')
  assert.match(v, /statusLabel/, '版本状态用中文文案呈现')
})

test('P0-12 豁免弹窗：原因必填（空禁用确认）+ createWaiver + 弹窗内错误行', () => {
  const v = view()
  assert.match(v, /豁免并继续/, '豁免入口与确认按钮')
  assert.match(v, /<textarea[^>]*v-model="waiver\.reason"/, '原因 textarea 绑定')
  const btn = v.match(/<button[^>]*:disabled="![^"]*waiver\.reason\.trim\(\)[^"]*"[^>]*>/)
  assert.ok(btn, '确认按钮在原因为空时禁用')
  const fn = v.match(/async confirmWaiver\(\) \{[\s\S]*?\n    \},/)
  assert.ok(fn, 'confirmWaiver 方法存在')
  assert.match(fn[0], /v21\.createWaiver\(/, '应调用 createWaiver 封装')
  assert.match(fn[0], /ownerType: 'shot'/, 'waiver body 按后端契约带 ownerType')
  assert.match(fn[0], /ownerId: this\.waiver\.shotId/, 'waiver body 带 ownerId（镜头）')
  assert.match(fn[0], /reason/, 'waiver body 带必填 reason')
  assert.match(v, /waiver\.error/, '后端错误（如 REASON_REQUIRED）呈现在弹窗内')
  assert.match(fn[0], /await this\.load\(\)/, '豁免成功后刷新 getCut 重新计算 gate')
})

test('P0-12 门禁 blockers 逐条渲染：镜头号 + 原因 + 回分镜处理（?shot=）+ 豁免入口', () => {
  const v = view()
  assert.match(v, /blockedShots/, '从 shots 派生逐条阻塞项')
  assert.match(v, /blockerReason\(/, '每条呈现用户可读原因')
  assert.match(v, /回分镜处理/, '每条有回分镜处理动作')
  assert.match(v, /query: \{ shot: /, '跳转分镜携带 ?shot= 定位该镜头')
  assert.match(v, /openWaiver\(/, '阻塞项可打开豁免弹窗')
})

test('P0-12 已豁免标注与导出信息', () => {
  const v = view()
  assert.match(v, /已豁免/, '时间线/列表显示已豁免标注')
  assert.match(v, /s\.waived|waivedShots/, '已豁免依据真实返回字段')
  assert.match(v, /v\.exportedAt/, 'exported 版本显示导出时间')
  assert.match(v, /v\.fileName/, 'exported 版本显示文件信息')
})

test('成片页 UI 规范：不使用 Element Plus / 原生弹窗；不把内部状态值当主文案', () => {
  const v = view()
  assert.doesNotMatch(v, /el-button|el-switch|el-alert|el-tooltip|ElMessage/, '成片页不使用 Element Plus')
  assert.doesNotMatch(v, /window\.(confirm|alert|prompt)|\balert\(/, '不使用原生弹窗')
  assert.doesNotMatch(v, /\{\{\s*v\.status\s*\}\}/, '版本状态不得直接渲染内部枚举值')
})
