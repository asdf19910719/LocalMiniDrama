import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isActiveVideoGenerationStatus,
  isPlayableVideoGenerationStatus,
} from '../src/utils/videoLifecycleStatus.js'
import { getSbVideosList } from '../src/utils/storyboardMedia.js'

test('treats canonical review and selected videos plus legacy completed videos as playable', () => {
  for (const status of ['review', 'selected', 'completed']) {
    assert.equal(isPlayableVideoGenerationStatus(status), true, status)
  }
  for (const status of ['waiting', 'queued', 'running', 'failed', 'cancelled']) {
    assert.equal(isPlayableVideoGenerationStatus(status), false, status)
  }
})

test('reattaches canonical and legacy active video statuses', () => {
  for (const status of ['waiting', 'queued', 'running', 'pending', 'processing']) {
    assert.equal(isActiveVideoGenerationStatus(status), true, status)
  }
  for (const status of ['review', 'selected', 'completed', 'failed', 'cancelled']) {
    assert.equal(isActiveVideoGenerationStatus(status), false, status)
  }
})

test('storyboard media exposes canonical review and selected videos without hiding legacy history', () => {
  const videos = {
    5: [
      { id: 1, status: 'review', local_path: 'videos/review.mp4' },
      { id: 2, status: 'selected', video_url: 'https://cdn.example.test/selected.mp4' },
      { id: 3, status: 'completed', local_path: 'videos/legacy.mp4' },
      { id: 4, status: 'running', local_path: 'videos/partial.mp4' },
    ],
  }
  assert.deepEqual(getSbVideosList(videos, 5).map((video) => video.id), [1, 2, 3])
})
