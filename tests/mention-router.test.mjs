import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseMentionDirective,
  resolveMentionDirective,
} from '../mention-router.mjs';

const participants = [
  { id: 'p1', provider: 'gemini', label: 'Gemini', role: 'Researcher', tabId: 1, connectionState: 'READY' },
  { id: 'p2', provider: 'copilot', label: 'Copilot', role: 'Critic', tabId: 2, connectionState: 'READY' },
  { id: 'p3', provider: 'chatgpt', label: 'ChatGPT', role: 'Facilitator', tabId: null, connectionState: 'DISCONNECTED' },
];

test('leading @AI directives resolve providers, labels, roles, and broadcast', () => {
  assert.equal(parseMentionDirective('@Gemini: start with evidence').alias, 'Gemini');
  assert.equal(resolveMentionDirective('@Copilot, challenge this', participants).target.id, 'p2');
  assert.equal(resolveMentionDirective('@Researcher review the hook', participants).target.id, 'p1');
  assert.equal(resolveMentionDirective('@all compare both options', participants).kind, 'broadcast');
});

test('historical prose is not treated as an automatic directive', () => {
  assert.equal(parseMentionDirective('I spoke with @Gemini yesterday'), null);
  assert.equal(resolveMentionDirective('The note says @Copilot should answer', participants).target, null);
});

test('disconnected, unknown, and self targets return explicit safe reasons', () => {
  assert.match(resolveMentionDirective('@ChatGPT: answer', participants).reason, /connect/i);
  assert.match(resolveMentionDirective('@Unknown: answer', participants).reason, /unknown/i);
  assert.match(resolveMentionDirective('@Gemini: continue', participants, 'p1').reason, /same|self/i);
  assert.equal(resolveMentionDirective('@Gemini: continue', participants, 'p1').target, null);
});
