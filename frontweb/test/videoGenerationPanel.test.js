import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { nextTick, reactive } from 'vue'

import {
  buildVideoCandidateRequest,
  candidateStartTime,
  anchorRoleLabel,
  candidateStatus,
  listVideoActions,
  normalizeVideoGenerationContext,
  resolveVideoPromptPresentation,
  resolveStoryboardVideoPrompt,
  workflowIdForTESpeed,
  useVideoGenerationPanel,
  videoErrorCopy,
  videoStatusLabel,
} from '../src/composables/useVideoGenerationPanel.js'

test('prefers actual execution start time and falls back to video creation time', () => {
  assert.equal(
    candidateStartTime({ job_started_at: '2026-08-30T01:02:03.000Z', video_generation: { created_at: '2026-08-30T00:00:00.000Z' } }),
    '2026-08-30T01:02:03.000Z',
  )
  assert.equal(
    candidateStartTime({ video_generation: { created_at: '2026-08-30T00:00:00.000Z' } }),
    '2026-08-30T00:00:00.000Z',
  )
})

test('keeps universal business prompt and exposes prior compiled H3 prompt separately', () => {
  const result = resolveVideoPromptPresentation(
    { creation_mode: 'universal', universal_segment_text: '全能片段描述', video_prompt: '旧视频词' },
    { prompt: '全能片段描述' },
    [{ candidates: [{ video_generation: { compiled_prompt: '旧 H3 编译词' } }] }],
  )

  assert.deepEqual(result, {
    businessPrompt: '全能片段描述',
    lastCompiledPrompt: '旧 H3 编译词',
  })
})

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
      workflowId: 'minimax_h3_director_r2v_te_speed',
      generationMode: 'single_reference',
      anchorId: 'anchor-1',
      sourceArtifactId: 'artifact-1',
    },
  })
  assert.equal('provider' in request, false)
  assert.equal('model' in request, false)
  assert.equal(request.structured.workflowId, 'minimax_h3_director_r2v_te_speed')
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
    candidateCount: 1,
    structured: {
      prompt: '未保存的全能片段提示词',
      negativePrompt: '',
      width: 1312,
      height: 736,
      durationSeconds: 7,
      frameRate: 24,
      seed: 42,
      continuityMode: 'motion_overlap',
        workflowId: 'minimax_h3_director_r2v_te_speed',
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
  assert.equal(
    videoErrorCopy({
      code: 'H3_DRAFT_WORKFLOW_MISMATCH',
      message: 'H3_DRAFT_WORKFLOW_MISMATCH',
    }).summary,
    '提示词草稿与当前 H3 加速开关不一致，请重新生成 H3 提示词。',
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

test('applies the high-resolution drawer preset as 1312 by 736', async () => {
  const api = {
    getDefaultConfig: async () => ({ id: 1, is_active: true, is_default: true, provider: 'cloud' }),
    getCandidateHistory: async () => ({ groups: [], latest: null }),
  }
  const panel = useVideoGenerationPanel(reactive({
    storyboardId: 1,
    storyboard: { id: 1, video_prompt: 'high-resolution preset' },
  }), () => {}, api)
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  panel.setDimensions(panel.dimensionPresets[1])

  assert.equal(panel.form.width, 1312)
  assert.equal(panel.form.height, 736)
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

// ---------- Task 17:H3 草稿抽屉流 ----------

const H3_CONFIG = {
  id: 77,
  is_active: true,
  is_default: true,
  provider: 'comfyui',
  default_model: 'minimax_h3_director_r2v',
}

function h3ApiStub(extra = {}) {
  return {
    getDefaultConfig: async () => ({ ...H3_CONFIG }),
    getCandidateHistory: async () => ({ groups: [], latest: null }),
    getH3Draft: async () => ({ draft: null, freshness: { stale: false, reasons: [] } }),
    getReferenceSlots: async () => ({ slots: [], total: 0, overflow: [] }),
    ...extra,
  }
}

test('detects ComfyUI H3 configs for the draft flow', async () => {
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    h3ApiStub(),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(panel.isH3Config.value, true)

  const plain = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    { ...h3ApiStub(), getDefaultConfig: async () => ({ ...H3_CONFIG, provider: 'cloud' }) },
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(plain.isH3Config.value, false)
})

test('defaults the TE-Speed switch on and maps off to the official Sage workflow', async () => {
  assert.equal(workflowIdForTESpeed(true), 'minimax_h3_director_r2v_te_speed')
  assert.equal(workflowIdForTESpeed(false), 'minimax_h3_director_r2v')

  const draftCalls = []
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async (_storyboardId, _configId, workflowId) => {
        draftCalls.push(workflowId)
        return { draft: null, freshness: { stale: false, reasons: [] } }
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(panel.teSpeedEnabled.value, true)
  assert.equal(panel.form.workflowId, 'minimax_h3_director_r2v_te_speed')
  assert.equal(panel.approximateAcceleration.value, true)

  await panel.setTESpeedEnabled(false)
  assert.equal(panel.teSpeedEnabled.value, false)
  assert.equal(panel.form.workflowId, 'minimax_h3_director_r2v')
  assert.equal(panel.approximateAcceleration.value, false)
  assert.equal(draftCalls.at(-1), 'minimax_h3_director_r2v')

  const component = fs.readFileSync(new URL('../src/components/video/VideoGenerationPanel.vue', import.meta.url), 'utf8')
  assert.match(component, /TE-Speed 加速/)
  assert.match(component, /setTESpeedEnabled/)
})

test('renders capability-driven TE-Speed identity without exposing tuning controls', async () => {
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    h3ApiStub({
      getDefaultConfig: async () => ({
        ...H3_CONFIG,
        default_model: 'minimax_h3_director_r2v_te_speed',
      }),
      capabilities: async () => ({
        workflow: {
          id: 'minimax_h3_director_r2v_te_speed',
          label: '官方多参考图（Sage + TE-Speed 实验）',
        },
        capabilities: {
          modes: ['single_reference'],
          supportsContinuity: false,
          supportsTESpeed: true,
          approximateAcceleration: true,
        },
      }),
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(panel.isH3Config.value, true)
  assert.equal(panel.workflowLabel.value, '官方多参考图（Sage + TE-Speed 实验）')
  assert.equal(panel.approximateAcceleration.value, true)

  const component = fs.readFileSync(new URL('../src/components/video/VideoGenerationPanel.vue', import.meta.url), 'utf8')
  assert.match(component, /近似加速/)
  assert.doesNotMatch(component, /v-model="form\.(?:processingControlValue|mcs|teSpeedDevice|teSpeedMode)"/)
})

test('restores the existing H3 draft text and chip when the panel opens', async () => {
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async (storyboardId, videoConfigId) => {
        assert.equal(storyboardId, 1)
        assert.equal(videoConfigId, 77)
        return {
          draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '编译好的 H3 提示词' },
          freshness: { stale: false, reasons: [] },
        }
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(panel.h3DraftText.value, '编译好的 H3 提示词')
  assert.equal(panel.h3UiState.value.chip, 'ai')
  assert.equal(panel.h3UiState.value.canGenerate, true)
})

test('compile generates the draft text through the compile endpoint', async () => {
  const compileCalls = []
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 3, storyboard: { id: 3, universal_segment_text: '片段描述' } }),
    () => {},
    h3ApiStub({
      compileH3Draft: async (storyboardId, videoConfigId) => {
        compileCalls.push([storyboardId, videoConfigId])
        return {
          draft: { id: 12, status: 'valid', manually_edited: false, final_compiled_prompt: '新编译提示词' },
          freshness: { stale: false, reasons: [] },
        }
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  await panel.compileH3Draft()
  assert.deepEqual(compileCalls, [[3, 77]])
  assert.equal(panel.h3DraftText.value, '新编译提示词')
  assert.equal(panel.h3UiState.value.chip, 'ai')
})

test('flushes a pending draft edit before compiling so the new draft cannot overwrite it', async () => {
  const order = []
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, universal_segment_text: '片段' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '原始编译词' },
        freshness: { stale: false, reasons: [] },
      }),
      saveH3Draft: async (storyboardId, body) => {
        order.push(['save', body.final_text])
        return {
          draft: { id: 9, status: 'valid', manually_edited: true, final_compiled_prompt: body.final_text },
          freshness: { stale: false, reasons: [] },
        }
      },
      compileH3Draft: async () => {
        order.push(['compile'])
        return {
          draft: { id: 12, status: 'valid', manually_edited: false, final_compiled_prompt: '重新编译的提示词' },
          freshness: { stale: false, reasons: [] },
        }
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  panel.h3DraftText.value = '未保存的人工修改'
  panel.onH3DraftTextInput()
  await panel.compileH3Draft()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(order, [['save', '未保存的人工修改'], ['compile']])
  assert.equal(panel.h3DraftText.value, '重新编译的提示词')
})

test('aborts compiling when the pending draft save fails and keeps the local text', async () => {
  const compileCalls = []
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, universal_segment_text: '片段' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '数据库里的旧编译词' },
        freshness: { stale: false, reasons: [] },
      }),
      saveH3Draft: async () => { throw new Error('保存失败') },
      compileH3Draft: async () => {
        compileCalls.push('compile')
        return {
          draft: { id: 12, status: 'valid', manually_edited: false, final_compiled_prompt: '新草稿' },
          freshness: { stale: false, reasons: [] },
        }
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  panel.h3DraftText.value = '尚未保存的修改'
  panel.onH3DraftTextInput()
  await panel.compileH3Draft()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(compileCalls, [], '保存失败时不得发起编译')
  assert.equal(panel.h3DraftText.value, '尚未保存的修改', '本地未保存文本不得被新草稿覆盖')
  assert.equal(panel.error.value?.summary, '保存失败')
})

test('flushes edited draft text through PUT and marks it manually edited', async () => {
  const saves = []
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '原始编译词' },
        freshness: { stale: false, reasons: [] },
      }),
      saveH3Draft: async (storyboardId, body) => {
        saves.push([storyboardId, body])
        return {
          draft: { id: 9, status: 'valid', manually_edited: true, final_compiled_prompt: body.final_text },
          freshness: { stale: false, reasons: [] },
        }
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  panel.h3DraftText.value = '人工改过的提示词'
  panel.onH3DraftTextInput()
  panel.scheduleH3DraftSave()
  await panel.flushH3DraftSave()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(saves, [[1, { draft_id: 9, final_text: '人工改过的提示词', manually_edited: true }]])
  assert.equal(panel.h3Saving.value, false)
  assert.equal(panel.h3UiState.value.chip, 'edited')
})

test('rejects candidate generation when the pending draft save failed and keeps the save error', async () => {
  const captured = []
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, universal_segment_text: '片段' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '数据库里的旧编译词' },
        freshness: { stale: false, reasons: [] },
      }),
      saveH3Draft: async () => { throw new Error('保存失败') },
      generateCandidates: async (storyboardId, body) => {
        captured.push([storyboardId, body])
        return {}
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  panel.h3DraftText.value = '尚未保存成功的新修改'
  panel.onH3DraftTextInput()
  await panel.generateCandidates()
  await new Promise((resolve) => setImmediate(resolve))

  // 本地编辑未落库时禁止用 DB 旧终文放行候选,且保存错误不得被清除
  assert.equal(captured.length, 0)
  assert.equal(panel.error.value?.summary, '保存失败')
})

