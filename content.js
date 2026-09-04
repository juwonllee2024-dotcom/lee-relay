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

  // Keep this serializable registry in sync with provider-adapters.mjs.
  const ADAPTERS = {
    chatgpt: {
      assistantSelectors: ['[data-message-author-role="assistant"]', '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]', '.agent-turn [data-message-author-role="assistant"]', '.agent-turn .markdown'],
      userSelectors: ['[data-message-author-role="user"]', '[data-testid^="conversation-turn-"] [data-message-author-role="user"]'],
      inputSelectors: ['#prompt-textarea', 'textarea', '[contenteditable="true"][role="textbox"]'],
      sendButtonSelectors: ['button[data-testid="send-button"]', 'button[aria-label*="send" i]', 'button[aria-label*="메시지 보내기" i]'],
      generatingSelectors: ['button[data-testid="stop-button"]', 'button[aria-label*="stop streaming" i]', 'button[aria-label*="stop generating" i]', 'button[aria-label*="중지" i]'],
      streamingSelectors: ['[data-message-author-role="assistant"][data-is-streaming="true"]', '[data-testid^="conversation-turn-"] [data-is-streaming="true"]', '[data-is-streaming="true"]'],
      fileInputSelectors: ['input[type="file"]'],
      attachButtonSelectors: ['button[aria-label*="attach" i]', 'button[aria-label*="upload" i]', 'button[aria-label*="add file" i]', 'button[aria-label*="첨부" i]', 'button[aria-label*="업로드" i]', 'button[title*="attach" i]', 'button[data-testid*="attach" i]'],
      responseQuietMs: 1800,
      initialResponseQuietMs: 6000,
    },
    claude: {
      assistantSelectors: ['.font-claude-response', '[data-testid="assistant-message"]', '.font-claude-message', '.assistant-message', '[data-testid*="assistant" i] .prose', '[data-testid*="assistant" i]', '[data-is-streaming] .font-claude-response', '[data-is-streaming] .font-claude-message', '[data-is-streaming] .prose', '[data-test-render-count] .font-claude-response', '[data-test-render-count] .font-claude-message'],
      userSelectors: ['[data-testid="user-message"]', '[data-testid*="user" i] .prose', '[data-testid*="user" i]'],
      inputSelectors: ['div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', 'textarea'],
      sendButtonSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="보내" i]', 'button[data-testid*="send" i]', 'button[title*="send" i]'],
      generatingSelectors: ['[data-is-streaming="true"]', 'button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', 'button[data-testid*="stop" i]'],
      fileInputSelectors: ['input[type="file"]'],
      attachButtonSelectors: ['button[aria-label*="attach" i]', 'button[aria-label*="upload" i]', 'button[aria-label*="add file" i]', 'button[aria-label*="첨부" i]', 'button[aria-label*="업로드" i]', 'button[title*="attach" i]', 'button[data-testid*="attach" i]'],
      responseQuietMs: 2000,
    },
    gemini: {
      assistantSelectors: ['model-response', 'response-container', '[data-test-id="model-response"]', '[data-testid="model-response"]', 'message-content', '.response-content', '.model-response-text', 'structured-content-container'],
      userSelectors: ['user-query', '.query-text', 'user-query-content', '[data-message-author="user"]', '[data-test-id="user-query"]', '[data-testid="user-query"]', '.user-query'],
      inputSelectors: ['div.ql-editor', 'rich-textarea [contenteditable="true"]', '[aria-label="Enter a prompt here"]', '[contenteditable="true"][role="textbox"]', 'textarea'],
      sendButtonSelectors: ['button[aria-label="Send message"]', 'button[aria-label*="send" i]', '.send-button', 'button.send-button', 'button[aria-label*="보내" i]', 'button[title*="send" i]', 'button[data-testid*="send" i]', 'button[data-test-id*="send" i]'],
      generatingSelectors: ['[aria-busy="true"]', 'button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', '[data-test-id*="stop" i]', '[data-testid*="stop" i]'],
      fileInputSelectors: ['input[type="file"]'],
      attachButtonSelectors: ['button[aria-label*="attach" i]', 'button[aria-label*="upload" i]', 'button[aria-label*="add file" i]', 'button[aria-label*="add" i]', 'button[aria-label*="첨부" i]', 'button[aria-label*="업로드" i]', 'button[title*="upload" i]', 'button[data-test-id*="upload" i]'],
      responseQuietMs: 2000,
    },
    copilot: {
      assistantSelectors: ['[data-message-author-role="assistant"]', '[data-author="assistant"]', '[data-content="ai-message"]', '[data-testid*="assistant" i]', 'cib-message-group[source="bot"]', 'cib-message[type="bot"]'],
      userSelectors: ['[data-message-author-role="user"]', '[data-author="user"]', '[data-content="user-message"]', 'cib-message-group[source="user"]', 'cib-message[type="user"]'],
      inputSelectors: ['textarea', '[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
      sendButtonSelectors: ['button[aria-label*="send" i]', 'button[aria-label*="보내" i]', 'button[title*="send" i]', 'button[data-testid*="send" i]'],
      generatingSelectors: ['button[aria-label*="stop" i]', 'button[aria-label*="중지" i]', 'button[data-testid*="stop" i]', '[data-content*="stop" i]'],
      fileInputSelectors: ['input[type="file"]'],
      attachButtonSelectors: ['button[aria-label*="attach" i]', 'button[aria-label*="upload" i]', 'button[aria-label*="add content" i]', 'button[aria-label*="add" i]', 'button[aria-label*="첨부" i]', 'button[aria-label*="업로드" i]', 'button[title*="attach" i]', 'button[data-testid*="attach" i]'],
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
  let responseCheckRunning = false;
  let responseCheckPending = false;
  const observedResponseRoots = new WeakSet();
  let responseMutationObserver = null;

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

  // Transcript nodes must remain readable while their provider tab is in the
  // background. Layout boxes can be throttled or skipped for hidden tabs, so
  // message discovery must not depend on getBoundingClientRect().
  function isReadableMessage(el) {
    if (!(el instanceof Element) || !el.isConnected || el.hidden) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
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
      try { found.push(...root.querySelectorAll(selector)); } catch { /* inaccessible root */ }
    }
    return [...new Set(found)];
  }

  function documentRank(el) {
    try {
      const rect = el.getBoundingClientRect();
      return (window.scrollY + rect.top) * 100000 + (window.scrollX + rect.left);
    } catch { return 0; }
  }

  function messageText(el, selectors) {
    const assistant = selectors === adapter.assistantSelectors;
    const user = selectors === adapter.userSelectors;

    if (provider === 'chatgpt' && assistant) {
      // ChatGPT's assistant turn contains controls beside the markdown body.
      // Read every markdown body in the turn so action UI or a nested short
      // node cannot replace the complete answer.
      const preferred = el.matches?.('.markdown')
        ? [el]
        : [...(el.querySelectorAll?.('.markdown') || [])];
      const preferredText = cleanText(preferred.map((node) => node.innerText || node.textContent || '').join('\n'));
      if (preferredText) return preferredText;
    }

    // Gemini's 2026 UI has used several nested response shells. Prefer the
    // rendered structured-content body so action bars / headings do not become
    // part of the relayed answer, then fall back to the turn root itself.
    if (provider === 'gemini' && assistant) {
      const preferred = el.matches?.('structured-content-container > div.container, .response-content, .model-response-text, message-content')
        ? el
        : el.querySelector?.('structured-content-container > div.container, .response-content, .model-response-text');
      const preferredText = cleanText(preferred?.innerText || preferred?.textContent || '');
      if (preferredText) return preferredText;
    }
    if (provider === 'gemini' && user) {
      const preferred = el.matches?.('.query-text, user-query-content')
        ? el
        : el.querySelector?.('.query-text, user-query-content');
      const preferredText = cleanText(preferred?.innerText || preferred?.textContent || '');
      if (preferredText) return preferredText;
    }
    if (provider === 'claude' && assistant) {
      const preferred = el.matches?.('.font-claude-response') ? el : el.querySelector?.('.font-claude-response');
      const preferredText = cleanText(preferred?.innerText || preferred?.textContent || '');
      if (preferredText) return preferredText;
    }
    return cleanText(el.innerText || el.textContent || '');
  }

  function compareMessageOrder(a, b) {
    if (a.el === b.el) return 0;
    try {
      const position = a.el.compareDocumentPosition(b.el);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    } catch { /* disconnected shadow roots fall back to query order */ }
    return a.sequence - b.sequence;
  }

  function collectMessages(selectors, roots = getRoots()) {
    // Each provider supplies selectors from most-semantic turn container to
    // fallback text node. Mixing all selector families double-counts nested
    // Gemini/Claude nodes and can make an already-complete response look stale.
    for (const selector of selectors) {
      const nodes = [];
      let sequence = 0;
      for (const el of queryDeep(selector, roots)) {
        if (!isReadableMessage(el)) continue;
        const text = messageText(el, selectors);
        if (!text) continue;
        nodes.push({ el, text, sequence: sequence++ });
      }
      nodes.sort(compareMessageOrder);
      if (nodes.length) return nodes;
    }
    return [];
  }

  function latestMessage(selectors, roots = getRoots()) {
    return collectMessages(selectors, roots).at(-1) || { el: null, text: '' };
  }

  function latestAssistant(roots = getRoots()) { return latestMessage(adapter.assistantSelectors, roots); }
  function latestUser(roots = getRoots()) { return latestMessage(adapter.userSelectors, roots); }

  function isGenerating(roots = getRoots()) {
    const activeControl = adapter.generatingSelectors.some((selector) => queryDeep(selector, roots).some(isVisible));
    const activeStream = (adapter.streamingSelectors || []).some((selector) => queryDeep(selector, roots).some(isReadableMessage));
    return activeControl || activeStream;
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


  function elementDistance(a, b) {
    try {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const ax = ar.left + ar.width / 2;
      const ay = ar.top + ar.height / 2;
      const bx = br.left + br.width / 2;
      const by = br.top + br.height / 2;
      return Math.hypot(ax - bx, ay - by);
    } catch { return Number.MAX_SAFE_INTEGER; }
  }

  function findFileInput() {
    const roots = getRoots(true);
    for (const selector of adapter.fileInputSelectors || ['input[type="file"]']) {
      const candidates = queryDeep(selector, roots)
        .filter((el) => el instanceof HTMLInputElement && el.type === 'file' && !el.disabled);
      if (candidates.length) return candidates.at(-1);
    }
    return null;
  }

  function buttonText(el) {
    return cleanText([
      el?.getAttribute?.('aria-label') || '',
      el?.getAttribute?.('title') || '',
      el?.innerText || el?.textContent || '',
    ].filter(Boolean).join(' '));
  }

  function findAttachButton(composer) {
    const roots = getRoots(true);
    const candidates = [];
    for (const selector of adapter.attachButtonSelectors || []) {
      for (const el of queryDeep(selector, roots)) {
        if (isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') candidates.push(el);
      }
    }
    if (!candidates.length) {
      const pattern = /(attach|upload|add\s+(content|file|files)|paperclip|첨부|업로드|파일\s*추가)/i;
      for (const el of queryDeep('button,[role="button"]', roots)) {
        if (isVisible(el) && !el.disabled && pattern.test(buttonText(el))) candidates.push(el);
      }
    }
    return [...new Set(candidates)].sort((a, b) => elementDistance(a, composer) - elementDistance(b, composer))[0] || null;
  }

  function findUploadMenuAction() {
    const pattern = /(upload|from (computer|device)|attach file|add file|파일|업로드|기기에서)/i;
    const candidates = queryDeep('button,[role="button"],[role="menuitem"],li', getRoots(true))
      .filter((el) => isVisible(el) && pattern.test(buttonText(el)));
    return candidates[0] || null;
  }

  function nativeFileInputHas(fileName) {
    if (!fileName) return false;
    for (const input of queryDeep('input[type="file"]', getRoots(true))) {
      try {
        if ([...(input.files || [])].some((file) => file.name === fileName)) return true;
      } catch { /* ignore inaccessible file list */ }
    }
    return false;
  }

  function contextFileVisible(fileName) {
    if (!fileName) return false;
    const roots = getRoots(true);
    const likelyAttachmentSelectors = [
      '[data-testid*="attachment" i]', '[data-test-id*="attachment" i]',
      '[data-testid*="file" i]', '[data-test-id*="file" i]',
      '[class*="attachment" i]', '[class*="file-chip" i]', '[class*="upload" i]',
      '[aria-label*=".txt" i]',
    ];
    for (const selector of likelyAttachmentSelectors) {
      for (const el of queryDeep(selector, roots)) {
        try {
          const text = `${buttonText(el)} ${el.textContent || ''}`;
          if (text.includes(fileName)) return true;
        } catch { /* ignore */ }
      }
    }
    const textCandidates = queryDeep('span,button,[role="button"],[role="listitem"],[title*=".txt" i]', roots);
    for (const el of textCandidates) {
      try {
        if (el.closest?.('textarea,[contenteditable="true"]')) continue;
        const text = `${buttonText(el)} ${el.textContent || ''}`;
        if (text.includes(fileName)) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  function contextAttachmentBusy(fileName = '') {
    const roots = getRoots(true);
    const busyPattern = /(loading|uploading|processing|preparing|pending|queued|in[-_ ]?progress|busy|waiting|upload\s*in\s*progress|processing\s*file|첨부\s*(중|준비)|업로드\s*(중|준비)|파일\s*(처리|업로드)\s*(중|준비)|불러오는\s*(중|준비)|처리\s*(중|준비)|준비\s*(중|준비))/i;
    const stateSelectors = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[role="status"]',
      '[aria-live="polite"]',
      '[aria-live="assertive"]',
      '[data-upload-state]',
      '[data-file-state]',
      '[data-attachment-state]',
      '[data-testid*="upload" i]',
      '[data-testid*="attachment" i]',
      '[data-testid*="file" i]',
    ].join(',');
    for (const el of queryDeep(stateSelectors, roots)) {
      if (!el?.isConnected) continue;
      const role = String(el.getAttribute?.('role') || '').toLowerCase();
      const ariaBusy = String(el.getAttribute?.('aria-busy') || '').toLowerCase();
      const ariaLive = String(el.getAttribute?.('aria-live') || '').toLowerCase();
      const state = [
        el.getAttribute?.('data-state'),
        el.getAttribute?.('data-status'),
        el.getAttribute?.('data-upload-state'),
        el.getAttribute?.('data-file-state'),
        el.getAttribute?.('data-attachment-state'),
      ].filter(Boolean).join(' ');
      const text = `${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('title') || ''} ${buttonText(el)} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim();
      const classState = String(el.className || '');
      if (ariaBusy === 'true' || role === 'progressbar') return true;
      if (busyPattern.test(state) || busyPattern.test(classState)) return true;
      if ((role === 'status' || ariaLive === 'polite' || ariaLive === 'assertive') && busyPattern.test(text)) return true;
    }

    // Providers may put upload state on a wrapper around a named attachment.
    // Check only a short ancestor chain; a generic Upload button is not busy.
    if (fileName && contextFileVisible(fileName)) {
      const candidates = queryDeep('[data-testid*="attachment" i],[data-test-id*="attachment" i],[class*="attachment" i],[class*="file-chip" i],[aria-label*=".txt" i]', roots);
      for (const candidate of candidates) {
        const text = `${buttonText(candidate)} ${candidate.textContent || ''}`;
        if (!text.includes(fileName)) continue;
        let node = candidate;
        for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
          const state = [
            node.getAttribute?.('aria-busy'),
            node.getAttribute?.('data-state'),
            node.getAttribute?.('data-status'),
            node.getAttribute?.('data-upload-state'),
            node.getAttribute?.('data-file-state'),
          ].filter(Boolean).join(' ');
          if (String(node.getAttribute?.('aria-busy') || '').toLowerCase() === 'true' || busyPattern.test(state) || busyPattern.test(String(node.className || ''))) return true;
        }
      }
    }
    return false;
  }

  async function waitForContextFileReady(fileName, { accepted = false, timeoutMs = 15000, intervalMs = 250, stableReads = 2 } = {}) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
    let acceptedSeen = Boolean(accepted);
    let stable = 0;
    let lastBusy = false;
    while (Date.now() <= deadline) {
      const visible = contextFileVisible(fileName);
      const native = nativeFileInputHas(fileName);
      acceptedSeen = acceptedSeen || visible || native;
      lastBusy = contextAttachmentBusy(fileName);
      if (acceptedSeen && !lastBusy) {
        stable += 1;
        if (stable >= Math.max(1, Number(stableReads) || 2)) {
          return { ready: true, confirmed: Boolean(visible || native), accepted: acceptedSeen, busy: false, fileName };
        }
      } else {
        stable = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return {
      ready: false,
      confirmed: false,
      accepted: acceptedSeen,
      busy: lastBusy,
      fileName,
      reason: lastBusy
        ? `${provider} is still processing the context file after the bounded wait.`
        : `${provider} did not expose a settled context-file attachment after the bounded wait.`,
    };
  }

  function clearNativeContextFile(fileName) {
    if (!fileName) return;
    for (const input of queryDeep('input[type="file"]', getRoots(true))) {
      let matches = false;
      try { matches = [...(input.files || [])].some((file) => file.name === fileName); } catch { matches = false; }
      if (!matches) continue;
      try {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } catch { /* the provider may have detached the native input */ }
    }
  }

  async function waitForChatgptSendReady(input, { timeoutMs = 12000, intervalMs = 150, stableReads = 2 } = {}) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 12000);
    let stable = 0;
    let lastInput = input;
    let lastBusy = false;
    while (Date.now() <= deadline) {
      lastInput = findInput() || lastInput;
      const button = findSendButton(lastInput);
      const attachmentInFlight = Boolean(transaction?.contextFileName && (transaction.contextFileAttached || transaction.contextFilePending));
      lastBusy = Boolean(attachmentInFlight && contextAttachmentBusy(transaction.contextFileName));
      if (button && !lastBusy) {
        stable += 1;
        if (stable >= Math.max(1, Number(stableReads) || 2)) return { ok: true, input: lastInput, button, busy: false };
      } else {
        stable = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return {
      ok: false,
      input: lastInput,
      busy: lastBusy,
      reason: lastBusy
        ? 'ChatGPT is still loading the context file; Send was not attempted.'
        : 'ChatGPT Send is not available yet; Send was not attempted.',
    };
  }

  async function revealFileInput(composer) {
    let input = findFileInput();
    if (input) return input;
    const attachButton = findAttachButton(composer);
    if (attachButton) {
      attachButton.click();
      await new Promise((resolve) => setTimeout(resolve, 350));
      input = findFileInput();
      if (input) return input;
      const uploadAction = findUploadMenuAction();
      if (uploadAction && uploadAction !== attachButton) {
        uploadAction.click();
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    for (let i = 0; i < 14; i += 1) {
      input = findFileInput();
      if (input) return input;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return null;
  }

  async function attachContextFile(message) {
    if (!transactionMatches(message)) throw new Error('Transaction mismatch.');
    const fileName = String(message.fileName || '').trim();
    const fileText = String(message.fileText || '');
    if (!fileName || !/\.txt$/i.test(fileName)) throw new Error('Context attachment must be a .txt file.');
    if (!fileText) throw new Error('Context attachment is empty.');
    if (fileText.length > 512000) throw new Error('Context attachment is too large.');
    if (transaction.contextFileAttached && transaction.contextFileName === fileName) {
      return { attached: true, ready: true, confirmed: true, reused: true, fileName };
    }
    transaction.contextFileName = fileName;
    transaction.contextFilePending = true;
    if (contextFileVisible(fileName) || nativeFileInputHas(fileName)) {
      const readiness = await waitForContextFileReady(fileName, { accepted: true, timeoutMs: provider === 'chatgpt' ? 15000 : 9000 });
      if (!readiness.ready) {
        clearNativeContextFile(fileName);
        transaction.contextFilePending = Boolean(readiness.busy);
        return { attached: false, ready: false, pending: Boolean(readiness.busy), reason: readiness.reason, fileName };
      }
      transaction.contextFileName = fileName;
      transaction.contextFileAttached = true;
      transaction.contextFilePending = false;
      return { attached: true, ready: true, confirmed: readiness.confirmed, reused: true, fileName };
    }

    const composer = findInput();
    if (!composer) {
      transaction.contextFilePending = false;
      return { attached: false, ready: false, reason: `${provider} input editor not found.`, fileName };
    }
    if (typeof File !== 'function' || typeof DataTransfer !== 'function') {
      transaction.contextFilePending = false;
      return { attached: false, ready: false, reason: 'Browser file attachment APIs are unavailable.', fileName };
    }
    const file = new File([fileText], fileName, { type: message.mimeType || 'text/plain', lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    const input = await revealFileInput(composer);
    if (!input) {
      // Some provider composers support drag-and-drop without exposing a stable
      // file input. Try the same browser-native File through a synthetic drop
      // before falling back to bounded inline context.
      if (typeof DragEvent === 'function') {
        for (const type of ['dragenter', 'dragover', 'drop']) {
          composer.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }));
        }
        const readiness = await waitForContextFileReady(fileName, { timeoutMs: provider === 'chatgpt' ? 15000 : 9000 });
        if (readiness.ready) {
          transaction.contextFileName = fileName;
          transaction.contextFileAttached = true;
          transaction.contextFilePending = false;
          return { attached: true, ready: true, confirmed: readiness.confirmed, dropped: true, fileName };
        }
        transaction.contextFilePending = Boolean(readiness.busy);
        return { attached: false, ready: false, pending: Boolean(readiness.busy), reason: readiness.reason, fileName };
      }
      transaction.contextFilePending = false;
      return { attached: false, ready: false, reason: `${provider} file upload control was not found.`, fileName };
    }
    try {
      input.files = transfer.files;
    } catch (error) {
      transaction.contextFilePending = false;
      return { attached: false, ready: false, reason: `Could not set the provider file input: ${error.message || String(error)}`, fileName };
    }
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    let assigned = false;
    try { assigned = [...(input.files || [])].some((item) => item.name === fileName); } catch { assigned = false; }
    const readiness = await waitForContextFileReady(fileName, { accepted: assigned, timeoutMs: provider === 'chatgpt' ? 15000 : 9000 });
    if (readiness.ready) {
      transaction.contextFileName = fileName;
      transaction.contextFileAttached = true;
      transaction.contextFilePending = false;
      return { attached: true, ready: true, confirmed: readiness.confirmed, consumed: assigned && !readiness.confirmed, fileName };
    }
    clearNativeContextFile(fileName);
    transaction.contextFilePending = Boolean(readiness.busy);
    return {
      attached: false,
      ready: false,
      pending: Boolean(readiness.busy),
      accepted: Boolean(readiness.accepted),
      reason: readiness.reason || `${provider} did not accept the context attachment.`,
      fileName,
    };
  }

  async function snapshot() {
    const roots = getRoots(true);
    const assistantMessages = collectMessages(adapter.assistantSelectors, roots);
    const userMessages = collectMessages(adapter.userSelectors, roots);
    const assistant = assistantMessages.at(-1) || { el: null, text: '' };
    const user = userMessages.at(-1) || { el: null, text: '' };
    return {
      assistantText: assistant.text,
      assistantSignature: await signatureText(assistant.text),
      assistantCount: assistantMessages.length,
      userText: user.text,
      userSignature: await signatureText(user.text),
      userCount: userMessages.length,
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
    if (transactionMatches(message)) {
      // PREPARE may be called again after a verification hiccup or watchdog pass.
      // Never move the baseline forward for the same transaction: doing so can
      // erase evidence that the first send already created a new turn.
      transaction.promptText = cleanText(message.text || transaction.promptText);
      transaction.promptSignature = message.promptSignature || transaction.promptSignature || await signatureText(transaction.promptText);
      if (message.contextMode === 'fallback-inline') {
        transaction.contextFileName = '';
        transaction.contextFileAttached = false;
        transaction.contextFilePending = false;
      }
      return { ...base, reusedTransaction: true };
    }
    const useRestoredBaseline = Boolean(message.baselineCaptured);
    transaction = {
      meetingId: message.meetingId,
      transactionId: message.transactionId,
      participantId: message.participantId,
      promptText: cleanText(message.text || ''),
      promptSignature: message.promptSignature || await signatureText(message.text || ''),
      baselineAssistantSignature: useRestoredBaseline ? (message.baselineAssistantSignature ?? null) : base.assistantSignature,
      baselineAssistantCount: useRestoredBaseline ? (Number(message.baselineAssistantCount) || 0) : (Number(base.assistantCount) || 0),
      baselineUserSignature: useRestoredBaseline ? (message.baselineUserSignature ?? null) : base.userSignature,
      baselineUserCount: useRestoredBaseline ? (Number(message.baselineUserCount) || 0) : (Number(base.userCount) || 0),
      baselineUrl: message.baselineUrl || location.href,
      baselineGenerating: useRestoredBaseline ? Boolean(message.baselineGenerating) : Boolean(base.generating),
      armed: false,
      generationSeen: useRestoredBaseline ? Boolean(message.baselineGenerating) : Boolean(base.generating),
      responseCandidateText: '',
      responseCandidateSignature: null,
      responseLastChangedAt: Date.now(),
      responseSent: false,
      sendActionExecuted: false,
      inputPrimed: false,
      deliveryConfirmed: false,
      contextFileName: '',
      contextFileAttached: false,
      contextFilePending: false,
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

    // Gemini and other rich editors can occasionally accept only part of a
    // programmatic multi-line insertion. Never click Send unless the composer
    // really contains the complete prompt we intended to submit.
    const composerText = inputText(input);
    const composerSignature = await signatureText(composerText);
    const expectedSignature = transaction.promptSignature || await signatureText(text);
    const composerMatchesPrompt = Boolean(composerSignature && expectedSignature && composerSignature === expectedSignature);
    if (!composerMatchesPrompt) {
      throw new Error(`${provider} composer did not accept the complete relay prompt; send was cancelled to prevent a partial or duplicate message.`);
    }
    transaction.inputPrimed = true;

    let button = findSendButton(input);
    if (provider === 'chatgpt') {
      // ChatGPT can expose a composer before its context-file card is ready.
      // Never fall back to form submission or Enter in that state: either wait
      // for the real Send button or fail without risking a partial/duplicate turn.
      const sendReady = await waitForChatgptSendReady(input);
      if (!sendReady.ok) throw new Error(sendReady.reason || 'ChatGPT Send is not available yet; Send was not attempted.');
      button = sendReady.button;
      const sendInput = sendReady.input || input;
      const sendText = inputText(sendInput);
      const sendSignature = await signatureText(sendText);
      const sendExpected = transaction.promptSignature || await signatureText(text);
      if (!sendSignature || !sendExpected || sendSignature !== sendExpected) {
        throw new Error('ChatGPT composer changed before Send; Send was not attempted to prevent a partial or duplicate message.');
      }
    }
    if (button) {
      button.click();
    } else {
      const form = input.closest?.('form');
      if (form?.requestSubmit) form.requestSubmit();
      else input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    }
    transaction.sendActionExecuted = true;
    return { sendActionExecuted: true, inputPrimed: true };
  }

  async function deliveryEvidence() {
    if (!transaction) return { matchingUserMessage: false, inputCleared: false, generationStarted: false, userMessageAdvanced: false, assistantAdvanced: false };
    const roots = getRoots(true);
    const users = collectMessages(adapter.userSelectors, roots);
    const latestUserItem = users.at(-1) || null;
    const latestUserSignature = latestUserItem ? await signatureText(latestUserItem.text) : null;
    let matchingUserMessage = false;
    for (let i = users.length - 1; i >= Math.max(0, users.length - 6); i -= 1) {
      const sig = await signatureText(users[i].text);
      if (sig && sig === transaction.promptSignature) {
        matchingUserMessage = true;
        break;
      }
    }
    const assistantMessages = collectMessages(adapter.assistantSelectors, roots);
    const assistant = assistantMessages.at(-1) || { el: null, text: '' };
    const assistantSignature = await signatureText(assistant.text);
    const input = findInput();
    const inputCleared = Boolean(input && !inputText(input));
    const generationStarted = isGenerating(roots) && !transaction.baselineGenerating;
    const userMessageAdvanced = Boolean(latestUserSignature && latestUserSignature !== transaction.baselineUserSignature);
    const userNodeAdvanced = users.length > (Number(transaction.baselineUserCount) || 0);
    const assistantSignatureAdvanced = Boolean(assistantSignature && assistantSignature !== transaction.baselineAssistantSignature);
    const assistantNodeAdvanced = assistantMessages.length > (Number(transaction.baselineAssistantCount) || 0);
    const assistantAdvanced = assistantSignatureAdvanced || assistantNodeAdvanced;
    return {
      matchingUserMessage,
      inputPrimed: Boolean(transaction.inputPrimed),
      inputCleared,
      generationStarted,
      userMessageAdvanced,
      userNodeAdvanced,
      assistantAdvanced,
      assistantNodeAdvanced,
      userSignature: latestUserSignature,
      assistantSignature,
      userCount: users.length,
      assistantCount: assistantMessages.length,
    };
  }

  function deliveryObserved(evidence) {
    if (!transaction) return false;
    if (evidence.matchingUserMessage) return true;
    if (!transaction.sendActionExecuted) return false;
    if (evidence.userNodeAdvanced || evidence.assistantAdvanced) return true;
    if (transaction.inputPrimed && evidence.inputCleared) return true;
    return Boolean(evidence.inputCleared && (evidence.generationStarted || evidence.userMessageAdvanced));
  }

  async function verifyDelivery(message) {
    if (!transactionMatches(message)) throw new Error('Transaction mismatch.');
    const timeoutMs = Math.min(12000, Math.max(0, Number(message.timeoutMs) || 7000));
    const deadline = Date.now() + timeoutMs;
    let evidence = await deliveryEvidence();
    while (!deliveryObserved(evidence) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      evidence = await deliveryEvidence();
    }
    return evidence;
  }

  function responseQuietMs() {
    const policy = globalThis.__LEE_RELAY_RESPONSE_POLICY__;
    if (typeof policy?.confirmationQuietMs === 'function') {
      return policy.confirmationQuietMs(adapter, transaction);
    }
    return Math.max(500, Number(adapter.responseQuietMs) || 2000);
  }

  async function responseStatus() {
    if (!transaction) return { active: false };
    const snap = await snapshot();
    const evidence = await deliveryEvidence();
    const assistantNodeAdvanced = Number(snap.assistantCount) > (Number(transaction.baselineAssistantCount) || 0);
    const changed = Boolean((snap.assistantSignature && snap.assistantSignature !== transaction.baselineAssistantSignature) || assistantNodeAdvanced);
    const stableMs = Date.now() - transaction.responseLastChangedAt;
    return {
      active: true,
      deliveryConfirmed: Boolean(transaction.deliveryConfirmed),
      ...snap,
      ...evidence,
      changed,
      stableMs,
      quietMs: responseQuietMs(),
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
    const assistantNodeAdvanced = Number(snap.assistantCount) > (Number(transaction.baselineAssistantCount) || 0);
    const changed = Boolean((snap.assistantSignature && snap.assistantSignature !== transaction.baselineAssistantSignature) || assistantNodeAdvanced);
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
        assistantNodeAdvanced,
        assistantCount: snap.assistantCount,
        generating: snap.generating,
      }).catch(() => {});
      return;
    }

    const stableMs = Date.now() - transaction.responseLastChangedAt;
    const quietMs = responseQuietMs();
    const staleGeneration = snap.generating && stableMs >= 90000;
    if ((snap.generating && !staleGeneration) || stableMs < quietMs) return;

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
      assistantNodeAdvanced,
      assistantCount: snap.assistantCount,
      generationSeen: transaction.generationSeen,
      staleGeneration,
    }).catch(() => { transaction.responseSent = false; transaction.armed = true; });
  }

  function requestResponseCheck() {
    if (!transaction?.armed || transaction.responseSent) return;
    if (responseCheckRunning) {
      responseCheckPending = true;
      return;
    }
    responseCheckRunning = true;
    Promise.resolve().then(async () => {
      do {
        responseCheckPending = false;
        await pollResponse();
      } while (responseCheckPending && transaction?.armed && !transaction.responseSent);
    }).catch(() => {}).finally(() => {
      responseCheckRunning = false;
      if (responseCheckPending) requestResponseCheck();
    });
  }

  function observeResponseRoots(force = true) {
    if (!responseMutationObserver) {
      responseMutationObserver = new MutationObserver(() => {
        if (!transaction?.armed || transaction.responseSent) return;
        // MutationObserver callbacks continue to fire for DOM changes even when
        // background-tab interval timers are heavily throttled. This is the
        // primary wake-up path for Gemini/Copilot background responses.
        requestResponseCheck();
        // pollResponse() force-refreshes the root cache. Reuse that cache here
        // instead of rescanning the entire provider DOM for every streamed token.
        queueMicrotask(() => observeResponseRoots(false));
      });
    }
    for (const root of getRoots(force)) {
      if (observedResponseRoots.has(root)) continue;
      try {
        responseMutationObserver.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-is-streaming', 'aria-busy', 'class'],
        });
        observedResponseRoots.add(root);
      } catch { /* inaccessible root */ }
    }
  }

  function ensurePolling() {
    observeResponseRoots();
    if (pollTimer) return;
    // Interval polling is only a fallback. Background provider tabs can throttle
    // timers, so response mutations also trigger requestResponseCheck().
    pollTimer = setInterval(() => requestResponseCheck(), 600);
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
        case 'ATTACH_CONTEXT_FILE': {
          const result = await attachContextFile(message);
          sendResponse({ ok: true, ...result });
          break;
        }
        case 'SUBMIT_MESSAGE': {
          const result = await submitMessage(message);
          sendResponse({ ok: true, sendActionExecuted: Boolean(result.sendActionExecuted), inputPrimed: Boolean(result.inputPrimed), delivered: false });
          break;
        }
        case 'VERIFY_DELIVERY': {
          const evidence = await verifyDelivery(message);
          sendResponse({
            ok: true,
            matchingUserMessage: Boolean(evidence.matchingUserMessage),
            inputPrimed: Boolean(evidence.inputPrimed),
            inputCleared: Boolean(evidence.inputCleared),
            generationStarted: Boolean(evidence.generationStarted),
            userMessageAdvanced: Boolean(evidence.userMessageAdvanced),
            userNodeAdvanced: Boolean(evidence.userNodeAdvanced),
            assistantAdvanced: Boolean(evidence.assistantAdvanced),
            assistantNodeAdvanced: Boolean(evidence.assistantNodeAdvanced),
            userSignature: evidence.userSignature || null,
            assistantSignature: evidence.assistantSignature || null,
            userCount: Number(evidence.userCount) || 0,
            assistantCount: Number(evidence.assistantCount) || 0,
          });
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
          requestResponseCheck();
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
