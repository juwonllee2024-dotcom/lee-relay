import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoRecoveryPolicyFor,
  nextRecoveryAction,
  recoveryActionSequence,
} from '../recovery-engine.mjs';

test('ChatGPT recovery is bounded and never resends the same transaction', () => {
  const policy = autoRecoveryPolicyFor('chatgpt');
  assert.equal(policy.maxAttempts, 3);
  assert.equal(policy.allowResend, false);
  assert.deepEqual(recoveryActionSequence('chatgpt'), ['RECONNECT_CONTENT', 'REARM_OBSERVER', 'VERIFY_ONLY']);
  assert.equal(nextRecoveryAction({ provider: 'chatgpt', recoveryCount: 0 }).action, 'RECONNECT_CONTENT');
  assert.equal(nextRecoveryAction({ provider: 'chatgpt', recoveryCount: 3 }).action, 'ESCALATE');
});

test('Gemini recovery refreshes background lifecycle before rearming', () => {
  const policy = autoRecoveryPolicyFor('gemini');
  assert.equal(policy.maxAttempts, 4);
  assert.equal(policy.allowResend, false);
  assert.deepEqual(recoveryActionSequence('gemini'), ['REFRESH_BACKGROUND', 'RECONNECT_CONTENT', 'REARM_OBSERVER', 'VERIFY_ONLY']);
  assert.equal(nextRecoveryAction({ provider: 'gemini', recoveryCount: 0 }).action, 'REFRESH_BACKGROUND');
  assert.equal(nextRecoveryAction({ provider: 'gemini', recoveryCount: 2 }).action, 'REARM_OBSERVER');
});

test('unknown providers retain a small safe re-arm policy', () => {
  const action = nextRecoveryAction({ provider: 'claude', recoveryCount: 0 });
  assert.equal(action.action, 'REARM_OBSERVER');
  assert.equal(action.allowResend, false);
});
