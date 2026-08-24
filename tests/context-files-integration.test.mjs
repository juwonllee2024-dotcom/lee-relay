import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAdaptiveContextPlan,
  buildAutonomousContextPlan,
  buildFallbackInlinePrompt,
  buildAutonomousFallbackInlinePrompt,
} from '../context-engine.mjs';

const selectedFile = {
  name: 'project-plan.md',
  type: 'text/markdown',
  size: 42,
  lastModified: 123,
  sha256: 'feedface',
  text: '# Project plan\nKeep the launch checklist visible.',
};

test('selected local files force a visible context attachment for short meetings', () => {
  const plan = buildAdaptiveContextPlan({
    provider: 'gemini',
    meetingTitle: 'Launch review',
    targetLabel: 'Gemini',
    participants: ['Gemini', 'Claude'],
    turnNumber: 1,
    entries: [{ speaker: 'User', text: 'Review this plan.' }],
    selectedFiles: [selectedFile],
  });

  assert.equal(plan.mode, 'file');
  assert.equal(plan.selectedFileCount, 1);
  assert.match(plan.contextFile.text, /SELECTED LOCAL FILES/);
  assert.match(plan.contextFile.text, /project-plan\.md/);
  assert.match(plan.contextFile.text, /Keep the launch checklist visible/);
  assert.match(plan.promptText, /lee-relay-context-turn-001\.txt/);
});

test('autonomous runs carry selected files without adding human transcript identity', () => {
  const plan = buildAutonomousContextPlan({
    provider: 'copilot',
    targetLabel: 'Copilot',
    participants: ['Gemini', 'Copilot'],
    topicText: 'Find launch risks.',
    turnNumber: 2,
    entries: [{ speaker: 'Gemini', text: 'The plan needs a rollback step.' }],
    selectedFiles: [selectedFile],
  });

  assert.equal(plan.mode, 'file');
  assert.match(plan.contextFile.text, /project-plan\.md/);
  assert.doesNotMatch(plan.contextFile.text, /User:/);
});

test('interactive fallback keeps a bounded excerpt of selected files when upload is unavailable', () => {
  const prompt = buildFallbackInlinePrompt({
    provider: 'gemini',
    targetLabel: 'Gemini',
    participants: ['Gemini', 'Claude'],
    entries: [{ speaker: 'User', text: 'Review the file.' }],
    selectedFiles: [selectedFile],
  });
  assert.match(prompt, /project-plan\.md/);
  assert.match(prompt, /Keep the launch checklist visible/);
  assert.ok(prompt.length <= 8500);
});

test('autonomous fallback keeps selected file content without a User speaker', () => {
  const prompt = buildAutonomousFallbackInlinePrompt({
    provider: 'copilot',
    targetLabel: 'Copilot',
    participants: ['Gemini', 'Copilot'],
    topicText: 'Find launch risks.',
    entries: [{ speaker: 'Gemini', text: 'The plan needs a rollback step.' }],
    selectedFiles: [selectedFile],
  });
  assert.match(prompt, /project-plan\.md/);
  assert.match(prompt, /Keep the launch checklist visible/);
  assert.doesNotMatch(prompt, /User:/);
  assert.ok(prompt.length <= 7400);
});
