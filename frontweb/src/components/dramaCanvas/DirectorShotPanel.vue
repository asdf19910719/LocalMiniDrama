<template>
  <aside class="director-shot-panel" aria-label="Director candidate review">
    <div class="panel-header">
      <div>
        <div class="panel-kicker">AI DIRECTOR</div>
        <h2>Shot {{ shotId }}</h2>
      </div>
      <el-button circle text :loading="loading" title="Refresh candidates" @click="refresh">
        <el-icon><Refresh /></el-icon>
      </el-button>
    </div>

    <el-form v-if="!group" class="candidate-create" @submit.prevent="createGroup">
      <el-input v-model="workflowId" placeholder="Workflow ID" clearable />
      <el-input-number v-model="candidateCount" :min="1" :max="3" controls-position="right" aria-label="Candidate count" />
      <el-input v-model="promptText" type="textarea" :rows="4" placeholder="Prompt JSON" />
      <el-input v-model="inputsText" type="textarea" :rows="3" placeholder="Inputs JSON (optional)" />
      <el-button type="primary" :loading="creating" @click="createGroup">
        <el-icon><Plus /></el-icon>
        Generate candidates
      </el-button>
    </el-form>

    <div v-else class="candidate-review">
      <div class="review-meta">
        <el-tag size="small" effect="plain">{{ group.status }}</el-tag>
        <span>{{ group.candidates?.length || 0 }} candidates</span>
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
          />
          <div class="candidate-copy">
            <strong>{{ candidate.artifact_id }}</strong>
            <span>{{ candidate.status }}</span>
            <small v-if="candidate.artifact?.media">
              {{ formatArtifactMedia(candidate.artifact) }}
            </small>
          </div>
          <el-button
            circle
            text
            title="Select candidate"
            :disabled="candidate.status !== 'review' || group.status !== 'review'"
            @click="select(candidate.id)"
          >
            <el-icon><Check /></el-icon>
          </el-button>
        </div>
      </div>
      <el-alert v-if="error" type="error" :closable="false" :title="error" />
    </div>
  </aside>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Check, Plus, Refresh } from '@element-plus/icons-vue'
import { directorAPI } from '@/api/director'
import { buildDirectorGenerationRequest, createDirectorStateGuard, formatArtifactMedia, isSameDirectorShot, normalizeDirectorShotState } from '@/utils/directorPersistence'

const props = defineProps({
  shotId: { type: [String, Number], required: true },
})

const group = ref(null)
const groupHistory = ref([])
const activeGroupId = ref('')
const workflowId = ref('h3-continuity-v1')
const candidateCount = ref(2)
const promptText = ref('{}')
const inputsText = ref('{}')
const reason = ref('')
const loading = ref(false)
const creating = ref(false)
const error = ref('')
const stateGuard = createDirectorStateGuard()

async function refresh() {
  const requestId = stateGuard.beginRefresh()
  loading.value = true
  error.value = ''
  try {
    const state = normalizeDirectorShotState(await directorAPI.getShotCandidates(props.shotId))
    if (!stateGuard.isCurrentRefresh(requestId)) return
    groupHistory.value = state.groups
    group.value = state.latest
    activeGroupId.value = state.latest?.id || ''
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
    const payload = buildDirectorGenerationRequest({
      workflowId: workflowId.value,
      candidateCount: candidateCount.value,
      promptText: promptText.value,
      inputsText: inputsText.value,
    })
    const generated = await directorAPI.generateCandidates(requestShotId, payload)
    if (!stateGuard.isCurrentWrite(requestId) || !isSameDirectorShot(props.shotId, requestShotId)) return
    if (!stateGuard.commitWrite(requestId)) return
    loading.value = false
    group.value = generated.group
    groupHistory.value = normalizeDirectorShotState({ groups: groupHistory.value }, generated.group).groups
    activeGroupId.value = generated.group.id
    refresh()
  } catch (err) {
    if (stateGuard.isCurrentWrite(requestId) && isSameDirectorShot(props.shotId, requestShotId)) {
      error.value = err?.message || 'Unable to create candidate group'
    }
  } finally {
    if (stateGuard.isCurrentWrite(requestId)) creating.value = false
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
  } catch (err) {
    if (stateGuard.isCurrentWrite(requestId) && isSameDirectorShot(props.shotId, requestShotId)) {
      group.value = previous
      error.value = err?.message || 'Unable to select candidate'
    }
  }
}

watch(activeGroupId, async (groupId) => {
  if (!groupId || groupId === group.value?.id) return
  const historical = groupHistory.value.find((item) => item.id === groupId)
  if (historical) group.value = historical
})

watch(() => props.shotId, () => {
  stateGuard.invalidateAll()
  loading.value = false
  creating.value = false
  group.value = null
  groupHistory.value = []
  activeGroupId.value = ''
  workflowId.value = 'h3-continuity-v1'
  candidateCount.value = 2
  promptText.value = '{}'
  inputsText.value = '{}'
  reason.value = ''
  error.value = ''
  refresh()
}, { immediate: true })
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
h2 { margin: 3px 0 14px; font-size: 15px; }
.candidate-create, .candidate-review { display: grid; gap: 10px; }
.candidate-list { display: grid; gap: 6px; }
.candidate-row { min-height: 42px; padding: 7px 8px; border: 1px solid var(--border-color, #27272a); border-radius: 6px; }
.candidate-copy { min-width: 0; display: grid; gap: 3px; flex: 1; }
.candidate-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.candidate-copy span, .candidate-copy small, .review-meta { color: var(--text-subtle, #71717a); font-size: 11px; }
.candidate-preview { width: 72px; aspect-ratio: 16 / 9; object-fit: cover; background: #09090b; border-radius: 4px; flex: 0 0 72px; }
@media (max-width: 900px) { .director-shot-panel { width: auto; flex: 0 0 240px; } }
</style>
