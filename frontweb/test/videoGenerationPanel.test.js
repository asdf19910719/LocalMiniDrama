import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, reactive } from 'vue'

import {
  buildVideoCandidateRequest,
  anchorRoleLabel,
  candidateStatus,
  listVideoActions,
  normalizeVideoGenerationContext,
  resolveStoryboardVideoPrompt,
  useVideoGenerationPanel,
  videoErrorCopy,
  videoStatusLabel,
} from '../src/composables/useVideoGenerationPanel.js'

test('prefers the universal segment when resolving a storyboard video prompt', () => {
  const storyboard = {
    universal_segment_text: '全能片段提示词',
    video_prompt: '视频提示词',
    polished_prompt: '润色提示词',
    image_prompt: '图片提示词',
    description: '分镜描述',
  }

  assert.equal(resolveStoryboardVideoPrompt(storyboard), storyboard.universal_segment_text)
  assert.equal(resolveStoryboardVideoPrompt({ ...storyboard, universal_segment_text: '  ' }), storyboard.video_prompt)
})

test('exposes the same video-generation actions in drawer and sidebar layouts', () => {
  const drawerActions = listVideoActions('drawer')
  const sidebarActions = listVideoActions('sidebar')

  assert.deepEqual(drawerActions, sidebarActions)
  assert.deepEqual(drawerActions, ['刷新', '生成候选', '取消生成', '重试生成', '质量检查', '选用候选', '创建连续性锚点'])
})

test('builds numeric candidate input without a client-selected provider, model, or workflow', () => {
  const request = buildVideoCandidateRequest({
    prompt: '雨夜车站，人物撑伞转身',
    negativePrompt: '画面抖动',
    width: '1280',
    height: '704',
    duration: '5',
    frameRate: '24',
    seed: '77',
    candidateCount: '2',
    continuityMode: 'motion_overlap',
    anchorId: 'anchor-1',
    sourceArtifactId: 'artifact-1',
  })

  assert.deepEqual(request, {
    candidateCount: 2,
    structured: {
      prompt: '雨夜车站，人物撑伞转身',
      negativePrompt: '画面抖动',
      width: 1280,
      height: 704,
      durationSeconds: 5,
      frameRate: 24,
      seed: 77,
      continuityMode: 'motion_overlap',
      anchorId: 'anchor-1',
      sourceArtifactId: 'artifact-1',
    },
  })
  assert.equal('provider' in request, false)
  assert.equal('model' in request, false)
  assert.equal('workflowId' in request, false)
})

test('accepts zero as a deterministic random seed', () => {
  const request = buildVideoCandidateRequest({
    prompt: '固定镜头',
    width: 864,
    height: 480,
    duration: 3,
    frameRate: 24,
    seed: 0,
    candidateCount: 1,
    continuityMode: 'none',
  })

  assert.equal(request.structured.seed, 0)
})

test('preserves the normal editor generation context in the unified candidate payload', async () => {
  const captured = []
  const generationContext = normalizeVideoGenerationContext({
    mode: 'universal_omni',
    prompt: '未保存的全能片段提示词',
    imageUrl: 'https://assets.example.test/selected-first.png',
    firstFrameUrl: 'https://assets.example.test/selected-first.png',
    lastFrameUrl: 'https://assets.example.test/selected-last.png',
    referenceImageUrls: [
      'https://assets.example.test/scene.png',
      'https://assets.example.test/character.png',
      'https://assets.example.test/prop.png',
    ],
    style: '电影写实',
    aspectRatio: '9:16',
    resolution: '1080p',
    duration: 7,
  })
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'cloud' }),
    getCandidateHistory: async () => ({ groups: [], latest: null }),
    generateCandidates: async (_storyboardId, body) => {
      captured.push(body)
      return {}
    },
  }
  const props = reactive({
    storyboardId: 1,
    storyboard: { id: 1, universal_segment_text: '已保存的旧提示词', duration: 3 },
    generationContext,
  })
  const panel = useVideoGenerationPanel(props, () => {}, api)
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  await panel.generateCandidates()

  assert.equal(panel.generationMode.value, 'universal_omni')
  assert.deepEqual(captured, [{
    candidateCount: 2,
    structured: {
      prompt: '未保存的全能片段提示词',
      negativePrompt: '',
      width: 1280,
      height: 704,
      durationSeconds: 7,
      frameRate: 24,
      seed: 42,
      continuityMode: 'motion_overlap',
      imageUrl: 'https://assets.example.test/selected-first.png',
      firstFrameUrl: 'https://assets.example.test/selected-first.png',
      lastFrameUrl: 'https://assets.example.test/selected-last.png',
      referenceImageUrls: [
        'https://assets.example.test/scene.png',
        'https://assets.example.test/character.png',
        'https://assets.example.test/prop.png',
      ],
      style: '电影写实',
      aspectRatio: '9:16',
      resolution: '1080p',
    },
  }])
})

