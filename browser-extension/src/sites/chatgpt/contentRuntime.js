export async function captureResults({ adapter, chromeApi, attempt, resultSet }) {
  try {
    for (const result of resultSet.results || []) {
      const original = await adapter.fetchOriginal(result);
      const response = await chromeApi.runtime.sendMessage({
        action: 'capturedResult',
        payload: {
          ...result,
          attemptId: attempt.attemptId,
          resultSetId: resultSet.resultSetId,
          conversationId: attempt.conversationId || adapter.getConversationIdentity?.()?.conversationId || null,
          assistantMessageId: resultSet.assistantMessageId || attempt.assistantMessageId || null,
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
        if (message.action === 'fill') return reply({ ok: true, value: adapter.fillPrompt(message.prompt) });
        if (message.action === 'upload') return reply({ ok: true, value: await adapter.uploadReferences(message.files || []) });
        if (message.action === 'submit') return reply({ ok: true, value: adapter.submit() });
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