test('keeps the local draft text when the save request fails', async () => {
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '原始编译词' },
        freshness: { stale: false, reasons: [] },
      }),
      saveH3Draft: async () => { throw new Error('保存失败') },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  panel.h3DraftText.value = '尚未保存的修改'
  panel.onH3DraftTextInput()
  await panel.flushH3DraftSave()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(panel.h3DraftText.value, '尚未保存的修改')
  assert.equal(panel.error.value?.summary, '保存失败')
})

test('shows the invalid chip with backend validation errors and blocks generation', async () => {
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: {
          id: 9,
          status: 'invalid',
          manually_edited: true,
          final_compiled_prompt: '被用户改坏的结构',
          validation_errors: { code: 'H3_PROMPT_FORMAT_INVALID', message: '缺少 INTEGRATED_MULTIMODAL_DESCRIPTION', missing: ['INTEGRATED_MULTIMODAL_DESCRIPTION'], empty: [] },
        },
        freshness: { stale: false, reasons: [] },
      }),
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(panel.h3UiState.value.chip, 'invalid')
  assert.equal(panel.h3UiState.value.canGenerate, false)
  assert.ok(panel.h3ValidationLines.value.some((line) => line.includes('INTEGRATED_MULTIMODAL_DESCRIPTION')))
})

