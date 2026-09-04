(() => {
  const HIDDEN_INPUT_TYPES = new Set(['hidden', 'file', 'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color']);

  function attribute(element, name) {
    try { return element?.getAttribute?.(name); } catch { return null; }
  }

  function isNativeTextInput(element) {
    const tagName = String(element?.tagName || '').toLowerCase();
    if (tagName === 'textarea') return !element.disabled && !element.readOnly;
    if (tagName !== 'input') return false;
    const type = String(element.type || attribute(element, 'type') || 'text').toLowerCase();
    return !HIDDEN_INPUT_TYPES.has(type) && !element.disabled && !element.readOnly;
  }

  function isContentEditableInput(element) {
    if (!element || attribute(element, 'contenteditable')?.toLowerCase() === 'false') return false;
    const declared = attribute(element, 'contenteditable')?.toLowerCase();
    return element.isContentEditable === true || declared === '' || declared === 'true';
  }

  function isUsableInput(element) {
    if (!element || element.isConnected === false) return false;
    return isNativeTextInput(element) || isContentEditableInput(element);
  }

  function selectUsableInput(candidates = [], isVisible = () => true) {
    let selected = null;
    for (const candidate of candidates) {
      if (!isUsableInput(candidate)) continue;
      let visible = false;
      try { visible = Boolean(isVisible(candidate)); } catch { visible = false; }
      if (visible) selected = candidate;
    }
    return selected;
  }

  function textValues(element) {
    if (!element) return [];
    if (isNativeTextInput(element)) return [String(element.value || '')];
    return [element.innerText, element.textContent]
      .filter((value) => typeof value === 'string')
      .map((value) => value.replace(/\r\n?/g, '\n'));
  }

  function readText(element) {
    const values = textValues(element);
    if (!values.length) return '';
    return values
      .slice()
      .sort((a, b) => canonicalText(b).length - canonicalText(a).length || b.length - a.length)[0] || '';
  }

  function canonicalText(value = '') {
    return String(value).replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();
  }

  function matchesCompleteText(element, expected = '') {
    if (!isUsableInput(element)) return false;
    const target = canonicalText(expected);
    if (!target) return canonicalText(readText(element)) === '';
    return textValues(element).some((value) => canonicalText(value) === target);
  }

  async function waitForCompleteInput(resolveInput, expected = '', {
    initialInput = null,
    timeoutMs = 1800,
    intervalMs = 80,
    stableReads = 2,
  } = {}) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    const interval = Math.max(1, Number(intervalMs) || 1);
    const requiredReads = Math.max(1, Number(stableReads) || 1);
    let input = initialInput;
    let matchingReads = 0;

    while (true) {
      try {
        const resolved = typeof resolveInput === 'function' ? resolveInput() : null;
        if (resolved) input = resolved;
      } catch { /* keep the last usable candidate while the provider rerenders */ }

      if (matchesCompleteText(input, expected)) {
        matchingReads += 1;
        if (matchingReads >= requiredReads) {
          return { ok: true, input, text: readText(input), stableReads: matchingReads };
        }
      } else {
        matchingReads = 0;
      }

      if (Date.now() >= deadline) break;
      const delay = Math.min(interval, Math.max(1, deadline - Date.now()));
      await new Promise((resolve) => {
        if (typeof setTimeout === 'function') setTimeout(resolve, delay);
        else resolve();
      });
    }

    return { ok: false, input, text: readText(input), stableReads: matchingReads };
  }

  function documentFor(input, env) {
    return input?.ownerDocument || env?.document || null;
  }

  function selectContents(input, env) {
    const doc = documentFor(input, env);
    const selection = env?.getSelection?.() || doc?.getSelection?.();
    const range = doc?.createRange?.();
    if (!selection || !range || typeof range.selectNodeContents !== 'function') return false;
    range.selectNodeContents(input);
    selection.removeAllRanges?.();
    selection.addRange?.(range);
    return true;
  }

  function dispatchInput(input, text, env, inputType = 'insertText') {
    if (typeof input?.dispatchEvent !== 'function') return;
    try {
      if (typeof env?.InputEvent === 'function') {
        input.dispatchEvent(new env.InputEvent('input', {
          bubbles: true,
          cancelable: false,
          composed: true,
          inputType,
          data: inputType.startsWith('delete') ? null : text,
        }));
      } else if (typeof env?.Event === 'function') {
        input.dispatchEvent(new env.Event('input', { bubbles: true }));
      }
    } catch {
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* provider owns event support */ }
    }
  }

  function setNativeValue(input, text, env) {
    const tagName = String(input?.tagName || '').toLowerCase();
    const constructor = tagName === 'textarea' ? env?.HTMLTextAreaElement : env?.HTMLInputElement;
    const setter = constructor?.prototype
      ? Object.getOwnPropertyDescriptor(constructor.prototype, 'value')?.set
      : null;
    if (setter) setter.call(input, text);
    else input.value = text;
    dispatchInput(input, text, env);
    try {
      if (typeof env?.Event === 'function') input.dispatchEvent(new env.Event('change', { bubbles: true }));
    } catch { /* input event is enough for providers without change constructors */ }
  }

  function pasteText(input, text, env) {
    if (typeof env?.DataTransfer !== 'function' || typeof env?.ClipboardEvent !== 'function') return false;
    try {
      const transfer = new env.DataTransfer();
      transfer.setData('text/plain', text);
      const event = new env.ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: transfer,
      });
      input.dispatchEvent(event);
      return true;
    } catch {
      return false;
    }
  }

  function clearContentEditable(input, env) {
    input.focus?.();
    selectContents(input, env);
    const doc = documentFor(input, env);
    try { doc?.execCommand?.('delete', false, null); } catch { /* direct readback below is authoritative */ }
    if (!matchesCompleteText(input, '')) {
      try {
        if (typeof input.replaceChildren === 'function') input.replaceChildren();
        else input.textContent = '';
        try { input.innerText = ''; } catch { /* textContent is sufficient */ }
      } catch { /* keep the provider's current content and refuse to append */ }
    }
    dispatchInput(input, '', env, 'deleteContent');
    return matchesCompleteText(input, '');
  }

  function execInsertText(input, text, env) {
    const doc = documentFor(input, env);
    if (typeof doc?.execCommand !== 'function') return false;
    try {
      const inserted = doc.execCommand('insertText', false, text);
      dispatchInput(input, text, env);
      return Boolean(inserted);
    } catch {
      return false;
    }
  }

  function directTextFallback(input, text, env) {
    try {
      input.textContent = text;
      input.innerText = text;
      dispatchInput(input, text, env);
      return true;
    } catch {
      return false;
    }
  }

  function replaceInputText(input, text, env = globalThis, { maxAttempts = 3 } = {}) {
    const expected = String(text ?? '');
    if (!isUsableInput(input)) return { ok: false, reason: 'Unsupported input element.', text: readText(input) };
    input.focus?.();

    if (isNativeTextInput(input)) {
      for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
        setNativeValue(input, expected, env);
        if (matchesCompleteText(input, expected)) return { ok: true, method: 'native', text: readText(input) };
      }
      return { ok: false, reason: 'Input editor did not accept the complete message.', text: readText(input) };
    }

    for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
      // Always start from an empty editor. Some ChatGPT/ProseMirror builds do
      // not honor a synthetic selection during paste; retrying without this
      // clear would append another complete prompt on every attempt.
      if (!clearContentEditable(input, env)) continue;
      selectContents(input, env);
      if (pasteText(input, expected, env) && matchesCompleteText(input, expected)) {
        return { ok: true, method: 'paste', text: readText(input) };
      }
    }

    if (clearContentEditable(input, env)) selectContents(input, env);
    if (execInsertText(input, expected, env) && matchesCompleteText(input, expected)) {
      return { ok: true, method: 'execCommand', text: readText(input) };
    }

    if (clearContentEditable(input, env) && directTextFallback(input, expected, env) && matchesCompleteText(input, expected)) {
      return { ok: true, method: 'dom-fallback', text: readText(input) };
    }
    return { ok: false, reason: 'Input editor did not accept the complete message.', text: readText(input) };
  }

  globalThis.__LEE_RELAY_INPUT_ENGINE__ = Object.freeze({
    canonicalText,
    isUsableInput,
    matchesCompleteText,
    readText,
    replaceInputText,
    selectUsableInput,
    waitForCompleteInput,
  });
})();
