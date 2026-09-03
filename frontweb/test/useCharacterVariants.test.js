import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVariantLinks } from '../src/composables/filmCreate/useCharacterVariants.js'

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
