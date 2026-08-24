import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Context Shelf exposes explicit selection and removal in the side panel', () => {
  const html = read('sidepanel.html');
  const js = read('sidepanel.js');
  assert.match(html, /contextFilePicker/);
  assert.match(html, /Select local files/);
  assert.match(js, /SET_CONTEXT_FILES/);
  assert.match(js, /file\.text\(\)/);
  assert.match(js, /removeContextFile/);
  assert.match(js, /sha256/);
});

test('background keeps selected files in session state and strips them from durable state', () => {
  const background = read('background.js');
  const meeting = read('meeting-engine.mjs');
  assert.match(background, /file-context\.mjs/);
  assert.match(background, /case 'SET_CONTEXT_FILES'/);
  assert.match(background, /selectedFiles/);
  assert.match(background, /selectedFiles:\s*meeting\.selectedFiles(?:\s*\|\|\s*\[\])?/);
  assert.match(meeting, /delete copy\.selectedFiles/);
});

test('selected file context is included in both interactive and autonomous plans', () => {
  const background = read('background.js');
  assert.match(background, /selectedFiles:\s*meeting\.selectedFiles(?:\s*\|\|\s*\[\])?/);
});

test('Context Guard exposes scope control and a safe handoff receipt', () => {
  const html = read('sidepanel.html');
  const js = read('sidepanel.js');
  const background = read('background.js');
  assert.match(html, /contextFilePolicy/);
  assert.match(html, /Next turn only/);
  assert.match(html, /contextReceipt/);
  assert.match(js, /SET_CONTEXT_POLICY/);
  assert.match(js, /renderContextReceipt/);
  assert.match(background, /case 'SET_CONTEXT_POLICY'/);
  assert.match(background, /createContextReceipt/);
  assert.match(background, /applyContextGuardAfterTurn/);
  assert.match(background, /CONTEXT_CLEARED/);
});
