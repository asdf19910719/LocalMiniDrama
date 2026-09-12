import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  collectIgnoredSourceKeys,
  matchActionLabel,
  matchRequiresDecision,
  matchTypeLabel,
  unresolvedConflictCount,
} from '../src/utils/episodeImportDecisions.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const importView = () => read('src/views/productionStudio/EpisodePackageImportView.vue')
const episodesView = () => read('src/views/productionStudio/ProjectEpisodesView.vue')

// ---------- 后端事实（episodeImportV21.js buildImportPlan 实际字段） ----------
// matches: [{ type, sourceKey, name, action: 'create'|'reuse'|'match-with-character', existingId }]

test('matchTypeLabel 覆盖后端四种匹配类型并兜底', () => {
  assert.equal(matchTypeLabel('character'), '人物')
  assert.equal(matchTypeLabel('character_state'), '人物状态')
  assert.equal(matchTypeLabel('scene'), '场景')
  assert.equal(matchTypeLabel('prop'), '道具')
  assert.equal(matchTypeLabel('unknown_kind'), 'unknown_kind')
  assert.equal(matchTypeLabel(undefined), '素材')
})

test('matchActionLabel：reuse 带 existingId 显示复用已有，match-with-character 随人物，默认新建', () => {
  assert.equal(matchActionLabel({ action: 'create', existingId: null }), '新建')
  assert.equal(matchActionLabel({ action: 'reuse', existingId: 12 }), '复用 · 已有 #12')
  assert.equal(matchActionLabel({ action: 'reuse', existingId: null }), '复用')
  assert.equal(matchActionLabel({ action: 'match-with-character', existingId: null }), '随人物处理')
})

test('matchRequiresDecision 仅在后端显式标记 requiresDecision/ambiguous/conflict 时为真', () => {
  assert.equal(matchRequiresDecision({ action: 'create' }), false)
  assert.equal(matchRequiresDecision({ action: 'reuse', existingId: 3 }), false)
  assert.equal(matchRequiresDecision({ requiresDecision: true }), true)
  assert.equal(matchRequiresDecision({ ambiguous: true }), true)
  assert.equal(matchRequiresDecision({ conflict: true }), true)
  assert.equal(matchRequiresDecision(null), false)
})

test('collectIgnoredSourceKeys 只收集勾选且带 sourceKey 的匹配项，保持顺序', () => {
  const matches = [
    { type: 'character', sourceKey: 'char_lin' },
    { type: 'scene', sourceKey: 'scene_alley' },
    { type: 'prop', sourceKey: 'prop_ring' },
    { type: 'prop', sourceKey: '' },
  ]
  assert.deepEqual(collectIgnoredSourceKeys(matches, { char_lin: true, prop_ring: true }), [
    'char_lin',
    'prop_ring',
  ])
  assert.deepEqual(collectIgnoredSourceKeys(matches, {}), [])
  assert.deepEqual(collectIgnoredSourceKeys(undefined, null), [])
})

test('unresolvedConflictCount：后端标记待决策且未被忽略的项才阻塞', () => {
  const matches = [
    { sourceKey: 'a', requiresDecision: true },
    { sourceKey: 'b', requiresDecision: true },
    { sourceKey: 'c', action: 'create' },
  ]
  assert.equal(unresolvedConflictCount(matches, []), 2)
  assert.equal(unresolvedConflictCount(matches, ['a']), 1)
  assert.equal(unresolvedConflictCount(matches, ['a', 'b']), 0)
  assert.equal(unresolvedConflictCount([], []), 0)
})

// ---------- P0-4 ① 预览步逐项渲染 matches + 忽略勾选 ----------
test('P0-4 ① 预览步以 v-for 逐项渲染 assets.matches，每行提供「忽略此项」勾选', () => {
  const src = importView()
  assert.match(src, /v-for="m in plan\.assets\.matches"/, '模板应有 matches 逐项 v-for')
  assert.match(src, /忽略此项/, '每行应有「忽略此项」勾选')
  assert.match(src, /v-model="ignoredMap\[m\.sourceKey\]"/, '勾选应绑定 per-sourceKey 忽略表')
  assert.match(src, /matchTypeLabel/, '应展示类型标签')
  assert.match(src, /matchActionLabel/, '应展示动作徽标（新建/复用）')
})