test('provides Chinese lifecycle and error summaries while preserving technical details', () => {
  assert.equal(videoStatusLabel('queued'), '排队中')
  assert.equal(videoStatusLabel('running'), '生成中')
  assert.equal(videoStatusLabel('review'), '待审核')
  assert.equal(videoStatusLabel('selected'), '已选用')

  assert.deepEqual(videoErrorCopy({
    code: 'VIDEO_CONFIG_DEFAULT_MISSING',
    message: 'No default video configuration',
  }), {
    summary: '尚未设置默认视频服务，请先前往 API 配置完成设置。',
    detail: 'VIDEO_CONFIG_DEFAULT_MISSING · No default video configuration',
  })
  assert.equal(
    videoErrorCopy({ code: 'VIDEO_CONFIG_MISSING', message: 'VIDEO_CONFIG_MISSING' }).summary,
    '尚未设置默认视频服务，请先前往 API 配置完成设置。',
  )
  assert.equal(
    videoErrorCopy({ code: 'VIDEO_CONFIG_AMBIGUOUS', message: 'VIDEO_CONFIG_AMBIGUOUS' }).summary,
    '检测到多个默认视频服务，请在 API 配置中仅保留一个。',
  )
})

test('keeps Director selection results authoritative over the linked video review state', () => {
  assert.equal(candidateStatus({ status: 'selected', video_generation: { status: 'selected' } }), 'selected')
  assert.equal(candidateStatus({ status: 'rejected', video_generation: { status: 'review' } }), 'rejected')
})

test('ignores a candidate selection response after the panel switches storyboards', async () => {
  let resolveSelection
  const selectionResponse = new Promise((resolve) => { resolveSelection = resolve })
  const group = {
    id: 'group-1',
    status: 'review',
    candidates: [{ id: 'candidate-1', status: 'review', video_generation: { id: 11, status: 'review' } }],
  }
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'comfyui', default_model: 'h3' }),
    getCandidateHistory: async (storyboardId) => storyboardId === 1
      ? { groups: [group], latest: group }
      : { groups: [], latest: null },
    selectCandidate: async () => selectionResponse,
    listAnchors: async () => [],
  }
  const props = reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头一' } })
  const emitted = []
  const panel = useVideoGenerationPanel(props, (name, payload) => emitted.push([name, payload]), api)
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  const pendingSelection = panel.selectCandidate(group.candidates[0])
  props.storyboardId = 2
  props.storyboard = { id: 2, video_prompt: '镜头二' }
  await nextTick()
  resolveSelection({ ...group, status: 'selected' })
  await pendingSelection

  assert.deepEqual(emitted, [])
  assert.equal(panel.currentGroup.value, null)
})

test('does not let a stale create failure clear or overwrite a newer storyboard create', async () => {
  const pendingCreates = []
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'cloud' }),
    getCandidateHistory: async () => ({ groups: [], latest: null }),
    generateCandidates: async () => new Promise((resolve, reject) => pendingCreates.push({ resolve, reject })),
  }
  const props = reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头一' } })
  const panel = useVideoGenerationPanel(props, () => {}, api)
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  const staleCreate = panel.generateCandidates()
  props.storyboardId = 2
  props.storyboard = { id: 2, video_prompt: '镜头二' }
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  const currentCreate = panel.generateCandidates()
  pendingCreates[0].reject(new Error('旧分镜创建失败'))
  await staleCreate

  assert.equal(panel.creating.value, true)
  assert.equal(panel.error.value, null)

  pendingCreates[1].resolve({})
  await currentCreate
  assert.equal(panel.creating.value, false)
  assert.equal(panel.error.value, null)
})

test('keeps generation copy and continuity roles Chinese through the panel behavior model', () => {
  assert.equal(anchorRoleLabel('state'), '状态')
  assert.equal(anchorRoleLabel('composition'), '构图')
  assert.equal(anchorRoleLabel('identity'), '角色一致性')
  assert.equal(anchorRoleLabel('motion'), '动作')
  assert.equal(anchorRoleLabel('unknown-provider-role'), '连续性')
  assert.deepEqual(listVideoActions('drawer'), listVideoActions('sidebar'))
  for (const action of listVideoActions('drawer')) assert.doesNotMatch(action, /\b(?:Refresh|Generate|Cancel|Retry|Quality|Select|Create|Director|GPU)\b/i)
  for (const status of ['waiting', 'queued', 'running', 'review', 'selected', 'failed']) {
    assert.doesNotMatch(videoStatusLabel(status), /\b(?:waiting|queued|running|review|selected|failed)\b/i)
  }
})

test('normal and canvas callers use the same candidate request behavior', () => {
  const makeRequest = (displayMode) => {
    const form = {
      prompt: 'shared caller',
      width: 864,
      height: 480,
      duration: 3,
      frameRate: 24,
      seed: 0,
      candidateCount: 1,
      continuityMode: 'none',
    }
    return buildVideoCandidateRequest(form)
  }
  assert.deepEqual(makeRequest('drawer'), makeRequest('sidebar'))
})
