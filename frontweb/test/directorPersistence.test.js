import test from 'node:test'
import assert from 'node:assert/strict'

import * as directorPersistence from '../src/utils/directorPersistence.js'

const { createLatestRequestGuard, formatArtifactMedia, isSameDirectorShot, normalizeDirectorShotState } = directorPersistence

test('normalizes persisted shot groups with the newest group as the active review state', () => {
  const state = normalizeDirectorShotState({
    groups: [
      { id: 'newest', status: 'review', candidates: [{ id: 'c1', artifact: { preview_url: '/video.mp4' } }] },
      { id: 'older', status: 'selected', candidates: [] },
    ],
    latest: { id: 'newest', status: 'review', candidates: [{ id: 'c1', artifact: { preview_url: '/video.mp4' } }] },
  })

  assert.equal(state.latest.id, 'newest')
  assert.equal(state.groups.length, 2)
  assert.equal(state.latest.candidates[0].artifact.preview_url, '/video.mp4')
})

test('returns an empty persisted state when a shot has no candidate groups', () => {
  assert.deepEqual(normalizeDirectorShotState({ groups: [], latest: null }), { groups: [], latest: null })
})

test('keeps a newly created group in persisted history until the next reload', () => {
  const created = { id: 'created', status: 'review', candidates: [] }
  const state = normalizeDirectorShotState({ groups: [], latest: null }, created)
  assert.deepEqual(state.groups, [created])
  assert.equal(state.latest.id, 'created')
})

test('replaces a stale history snapshot after selecting a candidate', () => {
  const selected = { id: 'current', status: 'selected', candidates: [] }
  const state = normalizeDirectorShotState({
    groups: [{ id: 'current', status: 'review', candidates: [] }, { id: 'older', status: 'selected', candidates: [] }],
    latest: null,
  }, selected)

  assert.deepEqual(state.groups, [selected, { id: 'older', status: 'selected', candidates: [] }])
})

test('formats persisted artifact dimensions, codec, frame rate, duration, and size', () => {
  assert.equal(formatArtifactMedia({
    file_size: 1048576,
    media: { width: 864, height: 480, codec: 'h264', frame_rate: '24/1', duration: '5.04' },
  }), '864x480 · h264 · 24/1 fps · 5.0s · 1.0 MB')
})

test('rejects a stale shot request after a newer refresh starts', () => {
  const guard = createLatestRequestGuard()
  const shotARequest = guard.begin()
  const shotBRequest = guard.begin()
  assert.equal(guard.isCurrent(shotARequest), false)
  assert.equal(guard.isCurrent(shotBRequest), true)
})

test('rejects a candidate creation response after the panel changes shots', () => {
  assert.equal(isSameDirectorShot(7, '7'), true)
  assert.equal(isSameDirectorShot(8, '7'), false)
})

test('rejects an older refresh after a candidate write begins', () => {
  assert.equal(typeof directorPersistence.createDirectorStateGuard, 'function')
  const guard = directorPersistence.createDirectorStateGuard()
  const refreshRequest = guard.beginRefresh()
  const writeRequest = guard.beginWrite()

  assert.equal(guard.isCurrentRefresh(refreshRequest), false)
  assert.equal(guard.isCurrentWrite(writeRequest), true)

  const overlappingRefresh = guard.beginRefresh()
  assert.equal(guard.isCurrentRefresh(overlappingRefresh), true)
  assert.equal(guard.commitWrite(writeRequest), true)
  assert.equal(guard.isCurrentRefresh(overlappingRefresh), false)
})
