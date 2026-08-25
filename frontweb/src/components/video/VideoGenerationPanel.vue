<template>
  <aside
    :class="['video-generation-panel', `video-generation-panel--${displayMode}`]"
    aria-label="视频生成面板"
  >
    <header class="panel-header">
      <div>
        <div class="panel-kicker">统一视频生成</div>
        <h2>分镜 {{ storyboardLabel }}</h2>
      </div>
      <div class="header-actions">
        <el-button circle text :loading="loading" title="刷新" aria-label="刷新" @click="refresh">
          <el-icon><Refresh /></el-icon>
        </el-button>
        <el-button circle text title="关闭" aria-label="关闭" @click="close">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </header>

    <section class="service-card" aria-label="默认视频服务状态">
      <div class="service-status-row">
        <strong>当前默认服务</strong>
        <el-tag :type="defaultConfig ? 'success' : 'danger'" size="small" effect="plain">
          {{ configLoading ? '读取中' : configStatus }}
        </el-tag>
      </div>
      <template v-if="defaultConfig">
        <span>{{ providerName }}</span>
        <small>模型或工作流：{{ modelName }}</small>
      </template>
      <small v-else>生成时始终由后端读取唯一默认配置，此处不可切换服务。</small>
    </section>

    <el-form class="generation-form" label-position="top" @submit.prevent="generateCandidates">
      <el-form-item label="视频提示词" required>
        <el-input
          v-model="form.prompt"
          type="textarea"
          :rows="displayMode === 'sidebar' ? 5 : 4"
          placeholder="描述动作、运镜、画面风格与声音"
        />
      </el-form-item>
      <el-form-item label="负面提示词">
        <el-input v-model="form.negativePrompt" clearable placeholder="可选：不希望出现的内容" />
      </el-form-item>

      <div class="number-grid">
        <el-form-item label="宽度">
          <el-input-number v-model="form.width" :min="32" :step="32" :controls="true" controls-position="right" />
        </el-form-item>
        <el-form-item label="高度">
          <el-input-number v-model="form.height" :min="32" :step="32" :controls="true" controls-position="right" />
        </el-form-item>
        <el-form-item label="时长（秒）">
          <el-input-number v-model="form.duration" :min="1" :max="60" :step="0.5" controls-position="right" />
        </el-form-item>
        <el-form-item label="帧率">
          <el-input-number v-model="form.frameRate" :min="1" :max="120" :step="1" controls-position="right" />
        </el-form-item>
        <el-form-item label="随机种子">
          <el-input-number v-model="form.seed" :min="0" :step="1" :controls="false" />
        </el-form-item>
        <el-form-item label="候选数量">
          <el-input-number v-model="form.candidateCount" :min="1" :max="3" :step="1" controls-position="right" />
        </el-form-item>
      </div>
      <div class="dimension-presets" aria-label="尺寸快捷值">
        <span>尺寸快捷值</span>
        <el-button size="small" plain @click="setDimensions(864, 480)">864 × 480</el-button>
        <el-button size="small" plain @click="setDimensions(1280, 704)">1280 × 704</el-button>
      </div>

      <el-form-item label="连续性方式">
        <el-select v-model="form.continuityMode" style="width: 100%">
          <el-option label="动作重叠" value="motion_overlap" />
          <el-option label="状态锚点（实验）" value="state_anchor" />
          <el-option label="仅构图锚点（实验）" value="composition_only" />
          <el-option label="不使用连续性" value="none" />
        </el-select>
      </el-form-item>
      <el-tag v-if="sourceAnchor || form.anchorId" type="success" effect="plain" closable @close="clearAnchor">
        已使用连续性锚点 · {{ sourceAnchor?.reference_role || '状态' }}
      </el-tag>

      <el-button
        type="primary"
        native-type="submit"
        :loading="creating"
        :disabled="!defaultConfig || !String(form.prompt || '').trim()"
        class="generate-button"
      >
        <el-icon><Plus /></el-icon>
        生成候选
      </el-button>
    </el-form>

    <section class="queue-card" aria-label="生成队列状态">
      <span class="queue-dot" />
      <strong>生成队列</strong>
      <span>{{ queueLabel }}</span>
    </section>

    <section class="review-section" aria-label="候选审核">
      <div class="section-heading">
        <strong>候选与历史</strong>
        <el-tag v-if="currentGroup" size="small" effect="plain">{{ videoStatusLabel(currentGroup.status) }}</el-tag>
      </div>
      <el-select
        v-if="groups.length"
        v-model="activeGroupId"
        aria-label="候选组历史"
        size="small"
        style="width: 100%"
      >
        <el-option
          v-for="(item, index) in groups"
          :key="item.id"
          :label="`第 ${groups.length - index} 组 · ${videoStatusLabel(item.status)} · ${shortId(item.id)}`"
          :value="item.id"
        />
      </el-select>

      <el-input
        v-if="currentGroup"
        v-model="selectionReason"
        clearable
        placeholder="选用理由（可选）"
      />

      <el-empty v-if="!currentGroup && !loading" :image-size="64" description="暂无候选，填写参数后开始生成" />
      <div v-else class="candidate-list">
        <article v-for="(candidate, index) in candidates" :key="candidate.id" class="candidate-card">
          <video
            v-if="candidatePreviewUrl(candidate)"
            class="candidate-preview"
            :src="candidatePreviewUrl(candidate)"
            controls
            preload="metadata"
            @timeupdate="captureVideoTime"
          />
          <div v-else class="candidate-placeholder">
            <el-icon v-if="isCandidateActive(candidate)" class="is-loading"><Loading /></el-icon>
            <el-icon v-else><VideoCamera /></el-icon>
            <span>{{ videoStatusLabel(candidateStatus(candidate)) }}</span>
          </div>

          <div class="candidate-copy">
            <div class="candidate-title-row">
              <strong>候选 {{ index + 1 }}</strong>
              <el-tag :type="candidateTagType(candidate)" size="small" effect="plain">
                {{ videoStatusLabel(candidateStatus(candidate)) }}
              </el-tag>
            </div>
            <small>任务：{{ candidateMediaId(candidate) || shortId(candidate.id) }}</small>
            <small v-if="candidate.video_generation?.provider || candidate.video_generation?.model">
              {{ candidate.video_generation?.provider || '默认服务' }} · {{ candidate.video_generation?.model || '默认模型' }}
            </small>
            <el-alert
              v-if="candidateError(candidate)"
              type="error"
              :closable="false"
              :title="candidateError(candidate).summary"
              show-icon
            />
            <div v-if="qualityReviews[candidate.id]" class="quality-result">
              <strong>{{ qualityLabel(qualityReviews[candidate.id]?.status) }}</strong>
              <span>{{ qualityReviews[candidate.id]?.issues?.length || 0 }} 项问题</span>
            </div>
          </div>

          <div class="candidate-actions">
            <el-button
              v-if="isCandidateActive(candidate)"
              size="small"
              plain
              type="warning"
              @click="cancelCandidate(candidate)"
            >
              取消生成
            </el-button>
            <el-button
              v-if="isCandidateRetryable(candidate)"
              size="small"
              plain
              type="warning"
              @click="retryCandidate(candidate)"
            >
              重试生成
            </el-button>
            <el-tooltip :disabled="canAnalyze(candidate)" content="当前候选没有可检查的本地产物">
              <span>
                <el-button
                  size="small"
                  plain
                  :disabled="!canAnalyze(candidate)"
                  :loading="analyzingCandidateId === candidate.id"
                  @click="analyzeCandidate(candidate)"
                >
                  质量检查
                </el-button>
              </span>
            </el-tooltip>
            <el-button
              size="small"
              type="primary"
              :disabled="!canSelect(candidate)"
              @click="selectCandidate(candidate)"
            >
              选用候选
            </el-button>
          </div>
        </article>
      </div>
    </section>

    <el-collapse v-if="currentGroup?.status === 'selected'" class="anchor-section">
      <el-collapse-item title="连续性锚点" name="anchor">
        <template v-if="selectedArtifactId">
          <el-form label-position="top">
            <el-form-item label="取帧时间（秒）">
              <el-slider v-model="anchorTime" :min="0" :max="selectedDuration" :step="0.04" show-input />
            </el-form-item>
            <div class="anchor-fields">
              <el-form-item label="锚点用途">
                <el-select v-model="anchorRole">
                  <el-option label="状态" value="state" />
                  <el-option label="构图" value="composition" />
                  <el-option label="角色一致性" value="identity" />
                  <el-option label="动作" value="motion" />
                </el-select>
              </el-form-item>
              <el-form-item label="处理方式">
                <el-select v-model="anchorOperation">
                  <el-option label="提取帧" value="extract_frame" />
                  <el-option label="放大两倍" value="upscale_2x" />
                  <el-option label="线稿" value="line_art" />
                </el-select>
              </el-form-item>
            </div>
            <el-button :loading="creatingAnchor" @click="createAnchor">创建连续性锚点</el-button>
          </el-form>
          <div v-for="anchor in anchors" :key="anchor.id" class="anchor-row">
            <img v-if="anchor.preview_url" :src="anchor.preview_url" alt="连续性锚点预览" />
            <div>
              <strong>{{ anchorRoleLabel(anchor.reference_role) }}</strong>
              <small>第 {{ anchor.frame_number }} 帧</small>
            </div>
            <el-button size="small" text @click="useAnchor(anchor)">用于下一分镜</el-button>
          </div>
        </template>
        <el-alert
          v-else
          type="info"
          :closable="false"
          title="当前候选未提供可取帧的本地产物，仍可预览和选用视频。"
        />
      </el-collapse-item>
    </el-collapse>

    <el-alert v-if="error" type="error" :closable="false" :title="error.summary" show-icon class="panel-error">
      <el-collapse>
        <el-collapse-item title="查看技术详情" name="details">
          <pre>{{ error.detail }}</pre>
        </el-collapse-item>
      </el-collapse>
    </el-alert>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { Close, Loading, Plus, Refresh, VideoCamera } from '@element-plus/icons-vue'
