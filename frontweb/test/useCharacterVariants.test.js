import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVariantLinks, useCharacterVariants } from '../src/composables/filmCreate/useCharacterVariants.js'

test('buildVariantLinks 正常输出：sort_order 从 1 递增，reference_role/framing_note 为默认值', () => {
  const selections = [
    { character_id: 1, variant_id: 11 },
    { character_id: 2, variant_id: 22 },
    { character_id: 3, variant_id: 33 },
  ]
  assert.deepEqual(buildVariantLinks(selections), [
    { character_id: 1, variant_id: 11, reference_role: 'primary', sort_order: 1, framing_note: null },
    { character_id: 2, variant_id: 22, reference_role: 'primary', sort_order: 2, framing_note: null },
    { character_id: 3, variant_id: 33, reference_role: 'primary', sort_order: 3, framing_note: null },
  ])
})

test('buildVariantLinks 空数组返回空数组', () => {
  assert.deepEqual(buildVariantLinks([]), [])
})

test('buildVariantLinks sortStart 参数：sort_order 从指定值递增', () => {
  const selections = [
    { character_id: 7, variant_id: 77 },
    { character_id: 8, variant_id: 88 },
  ]
  assert.deepEqual(buildVariantLinks(selections, 5), [
    { character_id: 7, variant_id: 77, reference_role: 'primary', sort_order: 5, framing_note: null },
    { character_id: 8, variant_id: 88, reference_role: 'primary', sort_order: 6, framing_note: null },
  ])
})

test('buildVariantLinks 非数组输入兜底返回空数组', () => {
  assert.deepEqual(buildVariantLinks(null), [])
  assert.deepEqual(buildVariantLinks(undefined), [])
})

// ── saveSbVariantLinks 竞态防护 ──────────────────────────────
// 后端 syncStoryboardVariantLinks 为事务内全删全插并覆写 storyboards.characters 投影，
// links payload 漏掉任何已勾选角色都会静默删除其关联。

function createDeferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

function buildDeps({ listVariants, getSbCharacterIds = () => [] }) {
  const calls = { updateVariantLinks: [] }
  const toasts = []
  const notify = {
    error: (m) => toasts.push(String(m)),
    warning: (m) => toasts.push(String(m)),
    success: (m) => toasts.push(String(m)),
    info: (m) => toasts.push(String(m)),
  }
  const storyboardsAPI = {
    updateVariantLinks: async (sbId, links) => {
      calls.updateVariantLinks.push({ sbId, links })
      return {}
    },
  }
  const api = useCharacterVariants({ characterAPI: { listVariants }, storyboardsAPI, getSbCharacterIds, notify })
  return { api, calls, toasts }
}

test('saveSbVariantLinks 等待在途的状态加载完成后提交完整 links（竞态修复）', async () => {
  const char2Deferred = createDeferred()
  const listVariants = async (id) => {
    if (Number(id) === 1) return [{ id: 11, name: '默认', is_default: 1 }]
    return char2Deferred.promise
  }
  const { api, calls } = buildDeps({ listVariants, getSbCharacterIds: () => [1, 2] })

  api.ensureSbVariantsLoaded(100) // 角色 2 的加载进入在途
  const savePromise = api.saveSbVariantLinks(100) // 在途未完成时触发保存
  char2Deferred.resolve([{ id: 22, name: '白衣', is_default: 1 }])
  await savePromise

  assert.equal(calls.updateVariantLinks.length, 1)
  assert.deepEqual(calls.updateVariantLinks[0].links, [
    { character_id: 1, variant_id: 11, reference_role: 'primary', sort_order: 1, framing_note: null },
    { character_id: 2, variant_id: 22, reference_role: 'primary', sort_order: 2, framing_note: null },
  ])
})

test('saveSbVariantLinks 任一角色状态加载失败时中止保存', async () => {
  const listVariants = async (id) => {
    if (Number(id) === 1) return [{ id: 11, name: '默认', is_default: 1 }]
    throw new Error('boom')
  }
  const { api, calls, toasts } = buildDeps({ listVariants, getSbCharacterIds: () => [1, 2] })

  await api.saveSbVariantLinks(100)

  assert.equal(calls.updateVariantLinks.length, 0)
  assert.ok(toasts.some((m) => m.includes('取消保存')))
})

test('saveSbVariantLinks 勾选角色无任何状态时不提交残缺 links', async () => {
  const listVariants = async (id) => (Number(id) === 1 ? [{ id: 11, name: '默认', is_default: 1 }] : [])
  const { api, calls, toasts } = buildDeps({ listVariants, getSbCharacterIds: () => [1, 2] })

  await api.saveSbVariantLinks(100)

  assert.equal(calls.updateVariantLinks.length, 0)
  assert.ok(toasts.some((m) => m.includes('取消保存')))
})
