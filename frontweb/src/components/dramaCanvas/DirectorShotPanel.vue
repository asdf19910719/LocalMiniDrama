<template>
  <aside class="director-shot-panel" aria-label="Director candidate review">
    <div class="panel-header">
      <div>
        <div class="panel-kicker">AI DIRECTOR</div>
        <h2>Shot {{ shotId }}</h2>
        <small v-if="queueStatus.queueLength || queueStatus.activeJobId" class="queue-status">
          GPU {{ queueStatus.activeJobId ? 'busy' : 'ready' }} · {{ queueStatus.queueLength }} queued
        </small>
      </div>
      <el-button circle text :loading="loading" title="Refresh candidates" @click="refresh">
        <el-icon><Refresh /></el-icon>
      </el-button>
    </div>

    <el-form v-if="!group" class="candidate-create" @submit.prevent="createGroup">
      <el-switch v-model="structuredMode" active-text="Creator mode" inactive-text="Advanced JSON" />
      <template v-if="structuredMode">
        <el-tag v-if="sourceAnchor" size="small" type="success" closable @close="$emit('anchor-created', null)">
          {{ sourceAnchor.reference_role }} anchor · frame {{ sourceAnchor.frame_number }}
        </el-tag>
        <el-input v-model="promptText" type="textarea" :rows="4" placeholder="Describe the shot action, camera, look, and sound" />
        <div class="form-grid">
          <el-select v-model="continuityMode" aria-label="Continuity mode">
            <el-option label="Motion overlap" value="motion_overlap" />
            <el-option label="State anchor (experimental)" value="state_anchor" />
            <el-option label="Composition only (experimental)" value="composition_only" />
            <el-option label="No continuity" value="none" />
          </el-select>
          <el-input-number v-model="candidateCount" :min="1" :max="3" controls-position="right" aria-label="Candidate count" />
          <el-input-number v-model="seed" :min="0" :controls="false" aria-label="Seed" />
          <el-input-number v-model="durationSeconds" :min="1" :max="10" :step="0.5" controls-position="right" aria-label="Duration seconds" />
        </div>
        <div class="form-grid">
          <el-select v-model="qualityPreset" aria-label="Quality preset">
            <el-option label="Preview 864x480" value="preview" />
            <el-option label="Production 1280x720" value="production" />
            <el-option label="Master 1920x1080" value="master" />
          </el-select>
          <el-input v-model="negativePrompt" placeholder="Negative prompt (optional)" clearable />
        </div>
      </template>
      <el-collapse v-else>
        <el-collapse-item title="Advanced workflow settings" name="advanced">
          <el-input v-model="workflowId" placeholder="Workflow ID" clearable />
          <el-input-number v-model="candidateCount" :min="1" :max="3" controls-position="right" aria-label="Candidate count" />
          <el-input v-model="promptJsonText" type="textarea" :rows="6" placeholder="ComfyUI prompt JSON" />
          <el-input v-model="inputsText" type="textarea" :rows="3" placeholder="Inputs JSON (optional)" />
        </el-collapse-item>
      </el-collapse>
      <el-button type="primary" :loading="creating" @click="createGroup">
        <el-icon><Plus /></el-icon>
        Generate candidates
      </el-button>
    </el-form>

    <div v-else class="candidate-review">
      <div class="review-meta">
        <el-tag size="small" effect="plain">{{ group.status }}</el-tag>
        <span>{{ group.candidates?.length || 0 }} candidates</span>
        <el-button circle text title="Generate a new candidate group" @click="beginNewGroup">
          <el-icon><Plus /></el-icon>
        </el-button>
      </div>
      <el-select v-if="groupHistory.length > 1" v-model="activeGroupId" size="small" aria-label="Candidate group history">
        <el-option v-for="item in groupHistory" :key="item.id" :label="`${item.status} · ${item.id.slice(0, 8)}`" :value="item.id" />
      </el-select>
      <el-input v-model="reason" placeholder="Selection reason" clearable />
      <div class="candidate-list">
        <div v-for="candidate in group.candidates" :key="candidate.id" class="candidate-row">
          <video
            v-if="candidate.artifact?.preview_url"
            class="candidate-preview"
            :src="candidate.artifact.preview_url"
            controls
            preload="metadata"
            @timeupdate="captureVideoTime"
          />
          <div class="candidate-copy">
            <strong>{{ candidate.artifact_id }}</strong>
            <span>{{ candidate.job_status || candidate.status }}</span>
            <small v-if="candidate.job_error_message" class="candidate-error">{{ candidate.job_error_message }}</small>
            <small v-if="candidate.artifact?.media">
              {{ formatArtifactMedia(candidate.artifact) }}
            </small>
            <small v-if="qualityReviews[candidate.artifact_id]" :class="`quality-${qualityReviews[candidate.artifact_id].status}`">
              QC {{ qualityReviews[candidate.artifact_id].status }} · {{ qualityReviews[candidate.artifact_id].issues.length }} issues
            </small>
          </div>
          <div class="candidate-actions">
            <el-button v-if="['pending', 'running'].includes(candidate.job_status)" circle text title="Cancel generation" @click="cancelJob(candidate.job_id)">
              <el-icon><Close /></el-icon>
            </el-button>
            <el-button v-if="candidate.job_status === 'failed' || candidate.status === 'failed'" circle text title="Retry generation" @click="retryJob(candidate.job_id)">
              <el-icon><Refresh /></el-icon>
            </el-button>
            <el-button v-if="candidate.artifact?.status === 'ready'" circle text title="Run quality checks" :loading="analyzingArtifactId === candidate.artifact_id" @click="runQuality(candidate.artifact_id)">
              <el-icon><DataAnalysis /></el-icon>
            </el-button>
            <el-button circle text title="Select candidate" :disabled="candidate.status !== 'review' || group.status !== 'review'" @click="select(candidate.id)">
              <el-icon><Check /></el-icon>
            </el-button>
          </div>
        </div>
      </div>
      <el-collapse v-if="group.status === 'selected' && group.selected_artifact_id">
        <el-collapse-item title="Continuity anchor" name="anchor">
          <div class="anchor-form">
            <el-slider v-model="anchorTime" :min="0" :max="selectedDuration" :step="0.04" show-input />
            <div class="form-grid">
              <el-select v-model="anchorRole" aria-label="Anchor role">
                <el-option label="State" value="state" />
                <el-option label="Composition" value="composition" />
                <el-option label="Identity" value="identity" />
                <el-option label="Motion" value="motion" />
              </el-select>
              <el-select v-model="anchorOperation" aria-label="Anchor operation">
                <el-option label="Extract frame" value="extract_frame" />
                <el-option label="Upscale 2x" value="upscale_2x" />
                <el-option label="Line art" value="line_art" />
              </el-select>
            </div>
            <el-button :loading="creatingAnchor" @click="createAnchor">Create anchor</el-button>
            <div v-for="anchor in anchors" :key="anchor.id" class="anchor-row">
              <img v-if="anchor.preview_url" :src="anchor.preview_url" alt="Continuity anchor preview" />
              <div><strong>{{ anchor.reference_role }}</strong><small>Frame {{ anchor.frame_number }}</small></div>
              <el-button circle text title="Use for next shot" @click="useAnchor(anchor)"><el-icon><Link /></el-icon></el-button>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
      <el-alert v-if="error" type="error" :closable="false" :title="error" />
    </div>
  </aside>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { Check, Close, DataAnalysis, Link, Plus, Refresh } from '@element-plus/icons-vue'
