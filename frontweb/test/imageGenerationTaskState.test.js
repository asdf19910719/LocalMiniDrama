import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeImageGenerationTask,
  resolveChatGPTPrepareAction,
  shouldPollImageGenerationTask,
  shouldReattachImageGenerationTask,
} from '../src/utils/imageGenerationTaskState.js'
import { clearImageGenerationEnvironmentCache, runImageGenerationEnvironmentCheck } from '../src/utils/imageGenerationEnvironment.js'

test('flattens imported external results into drawer candidates', () => {
  const task = normalizeImageGenerationTask({
    id: 'task-1',
    status: 'needs_review',
    external_job: {
      attempts: [
        { results: [{ id: 'result-1' }] },
        { results: [{ id: 'result-2' }] },
      ],
    },
  })

  assert.deepEqual(task.candidates.map((item) => item.id), ['result-1', 'result-2'])
})

test('polls only ChatGPT tasks waiting for an imported result', () => {
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'submitted' }), true)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'generating' }), true)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review' }), false)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'api', status: 'submitted' }), false)
})

test('summary refresh cannot replace a task that was just created by the user', () => {
  assert.equal(shouldReattachImageGenerationTask({
    currentTaskId: 'new-draft-task',
    activeTaskId: 'old-submitted-task',
    allowReattach: false,
  }), false)
})

test('page reload may restore the persisted active task', () => {
  assert.equal(shouldReattachImageGenerationTask({
    currentTaskId: null,
    activeTaskId: 'submitted-task',
    allowReattach: true,
  }), true)
})

test('an idempotent prepare response never submits the same ChatGPT prompt twice', () => {
  assert.equal(resolveChatGPTPrepareAction({ already_submitted: false, task: { status: 'preparing' } }), 'send')
  assert.equal(resolveChatGPTPrepareAction({ already_submitted: true, task: { status: 'submitted' } }), 'recover')
  assert.equal(resolveChatGPTPrepareAction({ already_submitted: true, task: { status: 'generating' } }), 'recover')
  assert.equal(resolveChatGPTPrepareAction({ already_submitted: true, task: { status: 'needs_review' } }), 'review')
})

test('environment check combines backend and ChatGPT diagnostics by channel', async () => {
  clearImageGenerationEnvironmentCache()
  let backendCalls = 0
  let bridgeCalls = 0
  const result = await runImageGenerationEnvironmentCheck({
    dramaId: 7, channel: 'chatgpt_web', targetType: 'scene', targetId: 3,
    requestBackend: async () => { backendCalls += 1; return { canProceed: true, checks: [{ key: 'backend', status: 'ok' }] } },
    requestBridge: async () => { bridgeCalls += 1; return { canProceed: true, checks: [{ key: 'provider_tab', status: 'ok' }] } },
  })
  assert.equal(result.canProceed, true)
  assert.equal(result.checks.length, 2)
  assert.equal(backendCalls, 1)
  assert.equal(bridgeCalls, 1)
  await runImageGenerationEnvironmentCheck({
    dramaId: 7, channel: 'chatgpt_web', targetType: 'scene', targetId: 3,
    requestBackend: async () => { backendCalls += 1; return { canProceed: true, checks: [] } },
    requestBridge: async () => { bridgeCalls += 1; return { canProceed: true, checks: [] } },
  })
  assert.equal(backendCalls, 1)
  assert.equal(bridgeCalls, 1)
})
