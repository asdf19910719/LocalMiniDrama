import { defineStore } from 'pinia'
import { ref } from 'vue'
import { imageGenerationTaskAPI } from '@/api/imageGenerationTasks'
import { sendImageGenerationBridgeMessage } from '@/utils/imageGenerationBridge'

export const useImageGenerationStore = defineStore('imageGeneration', () => {
  const dramaId = ref(null)
  const defaultChannel = ref('api')
  const summary = ref(null)
  const currentTask = ref(null)
  const drawerVisible = ref(false)
  const loading = ref(false)

  async function loadSummary(id) {
    if (id == null) return null
    dramaId.value = id
    summary.value = await imageGenerationTaskAPI.summary(id)
    return summary.value
  }
  async function loadDefault(id) {
    const result = await imageGenerationTaskAPI.getDefault(id)
    defaultChannel.value = result?.channel || 'api'
    return defaultChannel.value
  }
  async function openTask(input) {
    loading.value = true
    try {
      currentTask.value = await imageGenerationTaskAPI.create(input)
      drawerVisible.value = true
      await loadSummary(input.dramaId)
      return currentTask.value
    } finally { loading.value = false }
  }
  async function refreshTask() {
    if (!currentTask.value?.id) return null
    currentTask.value = await imageGenerationTaskAPI.get(currentTask.value.id)
    return currentTask.value
  }
  async function sendToChatGPT(task = currentTask.value) {
    if (!task?.id) throw new Error('图片生成任务不存在')
    const prepared = await imageGenerationTaskAPI.prepareSend(task.id)
    currentTask.value = prepared.task
    const job = prepared.external_job
    const attempt = prepared.attempt
    await sendImageGenerationBridgeMessage({
      action: 'send', dramaId: task.drama_id, site: 'chatgpt', jobId: job.id,
      attemptId: attempt.id, conversationId: job.conversation_id, payload: attempt,
    })
    currentTask.value = await imageGenerationTaskAPI.acknowledge(task.id, attempt.id)
    await loadSummary(task.drama_id)
    return currentTask.value
  }
  function closeDrawer() { drawerVisible.value = false }

  return { dramaId, defaultChannel, summary, currentTask, drawerVisible, loading, loadSummary, loadDefault, openTask, refreshTask, sendToChatGPT, closeDrawer }
})