import { directorAPI } from '@/api/director'
import { buildDirectorGenerationRequest, buildStructuredDirectorGenerationRequest, createDirectorStateGuard, formatArtifactMedia, isSameDirectorShot, normalizeDirectorShotState } from '@/utils/directorPersistence'

const props = defineProps({
  shotId: { type: [String, Number], required: true },
  storyboard: { type: Object, default: null },
  sourceAnchor: { type: Object, default: null },
})
const emit = defineEmits(['anchor-created'])

const group = ref(null)
const groupHistory = ref([])
const activeGroupId = ref('')
const workflowId = ref('h3-continuity-v1')
const candidateCount = ref(2)
const structuredMode = ref(true)
const promptText = ref('')
const promptJsonText = ref('{}')
const inputsText = ref('{}')
const continuityMode = ref('motion_overlap')
const seed = ref(42)
const durationSeconds = ref(5)
const qualityPreset = ref('preview')
const negativePrompt = ref('')
const reason = ref('')
const loading = ref(false)
const creating = ref(false)
const error = ref('')
const anchorTime = ref(0)
const selectedDuration = ref(5)
const selectedFps = ref(24)
const anchorRole = ref('state')
const anchorOperation = ref('extract_frame')
const anchors = ref([])
const creatingAnchor = ref(false)
const qualityReviews = ref({})
const analyzingArtifactId = ref('')
const queueStatus = ref({ activeJobId: null, queueLength: 0 })
const stateGuard = createDirectorStateGuard()
let pollTimer = null

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

function startPolling() {
  stopPolling()
  if (!group.value || !['pending', 'running'].includes(group.value.status)) return
  pollTimer = setInterval(() => refresh(), 2000)
}

function beginNewGroup() {
  stopPolling()
  group.value = null
  activeGroupId.value = ''
  error.value = ''
}

