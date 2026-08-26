export function messageIdentity(node) {
  if (!node) return null;
  const messageId = node.dataset?.messageId || node.getAttribute?.('data-message-id');
  const domId = node.getAttribute?.('data-testid') || node.getAttribute?.('data-turn-id-container') || node.id || null;
  if (messageId) return { messageId, confidence: 'provider' };
  if (domId) return { messageId: domId, confidence: 'dom' };
  return null;
}

export function conversationIdentity(url = globalThis.location?.href || '') {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/c\/([^/]+)/);
    return match ? { conversationId: decodeURIComponent(match[1]), confidence: 'url' } : null;
  } catch { return null; }
}

export function identityMatches(actual, expected) {
  if (!actual || !expected) return false;
  return actual.messageId === (expected.messageId || expected.assistantMessageId || expected.userMessageId);
}
