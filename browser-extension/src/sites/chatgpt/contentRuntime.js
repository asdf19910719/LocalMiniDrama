export async function captureResults({ adapter, chromeApi, attempt, resultSet }) {
  try {
    if (resultSet.status === 'CAPTURE_COMPLETE') {
      const response = await chromeApi.runtime.sendMessage({
        action: 'attemptCaptureComplete',
        payload: {
          attemptId: attempt.attemptId,
          conversationId: attempt.conversationId || adapter.getConversationIdentity?.()?.conversationId || null,
        },
      });
      if (!response?.ok) throw new Error(response?.error || 'CAPTURE_COMPLETION_NOT_ACKNOWLEDGED');
      return;
    }
    if (resultSet.status === 'USER_BOUND') {
      const response = await chromeApi.runtime.sendMessage({
        action: 'attemptUserBound',
        payload: {
          attemptId: attempt.attemptId,
          conversationId: attempt.conversationId || adapter.getConversationIdentity?.()?.conversationId || null,
          userMessageId: resultSet.userMessageId,
        },
      });
      if (!response?.ok) throw new Error(response?.error || 'USER_IDENTITY_NOT_ACKNOWLEDGED');
      return;
    }
    if (resultSet.status === 'RESULT_SHELL_STALLED') {
      const response = await chromeApi.runtime.sendMessage({
        action: 'recoverGrayShell',
        payload: {
          attemptId: attempt.attemptId,
          conversationId: attempt.conversationId || adapter.getConversationIdentity?.()?.conversationId || null,
          assistantMessageId: resultSet.assistantMessageId || attempt.assistantMessageId || null,
        },
      });
      if (!response?.ok) {
        const code = response?.error === 'RESULT_SHELL_STUCK' ? 'RESULT_SHELL_STUCK' : 'RESULT_SHELL_RECOVERY_FAILED';
        throw Object.assign(new Error(response?.error || code), { code });
      }
      return;
    }
    if (resultSet.status === 'GENERATING') {
      // Progress reporting is best-effort. A transient backend/status failure
      // must never tear down the observer that will later capture the image.
      try {
        await chromeApi.runtime.sendMessage({
          action: 'attemptGenerating',
          payload: {
            attemptId: attempt.attemptId,
            conversationId: attempt.conversationId || adapter.getConversationIdentity?.()?.conversationId || null,
            assistantMessageId: resultSet.assistantMessageId || attempt.assistantMessageId || null,
          },
        });
      } catch (_) {}
      return;
    }
    const assistantMessageId = resultSet.assistantMessageId || attempt.assistantMessageId || null;
    const conversationId = attempt.conversationId || adapter.getConversationIdentity?.()?.conversationId || null;
    const bound = await chromeApi.runtime.sendMessage({
      action: 'attemptBound',
      payload: { attemptId: attempt.attemptId, conversationId, assistantMessageId },
    });
    if (!bound?.ok) throw new Error(bound?.error || 'ATTEMPT_IDENTITY_NOT_ACKNOWLEDGED');
    for (const result of resultSet.results || []) {
      const original = await adapter.fetchOriginal(result);
      const response = await chromeApi.runtime.sendMessage({
        action: 'capturedResult',
        payload: {
          ...result,
          attemptId: attempt.attemptId,
          resultSetId: resultSet.resultSetId,
          conversationId,
          assistantMessageId,
          sourceMime: original.mime,
          bytes: original.bytes,
        },
      });
      if (!response?.ok) throw new Error(response?.error || 'RESULT_IMPORT_NOT_ACKNOWLEDGED');
    }
  } catch (error) {
    try {
      await chromeApi.runtime.sendMessage({
        action: 'adapterError',
        payload: {
          attemptId: attempt.attemptId,
          code: error.code || 'RESULT_CAPTURE_FAILED',
          message: error.message,
          assistantMessageId: resultSet.assistantMessageId || attempt.assistantMessageId || null,
          resultSetId: resultSet.resultSetId || null,
        },
      });
    } catch (_) {
      // Keep the original capture error when the diagnostic event cannot be queued.
    }
    throw error;
  }
}

