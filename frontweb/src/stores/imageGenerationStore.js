import { defineStore } from 'pinia'
import { ref } from 'vue'
import { imageGenerationTaskAPI } from '@/api/imageGenerationTasks'
import { sendImageGenerationBridgeMessage } from '@/utils/imageGenerationBridge'

function parseReferenceManifest(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

export const useImageGenerationStore = defineStore('imageGeneration', () => {
  const dramaId = ref(null)
  const defaultChannel = ref('api')
  const summary = ref(null)
  const currentTask = ref(null)
  const drawerVisible = ref(false)
  const loading = ref(false)
  const errorMessage = ref('')

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
    errorMessage.value = ''
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
    loading.value = true
    errorMessage.value = ''
    try {
      const prepared = await imageGenerationTaskAPI.prepareSend(task.id)
      currentTask.value = prepared.task
      const job = prepared.external_job
      const attempt = prepared.attempt
      await sendImageGenerationBridgeMessage({
        action: 'prepare', dramaId: prepared.task.drama_id, site: 'chatgpt', jobId: job.id,
        conversationId: job.conversation_id, prompt: prepared.task.prompt_snapshot,
        references: parseReferenceManifest(prepared.task.reference_manifest),
      })
      await sendImageGenerationBridgeMessage({
        action: 'send', dramaId: prepared.task.drama_id, site: 'chatgpt', jobId: job.id,
        attemptId: attempt.id, conversationId: job.conversation_id, payload: attempt,
      })
      currentTask.value = await imageGenerationTaskAPI.acknowledge(prepared.task.id, attempt.id)
      await loadSummary(prepared.task.drama_id)
      return currentTask.value
    } catch (error) {
      const message = error?.message || '发送到 ChatGPT 失败，请检查浏览器插件和登录状态'
      errorMessage.value = message
      if (currentTask.value?.id === task.id) {
        currentTask.value = { ...currentTask.value, error_code: 'chatgpt_bridge_error', error_message: message }
      }
      throw error
    } finally {
      loading.value = false
    }
  }
  async function selectResult(result) {
    if (!currentTask.value?.id || !result?.id) throw new Error('鍊欓€夌粨鏋滀笉瀛樺湪')
    currentTask.value = (await imageGenerationTaskAPI.selectResult(currentTask.value.id, result.id)).task
    await loadSummary(currentTask.value.drama_id)
    return currentTask.value
  }
  function closeDrawer() { drawerVisible.value = false }

  return { dramaId, defaultChannel, summary, currentTask, drawerVisible, loading, errorMessage, loadSummary, loadDefault, openTask, refreshTask, sendToChatGPT, selectResult, closeDrawer }
})
