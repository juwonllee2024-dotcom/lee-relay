import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../chatgpt-input-engine.js', import.meta.url), 'utf8');
const contentSource = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const backgroundSource = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');

function loadEngine({ withTimers = false } = {}) {
  const context = withTimers ? { globalThis: {}, setTimeout } : { globalThis: {} };
  vm.runInNewContext(source, context, { filename: 'chatgpt-input-engine.js' });
  return context.globalThis.__LEE_RELAY_INPUT_ENGINE__;
}

function element({ tagName = 'DIV', contenteditable = null, isContentEditable = false, disabled = false, readOnly = false, type = '' } = {}) {
  return {
    tagName,
    isContentEditable,
    disabled,
    readOnly,
    type,
    textContent: '',
    innerText: '',
    getAttribute(name) {
      if (name === 'contenteditable') return contenteditable;
      return null;
    },
  };
}

test('input selection ignores visible non-editable ChatGPT shell', () => {
  const engine = loadEngine();
  const shell = element({ contenteditable: 'false' });
  const editor = element({ contenteditable: 'true' });

  assert.equal(engine.selectUsableInput([shell, editor], () => true), editor);
  assert.equal(engine.selectUsableInput([shell], () => true), null);
});

test('input selection accepts contenteditable attribute when browser property is false', () => {
  const engine = loadEngine();
  const editor = element({ contenteditable: 'true', isContentEditable: false });

  assert.equal(engine.isUsableInput(editor), true);
});

test('disconnected editor cannot pass complete-text verification', () => {
  const engine = loadEngine();
  const editor = element({ contenteditable: 'true', isContentEditable: true });
  const fullText = 'complete text in an old detached editor';
  editor.isConnected = false;
  editor.textContent = fullText;
  editor.innerText = fullText;

  assert.equal(engine.matchesCompleteText(editor, fullText), false);
});

