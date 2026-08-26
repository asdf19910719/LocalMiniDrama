export const selectors = {
  composer: 'textarea#prompt-textarea, textarea[placeholder*="Message"], [contenteditable="true"]',
  file: 'input[type="file"]',
  send: 'button[data-testid="send-button"], button[aria-label*="Send"]',
  message: '[data-message-id],[data-testid^="conversation-turn-"]',
  assistant: '[data-message-author-role="assistant"], [data-message-author-role="assistant"] [data-message-id], [data-turn="assistant"], [data-turn="assistant"] [data-testid^="conversation-turn-"]',
  user: '[data-message-author-role="user"]',
};
