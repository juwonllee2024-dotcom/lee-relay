import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSACTION_STAGES,
  createTransaction,
  transitionTransaction,
  canAcceptEvent,
  deliveryEvidenceConfirmed,
  shouldRetryTransaction,
  markTransactionRetry,
  transactionTimedOut,
} from '../transaction-engine.mjs';

test('send action alone never confirms delivery', () => {
  assert.equal(deliveryEvidenceConfirmed({ sendActionExecuted: true }), false);
});

test('matching outgoing user node confirms delivery while weak signals alone do not', () => {
  assert.equal(deliveryEvidenceConfirmed({ sendActionExecuted: true, matchingUserMessage: true }), true);
  assert.equal(deliveryEvidenceConfirmed({ inputCleared: true, generationStarted: true }), false);
  assert.equal(deliveryEvidenceConfirmed({ sendActionExecuted: true, inputCleared: true, generationStarted: true }), true);
  assert.equal(deliveryEvidenceConfirmed({ matchingUserMessage: true, inputCleared: true }), true);
});

test('transaction starts PREPARING with identity and configured retry policy', () => {
  const tx = createTransaction({ meetingId: 'm1', participantId: 'p1', tabId: 5, turnNumber: 3, promptText: 'hello', promptSignature: 'sig', retryLimit: 3, now: 100 });
  assert.equal(tx.stage, 'PREPARING');
  assert.equal(tx.attempt, 0);
  assert.equal(tx.retryLimit, 3);
  assert.ok(tx.transactionId);
  assert.ok(TRANSACTION_STAGES.includes('VERIFYING_DELIVERY'));
});

test('normal transitions follow the explicit transaction path', () => {
  let tx = createTransaction({ meetingId: 'm', participantId: 'p', tabId: 1, turnNumber: 1, promptText: 'x', now: 10 });
  for (const stage of ['SENDING', 'VERIFYING_DELIVERY', 'DELIVERED', 'WAITING_FOR_GENERATION', 'RECEIVING', 'VERIFYING_RESPONSE', 'COMPLETE']) {
    tx = transitionTransaction(tx, stage, {}, 20);
    assert.equal(tx.stage, stage);
  }
  assert.throws(() => transitionTransaction(tx, 'SENDING'), /terminal/i);
});

test('transaction rejects late or mismatched events', () => {
  const tx = createTransaction({ meetingId: 'm', transactionId: 't', participantId: 'p', tabId: 7, turnNumber: 1, promptText: 'x' });
  assert.equal(canAcceptEvent(tx, { meetingId: 'm', transactionId: 't', participantId: 'p', tabId: 7 }), true);
  assert.equal(canAcceptEvent(tx, { meetingId: 'm', transactionId: 'old', participantId: 'p', tabId: 7 }), false);
  assert.equal(canAcceptEvent(tx, { meetingId: 'm', transactionId: 't', participantId: 'other', tabId: 7 }), false);
  assert.equal(canAcceptEvent(tx, { meetingId: 'm', transactionId: 't', participantId: 'p', tabId: 8 }), false);
});

test('retry count is bounded and terminal attention stops retries', () => {
  let tx = createTransaction({ meetingId: 'm', participantId: 'p', tabId: 1, turnNumber: 1, promptText: 'x', retryLimit: 2, now: 0 });
  assert.equal(shouldRetryTransaction(tx), true);
  tx = markTransactionRetry(tx, 'delivery timeout', 10);
  assert.equal(tx.stage, 'RETRYING');
  assert.equal(tx.attempt, 1);
  assert.equal(shouldRetryTransaction(tx), true);
  tx = markTransactionRetry(tx, 'delivery timeout', 20);
  assert.equal(tx.stage, 'RETRYING');
  assert.equal(tx.attempt, 2);
  assert.equal(shouldRetryTransaction(tx), false);
  tx = transitionTransaction(tx, 'NEEDS_ATTENTION', { error: 'failed' }, 30);
  assert.equal(shouldRetryTransaction(tx), false);
});

test('transaction timeout is based on last progress and response timeout', () => {
  const tx = createTransaction({ meetingId: 'm', participantId: 'p', tabId: 1, turnNumber: 1, promptText: 'x', responseTimeoutMs: 1000, now: 500 });
  assert.equal(transactionTimedOut(tx, 1499), false);
  assert.equal(transactionTimedOut(tx, 1501), true);
});
