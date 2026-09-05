import { messageIdentity, identityMatches } from './messageIdentity.js';

function fingerprint(node, id, index, url) {
  // ChatGPT may render one generated file through multiple responsive nodes;
  // source URL is stable while DOM position is not.
  return `${id}:${url}`;
}

function semanticImageLabel(element) {
  return String(element?.getAttribute?.('aria-label') || element?.getAttribute?.('alt') || element?.alt || '').trim();
}

function isCompletedImageLabel(value) {
  return /^(已生成图片|generated image)(?:[:：]|$)/i.test(String(value || '').trim());
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
  const groupsBySource = new Map();
  for (const img of [...(node.querySelectorAll?.('img') || [])]) {
    const sourceUrl = img.currentSrc || img.src || img.getAttribute?.('src');
    if (!sourceUrl || !/^(?:https?:|blob:|data:)/i.test(sourceUrl)) continue;
    let group = groupsBySource.get(sourceUrl);
    if (!group) {
      group = { sourceUrl, images: [] };
      groupsBySource.set(sourceUrl, group);
    }
    group.images.push(img);
  }
  let pendingResultCount = 0;
  const results = [...groupsBySource.values()].map(({ sourceUrl, images }, resultIndex) => {
    // blob:/data: entries are transient placeholders while ChatGPT materializes
    // the original; fetching them fails the allowlist and must not fail the attempt.
    // ChatGPT also assigns the final HTTP URL before the image response is
    // readable. Starting fetch at that point can hang indefinitely, so an
    // explicitly incomplete browser image remains a generating placeholder.
    const readyImage = /^https?:/i.test(sourceUrl) ? images.find((img) => {
      const pendingLoad = img.complete === false
        || (typeof img.naturalWidth === 'number' && img.naturalWidth <= 0);
      const alt = String(img.alt || img.getAttribute?.('alt') || '').trim();
      return !pendingLoad || isCompletedImageLabel(alt);
    }) : null;
    // Current ChatGPT marks completed imagegen results as lazy images. When
    // their turn is off-screen, Chromium deliberately leaves complete=false
    // and naturalWidth=0 forever even though the authenticated estuary URL is
    // already downloadable. The generated-image alt text is ChatGPT's stable
    // semantic completion marker, so it is safe to fetch that URL directly.
    if (!readyImage) {
      pendingResultCount += 1;
      return null;
    }
    return { resultIndex, sourceUrl, sourceMime: readyImage.dataset?.mime || null, nodeFingerprint: fingerprint(node, actual.messageId, resultIndex, sourceUrl) };
  }).filter(Boolean);
  const hasCompletedShell = !results.length && [...(node.querySelectorAll?.('[aria-label], [role="img"], img[alt]') || [])]
    .some((element) => isCompletedImageLabel(semanticImageLabel(element)));
  return {
    status: results.length ? 'RESULT_READY' : hasCompletedShell ? 'RESULT_SHELL' : 'GENERATING',
    resultSetId: attempt.resultSetId || `${attempt.attemptId || expected}:results`,
    attemptId: attempt.attemptId,
    assistantMessageId: actual.messageId,
    pendingResultCount,
    results,
  };
}

export function resultIdentity(result, attempt) {
  if (!result || result.attemptId !== attempt?.attemptId || result.resultIndex === undefined) return { status: 'UNBOUND_RESULT' };
  return result;
}
