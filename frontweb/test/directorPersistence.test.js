import test from 'node:test'
import assert from 'node:assert/strict'

import * as directorPersistence from '../src/utils/directorPersistence.js'

const { buildDirectorGenerationRequest, buildDirectorPostproductionRequest, buildStructuredDirectorGenerationRequest, createLatestRequestGuard, formatArtifactMedia, isSameDirectorShot, normalizeDirectorShotState } = directorPersistence

test('builds postproduction settings from export wizard fields', () => {
  assert.deepEqual(buildDirectorPostproductionRequest({
    enabled: true,
    subtitlePath: 'dialogue.srt',
    ttsPath: 'narration.mp3',
    musicPath: 'music.wav',
    brightness: 0.02,
    contrast: 1.1,
    saturation: 0.9,
    width: 1280,
    height: 720,
  }), {
    subtitlePath: 'dialogue.srt',
    ttsPath: 'narration.mp3',
    musicPath: 'music.wav',
    color: { brightness: 0.02, contrast: 1.1, saturation: 0.9 },
    upscale: { mode: 'ffmpeg-lanczos', width: 1280, height: 720 },
    fps: 24,
  })
})

test('builds a structured Director request from creator-facing fields', () => {
  assert.deepEqual(buildStructuredDirectorGenerationRequest({
    workflowId: 'h3-continuity-v1',
    candidateCount: 2,
    promptText: 'A woman opens an umbrella at a rainy bus stop.',
    continuityMode: 'motion_overlap',
    seed: 77,
    width: 1280,
    height: 720,
    durationSeconds: 5,
    frameRate: 24,
  }), {
    workflowId: 'h3-continuity-v1',
    candidateCount: 2,
    structured: {
      prompt: 'A woman opens an umbrella at a rainy bus stop.',
      continuityMode: 'motion_overlap',
      seed: 77,
      width: 1280,
      height: 720,
      durationSeconds: 5,
      frameRate: 24,
      overlapFrames: 22,
      negativePrompt: '',
    },
  })
})

test('uses the unified numeric video dimensions when legacy Director callers omit them', () => {
  const request = buildStructuredDirectorGenerationRequest({ promptText: '雾中灯塔' })
  assert.equal(request.structured.width, 1312)
  assert.equal(request.structured.height, 736)
})

test('builds a validated Director generation request from panel fields', () => {
  assert.deepEqual(buildDirectorGenerationRequest({
    workflowId: 'h3-continuity-v1',
    candidateCount: 2,
    promptText: '{"1":{"text":"a quiet mountain gate"}}',
    inputsText: '{"seed":42}',
  }), {
    workflowId: 'h3-continuity-v1',
    candidateCount: 2,
    prompt: { '1': { text: 'a quiet mountain gate' } },
    inputs: { seed: 42 },
  })
})

test('falls back to the default H3 workflow when the advanced field is blank', () => {
  assert.equal(buildDirectorGenerationRequest({
    workflowId: '  ',
    candidateCount: 1,
    promptText: '{"1":{"text":"a quiet mountain gate"}}',
    inputsText: '{}',
  }).workflowId, 'h3-continuity-v1')
})

test('rejects malformed generation JSON before sending a request', () => {
  assert.throws(() => buildDirectorGenerationRequest({ promptText: '{broken' }), /prompt must be valid JSON/)
})

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

test('refreshes only the selected storyboard media after choosing a video candidate', async () => {
  const touchedStoryboardIds = []
  const untouchedStoryboard = { id: 31, title: '分镜 2', status: 'generating' }
  const storyboards = [
    { id: 30, title: '旧分镜 1', image_url: 'images/keep.png' },
    untouchedStoryboard,
  ]
  const selectedVideoIds = { 30: 700, 31: 800 }

  const refreshed = await directorPersistence.refreshSelectedStoryboardVideo({
    storyboardId: 30,
    selectedVideoId: 900,
    currentTarget: storyboards[0],
    storyboards,
    selectStoryboardVideo: (storyboardId, videoId) => {
      selectedVideoIds[storyboardId] = videoId
    },
    refreshStoryboardMedia: async (storyboardId) => {
      touchedStoryboardIds.push(storyboardId)
    },
    fetchStoryboard: async () => ({
      id: 30,
      title: '新分镜 1',
      local_path: 'videos/selected.mp4',
    }),
  })

  assert.deepEqual(touchedStoryboardIds, [30])
  assert.strictEqual(storyboards[1], untouchedStoryboard)
  assert.deepEqual(refreshed, {
    id: 30,
    title: '新分镜 1',
    image_url: 'images/keep.png',
    local_path: 'videos/selected.mp4',
  })
  assert.deepEqual(selectedVideoIds, { 30: 900, 31: 800 })
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
