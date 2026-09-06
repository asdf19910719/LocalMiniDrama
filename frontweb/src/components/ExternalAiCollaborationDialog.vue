<template>
  <el-dialog
    v-model="visible"
    title="外部 AI 协作"
    width="min(900px, 94vw)"
    append-to-body
    destroy-on-close
  >
    <el-alert
      title="沿用同一 AI 会话时，可直接讨论剧情；只有新开会话才需要先复制上下文。剧情确认后，再生成本集制作任务。"
      type="info"
      :closable="false"
      show-icon
      class="flow-tip"
    />

    <el-form label-width="100px" class="target-form">
      <el-form-item label="目标集">
        <el-radio-group v-model="targetMode">
          <el-radio value="create">创建下一集（第{{ nextEpisodeNumber }}集）</el-radio>
          <el-radio value="fill">填充空白集</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="targetMode === 'fill'" label="空白剧集">
        <el-select
          v-model="targetEpisodeId"
          filterable
          :loading="blankEpisodesLoading"
          placeholder="选择要制作的空白剧集"
          style="width: 100%"
        >
          <el-option
            v-for="episode in blankEpisodes"
            :key="episode.id"
            :label="blankEpisodeLabel(episode)"
            :value="episode.id"
          />
        </el-select>
      </el-form-item>
    </el-form>

    <section class="flow-section">
      <div class="section-heading">
        <div>
          <h3>1. 新会话剧情上下文 <el-tag size="small" type="info">可选</el-tag></h3>
          <p>新开 AI 会话时使用，帮助它延续人物、状态、场景和前情；同一会话无需每集重复发送。</p>
        </div>
        <el-button :loading="contextLoading" :disabled="!targetReady" @click="loadContext">生成上下文</el-button>
      </div>
      <template v-if="contextData">
        <el-input v-model="contextData.markdown" type="textarea" :rows="7" readonly />
        <div class="section-actions">
          <el-button size="small" @click="copyText(contextData.markdown, '上下文已复制')">复制上下文</el-button>
          <el-button size="small" @click="downloadContext">下载 Markdown</el-button>
        </div>
      </template>
    </section>

    <section class="flow-section">
      <div class="section-heading">
        <div>
          <h3>2. 生成本集制作任务</h3>
          <p>在 AI 会话中确认本集剧情后生成。ZIP 只包含任务说明、当前资产清单和严格返回格式。</p>
        </div>
        <el-button type="primary" :loading="taskLoading" :disabled="!targetReady" @click="createTask">
          生成本集 AI 制作任务
        </el-button>
      </div>
      <template v-if="taskData">
        <el-descriptions :column="2" border size="small" class="task-meta">
          <el-descriptions-item label="目标集">第{{ taskData.target_episode_number }}集</el-descriptions-item>
          <el-descriptions-item label="任务包 ID"><code>{{ taskData.package_id }}</code></el-descriptions-item>
          <el-descriptions-item label="资产摘要" :span="2"><code>{{ taskData.assets_digest }}</code></el-descriptions-item>
        </el-descriptions>
        <el-input :model-value="taskData.instructions_markdown" type="textarea" :rows="7" readonly />
        <div class="section-actions">
          <el-button size="small" @click="copyText(taskData.instructions_markdown, '任务说明已复制')">复制任务说明</el-button>
          <el-button size="small" type="primary" :loading="downloadLoading" @click="downloadTask">下载任务 ZIP</el-button>
        </div>
      </template>
    </section>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="success" :disabled="!taskData" @click="openResultImport">导入 AI 返回 JSON</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { episodePackageAPI } from '@/api/episodePackage'
import { saveBlob, saveTextFile } from '@/utils/externalAiPackage'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  dramaId: { type: [Number, String], default: null },
  nextEpisodeNumber: { type: Number, default: 1 },
})
const emit = defineEmits(['update:modelValue', 'import-result'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const targetMode = ref('create')
const targetEpisodeId = ref(null)
const blankEpisodes = ref([])
const blankEpisodesLoading = ref(false)
const contextData = ref(null)
const contextLoading = ref(false)
const taskData = ref(null)
const taskLoading = ref(false)
const downloadLoading = ref(false)

const targetReady = computed(() => targetMode.value === 'create' || Boolean(targetEpisodeId.value))
const targetPayload = computed(() => targetMode.value === 'fill'
  ? { target_episode_id: targetEpisodeId.value }
  : { target_episode_number: props.nextEpisodeNumber })

watch(visible, (opened) => {
  if (!opened) return
  targetMode.value = 'create'
  targetEpisodeId.value = null
  contextData.value = null
  taskData.value = null
  loadBlankEpisodes()
})

watch([targetMode, targetEpisodeId], () => {
  contextData.value = null
  taskData.value = null
})

async function loadBlankEpisodes() {
  if (!props.dramaId) return
  blankEpisodesLoading.value = true
  try {
    const data = await episodePackageAPI.listBlankEpisodes(props.dramaId)
    blankEpisodes.value = Array.isArray(data) ? data : []
  } catch (error) {
    ElMessage.error(error.message || '空白剧集列表加载失败')
  } finally {
    blankEpisodesLoading.value = false
  }
}

function blankEpisodeLabel(episode) {
  return `第${episode.episode_number}集${episode.title ? `·${episode.title}` : ''}`
}

async function loadContext() {
  contextLoading.value = true
  try {
    contextData.value = await episodePackageAPI.getExternalAiContext(props.dramaId, targetPayload.value)
  } catch (error) {
    ElMessage.error(error.message || '上下文生成失败')
  } finally {
    contextLoading.value = false
  }
}

async function createTask() {
  taskLoading.value = true
  try {
    taskData.value = await episodePackageAPI.createExternalAiTask(props.dramaId, targetPayload.value)
    ElMessage.success('制作任务已生成，请下载 ZIP 发给外部 AI')
  } catch (error) {
    ElMessage.error(error.message || '制作任务生成失败')
  } finally {
    taskLoading.value = false
  }
}

async function downloadTask() {
  downloadLoading.value = true
  try {
    const blob = await episodePackageAPI.downloadExternalAiTask(taskData.value.package_id)
    saveBlob(blob, taskData.value.download_filename || 'external-ai-task.zip')
  } catch (error) {
    ElMessage.error(error.message || '任务 ZIP 下载失败')
  } finally {
    downloadLoading.value = false
  }
}

function downloadContext() {
  saveTextFile(contextData.value.markdown, contextData.value.filename, 'text/markdown;charset=utf-8')
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value || '')
    ElMessage.success(successMessage)
  } catch {
    ElMessage.error('复制失败，请手动选择文本')
  }
}

function openResultImport() {
  emit('import-result', { targetEpisodeId: taskData.value?.target_episode_id || null })
  visible.value = false
}
</script>

<style scoped>
.flow-tip { margin-bottom: 16px; }
.target-form { padding: 12px 12px 0; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.flow-section { margin-top: 16px; padding: 16px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 12px; }
.section-heading h3 { margin: 0 0 6px; font-size: 16px; }
.section-heading p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.55; }
.section-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.task-meta { margin-bottom: 10px; }
.task-meta code { font-size: 12px; word-break: break-all; }
@media (max-width: 720px) {
  .section-heading { flex-direction: column; }
}
</style>