import { videosAPI } from '@/api/videos'
import {
  candidateStatus,
  useVideoGenerationPanel,
  videoErrorCopy,
} from '@/composables/useVideoGenerationPanel'

const props = defineProps({
  storyboardId: { type: [String, Number], required: true },
  storyboard: { type: Object, default: null },
  displayMode: {
    type: String,
    default: 'drawer',
    validator: (value) => ['drawer', 'sidebar'].includes(value),
  },
})
const emit = defineEmits(['selected', 'anchor-created', 'close'])

const {
  form,
  defaultConfig,
  configLoading,
  configStatus,
  providerName,
  modelName,
  loading,
  creating,
  groups,
  activeGroupId,
  currentGroup,
  candidates,
  queueLabel,
  selectionReason,
  error,
  qualityReviews,
  analyzingCandidateId,
  anchors,
  anchorTime,
  selectedDuration,
  anchorRole,
  anchorOperation,
  creatingAnchor,
  selectedArtifactId,
  sourceAnchor,
  refresh,
  generateCandidates,
  cancelCandidate,
  retryCandidate,
  analyzeCandidate,
  selectCandidate,
  captureVideoTime,
  createAnchor,
  useAnchor,
  close,
  candidatePreviewUrl,
  candidateMediaId,
  videoStatusLabel,
} = useVideoGenerationPanel(props, emit, videosAPI)