const INSTALL_FLAG = '__AISTORY_CHATGPT_BRIDGE_INSTALLED__';
const DOM_INSTALL_FLAG = 'data-aistory-chatgpt-bridge';

export function installChatGPTContentBridge({ chromeApi, adapter, globalRef = globalThis }) {
  if (globalRef[INSTALL_FLAG]) return false;
  const documentElement = globalRef.document?.documentElement;
  if (documentElement?.hasAttribute?.(DOM_INSTALL_FLAG)) return false;
  documentElement?.setAttribute?.(DOM_INSTALL_FLAG, 'v1');
  globalRef[INSTALL_FLAG] = true;
  let activeObservation = null;

  chromeApi.runtime.onMessage.addListener((message, _sender, reply) => {
    (async () => {
      try {
        if (message.action === 'identity') return reply({ ok: true, value: adapter.getConversationIdentity() });
        if (message.action === 'ready') {
          const composer = adapter.document?.querySelector?.('[contenteditable="true"], textarea#prompt-textarea, textarea[placeholder*="Message"], [role="textbox"][aria-label*="聊天"], [role="textbox"][aria-label*="Message"]');
          const composerReady = typeof adapter.isComposerReady === 'function' ? adapter.isComposerReady() : Boolean(composer);
          const submit = typeof adapter.isSubmitReady === 'function' ? adapter.isSubmitReady() : undefined;
          const mode = typeof adapter.pageMode === 'function' ? adapter.pageMode() : undefined;
          return reply({ ok: true, value: { composer: composerReady, ...(submit === undefined ? {} : { submit }), ...(mode === undefined ? {} : { mode }) } });
        }
        if (message.action === 'exitImageEditor') return reply({ ok: true, value: await adapter.closeImageEditor() });
        if (message.action === 'fill') return reply({ ok: true, value: adapter.fillPrompt(message.prompt) });
        if (message.action === 'upload') return reply({ ok: true, value: await adapter.uploadReferences(message.files || []) });
        if (message.action === 'submit') {
          const submit = typeof adapter.submitWhenReady === 'function' ? await adapter.submitWhenReady() : adapter.submit();
          return reply({ ok: true, value: submit });
        }
        if (message.action === 'beginAttempt') {
          activeObservation?.();
          const attempt = message.attempt || {};
          activeObservation = adapter.beginAttempt(
            attempt,
            (resultSet) => captureResults({ adapter, chromeApi, attempt, resultSet }),
            (error) => chromeApi.runtime.sendMessage({
              action: 'adapterError',
              payload: {
                attemptId: attempt.attemptId,
                code: error.code || 'ADAPTER_ERROR',
                message: error.message,
              },
            }),
          );
          return reply({ ok: true });
        }
        if (message.action === 'recoverAttempt') {
          activeObservation?.();
          const attempt = message.attempt || {};
          activeObservation = adapter.recoverAttempt(
            attempt,
            (resultSet) => captureResults({ adapter, chromeApi, attempt, resultSet }),
            (error) => chromeApi.runtime.sendMessage({
              action: 'adapterError',
              payload: {
                attemptId: attempt.attemptId,
                code: error.code || 'ADAPTER_ERROR',
                message: error.message,
              },
            }),
          );
          return reply({ ok: true });
        }
        if (message.action === 'stopAttempt') {
          activeObservation?.();
          activeObservation = null;
          return reply({ ok: true });
        }
        if (message.action === 'fetchOriginal') return reply({ ok: true, value: await adapter.fetchOriginal(message.result) });
        return reply({ ok: false, error: 'Unknown action' });
      } catch (error) {
        return reply({ ok: false, error: error.code || error.message });
      }
    })();
    return true;
  });
  return true;
}
