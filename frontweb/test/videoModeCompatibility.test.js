import test from 'node:test'
import assert from 'node:assert/strict'
import { canUseUniversalOmniVideoApi, isH3ComfyUiConfig, universalVideoCompatibility } from '../src/utils/videoModeCompatibility.js'

test('accepts ComfyUI H3 as a compatible universal generation mode without Omni references', () => {
  const cfg = { provider: 'comfyui', default_model: 'h3-continuity-v1' }
  assert.equal(isH3ComfyUiConfig(cfg), true)
  assert.deepEqual(universalVideoCompatibility(cfg), { compatible: true, mode: 'h3_director', supportsOmniReferences: false })
  assert.equal(canUseUniversalOmniVideoApi(cfg), true)
})

test('keeps Omni providers on their multi-reference protocol', () => {
  assert.deepEqual(universalVideoCompatibility({ api_protocol: 'kling_omni' }), { compatible: true, mode: 'omni', supportsOmniReferences: true })
})

test('does not silently accept an unrelated model', () => {
  assert.equal(canUseUniversalOmniVideoApi({ provider: 'comfyui', default_model: 'other-workflow' }), false)
})
