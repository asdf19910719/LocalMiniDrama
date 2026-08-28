import { defineStore } from 'pinia'
import { ref } from 'vue'
import { imageGenerationTaskAPI } from '@/api/imageGenerationTasks'
import { sendImageGenerationBridgeMessage } from '@/utils/imageGenerationBridge'
import { buildChatGPTImageGenerationPrompt } from '@/utils/imageGenerationPrompt'
import {
  normalizeImageGenerationTask,
  resolveChatGPTPrepareAction,
  shouldPollImageGenerationTask,
  shouldReattachImageGenerationTask,
} from '@/utils/imageGenerationTaskState'

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
  let taskPollTimer = null

  function stopTaskPolling() {
    if (taskPollTimer != null) globalThis.clearTimeout(taskPollTimer)
    taskPollTimer = null
  }

  function startTaskPolling(delayMs = 3000) {
    stopTaskPolling()
    if (!shouldPollImageGenerationTask(currentTask.value)) return
    taskPollTimer = globalThis.setTimeout(async () => {
      taskPollTimer = null
      try {
        await refreshTask()
      } catch (error) {
        errorMessage.value = error?.message || '图片任务状态刷新失败'
        startTaskPolling(5000)
      }
    }, delayMs)
  }

  async function loadSummary(id, { reattach = true } = {}) {
    if (id == null) return null
    dramaId.value = id
    summary.value = await imageGenerationTaskAPI.summary(id)
    // Reattach the persisted active unified image task after a page reload.
    if (shouldReattachImageGenerationTask({
      currentTaskId: currentTask.value?.id,
      activeTaskId: summary.value?.active_task_id,
      allowReattach: reattach,
    })) {
      try {
        currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.get(summary.value.active_task_id))
        startTaskPolling(0)
      } catch (_) {
        // The summary remains useful even when the task disappeared between requests.
      }
    }
    return summary.value
  }
  async function loadDefault(id) {
    const result = await imageGenerationTaskAPI.getDefault(id)
    defaultChannel.value = result?.channel || 'api'
    return defaultChannel.value
  }
  async function openTask(input) {
    stopTaskPolling()
    loading.value = true
    errorMessage.value = ''
    try {
      currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.create(input))
      drawerVisible.value = true
      await loadSummary(input.dramaId, { reattach: false })
      return currentTask.value
    } finally { loading.value = false }
  }
  async function refreshTask() {
    if (!currentTask.value?.id) return null
    const taskId = currentTask.value.id
    const refreshed = normalizeImageGenerationTask(await imageGenerationTaskAPI.get(taskId))
    if (currentTask.value?.id !== taskId) return currentTask.value
    currentTask.value = refreshed
    startTaskPolling()
    return currentTask.value
  }
  async function sendToChatGPT(task = currentTask.value) {
    if (!task?.id) throw new Error('图片生成任务不存在')
    loading.value = true
    errorMessage.value = ''
    try {
      const prepared = await imageGenerationTaskAPI.prepareSend(task.id)
      currentTask.value = normalizeImageGenerationTask({ ...prepared.task, external_job: prepared.external_job })
      const job = prepared.external_job
      const attempt = prepared.attempt
      const prepareAction = resolveChatGPTPrepareAction(prepared)
      if (prepareAction === 'recover') return await recoverCapture(currentTask.value)
      if (prepareAction === 'review') return currentTask.value
      await sendImageGenerationBridgeMessage({
        action: 'prepare', dramaId: prepared.task.drama_id, site: 'chatgpt', jobId: job.id,
        conversationId: job.conversation_id,
        prompt: buildChatGPTImageGenerationPrompt(prepared.task.prompt_snapshot, prepared.task.target_type),
        references: parseReferenceManifest(prepared.task.reference_manifest),
      })
      await sendImageGenerationBridgeMessage({
        action: 'send', dramaId: prepared.task.drama_id, site: 'chatgpt', jobId: job.id,
        attemptId: attempt.id, conversationId: job.conversation_id, payload: attempt,
      })
      currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.acknowledge(prepared.task.id, attempt.id))
      startTaskPolling()
      await loadSummary(prepared.task.drama_id, { reattach: false })
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
  async function recoverCapture(task = currentTask.value) {
    if (!task?.id) throw new Error('图片生成任务不存在')
    loading.value = true
    errorMessage.value = ''
    try {
      const detailed = task.external_job
        ? normalizeImageGenerationTask(task)
        : normalizeImageGenerationTask(await imageGenerationTaskAPI.get(task.id))
      const job = detailed?.external_job
      const attempt = (job?.attempts || []).filter((item) => ['submitted', 'generating'].includes(item?.status)).at(-1)
        || (job?.attempts || []).at(-1)
      if (!job?.id || !attempt?.id) throw new Error('找不到可恢复的 ChatGPT 生成记录')
      currentTask.value = { ...detailed, error_code: null, error_message: null }
      // `attempt` comes from the reactive store tree; post only the plain
      // fields the extension reads so window.postMessage never sees a proxy.
      await sendImageGenerationBridgeMessage({
        action: 'recoverAttempt', dramaId: detailed.drama_id, site: 'chatgpt', jobId: job.id,
        attemptId: attempt.id, conversationId: attempt.conversation_id || job.conversation_id,
        attempt: {
          id: attempt.id,
          status: attempt.status,
          sequence: attempt.sequence,
          assistant_message_id: attempt.assistant_message_id ?? null,
          conversation_id: attempt.conversation_id ?? null,
        },
      })
      startTaskPolling(0)
      return currentTask.value
    } catch (error) {
      const message = error?.message || '恢复结果捕获失败，请检查 ChatGPT 页面和浏览器插件'
      errorMessage.value = message
      if (currentTask.value?.id === task.id) currentTask.value = { ...currentTask.value, error_message: message }
      throw error
    } finally {
      loading.value = false
    }
  }
  async function selectResult(result) {
    if (!currentTask.value?.id || !result?.id) throw new Error('鍊欓€夌粨鏋滀笉瀛樺湪')
    currentTask.value = normalizeImageGenerationTask((await imageGenerationTaskAPI.selectResult(currentTask.value.id, result.id)).task)
    stopTaskPolling()
    await loadSummary(currentTask.value.drama_id, { reattach: false })
    return currentTask.value
  }
  function closeDrawer() { drawerVisible.value = false }

  return { dramaId, defaultChannel, summary, currentTask, drawerVisible, loading, errorMessage, loadSummary, loadDefault, openTask, refreshTask, sendToChatGPT, recoverCapture, selectResult, closeDrawer }
})
