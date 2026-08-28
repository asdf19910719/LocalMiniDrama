import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeImageGenerationTask,
  shouldPollImageGenerationTask,
} from '../src/utils/imageGenerationTaskState.js'

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
