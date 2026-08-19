import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('side panel state reads do not reassign participant bindings', () => {
  const source = read('background.js');
  const handler = source.match(/case 'GET_MEETING_STATE':[\s\S]*?;/)?.[0] || '';
  assert.ok(handler);
  assert.doesNotMatch(handler, /bindParticipant|tabId\s*:/);
});

test('screenshot capture never steals focus by activating another tab', () => {
  const source = read('background.js');
  assert.doesNotMatch(source, /tabs\.update\([^\n]+active:\s*true/);
});

test('content adapters expose explicit generation indicators and outgoing user selectors', () => {
  const source = read('content.js');
  for (const provider of ['gemini', 'copilot', 'chatgpt', 'claude']) {
    const start = source.indexOf(`${provider}: {`);
    assert.notEqual(start, -1, `${provider} adapter missing`);
    const tail = source.slice(start, start + 5500);
    assert.match(tail, /generatingSelectors\s*:/, `${provider} lacks generatingSelectors`);
    assert.match(tail, /userSelectors\s*:/, `${provider} lacks userSelectors`);
  }
});

test('extension updates preserve an existing saved v3 meeting', () => {
  const source = read('background.js');
  assert.match(source, /local\[SAVED_MEETING_KEY\]\s*\|\|\s*createMeeting\(\)/);
  const installed = source.match(/chrome\.runtime\.onInstalled\.addListener\([\s\S]*?\n\}\);/)?.[0] || '';
  assert.ok(installed);
  assert.doesNotMatch(installed, /chrome\.storage\.local\.set\(\{\s*\[SAVED_MEETING_KEY\]:\s*createMeeting/);
});

test('debugger permission is optional and requested only from screenshot UI', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.optional_permissions?.includes('debugger'));
  assert.ok(!manifest.permissions?.includes('debugger'));
  assert.match(read('sidepanel.js'), /permissions\.request\(\{\s*permissions:\s*\['debugger'\]/);
});

test('exact screenshot path crops the assistant response without tab activation', () => {
  const background = read('background.js');
  const content = read('content.js');
  assert.match(content, /case 'GET_LATEST_RESPONSE_RECT'/);
  assert.match(background, /GET_LATEST_RESPONSE_RECT/);
  assert.match(background, /captureBeyondViewport:\s*true/);
  assert.match(background, /clip:\s*rect/);
  assert.doesNotMatch(background, /active:\s*true/);
});

test('content polling caches shadow roots instead of rescanning for every selector', () => {
  const source = read('content.js');
  assert.match(source, /rootCache/);
  assert.match(source, /ROOT_RESCAN_MS/);
  assert.match(source, /getRoots\(force = false\)/);
});

test('all mutating meeting events are serialized through one queue', () => {
  const source = read('background.js');
  assert.match(source, /let eventQueue = Promise\.resolve\(\)/);
  assert.match(source, /const readOnly = new Set\(\['GET_MEETING_STATE','LIST_SUPPORTED_TABS'\]\)/);
  assert.match(source, /enqueue\(\(\) => handleCommand\(message, sender\)\)/);
});

test('a turn increments currentTurn only after a verified response completes', () => {
  const source = read('background.js');
  assert.match(source, /transitionTransaction\(nextTx, 'COMPLETE'/);
  assert.match(source, /currentTurn:\s*meeting\.currentTurn \+ 1/);
  const execute = source.match(/async function executeTurn[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(execute, /currentTurn:\s*meeting\.currentTurn \+ 1/);
});

test('delivery retries verify late delivery before resending', () => {
  const source = read('background.js');
  const fn = source.match(/async function deliveryWithRetries[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /Idempotency check/);
  assert.match(fn, /verifyDelivery/);
  assert.match(fn, /SUBMIT_MESSAGE/);
  assert.ok(fn.indexOf('verifyDelivery') < fn.lastIndexOf('SUBMIT_MESSAGE'));
});

test('closing one participant tab preserves the meeting and marks that participant disconnected', () => {
  const source = read('background.js');
  const removed = source.match(/chrome\.tabs\.onRemoved\.addListener[\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(removed, /connectionState:\s*'DISCONNECTED'/);
  assert.doesNotMatch(removed, /newMeeting\(|transcript:\s*\[\]/);
});

test('watchdog rechecks transaction state and can surface NEEDS_ATTENTION', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const background = read('background.js');
  assert.ok(manifest.permissions.includes('alarms'));
  assert.match(background, /chrome\.alarms\.onAlarm\.addListener/);
  assert.match(background, /GET_TRANSACTION_STATUS/);
  assert.match(background, /watchdogRecover/);
  assert.match(background, /enterNeedsAttention/);
});

test('manifest has no popup and toolbar action opens the side panel', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(!manifest.action?.default_popup);
  assert.equal(manifest.side_panel?.default_path, 'sidepanel.html');
  assert.match(read('background.js'), /openPanelOnActionClick:\s*true/);
});