test('shows the stale chip with mapped freshness reasons', async () => {
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '编译词' },
        freshness: { stale: true, reasons: ['slots', 'params'] },
      }),
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(panel.h3UiState.value.chip, 'stale')
  assert.equal(panel.h3UiState.value.canGenerate, false)
  assert.deepEqual(panel.h3FreshnessLabels.value, ['参考图已变化', '时长/画幅/音频已变化'])
})

test('submits the H3 draft id with the compiled prompt as the candidate prompt', async () => {
  const captured = []
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, universal_segment_text: '片段' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '编译词全文' },
        freshness: { stale: false, reasons: [] },
      }),
      generateCandidates: async (storyboardId, body) => {
        captured.push([storyboardId, body])
        return {}
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  await panel.generateCandidates()
  assert.equal(captured.length, 1)
  assert.equal(captured[0][0], 1)
  assert.equal(captured[0][1].structured.prompt, '编译词全文')
  assert.equal(captured[0][1].structured.h3PromptDraftId, 9)
})

test('reloads the draft freshness when candidate generation is rejected as stale', async () => {
  let draftCalls = 0
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, universal_segment_text: '片段' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => {
        draftCalls += 1
        return draftCalls === 1
          ? {
              draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '编译词' },
              freshness: { stale: false, reasons: [] },
            }
          : {
              draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '编译词' },
              freshness: { stale: true, reasons: ['slots'] },
            }
      },
      generateCandidates: async () => {
        const error = new Error('提示词草稿的来源已变化')
        error.code = 'H3_DRAFT_STALE'
        error.details = { reasons: ['slots'] }
        throw error
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(panel.h3UiState.value.canGenerate, true)

  await panel.generateCandidates()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(draftCalls, 2)
  assert.equal(panel.h3UiState.value.chip, 'stale')
  assert.deepEqual(panel.h3FreshnessLabels.value, ['参考图已变化'])
})

