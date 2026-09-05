export function messageIdentity(node) {
  if (!node) return null;
  const providerId = node.dataset?.messageId || node.getAttribute?.('data-message-id');
  // `data-testid="conversation-turn-N"` is only the current render index and
  // ChatGPT renumbers it after a reload. The request/turn id survives that
  // rerender, so prefer it while retaining the render id as a legacy alias.
  const turnId = node.getAttribute?.('data-turn-id') || node.getAttribute?.('data-turn-id-container');
  const domId = node.getAttribute?.('data-testid') || node.id || null;
  const ids = [...new Set([providerId, turnId, domId].filter(Boolean).map(String))];
  if (ids.length) return {
    messageId: ids[0],
    confidence: providerId ? 'provider' : turnId ? 'turn' : 'dom',
    aliases: ids.slice(1),
  };
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
  const expectedIds = [expected.messageId, expected.assistantMessageId, expected.userMessageId, ...(expected.aliases || [])]
    .filter(Boolean).map(String);
  const actualIds = [actual.messageId, ...(actual.aliases || [])].filter(Boolean).map(String);
  return actualIds.some((id) => expectedIds.includes(id));
}
