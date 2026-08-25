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
