const TRANSIENT_SEND_ERRORS = /NOT_READY|provider tab unavailable|provider composer is not ready/

export function isTransientSendError(error) {
  return TRANSIENT_SEND_ERRORS.test(String(error?.message || error || ''))
}

const TERMINAL = new Set(['needs_review', 'completed', 'failed', 'cancelled'])

export function createQueueDriver({
  claimNext, getTask, prepareSend, sendAttempt, acknowledge, failTask, beforeSend, deferTask, cancelSend,
  onEvent = () => {},
  intervalMs = 5000,
  retryLimit = 2,
  retryDelayMs = 5000,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  // Live from construction so tick() can be driven manually (the tests do this);
  // stop() pauses (tick no-ops, the watch loop exits), start() resumes and kicks a cycle.
  let stopped = false
  let driving = false
  let blocked = false
  // `preclaimed` lets the caller hand over a result it already obtained from
  // claimNext (e.g. the store's queue-drained probe) so it is still driven
  // instead of idling in preparing until the stale timeout.
  async function tick(preclaimed) {
    if (stopped || driving || blocked) return
    driving = true
    try {
      const result = preclaimed || await claimNext()
      if (!result?.claimed) return
      await drive(result.task)
    } catch (error) {
      onEvent({ type: 'driver_error', message: error?.message })
    } finally {
      driving = false
    }
  }
  async function drive(task) {
    onEvent({ type: 'claimed', taskId: task.id, task })
    let attemptId = null
    try {
      if (beforeSend) {
        const readiness = await beforeSend(task)
        if (readiness?.canProceed === false) {
          if (deferTask) await deferTask(task.id).catch(() => {})
          blocked = true
          onEvent({ type: 'environment_blocked', taskId: task.id, task, diagnostics: readiness })
          return
        }
      }
      const prepared = await prepareSend(task.id)
      attemptId = prepared.attempt?.id
      if (!prepared.already_submitted) await sendWithRetry(prepared)
      const acknowledged = await acknowledge(task.id, attemptId)
      onEvent({ type: 'submitted', taskId: task.id, task: acknowledged })
    } catch (error) {
      const message = error?.message || '发送失败'
      await failTask(task.id, message).catch(() => {})
      // 后台可能仍在排队或等待发送按钮;通知它撤下该 attempt,避免任务判失败后提示词才被点出。
      if (attemptId && cancelSend) await cancelSend(attemptId).catch(() => {})
      onEvent({ type: 'failed', taskId: task.id, message })
      return
    }
    await watch(task.id)
  }
  async function sendWithRetry(prepared) {
    let retries = 0
    for (;;) {
      try {
        await sendAttempt(prepared)
        return
      } catch (error) {
        if (!isTransientSendError(error) || retries >= retryLimit) throw error
        retries += 1
        onEvent({ type: 'retrying', taskId: prepared.task.id, attempt: retries, message: error?.message })
        // Zero delay means "retry immediately"; every real wait goes through the injected delay.
        if (retryDelayMs > 0) await delay(retryDelayMs)
      }
    }
  }
  async function watch(taskId) {
    let lastStatus = null
    while (!stopped) {
      let task
      try { task = await getTask(taskId) } catch { return }
      if (!task) return
      if (task.status !== lastStatus) {
        if (task.status === 'needs_review') onEvent({ type: 'needs_review', taskId, task })
        if (task.status === 'failed') onEvent({ type: 'failed', taskId, task, message: task.error_message })
        if (task.status === 'completed') onEvent({ type: 'completed', taskId, task })
        lastStatus = task.status
      }
      if (TERMINAL.has(task.status)) { onEvent({ type: 'terminal', taskId, task, status: task.status }); return }
      if (intervalMs > 0) await delay(intervalMs)
    }
  }
  return {
    start() { stopped = false; blocked = false; tick() },
    stop() { stopped = true },
    resume() { blocked = false; if (!stopped) tick() },
    tick,
    isDriving: () => driving,
  }
}