test('P0-4 ① 人物状态行（match-with-character）不渲染忽略勾选，行内提示随人物处理', () => {
  const src = importView()
  // 后端 ensureAssetRows 的 skip() 不覆盖 states 循环：状态行勾选忽略是静默无效操作，
  // 故勾选必须以 v-if 排除 match-with-character 行，并给出人物行引导
  assert.match(
    src,
    /v-if="m\.action !== 'match-with-character'"[\s\S]{0,140}v-model="ignoredMap\[m\.sourceKey\]"/,
    '忽略勾选应排除 match-with-character 行',
  )
  assert.match(src, /随人物处理，请在人物行忽略/, '状态行应提示在人物行忽略')
})

// ---------- P0-4 文件身份区 + 协议徽标 ----------
test('P0-4 ① 步骤 1 有协议徽标与来源文件名/SHA-256 可选输入，preview 透传', () => {
  const src = importView()
  assert.match(src, /episode-package@2\.1/, '步骤 1 顶部应有协议徽标')
  assert.match(src, /来源文件名/, '应提供来源文件名输入')
  assert.match(src, /从导出方获取，用于来源追溯/, 'SHA-256 输入应有来源追溯占位说明')
  assert.match(src, /sourceFilename:\s*this\.sourceFilename/, 'preview 应透传 sourceFilename')
  assert.match(src, /sourceSha256:\s*this\.sourceSha256/, 'preview 应透传 sourceSha256')
  assert.doesNotMatch(src, /<el-|ElMessage/, '不使用 Element Plus（v21-ui 自建容器）')
  assert.doesNotMatch(src, /alert\(|window\.confirm/, '不使用原生弹窗')
})

// ---------- P0-4 ② confirm 组装 decisions ----------
test('P0-4 ② 确认导入将勾选忽略项组装为 decisions.ignoredSourceKeys 提交', () => {
  const src = importView()
  assert.match(src, /decisions:\s*\{\s*ignoredSourceKeys/, 'confirm 请求体应带 decisions.ignoredSourceKeys')
  assert.match(src, /collectIgnoredSourceKeys\(/, '应经 collectIgnoredSourceKeys 组装')
  assert.match(src, /confirming/, '提交中应有防重复状态')
})

// ---------- P0-4 ③ confirm catch 与 TARGET_NOT_BLANK 回退 ----------
test('P0-4 ③ confirm 有 catch：TARGET_NOT_BLANK 回退步骤 1 并提示，其他错误显错误条+重试', () => {
  const src = importView()
  assert.match(src, /catch\s*\(/, 'confirm 应有 catch')
  assert.match(src, /TARGET_NOT_BLANK/, '应识别 TARGET_NOT_BLANK 错误码')
  assert.match(src, /TARGET_NOT_BLANK[\s\S]{0,240}step = 0/, 'TARGET_NOT_BLANK 应回退到步骤 1')
  assert.match(src, /请选择空白剧集或创建新剧集/, '应提示选择空白剧集或创建新剧集')
  assert.match(src, /重试/, '其他错误应有重试按钮')
})

// ---------- P0-4 ④ 成功页四个结果动作 ----------
test('P0-4 ④ 成功页提供打开剧本/检查本集设定/查看剧集行(highlight)/返回项目四动作', () => {
  const src = importView()
  assert.match(src, /episodeId/, '应读取 confirm 返回的 episodeId')
  assert.match(src, /打开剧本/, '动作一：打开剧本')
  assert.match(src, /检查本集设定/, '动作二：检查本集设定')
  assert.match(src, /查看剧集行/, '动作三：查看剧集行')
  assert.match(src, /返回项目/, '动作四：返回项目')
  assert.match(src, /\/script/, '打开剧本应进该集剧本阶段')
  assert.match(src, /\/assets/, '检查设定应进该集设定阶段')
  assert.match(src, /highlight=\$\{/, '查看剧集行应带 highlight query')
})

// ---------- P0-4 ⑤ ProjectEpisodesView 消费 highlight query ----------
test('P0-4 ⑤ ProjectEpisodesView 读取 route.query.highlight 并复用既有高亮 class', () => {
  const src = episodesView()
  assert.match(src, /\$route\.query\.highlight/, '应读取 route.query.highlight')
  assert.match(src, /ep-row/, '剧集行容器仍在')
  // 高亮语义拆分（2026-09-11 UI 美化）：当前集 = current（accent），需处理 = attention（warn）
  // 两种"需要被看见"的行都必须有独立样式分支，needsAttention 不再复用 current
  assert.match(src, /current:\s*isHighlighted\(ep\)/, '当前集应走 current 样式分支')
  assert.match(src, /attention:\s*ep\.needsAttention/, '需处理行应有独立 attention 样式分支（warn 语义）')
})

// ---------- P0-10/P0-07/P0-14 数据安全与入口修复（2026-09-12 差距清单第一批） ----------

test('P0-10a 剧集删除链路不得静默失败', () => {
  const src = episodesView()
  assert.match(src, /getDeleteImpact\(ep\.id\)\s*\n?\s*\.then\([\s\S]*?\.catch\(/, 'impact 拉取失败必须有 catch 并呈现错误')
  assert.match(src, /deleteError/, '确认弹窗内应有 deleteError 错误呈现')
  assert.doesNotMatch(src, /async doDelete\(\)\s*\{[\s\S]{0,80}await/, 'doDelete 必须先进入 try/catch 再调用删除接口')
})

test('P0-10c 编辑项目保存不得静默失败', () => {
  const src = read('src/views/productionStudio/ProjectOverviewView.vue')
  assert.match(src, /async saveProfile\(\)\s*\{[\s\S]*?try\s*\{/, 'saveProfile 必须有 try/catch')
  assert.match(src, /profileSaving/, '保存按钮应有 Saving 态')
  assert.match(src, /profileError/, '保存失败应有弹窗内错误呈现')
})

test('P0-07 剧集中心普通制作中行必须有打开入口', () => {
  const src = episodesView()
  assert.match(src, /class="card ep-row"[^>]*@click="open\(ep\)"/, '剧集行本体必须可点击打开')
  assert.match(src, /rowAction\(ep\)/, '主动作应由 rowAction(ep) 统一计算，普通行不得缺席')
})

test('P0-14 剧本 409 冲突必须对比解决，不得默认覆盖', () => {
  const src = read('src/views/productionStudio/studio/ScriptStage.vue')
  assert.match(src, /conflictModalOpen/, '409 时应打开冲突对比 Modal')
  assert.match(src, /conflictServerText/, '应拉取服务端草稿内容做对比')
  assert.match(src, /loadServerVersion/, '应提供「载入最新版本」动作')
  assert.match(src, /overwriteServerVersion/, '覆盖必须走显式确认动作')
  assert.doesNotMatch(src, /async retrySave\(\)/, '不得保留直接覆盖式 retrySave')
})

test('E 域付费确认：分镜图生成须经确认 Sheet（通道/提示词/结果规则）', () => {
  const src = read('src/views/productionStudio/studio/StoryboardStage.vue')
  assert.match(src, /imageSheetOpen/, '应存在分镜图生成确认 Sheet')
  assert.match(src, /openImageSheet\(\)/, '「生成分镜图」按钮先打开确认 Sheet')
  assert.match(src, /只新增候选/, '应呈现结果规则：只新增候选不自动采用')
  assert.match(src, /confirmGenerateImage/, '确认后才执行生成')
})
