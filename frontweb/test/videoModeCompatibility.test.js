import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canUseUniversalOmniVideoApi,
  isH3ComfyUiConfig,
  requiresH3Draft,
  slotReferenceFallbackPolicy,
  universalVideoCompatibility,
} from '../src/utils/videoModeCompatibility.js'

const H3_WORKFLOW = { execution: { requiresPromptDraft: true, promptContract: 'h3_director_v1' } }
const FREE_TEXT_WORKFLOW = { execution: { requiresPromptDraft: false, promptContract: 'free_text_v1' } }

test('uses the selected workflow execution contract for the H3 draft flow', () => {
  const cfg = { provider: 'comfyui', default_model: 'h3-continuity-v1' }
  assert.equal(requiresH3Draft(H3_WORKFLOW), true)
  assert.equal(isH3ComfyUiConfig(cfg, H3_WORKFLOW), true)
  assert.deepEqual(universalVideoCompatibility(cfg, H3_WORKFLOW), { compatible: true, mode: 'h3_director', supportsOmniReferences: false })
  assert.equal(canUseUniversalOmniVideoApi(cfg, H3_WORKFLOW), true)
  assert.equal(slotReferenceFallbackPolicy(cfg, H3_WORKFLOW), 'abort')
})

test('keeps Omni providers on their multi-reference protocol', () => {
  assert.deepEqual(universalVideoCompatibility({ api_protocol: 'kling_omni' }), { compatible: true, mode: 'omni', supportsOmniReferences: true })
})

test('does not infer H3 behavior from config names or workflow adapter names', () => {
  const h3LookingConfig = { provider: 'comfyui', default_model: 'minimax-h3-director' }
  const h3LookingWorkflow = { adapter: 'minimax_h3_director', execution: FREE_TEXT_WORKFLOW.execution }
  assert.equal(requiresH3Draft(h3LookingWorkflow), false)
  assert.equal(isH3ComfyUiConfig(h3LookingConfig, h3LookingWorkflow), false)
  assert.equal(canUseUniversalOmniVideoApi(h3LookingConfig, h3LookingWorkflow), false)
  assert.equal(slotReferenceFallbackPolicy(h3LookingConfig, h3LookingWorkflow), 'legacy_fallback')
})

test('an arbitrary workflow id enables H3 behavior when its execution contract requires a draft', () => {
  const workflow = { id: 'custom-director-v9', adapter: 'custom', execution: H3_WORKFLOW.execution }
  assert.equal(isH3ComfyUiConfig({ provider: 'comfyui' }, workflow), true)
})
