import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// P0-3：外部 AI 向导「可离页恢复」能力 + 失败可见性（前端合同断言）

test('向导 URL 恢复：mounted 消费 route.query.taskId 并调 getWizard（task 缺失提示后停留第一步）', () => {
  const view = read('src/views/productionStudio/ExternalAiWizardView.vue')
  assert.match(view, /this\.\$route\.query\.taskId/, 'mounted 应读取 URL 中的 taskId')
  assert.match(view, /v21\.getWizard\(this\.projectId/, '恢复时应调用 getWizard 获取任务与当前步')
  assert.match(view, /任务不存在或已取消/, 'task 为 null（已取消/不存在）应给出明确提示')
  assert.match(view, /restoreFromTask/, '应有独立恢复方法')
  // 恢复 imported 任务时应能落到已导入草稿步
  assert.match(view, /imported-draft/, '应按后端 currentStep 识别已导入草稿步')
})

test('向导 URL 恢复：创建任务成功后 router.replace 写入 taskId；取消成功后清除 query', () => {
  const view = read('src/views/productionStudio/ExternalAiWizardView.vue')
  assert.match(
    view,
    /\$router\.replace\(\{ query: \{ taskId/,
    '创建任务包成功后应以 replace 写入 ?taskId=（可离页恢复的 URL 锚点）'
  )
  assert.match(view, /clearTaskQuery/, '取消任务后应有清除 query 的路径')
  assert.match(view, /\$router\.replace\(\{ query: \{\} \}\)/, '清除 query 应以 replace({ query: {} }) 实现')
})

test('失败可见性：validate 失败时在结果步就地渲染 checks 清单（✗ 标红）与修正提示', () => {
  const view = read('src/views/productionStudio/ExternalAiWizardView.vue')
  // 结果步内出现 checks 渲染（v-if="checks && !checks.ok" 与逐项 label/detail 循环）
  const resultStep = view.slice(view.indexOf(`step === 'result'`), view.indexOf(`step === 'preview'`))
  assert.ok(resultStep.length > 0 && resultStep.includes('step === \'result\''), '应能定位结果步模板块')
  assert.match(resultStep, /checks && !checks\.ok/, '校验失败清单应在结果步就地渲染')
  assert.match(resultStep, /checks\.checks/, '应逐项渲染 checks')
  assert.match(resultStep, /c\.label/, '每项渲染 label')
  assert.match(resultStep, /c\.detail/, '每项渲染 detail')
  assert.match(resultStep, /校验未通过，请修正结果 JSON 或返回上一步/, '应有修正引导提示')
  assert.match(view, /check-row fail|fail.*标红|\.fail/, '失败项应有标红样式类')
})

test('失败可见性：digest 失配呈现三选面板（.modal），确认导入传 frozenSnapshot: true', () => {
  const view = read('src/views/productionStudio/ExternalAiWizardView.vue')
  assert.match(view, /ASSETS_DIGEST_MISMATCH/, '应识别 digest 失配错误码')
  assert.match(view, /digestModal/, '应有三选面板开关状态')
  assert.match(view, /class="modal"/, '三选面板应以 .modal 呈现')
  assert.match(view, /按冻结快照导入/, '面板应提供按冻结快照导入选项')
  assert.match(view, /放弃并创建新任务/, '面板应提供放弃并创建新任务选项')
  assert.match(view, /返回修改结果 JSON/, '面板应提供返回修改结果选项')
  assert.match(view, /frozenSnapshot: true/, '确认导入应携带 frozenSnapshot: true')
  assert.match(view, /cancelExternalTask\(this\.taskId\)[\s\S]*?step = 'target'/, '放弃后应取消任务并回第一步')
  // api 封装透传 options
  const api = read('src/v21/api.js')
  assert.match(api, /confirmImport: \(taskId, resultJson, options = \{\}\)/, 'confirmImport 封装应支持 options 透传')
})

test('剧集中心：外部任务区块调用新列表端点，等待中可打开向导/取消，已导入可打开剧本', () => {
  const view = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.match(view, /外部 AI 任务/, '应有外部任务区块')
  assert.match(view, /v-if="externalTasks\.length"/, '空状态不显示区块')
  assert.match(view, /listExternalTasks\(this\.projectId\)/, '应调用列表端点封装')
  assert.match(view, /打开向导/, '等待中任务应可打开向导')
  assert.match(view, /external-ai\?taskId=/, '打开向导应带 taskId 查询参数')
  assert.match(view, /打开剧本/, '已导入任务应可打开剧本')
  assert.match(view, /waiting_external/, '应消费 waiting_external 状态')
  assert.match(view, /cancelExternalTask\(/, '等待中任务应可取消')
  const api = read('src/v21/api.js')
  assert.match(
    api,
    /listExternalTasks: \(projectId\) => get\(`\/projects\/\$\{projectId\}\/external-ai\/tasks`\)/,
    'api.js 应有 listExternalTasks 封装指向新端点'
  )
})
