import { messageIdentity, identityMatches } from './messageIdentity.js';

function fingerprint(node, id, index, url) {
  // ChatGPT may render one generated file through multiple responsive nodes;
  // source URL is stable while DOM position is not.
  return `${id}:${url}`;
}

export function extractResultSet(node, attempt = {}) {
  const actual = messageIdentity(node);
  const expected = attempt.assistantMessageId || attempt.messageId;
  if (!actual || !expected) return { status: 'NEEDS_REVIEW', reason: 'missing assistant identity', results: [] };
  if (!identityMatches(actual, { messageId: expected })) return { status: 'UNBOUND_RESULT', reason: 'assistant identity mismatch', results: [] };
  // Defense in depth: a user turn bound by an older build must never surface
  // its reference thumbnails as results — keep waiting for the real reply.
  const turnRole = node.getAttribute?.('data-turn') || node.getAttribute?.('data-message-author-role');
  if (turnRole === 'user') return { status: 'GENERATING', resultSetId: attempt.resultSetId || `${attempt.attemptId || expected}:results`, attemptId: attempt.attemptId, assistantMessageId: actual.messageId, results: [] };
  const seenSources = new Set();
  const results = [...(node.querySelectorAll?.('img') || [])].map((img) => {
    const sourceUrl = img.currentSrc || img.src || img.getAttribute?.('src');
    // blob:/data: entries are transient placeholders while ChatGPT materializes
    // the original; fetching them fails the allowlist and must not fail the attempt.
    if (!sourceUrl || !/^https?:/i.test(sourceUrl) || seenSources.has(sourceUrl)) return null;
    seenSources.add(sourceUrl);
    const resultIndex = seenSources.size - 1;
    return { resultIndex, sourceUrl, sourceMime: img.dataset?.mime || null, nodeFingerprint: fingerprint(node, actual.messageId, resultIndex, sourceUrl) };
  }).filter(Boolean);
  return {
    status: results.length ? 'RESULT_READY' : 'GENERATING',
    resultSetId: attempt.resultSetId || `${attempt.attemptId || expected}:results`,
    attemptId: attempt.attemptId,
    assistantMessageId: actual.messageId,
    results,
  };
}

export function resultIdentity(result, attempt) {
  if (!result || result.attemptId !== attempt?.attemptId || result.resultIndex === undefined) return { status: 'UNBOUND_RESULT' };
  return result;
}
