import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTabStatusSnapshot, classifyTabHealth } from '../status-center.mjs';

test('status center joins open tabs with participant and active transaction state', () => {
  const rows = buildTabStatusSnapshot({
    now: 10_000,
    tabs: [
      { tabId: 11, provider: 'chatgpt', providerLabel: 'ChatGPT', label: 'ChatGPT - Research', active: false },
      { tabId: 22, provider: 'gemini', providerLabel: 'Gemini', label: 'Gemini - Ideas', active: true },
      { tabId: 33, provider: 'copilot', providerLabel: 'Copilot', label: 'Copilot - unused', active: false },
    ],
    participants: [
      { id: 'p1', tabId: 11, provider: 'chatgpt', connectionState: 'READY', turnState: 'LISTENING', lastSeenAt: 9_500 },
      { id: 'p2', tabId: 22, provider: 'gemini', connectionState: 'READY', turnState: 'THINKING', lastSeenAt: 9_900 },
    ],
    activeTransaction: { participantId: 'p2', stage: 'WAITING_FOR_GENERATION', recoveryCount: 1 },
  });

  assert.deepEqual(rows.map((row) => row.tabId), [11, 22, 33]);
  assert.equal(rows[0].health, 'READY');
  assert.equal(rows[1].health, 'BUSY');
  assert.equal(rows[1].transactionStage, 'WAITING_FOR_GENERATION');
  assert.equal(rows[1].recoveryCount, 1);
  assert.equal(rows[2].health, 'UNBOUND');
  assert.equal(rows[2].participantId, null);
});

test('status center exposes disconnected participants even when their tab disappeared', () => {
  const rows = buildTabStatusSnapshot({
    now: 100_000,
    tabs: [],
    participants: [{ id: 'p1', tabId: null, provider: 'gemini', label: 'Gemini', connectionState: 'DISCONNECTED', turnState: 'WAITING' }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].health, 'DISCONNECTED');
  assert.equal(rows[0].tabId, null);
});

test('stale bound tabs are distinguishable from an explicit provider error', () => {
  assert.equal(classifyTabHealth({ tabId: 42, participantId: 'p1', connectionState: 'READY', lastSeenAt: 1, now: 100_000, staleAfterMs: 10_000 }), 'STALE');
  assert.equal(classifyTabHealth({ connectionState: 'ERROR', lastSeenAt: 99_000, now: 100_000 }), 'ERROR');
  assert.equal(classifyTabHealth({ tabId: 42, participantId: 'p1', connectionState: 'READY', lastSeenAt: 99_000, now: 100_000 }), 'READY');
});
