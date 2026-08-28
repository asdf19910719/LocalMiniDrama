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

test('builds numeric candidate input with the default H3 workflow and mode', () => {
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
      workflowId: 'minimax_h3_director_r2v',
      generationMode: 'single_reference',
      anchorId: 'anchor-1',
      sourceArtifactId: 'artifact-1',
    },
  })
  assert.equal('provider' in request, false)
  assert.equal('model' in request, false)
  assert.equal(request.structured.workflowId, 'minimax_h3_director_r2v')
  assert.equal(request.structured.generationMode, 'single_reference')
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
      workflowId: 'minimax_h3_director_r2v',
      generationMode: 'single_reference',
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

test('keeps the newly generated candidates when a stale history refresh returns no groups', async () => {
  const generatedGroup = {
    id: 'new-group',
    status: 'running',
    candidates: [
      { id: 'candidate-1', status: 'pending', video_generation: { id: 101, status: 'waiting' } },
      { id: 'candidate-2', status: 'pending', video_generation: { id: 102, status: 'queued' } },
    ],
  }
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'cloud' }),
    getCandidateHistory: async () => ({ groups: [], latest: null }),
    generateCandidates: async () => ({ group: generatedGroup }),
  }
  const props = reactive({
    storyboardId: 13,
    storyboard: { id: 13, video_prompt: '山路上的人物向前行走', duration: 5 },
  })
  const panel = useVideoGenerationPanel(props, () => {}, api)
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  await panel.generateCandidates()

  assert.equal(panel.currentGroup.value?.id, 'new-group')
  assert.deepEqual(panel.candidates.value.map((candidate) => candidate.id), ['candidate-1', 'candidate-2'])
  assert.match(panel.queueLabel.value, /正在生成|排队中/)
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
  assert.equal(
    videoErrorCopy({
      code: 'H3_SKILL_TOOL_CALL_UNSUPPORTED',
      message: 'H3_SKILL_TOOL_CALL_UNSUPPORTED',
    }).summary,
    '当前文本模型不支持技能工具调用，请为 H3 提示词编译选择支持 tool calling 的模型。',
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

test('keeps an in-flight create locked per storyboard while the user switches away and back', async () => {
  const pending = []
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'cloud' }),
    getCandidateHistory: async () => ({ groups: [], latest: null }),
    generateCandidates: async () => new Promise((resolve) => pending.push(resolve)),
  }
  const props = reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头一' } })
  const panel = useVideoGenerationPanel(props, () => {}, api)
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  const first = panel.generateCandidates()
  props.storyboardId = 2
  props.storyboard = { id: 2, video_prompt: '镜头二' }
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  props.storyboardId = 1
  props.storyboard = { id: 1, video_prompt: '镜头一' }
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  const duplicate = panel.generateCandidates()

  assert.equal(pending.length, 1)
  pending[0]({})
  await Promise.all([first, duplicate])
})

test('ignores stale cancel, retry, quality, and anchor writes after switching storyboards', async () => {
  const pending = {}
  const group = {
    id: 'selected-group',
    status: 'selected',
    selected_artifact_id: 'artifact-1',
    candidates: [{ id: 'candidate-1', status: 'selected', artifact: { id: 'artifact-1', status: 'ready' } }],
  }
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'cloud' }),
    getCandidateHistory: async (id) => id === 1 ? { groups: [group], latest: group } : { groups: [], latest: null },
    listAnchors: async () => [],
    cancelCandidate: async () => new Promise((resolve, reject) => { pending.cancel = { resolve, reject } }),
    retryCandidate: async () => new Promise((resolve, reject) => { pending.retry = { resolve, reject } }),
    analyzeCandidate: async () => new Promise((resolve, reject) => { pending.analyze = { resolve, reject } }),
    createAnchor: async () => new Promise((resolve, reject) => { pending.anchor = { resolve, reject } }),
  }
  const props = reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头一' } })
  const emitted = []
  const panel = useVideoGenerationPanel(props, (name, payload) => emitted.push([name, payload]), api)
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  const candidate = group.candidates[0]
  const cancel = panel.cancelCandidate(candidate)
  const retry = panel.retryCandidate(candidate)
  const analyze = panel.analyzeCandidate(candidate)
  const anchor = panel.createAnchor()
  props.storyboardId = 2
  props.storyboard = { id: 2, video_prompt: '镜头二' }
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  pending.cancel.reject(new Error('旧分镜取消失败'))
  pending.retry.reject(new Error('旧分镜重试失败'))
  pending.analyze.resolve({ status: 'failed', issues: ['stale'] })
  pending.anchor.resolve({ id: 'old-anchor', reference_role: 'state' })
  await Promise.all([cancel, retry, analyze, anchor])

  assert.equal(panel.error.value, null)
  assert.deepEqual(panel.qualityReviews.value, {})
  assert.deepEqual(panel.anchors.value, [])
  assert.deepEqual(emitted, [])
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

test('maps the rendered source-anchor role through the panel model', async () => {
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'cloud' }),
    getCandidateHistory: async () => ({ groups: [], latest: null }),
  }
  const panel = useVideoGenerationPanel(reactive({
    storyboardId: 1,
    storyboard: { id: 1, _videoSourceAnchor: { id: 'anchor-1', reference_role: 'identity' } },
  }), () => {}, api)
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(anchorRoleLabel(panel.sourceAnchor.value.reference_role), '角色一致性')
})

test('drawer and sidebar callers preserve distinct layout state while sharing candidate behavior', async () => {
  const calls = []
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'cloud' }),
    getCandidateHistory: async () => ({ groups: [], latest: null }),
    generateCandidates: async (id, body) => { calls.push([id, body]); return {} },
  }
  const makePanel = (displayMode) => useVideoGenerationPanel(reactive({
    storyboardId: 1,
    displayMode,
    storyboard: { id: 1, video_prompt: 'shared caller' },
  }), () => {}, api)
  const drawer = makePanel('drawer')
  const sidebar = makePanel('sidebar')
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  await Promise.all([drawer.generateCandidates(), sidebar.generateCandidates()])

  assert.equal(drawer.displayMode.value, 'drawer')
  assert.equal(sidebar.displayMode.value, 'sidebar')
  assert.deepEqual(calls[0][1], calls[1][1])
})

test('builds the same numeric candidate request for either panel layout', () => {
  const makeRequest = () => {
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
