import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyUrl,
  normalizeText,
  signatureFor,
  shouldForward,
  targetSiteFor,
  buildScreenshotFilename,
  providerLabelFor,
  otherSlotFor,
  selectedSlotForTabId,
  shouldAutoResume,
  shouldRetryPendingDelivery,
} from '../relay-core.mjs';

test('classifyUrl recognizes Gemini and Copilot URLs', () => {
  assert.equal(classifyUrl('https://gemini.google.com/app/abc'), 'gemini');
  assert.equal(classifyUrl('https://copilot.microsoft.com/chats/abc'), 'copilot');
  assert.equal(classifyUrl('https://example.com/'), null);
});

test('normalizeText collapses whitespace and trims UI noise', () => {
  assert.equal(normalizeText('  hello\n\n   world  '), 'hello\nworld');
  assert.equal(normalizeText('Copy\nUseful answer\nShare'), 'Useful answer');
});

test('signatureFor is stable for equivalent normalized text', async () => {
  assert.equal(await signatureFor(' hello   world '), await signatureFor('hello world'));
  assert.notEqual(await signatureFor('hello'), await signatureFor('goodbye'));
});

test('targetSiteFor returns the opposite relay endpoint', () => {
  assert.equal(targetSiteFor('gemini'), 'copilot');
  assert.equal(targetSiteFor('copilot'), 'gemini');
});

test('shouldForward rejects duplicates, blanks, and over-limit turns', () => {
  const state = { running: true, turnCount: 2, maxTurns: 5, lastSignatureBySite: { gemini: 'abc' } };
  assert.equal(shouldForward(state, 'gemini', 'text', 'abc'), false);
  assert.equal(shouldForward(state, 'gemini', 'text', 'def'), true);
  assert.equal(shouldForward({ ...state, running: false }, 'gemini', 'text', 'def'), false);
  assert.equal(shouldForward({ ...state, turnCount: 5 }, 'gemini', 'text', 'def'), false);
  assert.equal(shouldForward(state, 'gemini', '   ', 'def'), false);
});

test('buildScreenshotFilename creates a stable, descriptive PNG path', () => {
  const d = new Date('2026-08-19T18:22:33.456Z');
  assert.equal(buildScreenshotFilename('gemini', 7, d), 'lee-relay-bot-screenshots/gemini/2026-08-19/turn-007_gemini_2026-08-19T18-22-33-456Z.png');
});

test('classifyUrl recognizes ChatGPT and Claude URLs', () => {
  assert.equal(classifyUrl('https://chatgpt.com/c/123'), 'chatgpt');
  assert.equal(classifyUrl('https://chat.openai.com/'), 'chatgpt');
  assert.equal(classifyUrl('https://claude.ai/chat/abc'), 'claude');
});

test('providerLabelFor returns user-friendly names', () => {
  assert.equal(providerLabelFor('gemini'), 'Gemini');
  assert.equal(providerLabelFor('copilot'), 'Copilot');
  assert.equal(providerLabelFor('chatgpt'), 'ChatGPT');
  assert.equal(providerLabelFor('claude'), 'Claude');
  assert.equal(providerLabelFor('unknown'), 'Unknown');
});

test('otherSlotFor flips a and b', () => {
  assert.equal(otherSlotFor('a'), 'b');
  assert.equal(otherSlotFor('b'), 'a');
  assert.equal(otherSlotFor('x'), null);
});

test('selectedSlotForTabId finds the relay slot by stable tab id', () => {
  const selectedTabs = { a: { tabId: 11 }, b: { tabId: 22 } };
  assert.equal(selectedSlotForTabId(selectedTabs, 11), 'a');
  assert.equal(selectedSlotForTabId(selectedTabs, 22), 'b');
  assert.equal(selectedSlotForTabId(selectedTabs, 33), null);
});

test('shouldAutoResume survives supported-page navigation but not unrelated tabs', () => {
  const state = { running: true, selectedTabs: { a: { tabId: 11 }, b: { tabId: 22 } } };
  assert.equal(shouldAutoResume(state, 11, 'https://chatgpt.com/c/new-chat'), true);
  assert.equal(shouldAutoResume(state, 22, 'https://claude.ai/chat/xyz'), true);
  assert.equal(shouldAutoResume(state, 33, 'https://chatgpt.com/c/other'), false);
  assert.equal(shouldAutoResume(state, 11, 'https://example.com/'), false);
  assert.equal(shouldAutoResume({ ...state, running: false }, 11, 'https://chatgpt.com/'), false);
});

