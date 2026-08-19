export const PROVIDER_ADAPTERS = Object.freeze({
  chatgpt: {
    label: 'ChatGPT',
    assistantSelectors: [
      '[data-message-author-role="assistant"]',
      '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]',
      '.agent-turn [data-message-author-role="assistant"]',
      '.agent-turn .markdown',
    ],
    userSelectors: [
      '[data-message-author-role="user"]',
      '[data-testid^="conversation-turn-"] [data-message-author-role="user"]',
    ],
    inputSelectors: ['#prompt-textarea', 'textarea', '[contenteditable="true"][role="textbox"]'],
    sendButtonSelectors: ['button[data-testid="send-button"]', 'button[aria-label*="send" i]', 'button[aria-label*="메시지 보내기" i]'],
    generatingSelectors: ['button[data-testid="stop-button"]', 'button[aria-label*="stop streaming" i]', 'button[aria-label*="stop generating" i]', 'button[aria-label*="중지" i]'],
    responseQuietMs: 1800,
  },
  claude: {
    label: 'Claude',
    assistantSelectors: [
      '[data-testid="assistant-message"]',
      '[data-testid*="assistant" i] .prose',
      '[data-testid*="assistant" i]',
      '[data-is-streaming] .font-claude-message',
      '[data-is-streaming] .prose',
      '[data-test-render-count] .font-claude-message',
    ],
    userSelectors: ['[data-testid="user-message"]', '[data-testid*="user" i] .prose', '[data-testid*="user" i]'],
    inputSelectors: ['div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', 'textarea'],
    sendButtonSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="보내" i]', 'button[data-testid*="send" i]', 'button[title*="send" i]'],
    generatingSelectors: ['[data-is-streaming="true"]', 'button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', 'button[data-testid*="stop" i]'],
    responseQuietMs: 2000,
  },
  gemini: {
    label: 'Gemini',
    assistantSelectors: ['model-response', '[data-test-id="model-response"]', '[data-testid="model-response"]', 'model-response message-content', '.model-response-text'],
    userSelectors: ['user-query', '[data-test-id="user-query"]', '[data-testid="user-query"]', '.user-query'],
    inputSelectors: ['rich-textarea [contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'textarea'],
    sendButtonSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="보내" i]', 'button[title*="send" i]', 'button[data-testid*="send" i]', 'button[data-test-id*="send" i]'],
    generatingSelectors: ['button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', '[data-test-id*="stop" i]', '[data-testid*="stop" i]'],
    responseQuietMs: 2000,
  },
  copilot: {
    label: 'Copilot',
    assistantSelectors: ['[data-message-author-role="assistant"]', '[data-author="assistant"]', '[data-content="ai-message"]', '[data-testid*="assistant" i]', 'cib-message-group[source="bot"]', 'cib-message[type="bot"]'],
    userSelectors: ['[data-message-author-role="user"]', '[data-author="user"]', '[data-content="user-message"]', 'cib-message-group[source="user"]', 'cib-message[type="user"]'],
    inputSelectors: ['textarea', '[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
    sendButtonSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="보내" i]', 'button[title*="send" i]', 'button[data-testid*="send" i]'],
    generatingSelectors: ['button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', 'button[data-testid*="stop" i]', '[data-content*="stop" i]'],
    responseQuietMs: 2000,
  },
});

export function adapterFor(provider) {
  return PROVIDER_ADAPTERS[provider] || null;
}
