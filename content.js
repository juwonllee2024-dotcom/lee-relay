(() => {
  if (globalThis.__LEE_RELAY_BOT_V3__) {
    chrome.runtime.sendMessage({ type: 'PAGE_READY', provider: detectProvider() }).catch(() => {});
    return;
  }
  globalThis.__LEE_RELAY_BOT_V3__ = true;

  function detectProvider() {
    const host = location.hostname.toLowerCase();
    if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'chatgpt';
    if (host === 'claude.ai') return 'claude';
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'copilot.microsoft.com') return 'copilot';
    return null;
  }

  const provider = detectProvider();
  if (!provider) return;

  const ADAPTERS = {
    chatgpt: {
      assistantSelectors: ['[data-message-author-role="assistant"]', '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]', '.agent-turn [data-message-author-role="assistant"]', '.agent-turn .markdown'],
      userSelectors: ['[data-message-author-role="user"]', '[data-testid^="conversation-turn-"] [data-message-author-role="user"]'],
      inputSelectors: ['#prompt-textarea', 'textarea', '[contenteditable="true"][role="textbox"]'],
      sendButtonSelectors: ['button[data-testid="send-button"]', 'button[aria-label*="send" i]', 'button[aria-label*="메시지 보내기" i]'],
      generatingSelectors: ['button[data-testid="stop-button"]', 'button[aria-label*="stop streaming" i]', 'button[aria-label*="stop generating" i]', 'button[aria-label*="중지" i]'],
      responseQuietMs: 1800,
    },
    claude: {
      assistantSelectors: ['[data-testid="assistant-message"]', '[data-testid*="assistant" i] .prose', '[data-testid*="assistant" i]', '[data-is-streaming] .font-claude-message', '[data-is-streaming] .prose', '[data-test-render-count] .font-claude-message'],
      userSelectors: ['[data-testid="user-message"]', '[data-testid*="user" i] .prose', '[data-testid*="user" i]'],
      inputSelectors: ['div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', 'textarea'],
      sendButtonSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="보내" i]', 'button[data-testid*="send" i]', 'button[title*="send" i]'],
      generatingSelectors: ['[data-is-streaming="true"]', 'button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', 'button[data-testid*="stop" i]'],
      responseQuietMs: 2000,
    },
    gemini: {
      assistantSelectors: ['model-response', '[data-test-id="model-response"]', '[data-testid="model-response"]', 'model-response message-content', '.model-response-text'],
      userSelectors: ['user-query', '[data-test-id="user-query"]', '[data-testid="user-query"]', '.user-query'],
      inputSelectors: ['rich-textarea [contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'textarea'],
      sendButtonSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="보내" i]', 'button[title*="send" i]', 'button[data-testid*="send" i]', 'button[data-test-id*="send" i]'],
      generatingSelectors: ['button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', '[data-test-id*="stop" i]', '[data-testid*="stop" i]'],
      responseQuietMs: 2000,
    },
    copilot: {
      assistantSelectors: ['[data-message-author-role="assistant"]', '[data-author="assistant"]', '[data-content="ai-message"]', '[data-testid*="assistant" i]', 'cib-message-group[source="bot"]', 'cib-message[type="bot"]'],
      userSelectors: ['[data-message-author-role="user"]', '[data-author="user"]', '[data-content="user-message"]', 'cib-message-group[source="user"]', 'cib-message[type="user"]'],
      inputSelectors: ['textarea', '[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
      sendButtonSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="보내" i]', 'button[title*="send" i]', 'button[data-testid*="send" i]'],
      generatingSelectors: ['button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', 'button[data-testid*="stop" i]', '[data-content*="stop" i]'],
      responseQuietMs: 2000,
    },
  };

  const adapter = ADAPTERS[provider];
  const ROOT_RESCAN_MS = 3500;
  const NOISE = new Set(['copy','copy response','share','like','dislike','read aloud','regenerate','복사','공유','좋아요','싫어요','소리내어 읽기','다시 생성','다시 시도']);
  let rootCache = [document];
  let lastRootScanAt = 0;
  let attachment = null;
  let transaction = null;
  let pollTimer = null;

  function cleanText(raw = '') {
    const lines = String(raw).replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[\t ]+/g, ' ').trim());
    while (lines.length && (!lines[0] || NOISE.has(lines[0].toLowerCase()))) lines.shift();
    while (lines.length && (!lines.at(-1) || NOISE.has(lines.at(-1).toLowerCase()))) lines.pop();
    return lines.filter(Boolean).join('\n').trim();
  }

  async function signatureText(text = '') {
    const normalized = cleanText(text).replace(/\s+/g, ' ');
    if (!normalized) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function getRoots(force = false) {
    const now = Date.now();
    if (!force && now - lastRootScanAt < ROOT_RESCAN_MS) return rootCache;
    const roots = [document];
    const seen = new Set(roots);
    for (let i = 0; i < roots.length; i += 1) {
      let all = [];
      try { all = roots[i].querySelectorAll('*'); } catch { all = []; }
      for (const el of all) {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) {
          seen.add(el.shadowRoot);
          roots.push(el.shadowRoot);
        }
      }
    }
    rootCache = roots;
    lastRootScanAt = now;
    return roots;
  }

  function queryDeep(selector, roots = getRoots()) {
    const found = [];
    for (const root of roots) {
      try { found.push(...root.querySelectorAll(selector)); } catch { }
    }
    return [...new Set(found)];
  }

  function documentRank(el) {
    try {
      const rect = el.getBoundingClientRect();
      return (window.scrollY + rect.top) * 100000 + (window.scrollX + rect.left);
    } catch { return 0; }
  }

  function collectMessages(selectors, roots = getRoots()) {
    const nodes = [];
    selectors.forEach((selector, selectorIndex) => {
      for (const el of queryDeep(selector, roots)) {
        if (!isVisible(el)) continue;
        const text = cleanText(el.innerText || el.textContent || '');
        if (!text) continue;
        nodes.push({ el, text, selectorIndex, rank: documentRank(el) });
      }
    });
    const deduped = [...new Map(nodes.map((item) => [item.el, item])).values()];
    deduped.sort((a, b) => a.rank - b.rank || a.selectorIndex - b.selectorIndex);
    return deduped;
  }

  function latestMessage(selectors, roots = getRoots()) {
    return collectMessages(selectors, roots).at(-1) || { el: null, text: '' };
  }

  function latestAssistant(roots = getRoots()) { return latestMessage(adapter.assistantSelectors, roots); }
  function latestUser(roots = getRoots()) { return latestMessage(adapter.userSelectors, roots); }

  function isGenerating(roots = getRoots()) {
    return adapter.generatingSelectors.some((selector) => queryDeep(selector, roots).some(isVisible));
  }

  function findInput() {
    const roots = getRoots(true);
    for (const selector of adapter.inputSelectors) {
      const list = queryDeep(selector, roots).filter(isVisible);
      if (list.length) return list.at(-1);
    }
    return null;
  }

  function inputText(input) {
    if (!input) return '';
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) return cleanText(input.value || '');
    return cleanText(input.innerText || input.textContent || '');
  }

  function setInputText(input, text) {
    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, text); else input.value = text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (input.isContentEditable) {
      input.textContent = '';
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, text); } catch { inserted = false; }
      if (!inserted) input.textContent = text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return;
    }
    throw new Error('Unsupported input element.');
  }

  function findSendButton(input) {
    const roots = getRoots(true);
    const nearby = input?.closest?.('form, main, footer') || document;
    for (const selector of adapter.sendButtonSelectors) {
      let local = [];
      try { local = [...nearby.querySelectorAll(selector)]; } catch { local = []; }
      const candidate = [...new Set([...local, ...queryDeep(selector, roots)])]
        .find((el) => isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
      if (candidate) return candidate;
    }
    return null;
  }

  async function snapshot() {
    const roots = getRoots(true);
    const assistant = latestAssistant(roots);
    const user = latestUser(roots);
    return {
      assistantText: assistant.text,
      assistantSignature: await signatureText(assistant.text),
      userText: user.text,
      userSignature: await signatureText(user.text),
      generating: isGenerating(roots),
      url: location.href,
    };
  }

  function identityMatches(message) {
    if (!attachment) return false;
    return message.meetingId === attachment.meetingId && message.participantId === attachment.participantId;
  }

  function transactionMatches(message) {
    return identityMatches(message) && transaction && message.transactionId === transaction.transactionId;
  }

  async function prepareDelivery(message) {
    if (!identityMatches(message)) throw new Error('Participant attachment mismatch.');
    const base = await snapshot();
    transaction = {
      meetingId: message.meetingId,
      transactionId: message.transactionId,
      participantId: message.participantId,
      promptText: cleanText(message.text || ''),
      promptSignature: message.promptSignature || await signatureText(message.text || ''),
      baselineAssistantSignature: base.assistantSignature,
      baselineUserSignature: base.userSignature,
      baselineUrl: location.href,
      baselineGenerating: Boolean(base.generating),
      armed: false,
      generationSeen: base.generating,
      responseCandidateText: '',
      responseCandidateSignature: null,
      responseLastChangedAt: Date.now(),
      responseSent: false,
      sendActionExecuted: false,
      deliveryConfirmed: false,
    };
    return base;
  }

  async function submitMessage(message) {
    if (!transactionMatches(message)) throw new Error('Transaction mismatch.');
    const text = cleanText(message.text || transaction.promptText);
    if (!text) throw new Error('Prompt is empty.');
    const input = findInput();
    if (!input) throw new Error(`${provider} input editor not found.`);
    setInputText(input, text);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const button = findSendButton(input);
    if (button) {
      button.click();
    } else {
      const form = input.closest?.('form');
      if (form?.requestSubmit) form.requestSubmit();
      else input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    }
    transaction.sendActionExecuted = true;
    return { sendActionExecuted: true };
  }

  async function deliveryEvidence() {
    if (!transaction) return { matchingUserMessage: false, inputCleared: false, generationStarted: false };
    const roots = getRoots(true);
    const users = collectMessages(adapter.userSelectors, roots);
    let matchingUserMessage = false;
    let userSignature = null;
    for (let i = users.length - 1; i >= Math.max(0, users.length - 6); i -= 1) {
      const sig = await signatureText(users[i].text);
      if (sig && sig === transaction.promptSignature) {
        matchingUserMessage = true;
        userSignature = sig;
        break;
      }
    }
    const input = findInput();
    const inputCleared = Boolean(input && !inputText(input));
    const generationStarted = isGenerating(roots) && !transaction.baselineGenerating;
    const userMessageAdvanced = Boolean(userSignature && userSignature !== transaction.baselineUserSignature);
    return { matchingUserMessage, inputCleared, generationStarted, userMessageAdvanced, userSignature };
  }

  async function verifyDelivery(message) {
    if (!transactionMatches(message)) throw new Error('Transaction mismatch.');
    const timeoutMs = Math.min(12000, Math.max(0, Number(message.timeoutMs) || 7000));
    const deadline = Date.now() + timeoutMs;
    let evidence = await deliveryEvidence();
    while (!evidence.matchingUserMessage && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      evidence = await deliveryEvidence();
    }
    return evidence;
  }

  async function responseStatus() {
    if (!transaction) return { active: false };
    const snap = await snapshot();
    const evidence = await deliveryEvidence();
    const changed = Boolean(snap.assistantSignature && snap.assistantSignature !== transaction.baselineAssistantSignature);
    const stableMs = Date.now() - transaction.responseLastChangedAt;
    return {
      active: true,
      deliveryConfirmed: Boolean(transaction.deliveryConfirmed),
      ...snap,
      ...evidence,
      changed,
      stableMs,
      transactionId: transaction.transactionId,
      meetingId: transaction.meetingId,
      participantId: transaction.participantId,
    };
  }

  async function pollResponse() {
    if (!transaction?.armed || transaction.responseSent) return;
    const snap = await snapshot();
    const evidence = await deliveryEvidence();
    const deliveryCorrelated = Boolean(transaction.deliveryConfirmed || evidence.matchingUserMessage);
    if (!deliveryCorrelated) return;
    if (snap.generating) transaction.generationSeen = true;
    const changed = Boolean(snap.assistantSignature && snap.assistantSignature !== transaction.baselineAssistantSignature);
    if (!changed || !snap.assistantText) return;

    if (snap.assistantSignature !== transaction.responseCandidateSignature) {
      transaction.responseCandidateSignature = snap.assistantSignature;
      transaction.responseCandidateText = snap.assistantText;
      transaction.responseLastChangedAt = Date.now();
      await chrome.runtime.sendMessage({
        type: 'RESPONSE_CANDIDATE',
        meetingId: transaction.meetingId,
        transactionId: transaction.transactionId,
        participantId: transaction.participantId,
        provider,
        text: snap.assistantText,
        signature: snap.assistantSignature,
        generating: snap.generating,
      }).catch(() => {});
      return;
    }

    const stableMs = Date.now() - transaction.responseLastChangedAt;
    const staleGeneration = snap.generating && stableMs >= 90000;
    if ((snap.generating && !staleGeneration) || stableMs < adapter.responseQuietMs) return;

    transaction.responseSent = true;
    transaction.armed = false;
    await chrome.runtime.sendMessage({
      type: 'RESPONSE_CONFIRMED',
      meetingId: transaction.meetingId,
      transactionId: transaction.transactionId,
      participantId: transaction.participantId,
      provider,
      text: snap.assistantText,
      signature: snap.assistantSignature,
      generationSeen: transaction.generationSeen,
      staleGeneration,
    }).catch(() => { transaction.responseSent = false; transaction.armed = true; });
  }

  function ensurePolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => pollResponse().catch(() => {}), 600);
  }

  function responseRect() {
    const info = latestAssistant(getRoots(true));
    if (!info.el) return null;
    const r = info.el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.max(0, r.left + scrollX - 10), y: Math.max(0, r.top + scrollY - 10), width: r.width + 20, height: r.height + 20, scale: 1 };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      switch (message?.type) {
        case 'PING':
          sendResponse({ ok: true, provider, attached: Boolean(attachment), transactionId: transaction?.transactionId || null });
          break;
        case 'ATTACH_PARTICIPANT':
          attachment = { meetingId: message.meetingId, participantId: message.participantId };
          ensurePolling();
          sendResponse({ ok: true, provider, url: location.href });
          break;
        case 'DETACH_PARTICIPANT':
          attachment = null;
          transaction = null;
          sendResponse({ ok: true });
          break;
        case 'PREPARE_DELIVERY': {
          const base = await prepareDelivery(message);
          sendResponse({ ok: true, ...base });
          break;
        }
        case 'SUBMIT_MESSAGE': {
          const result = await submitMessage(message);
          sendResponse({ ok: true, sendActionExecuted: Boolean(result.sendActionExecuted), delivered: false });
          break;
        }
        case 'VERIFY_DELIVERY': {
          const evidence = await verifyDelivery(message);
          sendResponse({ ok: true, matchingUserMessage: Boolean(evidence.matchingUserMessage), inputCleared: Boolean(evidence.inputCleared), generationStarted: Boolean(evidence.generationStarted), userSignature: evidence.userSignature || null });
          break;
        }
        case 'ARM_RESPONSE_OBSERVER':
          if (!transactionMatches(message)) throw new Error('Transaction mismatch.');
          if (message.baselineAssistantSignature !== undefined) transaction.baselineAssistantSignature = message.baselineAssistantSignature;
          transaction.deliveryConfirmed = true;
          transaction.armed = true;
          transaction.responseSent = false;
          transaction.responseCandidateText = '';
          transaction.responseCandidateSignature = null;
          transaction.responseLastChangedAt = Date.now();
          ensurePolling();
          sendResponse({ ok: true });
          break;
        case 'GET_TRANSACTION_STATUS': {
          if (!transactionMatches(message)) throw new Error('Transaction mismatch.');
          sendResponse({ ok: true, ...(await responseStatus()) });
          break;
        }
        case 'GET_LATEST_RESPONSE_RECT':
          sendResponse({ ok: true, provider, rect: responseRect() });
          break;
        default:
          sendResponse({ ok: false, error: 'Unknown content message' });
      }
    })().catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });

  ensurePolling();
  chrome.runtime.sendMessage({ type: 'PAGE_READY', provider, url: location.href }).catch(() => {});
})();
