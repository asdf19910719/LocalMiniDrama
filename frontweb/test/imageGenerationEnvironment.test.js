import test from 'node:test'
import assert from 'node:assert/strict'

import * as environmentModule from '../src/utils/imageGenerationEnvironment.js'

test('saved image channel response is normalized before the next environment request', () => {
  assert.equal(typeof environmentModule.normalizeImageGenerationChannel, 'function')
  assert.equal(environmentModule.normalizeImageGenerationChannel({ channel: 'chatgpt_web' }, 'api'), 'chatgpt_web')
  assert.equal(environmentModule.normalizeImageGenerationChannel({ channel: 'api' }, 'chatgpt_web'), 'api')
  assert.equal(environmentModule.normalizeImageGenerationChannel(null, 'unsupported'), 'api')
  assert.equal(environmentModule.normalizeImageGenerationChannel(null, { channel: 'chatgpt_web' }), 'chatgpt_web')
})

test('environment check never forwards an API response object as the channel', async () => {
  let backendChannel = null
  const result = await environmentModule.runImageGenerationEnvironmentCheck({
    dramaId: 7,
    channel: { channel: 'chatgpt_web' },
    force: true,
    requestBackend: async ({ channel }) => {
      backendChannel = channel
      return { canProceed: true, checks: [] }
    },
    requestBridge: async () => ({ canProceed: true, checks: [] }),
    now: () => 1,
  })

  assert.equal(backendChannel, 'chatgpt_web')
  assert.equal(result.channel, 'chatgpt_web')
  assert.equal(result.canProceed, true)
})

test('image generation facade exposes the environment recheck action', async () => {
  let facadeModule = null
  try {
    facadeModule = await import('../src/composables/imageGenerationFacade.js')
  } catch (_) {}

  assert.equal(typeof facadeModule?.createImageGenerationFacade, 'function')
  const actionNames = [
    'loadSummary', 'loadDefault', 'setDefaultChannel', 'checkEnvironment',
    'openTask', 'refreshTask', 'sendToChatGPT', 'recoverCapture',
    'requeueTask', 'selectResult', 'closeDrawer',
  ]
  const store = Object.fromEntries(actionNames.map((name) => [name, () => name]))
  const facade = facadeModule.createImageGenerationFacade(store, { defaultChannel: 'api' })
  assert.equal(facade.defaultChannel, 'api')
  for (const name of actionNames) {
    const facadeName = { openTask: 'open', refreshTask: 'refresh', closeDrawer: 'close' }[name] || name
    assert.equal(facade[facadeName], store[name], `${facadeName} action was not preserved`)
  }
})
