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

test('buildVariantLinks 保留导入关联的角色、排序和构图元数据', () => {
  const selections = [
    { character_id: 1, variant_id: 12 },
    { character_id: 2, variant_id: 22 },
  ]
  const existing = [
    { character_id: 2, variant_id: 21, reference_role: 'supporting', sort_order: 2, framing_note: '半身' },
    { character_id: 1, variant_id: 11, reference_role: 'lead', sort_order: 7, framing_note: '近景' },
  ]
  assert.deepEqual(buildVariantLinks(selections, 1, existing), [
    { character_id: 1, variant_id: 12, reference_role: 'lead', sort_order: 7, framing_note: '近景' },
    { character_id: 2, variant_id: 22, reference_role: 'supporting', sort_order: 2, framing_note: '半身' },
  ])
})

// ── saveSbVariantLinks 竞态防护 ──────────────────────────────
// 后端 syncStoryboardVariantLinks 为事务内全删全插并覆写 storyboards.characters 投影，
// links payload 漏掉任何已勾选角色都会静默删除其关联。

function createDeferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

function buildDeps({ listVariants, getSbCharacterIds = () => [], updateVariant = async () => ({}), generateVariantImage = async () => ({}) }) {
  const calls = { updateVariantLinks: [], updateVariant: [], generateVariantImage: [] }
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
  const characterAPI = {
    listVariants,
    updateVariant: async (variantId, payload) => {
      calls.updateVariant.push({ variantId, payload })
      return updateVariant(variantId, payload)
    },
    generateVariantImage: async (variantId, payload) => {
      calls.generateVariantImage.push({ variantId, payload })
      return generateVariantImage(variantId, payload)
    },
  }
  const api = useCharacterVariants({ characterAPI, storyboardsAPI, getSbCharacterIds, notify })
  return { api, calls, toasts }
}

test('状态生图把自己的模式和身份引用偏好传给后端', async () => {
  const variant = {
    id: 11,
    character_id: 1,
    name: '雨夜',
    asset_mode: 'TURNAROUND',
    use_identity_reference: 0,
  }
  const { api, calls } = buildDeps({
    listVariants: async () => [variant],
    generateVariantImage: async () => variant,
  })
  await api.loadVariants(1)

  await api.generateVariantImage(variant)

  assert.deepEqual(calls.generateVariantImage, [{
    variantId: 11,
    payload: { asset_mode: 'TURNAROUND', use_identity_reference: false },
  }])
})

test('状态工作台设置保存后立即更新当前缓存', async () => {
  const variant = { id: 11, character_id: 1, name: '常态', asset_mode: 'SINGLE', use_identity_reference: 1 }
  const { api, calls } = buildDeps({
    listVariants: async () => [variant],
    updateVariant: async (_id, payload) => ({ ...variant, ...payload }),
  })
  await api.loadVariants(1)

  await api.updateVariantGenerationSettings(variant, { asset_mode: 'TURNAROUND' })

  assert.deepEqual(calls.updateVariant, [{ variantId: 11, payload: { asset_mode: 'TURNAROUND' } }])
  assert.equal(api.getVariantsForCharacter(1)[0].asset_mode, 'TURNAROUND')
})

test('状态工作台设置保存失败时回滚当前缓存', async () => {
  const variant = { id: 11, character_id: 1, name: '常态', asset_mode: 'SINGLE', use_identity_reference: 1 }
  const { api, toasts } = buildDeps({
    listVariants: async () => [variant],
    updateVariant: async () => { throw new Error('network down') },
  })
  await api.loadVariants(1)

  const result = await api.updateVariantGenerationSettings(variant, { asset_mode: 'TURNAROUND' })

  assert.equal(result, null)
  assert.equal(api.getVariantsForCharacter(1)[0].asset_mode, 'SINGLE')
  assert.ok(toasts.some((message) => message.includes('network down')))
})

test('refreshLoadedVariants 只强制刷新已经打开过的人物状态缓存', async () => {
  const reads = []
  const { api } = buildDeps({
    listVariants: async (id) => {
      reads.push(Number(id))
      return [{ id: Number(id) * 10, character_id: Number(id), name: '默认', is_default: 1 }]
    },
  })
  await api.loadVariants(1)
  await api.loadVariants(2)
  reads.length = 0

  await api.refreshLoadedVariants()

  assert.deepEqual(reads, [1, 2])
})

