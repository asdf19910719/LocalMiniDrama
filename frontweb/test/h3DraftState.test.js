import test from 'node:test'
import assert from 'node:assert/strict'

import {
  absoluteAssetUrl,
  checkImageRefDrift,
  collectAvailableSlotUrls,
  deriveH3DraftUiState,
  extractImageRefIndexes,
  formatH3ValidationErrors,
  mapFreshnessReasons,
} from '../src/utils/h3DraftState.js'

const validDraft = { id: 11, status: 'valid', manually_edited: false }

test('derive: no draft yields none chip and blocks generation', () => {
  assert.deepEqual(deriveH3DraftUiState({ draft: null }), { chip: 'none', canGenerate: false, reasons: [] })
  assert.deepEqual(deriveH3DraftUiState({}), { chip: 'none', canGenerate: false, reasons: [] })
})

test('derive: fresh AI draft yields ai chip and allows generation', () => {
  const state = deriveH3DraftUiState({
    draft: validDraft,
    freshness: { stale: false, reasons: [] },
    saving: false,
    structureValid: true,
  })
  assert.equal(state.chip, 'ai')
  assert.equal(state.canGenerate, true)
  assert.deepEqual(state.reasons, [])
})

test('derive: manually edited draft yields edited chip', () => {
  const state = deriveH3DraftUiState({ draft: { ...validDraft, manually_edited: true } })
  assert.equal(state.chip, 'edited')
  assert.equal(state.canGenerate, true)
})

test('derive: stale freshness outranks edited and blocks generation with raw reasons', () => {
  const state = deriveH3DraftUiState({
    draft: { ...validDraft, manually_edited: true },
    freshness: { stale: true, reasons: ['slots', 'params'] },
  })
  assert.equal(state.chip, 'stale')
  assert.equal(state.canGenerate, false)
  assert.deepEqual(state.reasons, ['slots', 'params'])
})

test('derive: invalid draft outranks stale and blocks generation', () => {
  const state = deriveH3DraftUiState({
    draft: { ...validDraft, status: 'invalid' },
    freshness: { stale: true, reasons: ['prompt'] },
  })
  assert.equal(state.chip, 'invalid')
  assert.equal(state.canGenerate, false)
})

test('derive: each canGenerate condition can independently turn the gate false', () => {
  // 1. no draft
  assert.equal(deriveH3DraftUiState({ draft: null }).canGenerate, false)
  // 2. draft status not valid
  assert.equal(deriveH3DraftUiState({ draft: { ...validDraft, status: 'invalid' } }).canGenerate, false)
  // 3. freshness stale
  assert.equal(deriveH3DraftUiState({ draft: validDraft, freshness: { stale: true, reasons: ['config'] } }).canGenerate, false)
  // 4. save in flight
  assert.equal(deriveH3DraftUiState({ draft: validDraft, saving: true }).canGenerate, false)
  // 5. external structure check failed
  assert.equal(deriveH3DraftUiState({ draft: validDraft, structureValid: false }).canGenerate, false)
})

test('derive: defaults keep missing freshness, saving, and structureValid inputs harmless', () => {
  assert.equal(deriveH3DraftUiState({ draft: validDraft }).canGenerate, true)
  assert.equal(deriveH3DraftUiState({ draft: validDraft, structureValid: undefined }).canGenerate, true)
})

test('mapFreshnessReasons maps every backend dimension to its Chinese label', () => {
  assert.deepEqual(mapFreshnessReasons(['prompt']), ['万能提示词已变化'])
  assert.deepEqual(mapFreshnessReasons(['slots']), ['参考图已变化'])
  assert.deepEqual(mapFreshnessReasons(['params']), ['时长/画幅/音频已变化'])
  assert.deepEqual(mapFreshnessReasons(['config']), ['视频配置已变化'])
  assert.deepEqual(mapFreshnessReasons(['skill']), ['H3 技能版本已变化'])
  assert.deepEqual(
    mapFreshnessReasons(['skill', 'slots']),
    ['H3 技能版本已变化', '参考图已变化'],
  )
})

