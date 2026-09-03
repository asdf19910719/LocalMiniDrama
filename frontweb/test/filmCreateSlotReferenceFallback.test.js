import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { slotReferenceFallbackPolicy } from '../src/utils/videoModeCompatibility.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const filmSource = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')

// 与 filmCreateExtraStrip.test.js 相同口径:取函数起点到下一个顶格 "}" 的函数体
function filmFunctionBody(name) {
  for (const prefix of [`async function ${name}(`, `function ${name}(`]) {
    const start = filmSource.indexOf(prefix)
    if (start === -1) continue
    const end = filmSource.indexOf('\n}', start)
    if (end !== -1) return filmSource.slice(start, end)
  }
  return ''
}

const collectBody = filmFunctionBody('collectSlotReferenceAbsoluteUrls')

test('slot failure policy aborts only H3 configs and keeps the legacy fallback otherwise', () => {
  // H3:参考图必须与草稿 reference_snapshot 同源 → 中止
  assert.equal(slotReferenceFallbackPolicy({ provider: 'comfyui', default_model: 'h3-continuity-v1' }), 'abort')
  assert.equal(slotReferenceFallbackPolicy({ provider: 'comfyui', default_model: 'minimax-h3-director' }), 'abort')
  // 非 H3:可用性优先,保留 legacy 兜底
  assert.equal(slotReferenceFallbackPolicy({ provider: 'volces', default_model: 'doubao-seedance-2-0' }), 'legacy_fallback')
  assert.equal(slotReferenceFallbackPolicy({ provider: 'comfyui', default_model: 'other-workflow' }), 'legacy_fallback')
  assert.equal(slotReferenceFallbackPolicy(null), 'legacy_fallback')
})

test('slot reference collector warns, aborts under H3, and never silently degrades to legacy refs', () => {
  assert.ok(collectBody, 'collectSlotReferenceAbsoluteUrls 应存在')
  // 槽位接口失败必须留痕,不得静默
  assert.match(collectBody, /console\.warn\(/)
  // H3 配置下:提示用户并返回 null 中止提交(角色主图 ≠ 状态图,降级会发错参考图)
  assert.match(collectBody, /getActiveVideoAiConfig\(\)/)
  assert.match(collectBody, /slotReferenceFallbackPolicy\(/)
  assert.match(collectBody, /ElMessage\.error\('参考图槽位加载失败/)
  assert.match(collectBody, /return null/)
  // 非 H3 仍保留 legacy 本地收集兜底
  assert.match(collectBody, /collectSbOmniReferenceAbsoluteUrls\(\{ id: sbId \}\)/)
})

test('every slot reference call site aborts its submission when the collector reports H3 failure', () => {
  const callSites = filmSource.match(/await collectSlotReferenceAbsoluteUrls\(/g) || []
  assert.ok(callSites.length >= 4, `应有 4 处槽位收集调用,实际 ${callSites.length}`)
  // 单镜生成:直接 return;批量 worker:记失败并跳过;两条流水线:在 pipelineWithRetry 内抛错
  assert.match(filmSource, /if \(omniRefs === null\) return/)
  assert.match(filmSource, /参考图槽位加载失败，已跳过/)
  assert.match(filmSource, /throw new Error\('参考图槽位加载失败'\)/)
})

test('batch and pipeline call sites silence the per-shot toast; single-shot keeps it', () => {
  // 函数签名接受 { silent = false },abort 分支的弹窗被静默(仅 console.warn + 返回 null)
  assert.match(collectBody, /\{ silent = false \} = \{\}/)
  assert.match(collectBody, /if \(!silent\) ElMessage\.error\('参考图槽位加载失败/)
  // 批量 worker + 两条流水线传 silent: true,失败由调用点记入 batchVideoErrors / 流水线失败列表
  const silentSites = filmSource.match(/collectSlotReferenceAbsoluteUrls\(sb\.id, \{ silent: true \}\)/g) || []
  assert.equal(silentSites.length, 3, `批量/流水线应有 3 处 silent 调用,实际 ${silentSites.length}`)
  // 单镜生成路径保持弹窗(不传 silent)
  assert.match(filmSource, /await collectSlotReferenceAbsoluteUrls\(sb\.id\)/)
})