test('collects universal candidate references from available reference slots', async () => {
  const captured = []
  const panel = useVideoGenerationPanel(
    reactive({
      storyboardId: 1,
      storyboard: { id: 1, universal_segment_text: '片段' },
      generationContext: { mode: 'universal_omni', prompt: '片段', referenceImageUrls: ['https://stale.example.test/old.png'] },
    }),
    () => {},
    {
      ...h3ApiStub(),
      // 非 H3 的全能多图参考(kling/volc omni)同样按槽位口径收集
      getDefaultConfig: async () => ({ id: 5, is_active: true, is_default: true, provider: 'volces', default_model: 'doubao-seedance-2-0' }),
      getReferenceSlots: async () => ({
        slots: [
          { index: 1, type: 'scene', image_available: true, image_url: 'projects/scene.png' },
          { index: 2, type: 'character_variant', image_available: false, image_url: 'projects/missing.png' },
          { index: 3, type: 'prop', image_available: true, image_url: '/static/props/prop.png' },
        ],
        total: 3,
        overflow: [],
      }),
      generateCandidates: async (storyboardId, body) => {
        captured.push(body)
        return {}
      },
    },
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  await panel.generateCandidates()
  assert.deepEqual(captured[0].structured.referenceImageUrls, ['/static/projects/scene.png', '/static/props/prop.png'])
})

test('waits for H3 reference slots and preserves Windows local paths before candidate submission', async () => {
  let resolveSlots
  const slotsPromise = new Promise((resolve) => { resolveSlots = resolve })
  const captured = []
  const panel = useVideoGenerationPanel(
    reactive({
      storyboardId: 1,
      storyboard: { id: 1, universal_segment_text: '片段' },
      generationContext: {
        mode: 'universal_omni',
        prompt: '片段',
        referenceImageUrls: ['http://127.0.0.1:3013/api/v1/external-generation/stale/content'],
      },
    }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '编译词全文' },
        freshness: { stale: false, reasons: [] },
      }),
      getReferenceSlots: async () => slotsPromise,
      generateCandidates: async (_storyboardId, body) => {
        captured.push(body)
        return {}
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  const generating = panel.generateCandidates()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(captured.length, 0, 'slot loading must finish before submission')

  resolveSlots({
    slots: [{ index: 1, type: 'scene', image_available: true, image_url: 'E:\\project\\LocalMiniDrama\\backend-node\\data\\external-web\\4\\original.png' }],
    total: 1,
    overflow: [],
  })
  await generating

  assert.deepEqual(captured[0].structured.referenceImageUrls, [
    'E:\\project\\LocalMiniDrama\\backend-node\\data\\external-web\\4\\original.png',
  ])
})

test('warns when the draft text references @图片N beyond the resolved slot count', async () => {
  const panel = useVideoGenerationPanel(
    reactive({ storyboardId: 1, storyboard: { id: 1, universal_segment_text: '片段' } }),
    () => {},
    h3ApiStub({
      getH3Draft: async () => ({
        draft: { id: 9, status: 'valid', manually_edited: false, final_compiled_prompt: '@图片1 与 @图片4 的互动' },
        freshness: { stale: false, reasons: [] },
      }),
      getReferenceSlots: async () => ({
        slots: [{ index: 1, image_available: true, image_url: 'a.png' }, { index: 2, image_available: true, image_url: 'b.png' }],
        total: 2,
        overflow: [],
      }),
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(panel.h3RefDrift.value.drift, true)
  assert.deepEqual(panel.h3RefDrift.value.outOfRange, [4])
})

test('flushes a pending draft save before switching storyboards', async () => {
  const saves = []
  const props = reactive({ storyboardId: 1, storyboard: { id: 1, video_prompt: '镜头一' } })
  const panel = useVideoGenerationPanel(
    props,
    () => {},
    h3ApiStub({
      getH3Draft: async (_storyboardId, videoConfigId) => ({
        draft: { id: 9, storyboard_id: 1, status: 'valid', manually_edited: false, final_compiled_prompt: '原始编译词' },
        freshness: { stale: false, reasons: [] },
        videoConfigId,
      }),
      saveH3Draft: async (storyboardId, body) => {
        saves.push([storyboardId, body.draft_id, body.final_text])
        return {
          draft: { id: 9, status: 'valid', manually_edited: true, final_compiled_prompt: body.final_text },
          freshness: { stale: false, reasons: [] },
        }
      },
    }),
  )
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  panel.h3DraftText.value = '切换前修改'
  panel.onH3DraftTextInput()
  props.storyboardId = 2
  props.storyboard = { id: 2, video_prompt: '镜头二' }
  await nextTick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(saves, [[1, 9, '切换前修改']])
})