const storyboardLabel = computed(() => (
  props.storyboard?.storyboard_number ?? props.storyboardId
))

function setDimensions(width, height) {
  form.width = width
  form.height = height
}

function clearAnchor() {
  form.anchorId = ''
  form.sourceArtifactId = ''
  form.continuityMode = 'none'
  emit('anchor-created', null)
}

function shortId(value) {
  const text = String(value || '')
  return text.length > 10 ? text.slice(0, 8) : text
}

function isCandidateActive(candidate) {
  return ['waiting', 'pending', 'queued', 'processing', 'running'].includes(candidateStatus(candidate))
}

function isCandidateRetryable(candidate) {
  return ['failed', 'interrupted'].includes(candidateStatus(candidate))
}

function canAnalyze(candidate) {
  return Boolean(candidate?.artifact?.id && candidate.artifact.status === 'ready')
}

function canSelect(candidate) {
  return currentGroup.value?.status === 'review' && candidateStatus(candidate) === 'review'
}

function candidateTagType(candidate) {
  const status = candidateStatus(candidate)
  if (status === 'selected') return 'success'
  if (['failed', 'interrupted'].includes(status)) return 'danger'
  if (status === 'cancelled') return 'warning'
  if (status === 'review') return 'primary'
  return 'info'
}

function candidateError(candidate) {
  const raw = candidate?.video_generation?.error_msg || candidate?.job_error_message || candidate?.error_message
  if (!raw) return null
  let parsed = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch (_) {}
  }
  return videoErrorCopy(parsed)
}