test('contenteditable insertion retries after a partial paste and commits the complete text', () => {
  const engine = loadEngine();
  const editor = element({ contenteditable: 'true', isContentEditable: true });
  const fullText = '첫 줄\n두 번째 줄\n세 번째 줄 — complete ChatGPT relay payload';
  let pasteCalls = 0;
  const events = [];
  const env = {
    document: {
      execCommand() {
        editor.textContent = fullText;
        editor.innerText = fullText;
        return true;
      },
      createRange() {
        return { selectNodeContents() {} };
      },
    },
    getSelection() {
      return { removeAllRanges() {}, addRange() {} };
    },
    ClipboardEvent: class {
      constructor(type, init) { this.type = type; this.clipboardData = init.clipboardData; }
    },
    DataTransfer: class {
      constructor() { this.data = new Map(); }
      setData(type, value) { this.data.set(type, value); }
    },
    InputEvent: class {
      constructor(type, init) { this.type = type; Object.assign(this, init); }
    },
    Event: class { constructor(type) { this.type = type; } },
  };
  editor.focus = () => events.push('focus');
  editor.dispatchEvent = (event) => {
    events.push(event.type);
    if (event.type === 'paste') {
      pasteCalls += 1;
      const value = event.clipboardData.data.get('text/plain');
      const inserted = pasteCalls === 1 ? value.slice(0, 8) : value;
      editor.textContent = inserted;
      editor.innerText = inserted;
    }
    return true;
  };

  const result = engine.replaceInputText(editor, fullText, env, { maxAttempts: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.text, fullText);
  assert.equal(editor.textContent, fullText);
  assert.ok(events.includes('paste'));
  assert.ok(pasteCalls >= 2);
});

test('rich-editor retries clear first so paste handlers cannot accumulate prompts', () => {
  const engine = loadEngine();
  const editor = element({ contenteditable: 'true', isContentEditable: true });
  const oldText = 'stale prompt already in ChatGPT composer';
  const fullText = 'new complete relay prompt';
  editor.textContent = oldText;
  editor.innerText = oldText;
  let pasteCalls = 0;
  const env = {
    document: {
      execCommand(command) {
        if (command === 'delete') {
          editor.textContent = '';
          editor.innerText = '';
          return true;
        }
        return false;
      },
      createRange() {
        return { selectNodeContents() {} };
      },
    },
    getSelection() {
      return { removeAllRanges() {}, addRange() {} };
    },
    ClipboardEvent: class {
      constructor(type, init) { this.type = type; this.clipboardData = init.clipboardData; }
    },
    DataTransfer: class {
      constructor() { this.data = new Map(); }
      setData(type, value) { this.data.set(type, value); }
    },
    InputEvent: class {
      constructor(type, init) { this.type = type; Object.assign(this, init); }
    },
    Event: class { constructor(type) { this.type = type; } },
  };
  editor.focus = () => {};
  editor.dispatchEvent = (event) => {
    if (event.type === 'paste') {
      pasteCalls += 1;
      const value = event.clipboardData.data.get('text/plain');
      editor.textContent += value;
      editor.innerText += value;
    }
    return true;
  };

  const result = engine.replaceInputText(editor, fullText, env, { maxAttempts: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.text, fullText);
  assert.equal(editor.textContent, fullText);
  assert.equal(pasteCalls, 1);
});

test('rich-editor does not trust a successful delete command without empty readback', () => {
  const engine = loadEngine();
  const editor = element({ contenteditable: 'true', isContentEditable: true });
  const oldText = 'stale prompt that cannot be cleared';
  const fullText = 'new relay prompt';
  let currentText = oldText;
  Object.defineProperty(editor, 'textContent', { configurable: true, get: () => currentText, set: () => {} });
  Object.defineProperty(editor, 'innerText', { configurable: true, get: () => currentText, set: () => {} });
  let pasteCalls = 0;
  const env = {
    document: {
      execCommand(command) {
        if (command === 'delete') return true;
        return false;
      },
      createRange() {
        return { selectNodeContents() {} };
      },
    },
    getSelection() {
      return { removeAllRanges() {}, addRange() {} };
    },
    ClipboardEvent: class {
      constructor(type, init) { this.type = type; this.clipboardData = init.clipboardData; }
    },
    DataTransfer: class {
      constructor() { this.data = new Map(); }
      setData(type, value) { this.data.set(type, value); }
    },
    InputEvent: class {
      constructor(type, init) { this.type = type; Object.assign(this, init); }
    },
    Event: class { constructor(type) { this.type = type; } },
  };
  editor.focus = () => {};
  editor.dispatchEvent = (event) => {
    if (event.type === 'paste') pasteCalls += 1;
    return true;
  };

  const result = engine.replaceInputText(editor, fullText, env, { maxAttempts: 2 });

  assert.equal(result.ok, false);
  assert.equal(pasteCalls, 0);
  assert.equal(currentText, oldText);
});

test('complete-text wait follows a replacement editor and requires stable readback', async () => {
  const engine = loadEngine({ withTimers: true });
  const firstEditor = element({ contenteditable: 'true', isContentEditable: true });
  const replacementEditor = element({ contenteditable: 'true', isContentEditable: true });
  const fullText = 'complete relay prompt after ChatGPT rerender';
  firstEditor.textContent = 'complete relay';
  firstEditor.innerText = 'complete relay';
  replacementEditor.textContent = fullText;
  replacementEditor.innerText = fullText;
  let resolveCalls = 0;

  const result = await engine.waitForCompleteInput(() => {
    resolveCalls += 1;
    return resolveCalls === 1 ? firstEditor : replacementEditor;
  }, fullText, { initialInput: firstEditor, timeoutMs: 500, intervalMs: 1, stableReads: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.input, replacementEditor);
  assert.equal(result.text, fullText);
  assert.ok(resolveCalls >= 3);
});

test('native textarea insertion reports the complete value', () => {
  const engine = loadEngine();
  const textarea = element({ tagName: 'TEXTAREA' });
  const fullText = 'complete native ChatGPT message';
  const events = [];
  const env = {
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    HTMLInputElement: function HTMLInputElement() {},
    InputEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    Event: class { constructor(type) { this.type = type; } },
  };
  textarea.constructor = env.HTMLTextAreaElement;
  Object.setPrototypeOf(textarea, env.HTMLTextAreaElement.prototype);
  Object.defineProperty(env.HTMLTextAreaElement.prototype, 'value', {
    configurable: true,
    get() { return this._value || ''; },
    set(value) { this._value = value; },
  });
  textarea.focus = () => events.push('focus');
  textarea.dispatchEvent = (event) => events.push(event.type);

  const result = engine.replaceInputText(textarea, fullText, env);

  assert.equal(result.ok, true);
  assert.equal(result.text, fullText);
  assert.equal(textarea.value, fullText);
  assert.deepEqual(events, ['focus', 'input', 'change']);
});

test('content script uses usable-input filtering and complete-text verification', () => {
  assert.match(contentSource, /__LEE_RELAY_INPUT_ENGINE__/);
  assert.match(contentSource, /selectUsableInput/);
  assert.match(contentSource, /matchesCompleteText/);
  assert.match(contentSource, /replaceInputText/);
  assert.match(contentSource, /waitForCompleteInput/);
  assert.match(contentSource, /settled\?\.input/);
  assert.match(contentSource, /let insertionResult = setInputText/);
  assert.match(contentSource, /retryInput/);
});

test('context-file delivery waits for a settled attachment before sending', () => {
  assert.match(contentSource, /contextAttachmentBusy/);
  assert.match(contentSource, /waitForContextFileReady/);
  assert.match(contentSource, /Send was not attempted/);
  assert.match(backgroundSource, /attachmentResult\?\.ready/);
  assert.match(backgroundSource, /fallback-inline/);
});

test('context-file delivery reuses a confirmed attachment within one transaction', () => {
  assert.match(contentSource, /transaction\.contextFileAttached/);
  assert.match(contentSource, /transaction\.contextFileName === fileName/);
  assert.match(contentSource, /reused: true/);
});

test('a pending attachment remains guarded during the final ChatGPT send check', () => {
  assert.match(contentSource, /transaction\.contextFileName = fileName;\n\s*transaction\.contextFilePending = true/);
  assert.match(contentSource, /transaction\?\.contextFileName && \(transaction\.contextFileAttached \|\| transaction\.contextFilePending\)/);
});

test('manifest loads input engine before content script', () => {
  const files = manifest.content_scripts?.[0]?.js || [];
  assert.ok(files.indexOf('chatgpt-input-engine.js') >= 0);
  assert.ok(files.indexOf('chatgpt-input-engine.js') < files.indexOf('content.js'));
});

test('runtime reinjection loads input engine before content script', () => {
  assert.match(backgroundSource, /files:\s*\[\s*'chatgpt-input-engine\.js'\s*,\s*'content\.js'\s*\]/);
});

test('ChatGPT connection surfaces a locked composer instead of reporting a false reconnect', () => {
  assert.match(contentSource, /inputAvailable/);
  assert.match(contentSource, /inputError/);
  assert.match(contentSource, /data-chatgpt-extension-side-panel/);
  assert.match(backgroundSource, /response\.inputAvailable === false/);
});

test('stale content scripts are rejected before a relay send', () => {
  assert.match(contentSource, /CONTENT_SCRIPT_VERSION = '4\.1\.5'/);
  assert.match(contentSource, /contentVersion: CONTENT_SCRIPT_VERSION/);
  assert.match(backgroundSource, /CONTENT_SCRIPT_VERSION = '4\.1\.5'/);
  assert.match(backgroundSource, /contentVersion !== CONTENT_SCRIPT_VERSION/);
  assert.match(backgroundSource, /Reload the AI tab once/);
});

test('bugfix release is versioned as 4.1.5', () => {
  assert.equal(manifest.version, '4.1.5');
});
