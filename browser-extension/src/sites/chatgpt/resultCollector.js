import { messageIdentity, identityMatches } from './messageIdentity.js';

function fingerprint(node, id, index, url) {
  return `${id}:${index}:${url}`;
}

export function extractResultSet(node, attempt = {}) {
  const actual = messageIdentity(node);
  const expected = attempt.assistantMessageId || attempt.messageId;
  if (!actual || !expected) return { status: 'NEEDS_REVIEW', reason: 'missing assistant identity', results: [] };
  if (!identityMatches(actual, { messageId: expected })) return { status: 'UNBOUND_RESULT', reason: 'assistant identity mismatch', results: [] };
  const results = [...(node.querySelectorAll?.('img') || [])].map((img, resultIndex) => {
    const sourceUrl = img.currentSrc || img.src || img.getAttribute?.('src');
    if (!sourceUrl) return null;
    return { resultIndex, sourceUrl, sourceMime: img.dataset?.mime || null, nodeFingerprint: fingerprint(node, actual.messageId, resultIndex, sourceUrl) };
  }).filter(Boolean);
  return { status: results.length ? 'RESULT_READY' : 'GENERATING', resultSetId: attempt.resultSetId || `${attempt.attemptId || expected}:results`, attemptId: attempt.attemptId, results };
}

export function resultIdentity(result, attempt) {
  if (!result || result.attemptId !== attempt?.attemptId || result.resultIndex === undefined) return { status: 'UNBOUND_RESULT' };
  return result;
}
