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
      <el-input v-model="artifactInput" placeholder="Artifact IDs, comma separated" clearable />
      <el-button type="primary" :loading="creating" :disabled="!artifactInput.trim()" @click="createGroup">
        <el-icon><Plus /></el-icon>
        Create group
      </el-button>
    </el-form>

    <div v-else class="candidate-review">
      <div class="review-meta">
        <el-tag size="small" effect="plain">{{ group.status }}</el-tag>
        <span>{{ group.candidates?.length || 0 }} candidates</span>
      </div>
      <el-input v-model="reason" placeholder="Selection reason" clearable />
      <div class="candidate-list">
        <div v-for="candidate in group.candidates" :key="candidate.id" class="candidate-row">
          <div class="candidate-copy">
            <strong>{{ candidate.artifact_id }}</strong>
            <span>{{ candidate.status }}</span>
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

const props = defineProps({
  shotId: { type: [String, Number], required: true },
})

const group = ref(null)
const artifactInput = ref('')
const reason = ref('')
const loading = ref(false)
const creating = ref(false)
const error = ref('')

async function refresh() {
  if (!group.value?.id) return
  loading.value = true
  error.value = ''
  try {
    group.value = await directorAPI.getCandidateGroup(group.value.id)
  } catch (err) {
    error.value = err?.message || 'Unable to load candidates'
  } finally {
    loading.value = false
  }
}

async function createGroup() {
  const candidates = artifactInput.value.split(',').map((artifactId) => artifactId.trim()).filter(Boolean).map((artifactId) => ({ artifact_id: artifactId }))
  if (!candidates.length) return
  creating.value = true
  error.value = ''
  try {
    group.value = await directorAPI.createCandidateGroup(props.shotId, candidates)
  } catch (err) {
    error.value = err?.message || 'Unable to create candidate group'
  } finally {
    creating.value = false
  }
}

async function select(candidateId) {
  const previous = group.value
  error.value = ''
  try {
    group.value = await directorAPI.selectCandidate(previous.id, candidateId, reason.value)
  } catch (err) {
    group.value = previous
    error.value = err?.message || 'Unable to select candidate'
  }
}

watch(() => props.shotId, () => {
  group.value = null
  artifactInput.value = ''
  reason.value = ''
  error.value = ''
})
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
.candidate-copy { min-width: 0; display: grid; gap: 3px; }
.candidate-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.candidate-copy span, .review-meta { color: var(--text-subtle, #71717a); font-size: 11px; }
@media (max-width: 900px) { .director-shot-panel { width: auto; flex: 0 0 240px; } }
</style>