test('shouldAcceptResponse only accepts the expected speaker once', async () => {
  const { shouldAcceptResponse } = await import('../relay-core.mjs');
  const state = { running: true, awaitingTabId: 11, turnCount: 3, maxTurns: 10, lastSignatureByTabId: { '11': 'old' } };
  assert.equal(shouldAcceptResponse(state, 11, 'new'), true);
  assert.equal(shouldAcceptResponse(state, 22, 'new'), false);
  assert.equal(shouldAcceptResponse(state, 11, 'old'), false);
  assert.equal(shouldAcceptResponse({ ...state, running: false }, 11, 'new'), false);
  assert.equal(shouldAcceptResponse({ ...state, turnCount: 10 }, 11, 'new'), false);
});

test('responseReady requires quiet text and no active generation signal', async () => {
  const { responseReady } = await import('../relay-core.mjs');
  const base = { text: 'answer', previousText: 'answer', lastChangedAt: 1_000, now: 7_000, quietMs: 4_000 };
  assert.equal(responseReady({ ...base, generating: false }), true);
  assert.equal(responseReady({ ...base, generating: true }), false);
  assert.equal(responseReady({ ...base, now: 3_000, generating: false }), false);
  assert.equal(responseReady({ ...base, text: '', generating: false }), false);
  assert.equal(responseReady({ ...base, previousText: 'different', generating: false }), false);
});

test('mergeRuntimeState merges partial selections/signatures but replaces pending screenshot map', async () => {
  const { mergeRuntimeState } = await import('../relay-core.mjs');
  const current = { selectedTabs: { a: { tabId: 1 }, b: { tabId: 2 } }, lastSignatureByTabId: { '1': 'a', '2': 'b' }, pendingScreenshots: { '1': { turnCount: 1 }, '2': { turnCount: 2 } }, running: true };
  const next = mergeRuntimeState(current, { selectedTabs: { a: { tabId: 3 } }, lastSignatureByTabId: { '1': 'new' }, pendingScreenshots: { '2': { turnCount: 3 } } });
  assert.deepEqual(next.selectedTabs, { a: { tabId: 3 }, b: { tabId: 2 } });
  assert.deepEqual(next.lastSignatureByTabId, { '1': 'new', '2': 'b' });
  assert.deepEqual(next.pendingScreenshots, { '2': { turnCount: 3 } });
});

test('shouldRetryPendingDelivery only retries the pending target while relay is running', () => {
  const runtime = { running: true, pendingDelivery: { tabId: 42, text: 'hello' } };
  assert.equal(shouldRetryPendingDelivery(runtime, 42), true);
  assert.equal(shouldRetryPendingDelivery(runtime, 43), false);
  assert.equal(shouldRetryPendingDelivery({ ...runtime, running: false }, 42), false);
  assert.equal(shouldRetryPendingDelivery({ running: true, pendingDelivery: null }, 42), false);
});

test('reloaded page can recover a completed response when it differs from the known pre-prompt signature', async () => {
  const { responseActivityObserved } = await import('../relay-core.mjs');
  assert.equal(responseActivityObserved({ sawGeneration: false, text: 'new completed answer', initialText: 'new completed answer', currentSignature: 'new-sig', knownSignature: 'old-sig' }), true);
  assert.equal(responseActivityObserved({ sawGeneration: false, text: 'old answer', initialText: 'old answer', currentSignature: 'same', knownSignature: 'same' }), false);
});

test('watchdog may recover a stable changed answer and eventually ignores a stale generation marker', async () => {
  const { watchdogResponseRecoverable } = await import('../relay-core.mjs');
  const base = { running: true, expectedTabMatches: true, signatureChanged: true, stableMs: 10_000, generating: false };
  assert.equal(watchdogResponseRecoverable(base), true);
  assert.equal(watchdogResponseRecoverable({ ...base, signatureChanged: false }), false);
  assert.equal(watchdogResponseRecoverable({ ...base, stableMs: 1_000 }), false);
  assert.equal(watchdogResponseRecoverable({ ...base, generating: true, stableMs: 20_000 }), false);
  assert.equal(watchdogResponseRecoverable({ ...base, generating: true, stableMs: 95_000 }), true);
});
