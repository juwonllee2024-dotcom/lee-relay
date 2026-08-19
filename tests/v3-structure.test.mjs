import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('provider registry exposes delivery and response selectors for all supported providers', async () => {
  const { PROVIDER_ADAPTERS } = await import('../provider-adapters.mjs');
  for (const p of ['chatgpt','claude','gemini','copilot']) {
    const a = PROVIDER_ADAPTERS[p];
    assert.ok(a);
    for (const k of ['assistantSelectors','userSelectors','inputSelectors','sendButtonSelectors','generatingSelectors']) {
      assert.ok(Array.isArray(a[k]) && a[k].length, `${p}.${k}`);
    }
  }
});

test('content protocol separates send action from delivery confirmation', () => {
  const src = read('content.js');
  for (const type of ['ATTACH_PARTICIPANT','PREPARE_DELIVERY','SUBMIT_MESSAGE','VERIFY_DELIVERY','ARM_RESPONSE_OBSERVER','GET_TRANSACTION_STATUS']) {
    assert.match(src, new RegExp(`case '${type}'`));
  }
  const submit = src.match(/case 'SUBMIT_MESSAGE':[\s\S]*?break;/)?.[0] || '';
  assert.ok(submit);
  assert.match(submit, /sendActionExecuted/);
  assert.doesNotMatch(submit, /delivered:\s*true/);
  const verify = src.match(/case 'VERIFY_DELIVERY':[\s\S]*?break;/)?.[0] || '';
  assert.match(verify, /matchingUserMessage/);
});

test('transaction-scoped response events carry identity', () => {
  const src = read('content.js');
  assert.match(src, /RESPONSE_CONFIRMED/);
  assert.match(src, /transactionId/);
  assert.match(src, /participantId/);
  assert.match(src, /meetingId/);
});

test('v3 manifest uses side panel as primary UI', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.version, '3.0.1');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.side_panel?.default_path, 'sidepanel.html');
  assert.ok(!manifest.action?.default_popup);
});

test('background uses verified transaction stages and side panel behavior', () => {
  const src = read('background.js');
  assert.match(src, /setPanelBehavior\(\{\s*openPanelOnActionClick:\s*true\s*\}\)/);
  assert.match(src, /VERIFYING_DELIVERY/);
  assert.match(src, /deliveryEvidenceConfirmed/);
  assert.match(src, /NEEDS_ATTENTION/);
  assert.match(src, /MEETING_STATE_CHANGED/);
});

test('side panel contains meeting room controls and recovery actions', () => {
  const html = read('sidepanel.html');
  for (const id of ['meetingStatus','participants','addParticipant','transcript','composer','pauseMeeting','endMeeting','meetingControls','activityPanel','retryTransaction','skipParticipant','reconnectParticipant']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
});

test('meeting start requires two participants that actually reattached successfully', () => {
  const src = read('background.js');
  const fn = src.match(/async function startMeeting[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /connectionState\s*===\s*'READY'/);
  assert.match(fn, /ready[^\n]*length\s*<\s*2/);
});

test('delivery fallback uses a new generation transition rather than a stale generation control', () => {
  const src = read('content.js');
  assert.match(src, /baselineGenerating/);
  assert.match(src, /isGenerating\(roots\)\s*&&\s*!transaction\.baselineGenerating/);
});

test('response observer trusts the background delivery receipt even when the outgoing prompt DOM is collapsed', () => {
  const src = read('content.js');
  const arm = src.match(/case 'ARM_RESPONSE_OBSERVER':[\s\S]*?break;/)?.[0] || '';
  assert.ok(arm);
  assert.match(arm, /deliveryConfirmed\s*=\s*true/);
  const poll = src.match(/async function pollResponse\(\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(poll);
  assert.match(poll, /transaction\.deliveryConfirmed\s*\|\|\s*evidence\.matchingUserMessage/);
  assert.doesNotMatch(poll, /if \(!evidence\.matchingUserMessage\) return;/);
  const status = src.match(/async function responseStatus\(\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(status, /deliveryConfirmed/);
});

test('start meeting does not append the same seed topic twice', () => {
  const src = read('background.js');
  const fn = src.match(/async function startMeeting[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn);
  assert.match(fn, /latestUserText/);
  assert.match(fn, /normalizedSeed\s*!==\s*latestUserText/);
});

test('background response verification accepts an armed delivery receipt when exact outgoing DOM text is unavailable', () => {
  const src = read('background.js');
  assert.match(src, /verify\.deliveryConfirmed\s*\|\|\s*verify\.matchingUserMessage/);
  assert.match(src, /status\.deliveryConfirmed\s*\|\|\s*status\.matchingUserMessage/);
});
