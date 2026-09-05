import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { generationStyleOptions } from '../src/constants/styleOptions.js'

const require = createRequire(import.meta.url)
const {
  resolveStylePreset,
  PRESET_VALUES,
} = require('../../backend-node/src/constants/generationStylePresets.js')

function frontendPresetOptions() {
  const out = []
  for (const group of generationStyleOptions) {
    for (const o of group.options || []) out.push(o)
  }
  return out
}

// 同一断言器供正式用例与漂移金丝雀共用：任一字段不一致即抛错
function assertPresetsMatch(feOption, bePreset, context) {
  assert.ok(bePreset, `${context}: 后端缺少预设 ${feOption.value}`)
  assert.equal(
    bePreset.zh,
    feOption.prompt,
    `${context}: ${feOption.value} 中文文案与后端不一致（前端为权威定义，请同步 generationStylePresets.js）`
  )
  assert.equal(
    bePreset.en,
    feOption.promptEn,
    `${context}: ${feOption.value} 英文文案与后端不一致（前端为权威定义，请同步 generationStylePresets.js）`
  )
}

test('前端每个风格预设都能在后端解析出完全一致的 zh/en 文案', () => {
  for (const o of frontendPresetOptions()) {
    assertPresetsMatch(o, resolveStylePreset(o.value), 'frontend→backend')
  }
})

test('后端每个预设都存在于前端选项中（无孤儿预设）', () => {
  const feValues = new Set(frontendPresetOptions().map((o) => o.value))
  for (const v of PRESET_VALUES) {
    assert.ok(feValues.has(v), `backend→frontend: 后端预设 ${v} 不在前端选项中`)
  }
})

test('漂移金丝雀：断言器能捕获伪造的字段不一致', () => {
  const fe = { value: 'fake', prompt: '甲文案', promptEn: 'A text' }
  assert.throws(() => assertPresetsMatch(fe, { zh: '乙文案', en: 'A text' }, 'canary'), /中文文案与后端不一致/)
  assert.throws(() => assertPresetsMatch(fe, { zh: '甲文案', en: 'B text' }, 'canary'), /英文文案与后端不一致/)
  assert.throws(() => assertPresetsMatch(fe, null, 'canary'), /后端缺少预设/)
})
