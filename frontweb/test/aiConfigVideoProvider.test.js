import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COMFYUI_DEFAULT_BASE_URL,
  comfyuiConfigDefaults,
  isApiKeyRequired,
  serializeVideoProviderSettings,
} from '../src/utils/aiConfigVideoProvider.js'

test('supplies ComfyUI local defaults with a workflow selector and 32-aligned numeric dimensions', () => {
  assert.equal(COMFYUI_DEFAULT_BASE_URL, 'http://127.0.0.1:8188')
  assert.deepEqual(comfyuiConfigDefaults(['h3-continuity-v1']), {
    base_url: 'http://127.0.0.1:8188',
    modelText: 'h3-continuity-v1',
    default_model: 'h3-continuity-v1',
    width: 1312,
    height: 736,
  })
  assert.equal(isApiKeyRequired({ service_type: 'video', provider: 'comfyui' }), false)
})

test('prefers the verified TE-Speed H3 workflow for new ComfyUI video configs', () => {
  assert.deepEqual(comfyuiConfigDefaults([
    'minimax_h3_director_r2v',
    'minimax_h3_director_r2v_te_speed',
  ]), {
    base_url: 'http://127.0.0.1:8188',
    modelText: 'minimax_h3_director_r2v_te_speed',
    default_model: 'minimax_h3_director_r2v_te_speed',
    width: 1312,
    height: 736,
  })
})

test('serializes ComfyUI width and height as numbers and rejects dimensions outside the 32-pixel grid', () => {
  assert.equal(
    serializeVideoProviderSettings({ provider: 'comfyui', width: '1280', height: '704' }),
    JSON.stringify({ width: 1280, height: 704 }),
  )
  assert.throws(
    () => serializeVideoProviderSettings({ provider: 'comfyui', width: 1280, height: 720 }),
    /32 的倍数/,
  )
})

test('preserves unrelated ComfyUI settings when editing numeric dimensions', () => {
  assert.equal(
    serializeVideoProviderSettings({
      provider: 'comfyui',
      width: '1280',
      height: '704',
      settings: JSON.stringify({ vram_budget_mb: 24000, frame_rate: 24, seed: 42, continuity_mode: 'motion_overlap' }),
    }),
    JSON.stringify({
      vram_budget_mb: 24000,
      frame_rate: 24,
      seed: 42,
      continuity_mode: 'motion_overlap',
      width: 1280,
      height: 704,
    }),
  )
})
