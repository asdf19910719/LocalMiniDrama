import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeImageGenerationTask,
  resolveChatGPTPrepareAction,
  shouldPollImageGenerationTask,
  shouldReattachImageGenerationTask,
  shouldRecoverImageGenerationTask,
  toChatGPTRecoveryAttempt,
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

test('polls active tasks according to their channel lifecycle', () => {
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'submitted' }), true)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'generating' }), true)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review', error_code: 'result_timeout' }), false)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review' }), false)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'api', status: 'submitted' }), false)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'api', status: 'generating' }), true)
  assert.equal(shouldPollImageGenerationTask({ generation_channel: 'api', status: 'completed' }), false)
})

test('offers result recovery for active, timed-out, and capture-failed ChatGPT tasks only', () => {
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'submitted' }), true)
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'generating' }), true)
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review', error_code: 'result_timeout' }), true)
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review', error_code: 'UNBOUND_RESULT' }), true)
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review', error_code: 'RESULT_CAPTURE_FAILED' }), true)
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review', error_code: 'RESULT_SHELL_STUCK' }), true)
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review', error_code: 'ADAPTER_ERROR' }), false)
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'chatgpt_web', status: 'needs_review' }), false)
  assert.equal(shouldRecoverImageGenerationTask({ generation_channel: 'api', status: 'submitted' }), false)
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

test('ChatGPT recovery payload retains both user and assistant message anchors', () => {
  assert.deepEqual(toChatGPTRecoveryAttempt({
    id: 'attempt-1',
    status: 'generating',
    sequence: 2,
    user_message_id: 'user-message-uuid',
    assistant_message_id: 'request-conversation-1-3',
    conversation_id: 'conversation-1',
  }), {
    id: 'attempt-1',
    status: 'generating',
    sequence: 2,
    user_message_id: 'user-message-uuid',
    assistant_message_id: 'request-conversation-1-3',
    conversation_id: 'conversation-1',
  })
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

test('loading the saved default channel refreshes its environment status', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  const loadDefault = source.match(/async function loadDefault\(id\) \{([\s\S]*?)\n  \}/)?.[1] || ''
  assert.match(loadDefault, /checkEnvironment\(\{ dramaId: id, channel: defaultChannel\.value \}, \{ force: true \}\)/)
})

test('stale environment checks cannot overwrite a newer channel result', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  assert.match(source, /let environmentCheckVersion = 0/)
  assert.match(source, /const checkVersion = \+\+environmentCheckVersion/)
  assert.match(source, /if \(checkVersion !== environmentCheckVersion\) return result/)
})

test('task pill keeps environment and default channel reactive', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = fs.readFileSync(path.join(root, 'src/components/imageGeneration/ImageGenerationTaskPill.vue'), 'utf8')
  assert.match(source, /import \{ storeToRefs \} from ['"]pinia['"]/)
  assert.match(source, /const \{ environment, defaultChannel \} = storeToRefs\(store\)/)
  assert.match(source, /channel: defaultChannel\.value/)
})
