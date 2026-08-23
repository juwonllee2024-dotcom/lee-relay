import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutonomousContextPlan,
  buildAutonomousFallbackInlinePrompt,
} from '../context-engine.mjs';

test('autonomous context contains topic and AI dialogue without user identity', () => {
  const plan = buildAutonomousContextPlan({
    provider: 'gemini',
    targetLabel: 'Gemini',
    participants: ['Gemini', 'Copilot'],
    topicText: 'Compare two approaches.',
    turnNumber: 2,
    entries: [
      { speaker: 'User', text: 'Do not leak this human label.' },
      { speaker: 'Gemini', text: 'Approach one has lower cost.' },
      { speaker: 'Copilot', text: 'Approach two is easier to maintain.' },
    ],
  });

  assert.match(plan.promptText, /Compare two approaches/);
  assert.match(plan.promptText, /Approach one/);
  assert.match(plan.promptText, /Approach two/);
  assert.doesNotMatch(plan.promptText, /Do not leak this human label/);
  assert.doesNotMatch(plan.promptText, /User:/);
  assert.doesNotMatch(plan.promptText, /LEE RELAY/);
});

test('autonomous context keeps the same provider size contract', () => {
  const plan = buildAutonomousContextPlan({
    provider: 'gemini',
    targetLabel: 'Gemini',
    participants: ['Gemini', 'Copilot'],
    topicText: 'Short topic',
    turnNumber: 1,
    entries: [],
  });
  assert.equal(typeof plan.promptText, 'string');
  assert.equal(plan.promptText.length <= 6000, true);
  assert.equal(plan.contextFile === null || typeof plan.contextFile.text === 'string', true);
});

test('autonomous fallback remains AI-only when a context file cannot attach', () => {
  const prompt = buildAutonomousFallbackInlinePrompt({
    provider: 'gemini',
    targetLabel: 'Gemini',
    participants: ['Gemini', 'Copilot'],
    topicText: 'Compare two approaches.',
    entries: [
      { speaker: 'User', text: 'This human sentence must stay out.' },
      { speaker: 'Copilot', text: 'The second approach is maintainable.' },
    ],
  });
  assert.match(prompt, /Compare two approaches/);
  assert.match(prompt, /maintainable/);
  assert.doesNotMatch(prompt, /This human sentence/);
  assert.doesNotMatch(prompt, /User:/);
});

test('autonomous context adds only the target role and current session phase', () => {
  const plan = buildAutonomousContextPlan({
    provider: 'gemini',
    targetLabel: 'Gemini',
    participants: ['Gemini', 'Copilot'],
    topicText: 'Analyze the channel.',
    role: 'Critic',
    rolePrompt: 'Demand concrete evidence.',
    sessionPhase: { name: 'Concept', instruction: 'Evaluate the promise and audience.' },
    entries: [{ speaker: 'Copilot', text: 'The idea is clear.' }],
  });
  assert.match(plan.promptText, /Role: Critic/);
  assert.match(plan.promptText, /Demand concrete evidence/);
  assert.match(plan.promptText, /Concept/);
  assert.doesNotMatch(plan.promptText, /User:/);
});
