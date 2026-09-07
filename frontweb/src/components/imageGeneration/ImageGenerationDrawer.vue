<template>
  <el-drawer :model-value="visible" title="图片生成" size="420px" @close="$emit('close')">
    <template v-if="task">
      <div class="task-tags">
        <el-tag>{{ statusText }}</el-tag>
        <el-tag v-if="modeLabel" type="info">{{ modeLabel }}</el-tag>
      </div>
      <ImageGenerationEnvironmentStatus :environment="environment" :checking="environmentChecking" @check="$emit('check-environment')" />
      <label class="snapshot-label">本次实际提示词</label>
      <el-input :model-value="task.prompt_snapshot" type="textarea" :rows="5" readonly class="prompt" />
      <template v-if="task.negative_prompt_snapshot">
        <label class="snapshot-label">本次负向提示词</label>
        <el-input :model-value="task.negative_prompt_snapshot" type="textarea" :rows="2" readonly class="prompt prompt--compact" />
      </template>
      <p v-if="styleSummary" class="style-snapshot"><strong>项目画风快照：</strong>{{ styleSummary }}</p>
      <p v-if="task.generation_channel === 'chatgpt_web'">点击“ChatGPT 生成”后会自动加入队列依次发送；此处用于查看进度和选择结果。</p>
      <el-button
        v-if="task.status === 'draft' && task.generation_channel === 'chatgpt_web'"
        type="primary"
        :loading="sending"
        :disabled="environment?.canProceed === false"
        @click="$emit('send', task)"
      >
        发送到 ChatGPT
      </el-button>
      <el-alert v-if="task.status === 'preparing' && !task.error_message" type="info" :title="task.generation_channel === 'api' ? '正在提交默认模型生图任务' : '正在等待浏览器插件确认'" show-icon />
      <el-alert v-if="task.status === 'queued'" type="info" :title="task.generation_channel === 'api' ? '默认模型任务等待提交' : '已加入队列，将自动依次发送'" show-icon />
      <el-alert v-if="task.status === 'submitted' || task.status === 'generating'" type="info" :title="task.generation_channel === 'api' ? '默认模型正在生成，完成后会自动设为当前图片' : 'ChatGPT 已接收任务，正在等待生成结果'" show-icon />
      <el-alert v-if="task.status === 'completed'" type="success" title="图片已生成并设为当前图片" show-icon />
      <el-button
        v-if="canRecover"
        :loading="sending"
        @click="$emit('recover', task)"
      >
        恢复结果捕获
      </el-button>
      <el-button v-if="task.status === 'failed'" :loading="sending" @click="$emit('requeue', task)">重新排队</el-button>
      <div v-if="results.length" class="results">
        <div v-for="result in results" :key="result.id" class="result">
          <img :src="result.preview_url || result.image_url" alt="候选图片" />
          <el-button type="primary" size="small" @click="$emit('select', result)">设为当前图片</el-button>
        </div>
      </div>
      <div v-if="task.generation_channel === 'chatgpt_web'" class="auto-select-row">
        <el-switch :model-value="autoSelect" @change="onAutoSelect" />
        <span>自动采用首个候选</span>
      </div>
      <el-alert v-if="task.error_message" type="error" :title="task.error_message" show-icon />
    </template>
  </el-drawer>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import ImageGenerationEnvironmentStatus from './ImageGenerationEnvironmentStatus.vue'
import { useImageGenerationStore } from '@/stores/imageGenerationStore'
import { shouldRecoverImageGenerationTask } from '@/utils/imageGenerationTaskState'
import { assetGenerationModeLabel } from '@/constants/assetGenerationModes'
const props = defineProps({ visible: Boolean, task: Object, results: { type: Array, default: () => [] }, sending: Boolean, environment: { type: Object, default: null }, environmentChecking: Boolean })
defineEmits(['close', 'send', 'recover', 'requeue', 'select', 'check-environment'])
const store = useImageGenerationStore()
const autoSelect = computed(() => store.autoSelect)
const canRecover = computed(() => shouldRecoverImageGenerationTask(props.task))
const modeLabel = computed(() => props.task?.asset_mode
  ? assetGenerationModeLabel(props.task.target_type, props.task.asset_mode)
  : '')
const styleSummary = computed(() => {
  const value = props.task?.style_snapshot
  if (!value) return ''
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed?.style_prompt_zh || parsed?.style_prompt_en || parsed?.style || ''
  } catch (_) {
    return String(value)
  }
})
onMounted(() => { store.loadAutoSelect().catch(() => {}) })
function onAutoSelect(value) { store.setAutoSelect(value).catch(() => {}) }
const labels = { draft: '待确认', queued: '排队中', preparing: '准备中', submitted: '已发送', generating: '生成中', needs_review: '请选择图片', completed: '已完成', failed: '失败', cancelled: '已取消' }
const statusText = computed(() => (
  props.task?.status === 'needs_review' && props.task?.error_code === 'result_timeout'
    ? '等待恢复'
    : labels[props.task?.status] || props.task?.status || ''
))
</script>

<style scoped>
.task-tags { display:flex;gap:8px;align-items:center; }
.snapshot-label { display:block;margin-top:14px;color:var(--el-text-color-secondary);font-size:12px; }
.prompt { margin: 6px 0 14px; }.prompt--compact { margin-bottom:10px; }.style-snapshot { margin:4px 0 14px;color:var(--el-text-color-secondary);font-size:12px;line-height:1.55; }.results { display:grid;gap:12px;margin-top:16px }.result { display:flex;gap:10px;align-items:center }.result img { width:96px;height:96px;object-fit:cover;border-radius:6px }
.auto-select-row { display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:var(--el-text-color-secondary) }
</style>
