import test from 'node:test'
import assert from 'node:assert/strict'
import { createExternalGenerationAPI } from '../src/api/externalGenerationClient.js'

test('external generation API keeps job, attempt, result, and session contracts', async () => {
  const calls = []
  const request = {
    get(path) { calls.push(['GET', path]); return Promise.resolve({ ok: true }) },
    post(path, body, config) { calls.push(['POST', path, body, config]); return Promise.resolve({ ok: true }) },
  }
  let key = 0
  const api = createExternalGenerationAPI(request, () => `key-${++key}`)
  await api.createJob({ dramaId: 7 })
  await api.prepareJob('job/1', [])
  await api.createAttempt('job/1', { sequence: 1 })
  await api.recordAttemptEvent('attempt/1', { eventType: 'SUBMITTED' })
  await api.importResult(new FormData())
  await api.selectResult('result/1', 42)
  await api.attachSession(7, { site: 'chatgpt' })
  await api.listJobs(7)
  await api.getJob('job/1')
  assert.equal(calls[1][1], '/external-generation/jobs/job%2F1/prepare')
  assert.equal(calls[2][3].headers['Idempotency-Key'], 'key-3')
  assert.equal(calls[5][1], '/external-generation/results/result%2F1/rebind')
  assert.equal(calls[7][1], '/external-generation/dramas/7/jobs')
})

test('restores the newest persisted job for one shot after reload', async () => {
  const request = {
    async get(path) {
      if (path === '/external-generation/dramas/3/jobs') {
        return [
          { id: 'other-shot', storyboard_id: 9, updated_at: '2026-08-26T10:00:00.000Z' },
          { id: 'older-shot-5', storyboard_id: 5, updated_at: '2026-08-26T08:00:00.000Z' },
          { id: 'newest-shot-5', storyboard_id: 5, updated_at: '2026-08-26T09:00:00.000Z' },
        ]
      }
      assert.equal(path, '/external-generation/jobs/newest-shot-5')
      return { id: 'newest-shot-5', attempts: [{ results: [{ id: 'candidate-1', selected: 1 }] }] }
    },
    async post() { throw new Error('unexpected write') },
  }

  const api = createExternalGenerationAPI(request)
  const restored = await api.restoreLatestJob(3, 5)

  assert.equal(restored.id, 'newest-shot-5')
  assert.equal(restored.attempts[0].results[0].id, 'candidate-1')
})

test('returns null when the current shot has no persisted external job', async () => {
  const api = createExternalGenerationAPI({
    async get() { return [{ id: 'other-shot', storyboard_id: 9 }] },
    async post() { throw new Error('unexpected write') },
  })

  assert.equal(await api.restoreLatestJob(3, 5), null)
})