test('mapFreshnessReasons passes unknown keys through and tolerates bad input', () => {
  assert.deepEqual(mapFreshnessReasons(['mystery']), ['mystery'])
  assert.deepEqual(mapFreshnessReasons([]), [])
  assert.deepEqual(mapFreshnessReasons(null), [])
  assert.deepEqual(mapFreshnessReasons('slots'), [])
})

test('extractImageRefIndexes collects unique 1-based @图片N references', () => {
  assert.deepEqual(extractImageRefIndexes('场景 @图片1 中 @图片2 转身，随后 @图片1 特写'), [1, 2])
  assert.deepEqual(extractImageRefIndexes('无引用的提示词'), [])
  assert.deepEqual(extractImageRefIndexes(''), [])
  assert.deepEqual(extractImageRefIndexes('@图片12'), [12])
})

test('checkImageRefDrift flags references beyond the resolved slot count only', () => {
  const slots = [{ index: 1 }, { index: 2 }, { index: 3 }]
  // 引用都在槽位范围内（含缺图占位槽位）→ 不警告
  assert.equal(checkImageRefDrift('从 @图片1 推到 @图片3', slots).drift, false)
  // 引用超出槽位数 → 警告
  const drifted = checkImageRefDrift('从 @图片1 推到 @图片4', slots)
  assert.equal(drifted.drift, true)
  assert.deepEqual(drifted.outOfRange, [4])
  assert.equal(drifted.slotCount, 3)
  // 无引用 → 不警告
  assert.equal(checkImageRefDrift('纯文本提示词', slots).drift, false)
  // 槽位数为 0 但存在引用 → 警告
  assert.equal(checkImageRefDrift('看 @图片1', []).drift, true)
  // 支持直接传槽数量
  assert.equal(checkImageRefDrift('看 @图片2', 2).drift, false)
  assert.equal(checkImageRefDrift('看 @图片3', 2).drift, true)
})

test('collectAvailableSlotUrls keeps slot order and drops unavailable or empty slots', () => {
  const slots = [
    { index: 1, image_available: true, image_url: '/static/a.png' },
    { index: 2, image_available: false, image_url: '/static/b.png' },
    { index: 3, image_available: true, image_url: '' },
    { index: 4, image_available: true, image_url: 'https://cdn.example.test/c.png' },
  ]
  assert.deepEqual(
    collectAvailableSlotUrls(slots),
    ['/static/a.png', 'https://cdn.example.test/c.png'],
  )
  assert.deepEqual(collectAvailableSlotUrls([]), [])
  assert.deepEqual(collectAvailableSlotUrls(null), [])
})

test('absoluteAssetUrl prefixes app base and keeps remote URLs untouched', () => {
  assert.equal(absoluteAssetUrl('/static/a.png', 'http://localhost:5679'), 'http://localhost:5679/static/a.png')
  assert.equal(absoluteAssetUrl('projects/demo/x.png', 'http://localhost:5679'), 'http://localhost:5679/projects/demo/x.png')
  assert.equal(absoluteAssetUrl('https://cdn.example.test/c.png', 'http://localhost:5679'), 'https://cdn.example.test/c.png')
  assert.equal(absoluteAssetUrl('', 'http://localhost:5679'), '')
  assert.equal(absoluteAssetUrl('/static/a.png', ''), '/static/a.png')
})

test('formatH3ValidationErrors renders backend validation error objects as readable lines', () => {
  const lines = formatH3ValidationErrors({
    code: 'H3_PROMPT_FORMAT_INVALID',
    message: 'H3 prompt has invalid required fields',
    missing: ['OVERALL_SOUNDSCAPE'],
    empty: ['NON_DIEGETIC_MUSIC'],
  })
  assert.ok(lines.some((line) => line.includes('H3 prompt has invalid required fields')))
  assert.ok(lines.some((line) => line.includes('OVERALL_SOUNDSCAPE')))
  assert.ok(lines.some((line) => line.includes('NON_DIEGETIC_MUSIC')))
  assert.deepEqual(formatH3ValidationErrors(null), [])
  const fallback = formatH3ValidationErrors('结构不完整')
  assert.deepEqual(fallback, ['结构不完整'])
})