test('selectVariantCandidate 保存候选为当前图并立即刷新对应人物状态', async () => {
  let revision = 0
  const { api, calls } = buildDeps({
    listVariants: async () => [{
      id: 11,
      character_id: 1,
      name: '夜间',
      local_path: revision === 0 ? 'old.png' : 'picked.png',
      image_url: '',
      extra_images: revision === 0 ? ['picked.png'] : ['old.png'],
    }],
    updateVariant: async () => { revision += 1 },
  })
  await api.loadVariants(1)
  const variant = api.getVariantsForCharacter(1)[0]

  await api.selectVariantCandidate(variant, 'picked.png')

  assert.deepEqual(calls.updateVariant, [{
    variantId: 11,
    payload: { image_url: '', local_path: 'picked.png', extra_images: ['old.png'] },
  }])
  assert.equal(api.getVariantsForCharacter(1)[0].local_path, 'picked.png')
})

test('selectVariantCandidate 优先用更新响应覆盖缓存，避免随后列表请求仍返回旧图时界面不刷新', async () => {
  const staleVariant = {
    id: 11,
    character_id: 1,
    name: '夜间',
    local_path: 'old.png',
    image_url: '',
    extra_images: ['picked.png'],
  }
  const { api } = buildDeps({
    listVariants: async () => [staleVariant],
    updateVariant: async (_id, payload) => ({ ...staleVariant, ...payload }),
  })
  await api.loadVariants(1)

  await api.selectVariantCandidate(staleVariant, 'picked.png')

  assert.equal(api.getVariantsForCharacter(1)[0].local_path, 'picked.png')
})

test('hydrateSbVariantLinks 恢复显式选择并在状态列表加载前提供正确缩略图记录', () => {
  const { api } = buildDeps({ listVariants: async () => [] })
  api.hydrateSbVariantLinks([{ id: 100, character_variant_links: [{
    character_id: 1,
    variant_id: 11,
    variant_name: '工作状态',
    image_url: '/work-remote.png',
    local_path: 'variants/work.png',
    reference_role: 'lead',
    sort_order: 3,
    framing_note: '近景',
  }] }])

  assert.equal(api.getSbVariantId(100, 1), 11)
  assert.deepEqual(api.getSbSelectedVariant(100, 1), {
    id: 11,
    character_id: 1,
    name: '工作状态',
    image_url: '/work-remote.png',
    local_path: 'variants/work.png',
    reference_role: 'lead',
    sort_order: 3,
    framing_note: '近景',
  })
})

test('显式选择的状态缺图时保留该状态，不回落到基础人物图', () => {
  const { api } = buildDeps({ listVariants: async () => [] })
  api.hydrateSbVariantLinks([{ id: 100, character_variant_links: [{
    character_id: 1,
    variant_id: 11,
    variant_name: '夜间状态',
    image_url: null,
    local_path: null,
    reference_role: 'primary',
    sort_order: 1,
    framing_note: null,
  }] }])

  const selected = api.getSbSelectedVariant(100, 1)
  assert.equal(selected.id, 11)
  assert.equal(selected.image_url, null)
  assert.equal(selected.local_path, null)
})

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

test('saveSbVariantLinks 切换状态时保留导入关联元数据', async () => {
  const { api, calls } = buildDeps({
    listVariants: async () => [
      { id: 11, character_id: 1, name: '默认', is_default: 1 },
      { id: 12, character_id: 1, name: '夜间', is_default: 0 },
    ],
    getSbCharacterIds: () => [1],
  })
  api.hydrateSbVariantLinks([{ id: 100, character_variant_links: [{
    character_id: 1,
    variant_id: 11,
    reference_role: 'lead',
    sort_order: 8,
    framing_note: '特写',
  }] }])
  api.setSbVariantId(100, 1, 12)

  await api.saveSbVariantLinks(100)

  assert.deepEqual(calls.updateVariantLinks[0].links, [{
    character_id: 1,
    variant_id: 12,
    reference_role: 'lead',
    sort_order: 8,
    framing_note: '特写',
  }])
})
