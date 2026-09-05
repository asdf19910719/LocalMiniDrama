export const selectors = {
  composer: 'textarea#prompt-textarea, textarea[placeholder*="Message"], [contenteditable="true"], [role="textbox"][aria-label*="聊天"], [role="textbox"][aria-label*="Message"]',
  file: 'input[type="file"]',
  send: 'button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]',
  message: '[data-message-id],[data-testid^="conversation-turn-"]',
  turn: '[data-turn][data-testid^="conversation-turn-"], [data-message-author-role][data-message-id]',
  assistant: '[data-message-author-role="assistant"], [data-message-author-role="assistant"] [data-message-id], [data-turn="assistant"], [data-turn="assistant"] [data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
  user: '[data-message-author-role="user"]',
};
