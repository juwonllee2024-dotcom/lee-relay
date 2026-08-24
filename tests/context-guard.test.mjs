import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyContextGuardAfterTurn,
  CONTEXT_FILE_POLICIES,
  createContextReceipt,
  normalizeContextFilePolicy,
  normalizeContextReceipt,
} from '../file-context.mjs';

test('Context Guard defaults to every-turn scope and normalizes unsafe policy values', () => {
  assert.equal(CONTEXT_FILE_POLICIES.EVERY_TURN, 'every-turn');
  assert.equal(CONTEXT_FILE_POLICIES.NEXT_TURN, 'next-turn');
  assert.equal(normalizeContextFilePolicy(), 'every-turn');
  assert.equal(normalizeContextFilePolicy('next-turn'), 'next-turn');
  assert.equal(normalizeContextFilePolicy('anything-else'), 'every-turn');
});

test('Context Guard receipts keep only safe file metadata, never content or local paths', () => {
  const receipt = createContextReceipt({
    at: 123,
    turnNumber: 3,
    provider: 'gemini',
    label: 'Gemini',
    policy: 'next-turn',
    mode: 'inline-fallback',
    attachmentConfirmed: false,
    files: [{ name: 'C:\\Users\\juwon\\secret\\plan.md', text: 'do not persist', size: 42, sha256: 'ABC123' }],
  });

  assert.deepEqual(receipt.files, [{ name: 'plan.md', size: 42, sha256: 'abc123' }]);
  assert.equal(receipt.policy, 'next-turn');
  assert.equal(receipt.mode, 'inline-fallback');
  assert.equal(Object.hasOwn(receipt.files[0], 'text'), false);
  assert.doesNotMatch(JSON.stringify(receipt), /Users|juwon|secret/);
});

test('Context Guard receipt normalization bounds metadata and preserves one-turn clearing evidence', () => {
  const receipt = normalizeContextReceipt({
    at: 456,
    turnNumber: 4,
    provider: 'claude',
    label: 'Claude',
    policy: 'next-turn',
    mode: 'attachment',
    attachmentConfirmed: true,
    clearedAfterTurn: true,
    files: [{ name: '/tmp/spec.md', text: 'drop me', size: 12, sha256: 'DEF456' }],
  });

  assert.equal(receipt.clearedAfterTurn, true);
  assert.deepEqual(receipt.files, [{ name: 'spec.md', size: 12, sha256: 'def456' }]);
  assert.equal(receipt.provider, 'claude');
});

test('Context Guard clears selected files only after a verified next-turn handoff', () => {
  const receipt = createContextReceipt({
    at: 10,
    turnNumber: 1,
    provider: 'gemini',
    files: [{ name: 'plan.md', size: 10, sha256: 'abc' }],
  });
  const nextTurn = applyContextGuardAfterTurn({
    contextFilePolicy: 'next-turn',
    selectedFiles: [{ name: 'plan.md', text: 'private', size: 10, sha256: 'abc' }],
    contextReceipt: receipt,
  }, 999);
  assert.deepEqual(nextTurn.selectedFiles, []);
  assert.equal(nextTurn.contextReceipt.clearedAfterTurn, true);
  assert.equal(nextTurn.contextReceipt.clearedAt, 999);

  const everyTurn = { contextFilePolicy: 'every-turn', selectedFiles: [{ name: 'plan.md', text: 'keep' }] };
  assert.equal(applyContextGuardAfterTurn(everyTurn), everyTurn);
});