function qualityLabel(status) {
  const labels = { passed: '质量检查通过', warning: '质量检查有提醒', failed: '质量检查未通过' }
  return labels[String(status || '').toLowerCase()] || '质量检查完成'
}

function anchorRoleLabel(role) {
  return { state: '状态', composition: '构图', identity: '角色一致性', motion: '动作' }[role] || '连续性'
}
</script>

<style scoped>
.video-generation-panel {
  box-sizing: border-box;
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
  height: 100%;
  padding: 16px;
  overflow-y: auto;
  color: var(--text-primary, #e4e4e7);
  background: var(--bg-card, #18181b);
}

.video-generation-panel--sidebar {
  width: 360px;
  flex: 0 0 360px;
  border-left: 1px solid var(--border-color, #27272a);
}

.video-generation-panel--drawer {
  width: 100%;
  background: transparent;
}

.panel-header,
.header-actions,
.service-status-row,
.section-heading,
.queue-card,
.candidate-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-kicker {
  color: #818cf8;
  font-size: 11px;
  letter-spacing: .08em;
}

h2 {
  margin: 3px 0 0;
  font-size: 17px;
}

.service-card,
.queue-card,
.candidate-card {
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-card, #18181b) 88%, white 3%);
}

.service-card {
  display: grid;
  gap: 5px;
  padding: 11px 12px;
}

.service-card span,
.service-card small,
.queue-card,
.candidate-copy small,
.quality-result {
  color: var(--text-subtle, #a1a1aa);
  font-size: 12px;
}

.generation-form {
  display: grid;
  gap: 2px;
}

.generation-form :deep(.el-form-item) {
  margin-bottom: 10px;
}

.number-grid,
.anchor-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 10px;
}

.number-grid :deep(.el-input-number),
.anchor-fields :deep(.el-select) {
  width: 100%;
}

.dimension-presets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin: -2px 0 10px;
  color: var(--text-subtle, #a1a1aa);
  font-size: 12px;
}

.generate-button {
  width: 100%;
  margin-top: 8px;
}

.queue-card {
  justify-content: flex-start;
  padding: 9px 12px;
}

.queue-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 8px rgb(52 211 153 / 55%);
}

.review-section,
.candidate-list,
.candidate-copy,
.candidate-actions,
.anchor-section :deep(.el-collapse-item__content) {
  display: grid;
  gap: 10px;
}

.candidate-card {
  display: grid;
  grid-template-columns: minmax(112px, 38%) 1fr;
  gap: 10px;
  padding: 10px;
}

.candidate-preview,
.candidate-placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 7px;
  background: #09090b;
}

.candidate-preview {
  object-fit: cover;
}

.candidate-placeholder {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 6px;
  color: #71717a;
  font-size: 12px;
}

.candidate-actions {
  grid-column: 1 / -1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.candidate-actions :deep(.el-button),
.candidate-actions span,
.candidate-actions span :deep(.el-button) {
  width: 100%;
  margin-left: 0;
}

.quality-result {
  display: flex;
  gap: 8px;
}

.anchor-row {
  display: grid;
  grid-template-columns: 72px 1fr auto;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
}

.anchor-row img {
  width: 72px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 5px;
}

.anchor-row div {
  display: grid;
  gap: 2px;
}

.anchor-row small {
  color: var(--text-subtle, #a1a1aa);
}

.panel-error pre {
  max-width: 100%;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 900px) {
  .video-generation-panel--sidebar {
    width: 300px;
    flex-basis: 300px;
  }

  .candidate-card {
    grid-template-columns: 1fr;
  }

  .candidate-actions {
    grid-column: 1;
  }
}
</style>
