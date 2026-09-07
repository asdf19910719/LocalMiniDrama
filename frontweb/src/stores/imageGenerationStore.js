import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElNotification } from 'element-plus'
import { imageGenerationTaskAPI } from '@/api/imageGenerationTasks'
import { aiAPI } from '@/api/ai'
import { sendImageGenerationBridgeMessage } from '@/utils/imageGenerationBridge'
import { buildChatGPTImageGenerationPrompt } from '@/utils/imageGenerationPrompt'
import { createQueueDriver } from '@/utils/imageGenerationQueueDriver'
import { runImageGenerationEnvironmentCheck, clearImageGenerationEnvironmentCache, normalizeImageGenerationChannel } from '@/utils/imageGenerationEnvironment'
import {
  normalizeImageGenerationTask,
  resolveChatGPTPrepareAction,
  shouldPollImageGenerationTask,
  shouldRecoverImageGenerationTask,
  shouldReattachImageGenerationTask,
  toChatGPTRecoveryAttempt,
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

// Shared by the drawer's manual send and the queue driver's automatic send:
// bridges one prepared attempt into the ChatGPT page (prepare + send).
const BRIDGE_TIMEOUT_MS = 60000
// 后台发送链最长会等 ~4 分钟让 ChatGPT 发送按钮从"生成中"恢复;工作台必须等得比它久,
// 否则任务被提前判失败,而提示词稍后仍会被点出(孤儿发送)。
const SEND_BRIDGE_TIMEOUT_MS = 300000
async function sendChatGPTAttempt(prepared) {
  const job = prepared.external_job
  const references = parseReferenceManifest(prepared.task.reference_manifest)
  await sendImageGenerationBridgeMessage({
    action: 'prepare', dramaId: prepared.task.drama_id, site: 'chatgpt', jobId: job.id,
    conversationId: job.conversation_id,
    prompt: buildChatGPTImageGenerationPrompt(prepared.task.prompt_snapshot, prepared.task.target_type, {
      hasReferences: references.length > 0,
      hasIdentityReference: references.some((item) => item?.role === 'character_identity' && item?.url),
      negativePrompt: prepared.task.negative_prompt_snapshot,
    }),
    references,
  }, BRIDGE_TIMEOUT_MS)
  await sendImageGenerationBridgeMessage({
    action: 'send', dramaId: prepared.task.drama_id, site: 'chatgpt', jobId: job.id,
    attemptId: prepared.attempt.id, conversationId: job.conversation_id, payload: prepared.attempt,
  }, SEND_BRIDGE_TIMEOUT_MS)
}

function cancelChatGPTAttemptSend(attemptId) {
  if (!attemptId) return Promise.resolve()
  return sendImageGenerationBridgeMessage({ action: 'cancelAttemptSend', attemptId }).catch(() => {})
}

export const useImageGenerationStore = defineStore('imageGeneration', () => {
  const dramaId = ref(null)
  const defaultChannel = ref('api')
  const summary = ref(null)
  const currentTask = ref(null)
  const drawerVisible = ref(false)
  const loading = ref(false)
  const errorMessage = ref('')
  const environment = ref(null)
  const autoSelect = ref(true)
  // 生成任务落定(完成/待选/失败)时递增,驱动页面刷新资产列表
  const generationSettledTick = ref(0)
  let taskPollTimer = null
  let environmentCheckVersion = 0

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
    // The driver is a page-session singleton: every summary load (re)arms it so
    // queued chatgpt_web tasks keep draining even with the drawer closed.
    startQueueDriver()
    return summary.value
  }
  async function setDefaultChannel(channel) {
    if (dramaId.value == null) throw new Error('剧集未加载')
    const requestedChannel = normalizeImageGenerationChannel(channel)
    const result = await imageGenerationTaskAPI.setDefault(dramaId.value, requestedChannel)
    defaultChannel.value = normalizeImageGenerationChannel(result, requestedChannel)
    return defaultChannel.value
  }
  async function loadDefault(id) {
    const result = await imageGenerationTaskAPI.getDefault(id)
    defaultChannel.value = normalizeImageGenerationChannel(result)
    await checkEnvironment({ dramaId: id, channel: defaultChannel.value }, { force: true })
    return defaultChannel.value
  }
  async function checkEnvironment(input = {}, { force = false } = {}) {
    const checkVersion = ++environmentCheckVersion
    const channel = input.channel || input.generationChannel || defaultChannel.value || 'api'
    const result = await runImageGenerationEnvironmentCheck({
      dramaId: input.dramaId ?? dramaId.value,
      channel,
      targetType: input.targetType,
      targetId: input.targetId,
      force,
      requestBackend: ({ dramaId: id, channel: selectedChannel, targetType, targetId }) => imageGenerationTaskAPI.environment(id, { channel: selectedChannel, targetType, targetId }),
      requestBridge: (message) => sendImageGenerationBridgeMessage(message, 10000).then((response) => response?.diagnostics || { canProceed: false, checks: [{ key: 'workbench_bridge', status: 'failed', code: 'BRIDGE_INVALID', message: '扩展诊断返回无效' }] }),
    })
    if (checkVersion !== environmentCheckVersion) return result
    environment.value = result
    if (result.canProceed) queueDriver?.resume?.()
    return result
  }
  async function openTask(input) {
    stopTaskPolling()
    loading.value = true
    errorMessage.value = ''
    try {
      const readiness = await checkEnvironment(input, { force: true })
      if (!readiness.canProceed) {
        const failed = readiness.checks.find((check) => check.status === 'failed')
        throw new Error(failed?.message || '生图环境未就绪，请先修复环境后重试')
      }
      currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.create(input))
      drawerVisible.value = true
      if (currentTask.value.generation_channel === 'api') {
        currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.submit(currentTask.value.id))
        startTaskPolling()
      }
      await loadSummary(input.dramaId, { reattach: false })
      return currentTask.value
    } finally { loading.value = false }
  }
  async function refreshTask() {
    if (!currentTask.value?.id) return null
    const taskId = currentTask.value.id
    const previousStatus = currentTask.value.status
    const refreshed = normalizeImageGenerationTask(await imageGenerationTaskAPI.get(taskId))
    if (currentTask.value?.id !== taskId) return currentTask.value
    currentTask.value = refreshed
    if (previousStatus !== refreshed?.status && ['completed', 'failed', 'needs_review'].includes(refreshed?.status)) {
      generationSettledTick.value += 1
      await loadSummary(refreshed.drama_id, { reattach: false })
    }
    startTaskPolling()
    return currentTask.value
  }
  async function sendToChatGPT(task = currentTask.value) {
    if (!task?.id) throw new Error('图片生成任务不存在')
    loading.value = true
    errorMessage.value = ''
    let prepared = null
    try {
      prepared = await imageGenerationTaskAPI.prepareSend(task.id)
      currentTask.value = normalizeImageGenerationTask({ ...prepared.task, external_job: prepared.external_job })
      const prepareAction = resolveChatGPTPrepareAction(prepared)
      if (prepareAction === 'recover') return await recoverCapture(currentTask.value)
      if (prepareAction === 'review') return currentTask.value
      await sendChatGPTAttempt(prepared)
      currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.acknowledge(prepared.task.id, prepared.attempt.id))
      startTaskPolling()
      await loadSummary(prepared.task.drama_id, { reattach: false })
      return currentTask.value
    } catch (error) {
      const message = error?.message || '发送到 ChatGPT 失败，请检查浏览器插件和登录状态'
      errorMessage.value = message
      // 手动发送失败同样撤下后台仍在等待的发送链,避免提示词稍后被提交
      void cancelChatGPTAttemptSend(prepared?.attempt?.id)
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
    let recoveryReserved = false
    try {
      // Always refresh before recovery. The drawer may still hold a submitted
      // snapshot after the backend timed it out and advanced another task;
      // using that stale snapshot would bypass the recovery ownership check.
      const detailed = normalizeImageGenerationTask(await imageGenerationTaskAPI.get(task.id))
      const job = detailed?.external_job
      const attempt = (job?.attempts || []).filter((item) => ['submitted', 'generating'].includes(item?.status)).at(-1)
        || (job?.attempts || []).at(-1)
      if (!job?.id || !attempt?.id) throw new Error('找不到可恢复的 ChatGPT 生成记录')
      const needsReservation = detailed.status === 'needs_review' && shouldRecoverImageGenerationTask(detailed)
      const reserved = await imageGenerationTaskAPI.beginResultRecovery(detailed.id)
      recoveryReserved = needsReservation
      currentTask.value = normalizeImageGenerationTask({ ...detailed, ...reserved })
      // `attempt` comes from the reactive store tree; post only the plain
      // fields the extension reads so window.postMessage never sees a proxy.
      await sendImageGenerationBridgeMessage({
        action: 'recoverAttempt', dramaId: detailed.drama_id, site: 'chatgpt', jobId: job.id,
        attemptId: attempt.id, conversationId: attempt.conversation_id || job.conversation_id,
        attempt: toChatGPTRecoveryAttempt(attempt),
      })
      startTaskPolling(0)
      return currentTask.value
    } catch (error) {
      const message = error?.message || '恢复结果捕获失败，请检查 ChatGPT 页面和浏览器插件'
      if (recoveryReserved) {
        try {
          const released = await imageGenerationTaskAPI.releaseResultRecovery(task.id, message)
          currentTask.value = normalizeImageGenerationTask({ ...(currentTask.value || {}), ...released })
        } catch (_) {}
      }
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

  const notifiedEvents = new Set()
  let queueDriver = null
  let queueDriverTimer = null

  function notifyQueueEvent(event) {
    if (!event.taskId || event.type === 'driver_error' || event.type === 'retrying') return
    if (event.type === 'completed' || event.type === 'needs_review' || event.type === 'failed') generationSettledTick.value += 1
    const key = `${event.taskId}:${event.type}`
    if (notifiedEvents.has(key)) return
    notifiedEvents.add(key)
    if (event.type === 'completed') {
      ElNotification({ title: '生图完成', message: '已生成并挂载到对应位置，点击查看', type: 'success', onClick: () => { openTaskById(event.taskId) } })
    } else if (event.type === 'needs_review') {
      const count = (event.task?.candidates || []).length
      ElNotification({ title: '生图完成', message: count > 1 ? `${count} 张候选已挂载，请选择主图` : '候选已导入，请选择', type: 'success', onClick: () => { openTaskById(event.taskId) } })
    } else if (event.type === 'failed') {
      ElNotification({ title: '生图失败', message: event.message || '请重新排队', type: 'error', onClick: () => { openTaskById(event.taskId) } })
    } else if (event.type === 'environment_blocked') {
      const failed = event.diagnostics?.checks?.find((check) => check.status === 'failed')
      ElNotification({ title: '生图环境未就绪', message: failed?.message || '请修复环境后重新检测', type: 'warning', onClick: () => { openTaskById(event.taskId) } })
    } else if (event.type === 'terminal') {
      // 异步追探一次领取接口，确认队列已清空才提示"全部完成"；
      // 探针若恰好领到任务，把领取结果直接交回驱动器推进，避免其滞留 preparing。
      void probeQueueAfterTerminal(event)
    }
  }

  async function probeQueueAfterTerminal(event) {
    try {
      const result = await imageGenerationTaskAPI.claimNext()
      if (result?.claimed) {
        queueDriver?.tick(result)
        return
      }
      if (result?.active_task_id) return
      // No active task does not imply every task succeeded: review and failed
      // tasks are terminal too. Read the summary before showing completion.
      const summaryResult = await imageGenerationTaskAPI.summary(event.task?.drama_id ?? dramaId.value)
      const remaining = ['draft', 'queued', 'preparing', 'submitted', 'generating']
        .reduce((total, status) => total + Number(summaryResult?.[status] || 0), 0)
      if (remaining > 0) return
      const review = Number(summaryResult?.needs_review || 0)
      const failed = Number(summaryResult?.failed || 0)
      const hasIssues = review || failed
      ElNotification({
        title: hasIssues ? '队列已处理' : '队列完成',
        message: hasIssues ? `队列已处理：${review} 个待审核，${failed} 个失败` : '全部生图任务已完成',
        type: hasIssues ? 'warning' : 'success',
        onClick: () => { openTaskById(event.taskId) },
      })
    } catch (_) {
      // 探针失败保持静默：驱动器的下一个周期会正常领取并推进
    }
  }

  async function loadAutoSelect() {
    const settings = await aiAPI.getImageGenerationSettings()
    autoSelect.value = settings?.chatgpt_web?.auto_select !== false
    return autoSelect.value
  }
  async function setAutoSelect(value) {
    const settings = await aiAPI.updateImageGenerationSettings({ auto_select: value === true })
    autoSelect.value = settings?.chatgpt_web?.auto_select !== false
    return autoSelect.value
  }
  async function batchSelectFirst(id) {
    const report = await imageGenerationTaskAPI.batchSelectFirst(id)
    await loadSummary(id, { reattach: false })
    return report
  }

  async function openTaskById(taskId) {
    currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.get(taskId))
    drawerVisible.value = true
    startTaskPolling()
  }

  function startQueueDriver() {
    if (queueDriver) return
    queueDriver = createQueueDriver({
      claimNext: imageGenerationTaskAPI.claimNext,
      getTask: async (id) => normalizeImageGenerationTask(await imageGenerationTaskAPI.get(id)),
      prepareSend: (id) => imageGenerationTaskAPI.prepareSend(id),
      sendAttempt: sendChatGPTAttempt,
      acknowledge: (id, attemptId) => imageGenerationTaskAPI.acknowledge(id, attemptId),
      failTask: (id, message) => imageGenerationTaskAPI.failTask(id, message),
      deferTask: (id) => imageGenerationTaskAPI.deferTask(id),
      cancelSend: (attemptId) => cancelChatGPTAttemptSend(attemptId),
      beforeSend: (task) => checkEnvironment({ dramaId: task.drama_id, channel: task.generation_channel, targetType: task.target_type, targetId: task.target_id }, { force: true }),
      onEvent: notifyQueueEvent,
    })
    queueDriver.start()
    // start() only pushes one claimed task to a terminal state; keep a
    // page-session timer ticking so subsequently queued tasks drain too.
    queueDriverTimer = globalThis.setInterval(() => { queueDriver?.tick() }, 5000)
  }

  function stopQueueDriver() {
    if (queueDriverTimer != null) globalThis.clearInterval(queueDriverTimer)
    queueDriverTimer = null
    queueDriver?.stop()
    queueDriver = null
  }

  async function requeueTask(task) {
    if (!task?.id) throw new Error('图片生成任务不存在')
    loading.value = true
    errorMessage.value = ''
    try {
      currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.retry(task.id))
      if (currentTask.value.generation_channel === 'api') {
        currentTask.value = normalizeImageGenerationTask(await imageGenerationTaskAPI.submit(currentTask.value.id))
      }
      startTaskPolling(0)
      await loadSummary(task.drama_id ?? dramaId.value, { reattach: false })
      return currentTask.value
    } catch (error) {
      // Keep the drawer's original failure message visible; only record why
      // the requeue attempt itself did not go through.
      errorMessage.value = error?.message || '重新排队失败'
      throw error
    } finally {
      loading.value = false
    }
  }

  return { dramaId, defaultChannel, summary, environment, autoSelect, generationSettledTick, loadAutoSelect, setAutoSelect, batchSelectFirst, checkEnvironment, clearEnvironmentCache: clearImageGenerationEnvironmentCache, currentTask, drawerVisible, loading, errorMessage, loadSummary, loadDefault, setDefaultChannel, openTask, refreshTask, sendToChatGPT, recoverCapture, selectResult, closeDrawer, startQueueDriver, stopQueueDriver, openTaskById, requeueTask }
})
