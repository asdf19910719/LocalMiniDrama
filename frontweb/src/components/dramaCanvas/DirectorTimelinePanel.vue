<template>
  <aside class="director-timeline-panel" aria-label="Director timeline editor">
    <div class="panel-header">
      <div>
        <div class="panel-kicker">TIMELINE V1</div>
        <h2>Assemble selected shots</h2>
      </div>
      <el-button circle text :loading="loading" title="Reload selected shots" @click="load">
        <el-icon><Refresh /></el-icon>
      </el-button>
    </div>

    <el-alert v-if="error" type="error" :closable="false" :title="error" />
    <el-empty v-if="!loading && !clips.length" description="Select at least one shot candidate first" />

    <div v-else class="timeline-editor">
      <div v-for="(clip, index) in clips" :key="clip.artifactId" class="timeline-clip">
        <div class="clip-heading">
          <strong>{{ index + 1 }}. {{ clip.title }}</strong>
          <span>{{ clip.artifactId.slice(0, 8) }}</span>
        </div>
        <div class="clip-controls">
          <el-button circle text title="Move up" :disabled="index === 0" @click="move(index, -1)"><el-icon><ArrowUp /></el-icon></el-button>
          <el-button circle text title="Move down" :disabled="index === clips.length - 1" @click="move(index, 1)"><el-icon><ArrowDown /></el-icon></el-button>
          <el-select v-model="clip.transition.type" size="small" aria-label="Transition" @change="onTransitionChange(clip)">
            <el-option label="Cut" value="cut" />
            <el-option label="Fade" value="fade" />
            <el-option label="Dissolve" value="dissolve" />
          </el-select>
        </div>
        <div class="clip-grid">
          <label>Source offset <el-input-number v-model="clip.sourceOffset" :min="0" :max="Math.max(0, clip.sourceDuration - 0.1)" :step="0.1" controls-position="right" @change="normalize" /></label>
          <label>Duration <el-input-number v-model="clip.duration" :min="0.1" :max="clip.sourceDuration" :step="0.1" controls-position="right" @change="normalize" /></label>
          <label v-if="clip.transition.type !== 'cut'">Transition <el-input-number v-model="clip.transition.duration" :min="0.1" :max="Math.max(0.1, clip.duration)" :step="0.1" controls-position="right" @change="normalize" /></label>
        </div>
      </div>

      <el-select v-model="qualityPreset" aria-label="Timeline output quality">
        <el-option label="Preview 864x480" value="preview" />
        <el-option label="Production 1280x720" value="production" />
        <el-option label="Master 1920x1080" value="master" />
      </el-select>
      <el-collapse>
        <el-collapse-item title="Postproduction" name="postproduction">
          <el-switch v-model="post.enabled" active-text="Apply postproduction" />
          <div v-if="post.enabled" class="post-form">
            <el-input v-model="post.subtitlePath" placeholder="Subtitle file (.srt)" clearable />
            <el-input v-model="post.ttsPath" placeholder="TTS/dialogue audio file" clearable />
            <el-input v-model="post.musicPath" placeholder="Music file" clearable />
            <label>Brightness <el-slider v-model="post.brightness" :min="-0.2" :max="0.2" :step="0.01" /></label>
            <label>Contrast <el-slider v-model="post.contrast" :min="0.5" :max="1.5" :step="0.01" /></label>
            <label>Saturation <el-slider v-model="post.saturation" :min="0.5" :max="1.5" :step="0.01" /></label>
          </div>
        </el-collapse-item>
      </el-collapse>
      <div class="timeline-total">Total {{ totalDuration.toFixed(1) }}s · {{ clips.length }} clips</div>
      <el-button type="primary" :loading="exporting" :disabled="!clips.length" @click="exportTimeline">
        <el-icon><VideoCamera /></el-icon>
        Export timeline
      </el-button>
      <el-alert v-if="exportResult" type="success" :closable="false" :title="exportResult" />
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Refresh, VideoCamera } from '@element-plus/icons-vue'
import { directorAPI } from '@/api/director'
import { buildDirectorPostproductionRequest } from '@/utils/directorPersistence'

const props = defineProps({
  storyboards: { type: Array, default: () => [] },
})

const clips = ref([])
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const exportResult = ref('')
const qualityPreset = ref('preview')
const post = ref({ enabled: false, subtitlePath: '', ttsPath: '', musicPath: '', brightness: 0, contrast: 1, saturation: 1 })
let loadGeneration = 0

const totalDuration = computed(() => clips.value.reduce((sum, clip, index) => {
  const overlap = index < clips.value.length - 1 && clip.transition?.type !== 'cut'
    ? Number(clip.transition?.duration || 0)
    : 0
  return sum + Number(clip.duration || 0) - overlap
}, 0))
const dimensions = computed(() => qualityPreset.value === 'master'
  ? { width: 1920, height: 1080 }
  : qualityPreset.value === 'production'
    ? { width: 1280, height: 720 }
    : { width: 864, height: 480 })

