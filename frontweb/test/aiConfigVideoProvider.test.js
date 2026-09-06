import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COMFYUI_DEFAULT_BASE_URL,
  buildComfyuiWorkflowCheckPlan,
  comfyuiConfigDefaults,
  comfyuiWorkflowOptionsFromCatalog,
  isApiKeyRequired,
  normalizeComfyuiModelSelection,
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

test('keeps verified, configured, and invalid catalog entries with explicit availability reasons', () => {
  const options = comfyuiWorkflowOptionsFromCatalog({ workflows: [
    { id: 'verified', status: 'verified', selectable: true, unavailableReason: null, variant: '稳定版' },
    { id: 'configured', status: 'configured', selectable: false, unavailableReason: 'WORKFLOW_EXPERIMENTAL_REQUIRED', variant: '实验版' },
    { id: 'invalid', status: 'invalid', selectable: false, unavailableReason: 'WORKFLOW_INVALID' },
  ] })

  assert.deepEqual(options.map(({ id, status, selectable, disabled, unavailableReason }) => (
    { id, status, selectable, disabled, unavailableReason }
  )), [
    { id: 'verified', status: 'verified', selectable: true, disabled: false, unavailableReason: null },
    { id: 'configured', status: 'configured', selectable: false, disabled: true, unavailableReason: 'WORKFLOW_EXPERIMENTAL_REQUIRED' },
    { id: 'invalid', status: 'invalid', selectable: false, disabled: true, unavailableReason: 'WORKFLOW_INVALID' },
  ])
})

test('normalizes a ComfyUI allowlist and moves the default to a selected selectable workflow', () => {
  const options = comfyuiWorkflowOptionsFromCatalog({ workflows: [
    { id: 'ready-a', status: 'verified', selectable: true },
    { id: 'ready-b', status: 'verified', selectable: true },
    { id: 'blocked', status: 'invalid', selectable: false, unavailableReason: 'WORKFLOW_INVALID' },
  ] })

  assert.deepEqual(normalizeComfyuiModelSelection({
    selected: ['blocked', 'ready-b', 'ready-b'],
    defaultModel: 'blocked',
    options,
  }), {
    models: ['blocked', 'ready-b'],
    defaultModel: 'ready-b',
    invalidSelected: ['blocked'],
    canSave: false,
  })
})

test('preserves unknown existing workflow values when the catalog cannot represent them', () => {
  const options = comfyuiWorkflowOptionsFromCatalog(null, ['legacy-workflow'])
  assert.equal(options[0].id, 'legacy-workflow')
  assert.equal(options[0].preserved, true)
  assert.equal(options[0].disabled, true)
  assert.equal(options[0].unavailableReason, 'WORKFLOW_CATALOG_UNAVAILABLE')

  assert.deepEqual(normalizeComfyuiModelSelection({
    selected: ['legacy-workflow'],
    defaultModel: 'legacy-workflow',
    options,
  }), {
    models: ['legacy-workflow'],
    defaultModel: '',
    invalidSelected: ['legacy-workflow'],
    canSave: false,
  })
})

test('builds per-workflow connection states before running online checks', () => {
  const catalog = { workflows: [
    { id: 'ready', status: 'verified', selectable: true },
    { id: 'experimental', status: 'configured', selectable: false, unavailableReason: 'WORKFLOW_EXPERIMENTAL_REQUIRED' },
    { id: 'invalid', status: 'invalid', selectable: false, unavailableReason: 'WORKFLOW_INVALID' },
  ] }
  assert.deepEqual(buildComfyuiWorkflowCheckPlan(['ready', 'experimental', 'invalid', 'missing'], catalog), [
    { workflow: 'ready', status: 'pending', error: '' },
    { workflow: 'experimental', status: 'experimental_disabled', error: '需要启用实验工作流' },
    { workflow: 'invalid', status: 'failed', error: '注册表标记为无效' },
    { workflow: 'missing', status: 'failed', error: '当前目录中不存在' },
  ])
})
