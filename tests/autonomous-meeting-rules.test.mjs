import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAcceptUserMessage,
  canChangeInteractionMode,
  autonomousSeed,
} from '../interaction-mode.mjs';

test('live autonomous meetings reject user messages', () => {
  assert.equal(canAcceptUserMessage({ status: 'LIVE', interactionMode: 'autonomous' }), false);
});

test('paused autonomous meetings allow an explicit mode change', () => {
  assert.equal(canChangeInteractionMode({ status: 'PAUSED', interactionMode: 'autonomous', activeTransaction: null }), true);
});

test('autonomous seed prefers a fresh composer topic', () => {
  assert.equal(autonomousSeed({ meeting: { topicText: 'old' }, seedText: 'new topic' }), 'new topic');
});

test('interactive meetings accept user messages while live', () => {
  assert.equal(canAcceptUserMessage({ status: 'LIVE', interactionMode: 'interactive' }), true);
});

test('live meetings cannot change mode during an active transaction', () => {
  assert.equal(canChangeInteractionMode({ status: 'LIVE', interactionMode: 'autonomous', activeTransaction: null }), false);
  assert.equal(canChangeInteractionMode({ status: 'PAUSED', interactionMode: 'autonomous', activeTransaction: { transactionId: 'tx-1' } }), false);
});

test('ready meetings can recover a stale transaction before changing mode', () => {
  assert.equal(canChangeInteractionMode({ status: 'READY', interactionMode: 'interactive', activeTransaction: { transactionId: 'stale' } }), true);
});