function normalize() {
  let start = 0
  clips.value.forEach((clip) => {
    clip.sourceDuration = Math.max(0.1, Number(clip.sourceDuration || clip.duration || 5))
    clip.sourceOffset = Math.max(0, Math.min(Number(clip.sourceOffset || 0), clip.sourceDuration - 0.1))
    clip.duration = Math.max(0.1, Math.min(Number(clip.duration || clip.sourceDuration), clip.sourceDuration - clip.sourceOffset))
    clip.startTime = Number(start.toFixed(3))
    clip.transition = clip.transition || { type: 'cut', duration: 0 }
    if (clip.transition.type === 'cut') clip.transition.duration = 0
    else clip.transition.duration = Math.max(0.1, Math.min(Number(clip.transition.duration || 0.5), clip.duration))
    start += clip.duration
  })
}

function onTransitionChange(clip) {
  clip.transition.duration = clip.transition.type === 'cut' ? 0 : Number(clip.transition.duration || 0.5)
  normalize()
}

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  error.value = ''
  exportResult.value = ''
  try {
    const loaded = []
    for (const storyboard of props.storyboards) {
      const state = await directorAPI.getShotCandidates(storyboard.id)
      const group = state?.latest
      if (!group || group.status !== 'selected' || !group.selected_artifact_id) continue
      const candidate = (group.candidates || []).find((item) => item.artifact_id === group.selected_artifact_id)
      const media = candidate?.artifact?.media || {}
      const sourceDuration = Number(media.duration || storyboard.duration || 5)
      loaded.push({
        artifactId: group.selected_artifact_id,
        title: storyboard.title || `Shot ${storyboard.storyboard_number || storyboard.id}`,
        sourceDuration,
        sourceOffset: 0,
        duration: sourceDuration,
        startTime: 0,
        transition: { type: 'cut', duration: 0 },
      })
    }
    if (generation !== loadGeneration) return
    clips.value = loaded
    normalize()
  } catch (err) {
    error.value = err?.message || 'Unable to load selected shots'
  } finally {
    loading.value = false
  }
}

function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= clips.value.length) return
  const next = [...clips.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  clips.value = next
  normalize()
}

async function exportTimeline() {
  exporting.value = true
  error.value = ''
  exportResult.value = ''
  try {
    normalize()
    const timeline = await directorAPI.createTimeline({
      version: 'timeline_v1',
      output: { ...dimensions.value, fps: 24, pixelFormat: 'yuv420p' },
      clips: clips.value.map(({ artifactId, startTime, duration, sourceOffset, sourceDuration, transition }) => ({ artifactId, startTime, duration, sourceOffset, sourceDuration, transition })),
      audioSources: [],
      audioPolicy: 'mix',
      postproduction: buildDirectorPostproductionRequest({ ...post.value, ...dimensions.value, fps: 24 }),
    })
    const rendered = await directorAPI.renderTimeline(timeline.id)
    exportResult.value = `Timeline ${rendered?.status || 'accepted'}: ${timeline.id.slice(0, 8)}`
  } catch (err) {
    error.value = err?.message || 'Timeline export failed'
  } finally {
    exporting.value = false
  }
}

watch(() => props.storyboards, load, { deep: true })
onMounted(load)
</script>

<style scoped>
.director-timeline-panel { width: 320px; flex: 0 0 320px; padding: 14px; border-left: 1px solid var(--border-color, #27272a); background: var(--bg-card, #18181b); overflow-y: auto; }
.panel-header, .clip-heading, .clip-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.panel-kicker { font-size: 10px; color: #34d399; letter-spacing: .08em; }
h2 { margin: 3px 0 14px; font-size: 15px; }
.timeline-editor { display: grid; gap: 10px; }
.timeline-clip { display: grid; gap: 7px; padding: 9px; border: 1px solid var(--border-color, #27272a); border-radius: 6px; }
.clip-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.clip-heading span, .timeline-total { color: var(--text-subtle, #71717a); font-size: 11px; }
.clip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.clip-grid label { display: grid; gap: 3px; color: var(--text-subtle, #a1a1aa); font-size: 10px; }
.clip-grid :deep(.el-input-number), .clip-controls :deep(.el-select) { width: 100%; }
.clip-controls :deep(.el-select) { flex: 1; }
.post-form { display: grid; gap: 8px; padding-top: 8px; }
.post-form label { display: grid; gap: 2px; color: var(--text-subtle, #a1a1aa); font-size: 10px; }
@media (max-width: 900px) {
  .director-timeline-panel {
    position: fixed;
    z-index: 20;
    top: 128px;
    right: 0;
    bottom: 0;
    width: min(320px, 100vw);
    max-width: 100vw;
    flex: none;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.22);
  }
}
</style>