async function refresh() {
  const requestId = stateGuard.beginRefresh()
  loading.value = true
  error.value = ''
  try {
    queueStatus.value = await directorAPI.getQueue()
    const state = normalizeDirectorShotState(await directorAPI.getShotCandidates(props.shotId))
    if (!stateGuard.isCurrentRefresh(requestId)) return
    groupHistory.value = state.groups
    group.value = state.latest
    activeGroupId.value = state.latest?.id || ''
    if (['pending', 'running'].includes(group.value?.status)) startPolling()
    else stopPolling()
    if (group.value?.status === 'selected') await loadAnchors()
    else anchors.value = []
  } catch (err) {
    if (stateGuard.isCurrentRefresh(requestId)) error.value = err?.message || 'Unable to load candidates'
  } finally {
    if (stateGuard.isCurrentRefresh(requestId)) loading.value = false
  }
}

async function createGroup() {
  creating.value = true
  error.value = ''
  const requestShotId = props.shotId
  const requestId = stateGuard.beginWrite()
  loading.value = false
  try {
    const payload = structuredMode.value
      ? buildStructuredDirectorGenerationRequest({
        workflowId: workflowId.value,
        candidateCount: candidateCount.value,
        promptText: promptText.value,
        continuityMode: continuityMode.value,
        seed: seed.value,
        durationSeconds: durationSeconds.value,
        negativePrompt: negativePrompt.value,
        sourceArtifactId: props.sourceAnchor?.sourceArtifactId || '',
        anchorId: props.sourceAnchor?.id || '',
        ...(qualityPreset.value === 'master'
          ? { width: 1920, height: 1080 }
          : qualityPreset.value === 'production'
            ? { width: 1280, height: 720 }
            : { width: 864, height: 480 }),
      })
      : buildDirectorGenerationRequest({
        workflowId: workflowId.value,
        candidateCount: candidateCount.value,
        promptText: promptJsonText.value,
        inputsText: inputsText.value,
      })
    const generated = await directorAPI.generateCandidates(requestShotId, payload)
    if (!stateGuard.isCurrentWrite(requestId) || !isSameDirectorShot(props.shotId, requestShotId)) return
    if (!stateGuard.commitWrite(requestId)) return
    loading.value = false
    group.value = generated.group
    groupHistory.value = normalizeDirectorShotState({ groups: groupHistory.value }, generated.group).groups
    activeGroupId.value = generated.group.id
    startPolling()
    refresh()
  } catch (err) {
    if (stateGuard.isCurrentWrite(requestId) && isSameDirectorShot(props.shotId, requestShotId)) {
      error.value = err?.message || 'Unable to create candidate group'
    }
  } finally {
    if (stateGuard.isCurrentWrite(requestId)) creating.value = false
  }
}

async function cancelJob(jobId) {
  if (!jobId) return
  try {
    await directorAPI.cancelJob(jobId)
    await refresh()
  } catch (err) {
    error.value = err?.message || 'Unable to cancel generation'
  }
}

async function retryJob(jobId) {
  if (!jobId) return
  try {
    await directorAPI.retryJob(jobId)
    await refresh()
    startPolling()
  } catch (err) {
    error.value = err?.message || 'Unable to retry generation'
  }
}

async function runQuality(artifactId) {
  analyzingArtifactId.value = artifactId
  error.value = ''
  try {
    qualityReviews.value = { ...qualityReviews.value, [artifactId]: await directorAPI.analyzeArtifact(artifactId) }
  } catch (err) {
    error.value = err?.message || 'Unable to analyze artifact quality'
  } finally {
    analyzingArtifactId.value = ''
  }
}

async function select(candidateId) {
  const previous = group.value
  const requestShotId = props.shotId
  const requestId = stateGuard.beginWrite()
  loading.value = false
  error.value = ''
  try {
    const selected = await directorAPI.selectCandidate(previous.id, candidateId, reason.value)
    if (!stateGuard.isCurrentWrite(requestId) || !isSameDirectorShot(props.shotId, requestShotId)) return
    if (!stateGuard.commitWrite(requestId)) return
    loading.value = false
    group.value = selected
    groupHistory.value = normalizeDirectorShotState({ groups: groupHistory.value }, selected).groups
    await loadAnchors()
  } catch (err) {
    if (stateGuard.isCurrentWrite(requestId) && isSameDirectorShot(props.shotId, requestShotId)) {
      group.value = previous
      error.value = err?.message || 'Unable to select candidate'
    }
  }
}

function captureVideoTime(event) {
  anchorTime.value = Number(event?.target?.currentTime || 0)
  selectedDuration.value = Number(event?.target?.duration || selectedDuration.value || 5)
  const selected = group.value?.candidates?.find((candidate) => candidate.artifact_id === group.value.selected_artifact_id)
  const frameRate = selected?.artifact?.media?.frame_rate || selected?.artifact?.media?.fps
  if (frameRate) {
    const [numerator, denominator] = String(frameRate).split('/').map(Number)
    selectedFps.value = denominator ? numerator / denominator : Number(frameRate) || 24
  }
}

