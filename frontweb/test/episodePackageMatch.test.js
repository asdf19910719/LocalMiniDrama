import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDecisions, canProceedMatches, summarizeMatches } from '../src/utils/episodePackageMatch.js'

const sampleMatches = [
  { type: 'character', source_key: 'char_lin', name: '林晚', decision: 'create', existing_id: null, candidates: [] },
  { type: 'character', source_key: 'char_chen', name: '陈默', decision: 'reuse', existing_id: 12, candidates: [{ id: 12, name: '陈默' }] },
  { type: 'scene', source_key: 'scene_alley', name: '小巷', decision: 'conflict', existing_id: null, candidates: [{ id: 7, name: '小巷' }, { id: 9, name: '小巷' }] },
  { type: 'prop', source_key: 'prop_ring', name: '戒指', decision: 'conflict', existing_id: null, candidates: [{ id: 3, name: '戒指' }] },
]

test('canProceedMatches 为 false：存在未决策的 conflict 项', () => {
  // 缺少 scene_alley 的选择（后端 decisions 形状中该项缺失 = 未决策）
  const decisions = { characters: {}, scenes: {}, props: { prop_ring: 'create' } }
  assert.equal(canProceedMatches(sampleMatches, decisions), false)
})

test('canProceedMatches 为 true：所有 conflict 项均有显式决策', () => {
  const decisions = buildDecisions(sampleMatches, { scene_alley: 'reuse', prop_ring: 'create' })
  assert.equal(canProceedMatches(sampleMatches, decisions), true)
})

test('canProceedMatches 为 true：无 conflict 项时不强制任何决策', () => {
  const noConflict = sampleMatches.filter((m) => m.decision !== 'conflict')
  assert.equal(canProceedMatches(noConflict, { characters: {}, scenes: {}, props: {} }), true)
  assert.equal(canProceedMatches([], {}), true)
  assert.equal(canProceedMatches(undefined, undefined), true)
})

test('canProceedMatches 为 false：决策值非法（非 create/reuse）视为未决策', () => {
  const decisions = {
    characters: {},
    scenes: { scene_alley: '' },
    props: { prop_ring: 'create' },
  }
  assert.equal(canProceedMatches(sampleMatches, decisions), false)
})

test('canProceedMatches 兼容按 source_key 平铺的 overrides 形状', () => {
  assert.equal(canProceedMatches(sampleMatches, { scene_alley: 'reuse', prop_ring: 'reuse' }), true)
})

test('buildDecisions 默认全部 create', () => {
  assert.deepEqual(buildDecisions(sampleMatches), {
    characters: { char_lin: 'create', char_chen: 'create' },
    scenes: { scene_alley: 'create' },
    props: { prop_ring: 'create' },
  })
})

test('buildDecisions overrides 覆盖默认值，且不影响其他项', () => {
  const decisions = buildDecisions(sampleMatches, { char_lin: 'create', scene_alley: 'reuse' })
  assert.deepEqual(decisions, {
    characters: { char_lin: 'create', char_chen: 'create' },
    scenes: { scene_alley: 'reuse' },
    props: { prop_ring: 'create' },
  })
})

test('buildDecisions 忽略非法 override 值并跳过无 source_key 的匹配', () => {
  const matches = [
    { type: 'scene', source_key: 'scene_ok', name: '场景A', decision: 'conflict', existing_id: null, candidates: [{ id: 1, name: '场景A' }] },
    { type: 'prop', source_key: null, name: '无名道具', decision: 'create', existing_id: null, candidates: [] },
  ]
  const decisions = buildDecisions(matches, { scene_ok: 'nope' })
  assert.deepEqual(decisions, {
    characters: {},
    scenes: { scene_ok: 'create' },
    props: {},
  })
})

test('buildDecisions 兼容按分组嵌套的 overrides 形状', () => {
  const decisions = buildDecisions(sampleMatches, { scenes: { scene_alley: 'reuse' }, props: { prop_ring: 'reuse' } })
  assert.equal(decisions.scenes.scene_alley, 'reuse')
  assert.equal(decisions.props.prop_ring, 'reuse')
  assert.equal(decisions.characters.char_lin, 'create')
})

test('summarizeMatches 按类型与决策正确计数', () => {
  assert.deepEqual(summarizeMatches(sampleMatches), {
    character: { create: 1, reuse: 1, conflict: 0 },
    scene: { create: 0, reuse: 0, conflict: 1 },
    prop: { create: 0, reuse: 0, conflict: 1 },
    total: 4,
  })
})

test('summarizeMatches 空输入返回全零统计', () => {
  const empty = {
    character: { create: 0, reuse: 0, conflict: 0 },
    scene: { create: 0, reuse: 0, conflict: 0 },
    prop: { create: 0, reuse: 0, conflict: 0 },
    total: 0,
  }
  assert.deepEqual(summarizeMatches([]), empty)
  assert.deepEqual(summarizeMatches(null), empty)
})
