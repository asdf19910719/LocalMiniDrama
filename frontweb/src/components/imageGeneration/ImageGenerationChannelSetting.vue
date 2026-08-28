<template>
  <el-form-item label="默认生图方式" class="image-generation-channel-setting">
    <el-select
      :model-value="modelValue"
      :loading="saving"
      :disabled="!dramaId || saving"
      style="width: 180px"
      @change="saveChannel"
    >
      <el-option label="默认模型生成" value="api" />
      <el-option label="ChatGPT 生成" value="chatgpt_web" :disabled="!chatgptWebEnabled" />
    </el-select>
    <span class="setting-hint">按钮主操作会使用此通道，也可在按钮菜单中临时切换。</span>
  </el-form-item>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { imageGenerationTaskAPI } from '@/api/imageGenerationTasks'
import { aiAPI } from '@/api/ai'

const props = defineProps({
  dramaId: { type: [Number, String], required: true },
  modelValue: { type: String, default: 'api' },
})
const emit = defineEmits(['update:modelValue', 'saved'])
const saving = ref(false)
const chatgptWebEnabled = ref(true)

async function loadChannelAvailability() {
  try {
    const result = await aiAPI.getImageGenerationSettings()
    chatgptWebEnabled.value = result?.chatgpt_web?.enabled !== false
  } catch (_) {}
}

async function saveChannel(channel) {
  if (!props.dramaId || !channel || channel === props.modelValue) return
  if (channel === 'chatgpt_web' && !chatgptWebEnabled.value) {
    ElMessage.warning('请先在 API 配置中启用 ChatGPT 网页生图通道')
    return
  }
  saving.value = true
  try {
    const result = await imageGenerationTaskAPI.setDefault(props.dramaId, channel)
    const value = result?.channel || channel
    emit('update:modelValue', value)
    emit('saved', value)
    ElMessage.success(`默认生图方式已切换为${value === 'chatgpt_web' ? ' ChatGPT' : '默认模型'}`)
  } catch (error) {
    ElMessage.error(error?.message || '保存默认生图方式失败')
  } finally {
    saving.value = false
  }
}

loadChannelAvailability()
</script>

<style scoped>
.image-generation-channel-setting { align-items: center; }
.setting-hint { margin-left: 10px; color: var(--el-text-color-secondary); font-size: 12px; }
</style>