async function loadAnchors() {
  if (!group.value?.selected_artifact_id) {
    anchors.value = []
    return
  }
  anchors.value = await directorAPI.listAnchors(group.value.selected_artifact_id)
}

async function createAnchor() {
  creatingAnchor.value = true
  error.value = ''
  try {
    const anchor = await directorAPI.createAnchor({
      artifactId: group.value.selected_artifact_id,
      frameNumber: Math.max(0, Math.round(anchorTime.value * selectedFps.value)),
      referenceRole: anchorRole.value,
      referenceUse: anchorRole.value === 'composition' ? 'composition_only' : 'state_anchor',
      operation: anchorOperation.value,
    })
    await loadAnchors()
    useAnchor(anchor)
  } catch (err) {
    error.value = err?.message || 'Unable to create continuity anchor'
  } finally {
    creatingAnchor.value = false
  }
}

function useAnchor(anchor) {
  emit('anchor-created', { ...anchor, sourceArtifactId: group.value?.selected_artifact_id })
}

watch(activeGroupId, async (groupId) => {
  if (!groupId || groupId === group.value?.id) return
  const historical = groupHistory.value.find((item) => item.id === groupId)
  if (historical) group.value = historical
})

watch(() => props.shotId, () => {
  stateGuard.invalidateAll()
  stopPolling()
  loading.value = false
  creating.value = false
  group.value = null
  groupHistory.value = []
  activeGroupId.value = ''
  workflowId.value = 'h3-continuity-v1'
  candidateCount.value = 2
  promptText.value = ''
  promptJsonText.value = '{}'
  inputsText.value = '{}'
  structuredMode.value = true
  continuityMode.value = 'motion_overlap'
  seed.value = 42
  durationSeconds.value = 5
  qualityPreset.value = 'preview'
  negativePrompt.value = ''
  anchorTime.value = 0
  anchors.value = []
  qualityReviews.value = {}
  reason.value = ''
  error.value = ''
  refresh()
}, { immediate: true })

watch(() => props.storyboard, (storyboard) => {
  if (!promptText.value && storyboard) {
    promptText.value = storyboard.universal_segment_text || storyboard.video_prompt || storyboard.description || storyboard.title || ''
  }
}, { immediate: true })

watch(() => props.sourceAnchor, (anchor) => {
  if (!anchor) return
  continuityMode.value = anchor.reference_role === 'composition' ? 'composition_only' : 'state_anchor'
}, { immediate: true })

onBeforeUnmount(stopPolling)
</script>

<style scoped>
.director-shot-panel {
  width: 280px;
  flex: 0 0 280px;
  padding: 14px;
  border-left: 1px solid var(--border-color, #27272a);
  background: var(--bg-card, #18181b);
  overflow-y: auto;
}
.panel-header, .review-meta, .candidate-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.panel-kicker { font-size: 10px; color: #818cf8; letter-spacing: .08em; }
.queue-status { color: var(--text-subtle, #71717a); font-size: 10px; }
h2 { margin: 3px 0 14px; font-size: 15px; }
.candidate-create, .candidate-review { display: grid; gap: 10px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.form-grid :deep(.el-input-number), .form-grid :deep(.el-select) { width: 100%; }
.candidate-list { display: grid; gap: 6px; }
.candidate-row { min-height: 42px; padding: 7px 8px; border: 1px solid var(--border-color, #27272a); border-radius: 6px; }
.candidate-copy { min-width: 0; display: grid; gap: 3px; flex: 1; }
.candidate-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.candidate-copy span, .candidate-copy small, .review-meta { color: var(--text-subtle, #71717a); font-size: 11px; }
.candidate-error { color: #f87171 !important; }
.quality-failed { color: #f87171 !important; }
.quality-warning { color: #fbbf24 !important; }
.quality-passed { color: #34d399 !important; }
.candidate-actions { display: flex; gap: 2px; }
.anchor-form { display: grid; gap: 8px; padding-top: 6px; }
.anchor-row { display: grid; grid-template-columns: 64px 1fr 32px; align-items: center; gap: 7px; }
.anchor-row img { width: 64px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; }
.anchor-row div { display: grid; gap: 2px; font-size: 11px; }
.anchor-row small { color: var(--text-subtle, #71717a); }
.candidate-preview { width: 72px; aspect-ratio: 16 / 9; object-fit: cover; background: #09090b; border-radius: 4px; flex: 0 0 72px; }
@media (max-width: 900px) { .director-shot-panel { width: auto; flex: 0 0 240px; } }
</style>
