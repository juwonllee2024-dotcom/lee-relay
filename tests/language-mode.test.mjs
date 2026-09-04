import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMeeting } from '../meeting-engine.mjs';
import { buildCompactRelayPrompt } from '../relay-core.mjs';
import { buildAdaptiveContextPlan, buildAutonomousContextPlan } from '../context-engine.mjs';

const sidepanelHtml = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');

test('new meetings default to Korean language mode', () => {
  const meeting = createMeeting({ now: 1 });
  assert.equal(meeting.settings.language, 'ko');
});

test('compact relay prompt carries Japanese response-language instruction', () => {
  const prompt = buildCompactRelayPrompt({
    language: 'ja',
    targetLabel: 'ChatGPT',
    participants: ['ChatGPT', 'Gemini'],
    entries: [{ speaker: 'User', text: 'このテーマを検討してください。' }],
  });
  assert.match(prompt, /日本語で書いてください/);
});

test('adaptive context prompt carries English response-language instruction', () => {
  const plan = buildAdaptiveContextPlan({
    language: 'en',
    provider: 'chatgpt',
    targetLabel: 'ChatGPT',
    participants: ['ChatGPT', 'Gemini'],
    entries: [{ speaker: 'User', text: 'Review this proposal.' }],
  });
  assert.match(plan.promptText, /Write every final answer in English/);
});

test('compact relay prompts carry the selected language instruction for every mode', () => {
  const expected = {
    ko: '모든 최종 답변을 한국어로 작성하세요.',
    en: 'Write every final answer in English.',
    ja: 'すべての最終回答を日本語で書いてください。',
  };
  for (const [language, phrase] of Object.entries(expected)) {
    const prompt = buildCompactRelayPrompt({
      language,
      targetLabel: 'ChatGPT',
      participants: ['ChatGPT', 'Gemini'],
      entries: [{ speaker: 'User', text: 'Review this topic.' }],
    });
    assert.match(prompt, new RegExp(phrase));
  }
});

test('long context keeps the selected language in file-mode prompts', () => {
  const plan = buildAdaptiveContextPlan({
    language: 'ja',
    provider: 'chatgpt',
    targetLabel: 'ChatGPT',
    participants: ['ChatGPT', 'Gemini'],
    entries: Array.from({ length: 18 }, (_, index) => ({
      speaker: index % 2 ? 'Gemini' : 'ChatGPT',
      text: `Turn ${index}: ${'discussion '.repeat(110)}`,
    })),
  });
  assert.equal(plan.mode, 'file');
  assert.match(plan.promptText, /すべての最終回答を日本語で書いてください/);
  assert.match(plan.contextFile.text, /最新のターン/);
});

test('Full Auto prompts keep the selected language', () => {
  const plan = buildAutonomousContextPlan({
    language: 'en',
    provider: 'chatgpt',
    targetLabel: 'Gemini',
    participants: ['Gemini', 'Copilot'],
    topicText: 'Evaluate this proposal.',
    entries: [{ speaker: 'Copilot', text: 'I recommend testing the assumptions first.' }],
  });
  assert.match(plan.promptText, /Write every final answer in English/);
  assert.match(plan.promptText, /ongoing peer discussion/);
});

test('built-in session phase guidance is localized with the selected language', () => {
  const plan = buildAdaptiveContextPlan({
    language: 'ja',
    provider: 'chatgpt',
    targetLabel: 'ChatGPT',
    participants: ['ChatGPT', 'Gemini'],
    sessionPhase: {
      id: 'axis-1',
      name: 'Concept',
      instruction: 'Evaluate the channel idea.',
    },
    entries: [{ speaker: 'User', text: 'Analyze this channel.' }],
  });
  assert.match(plan.promptText, /コンセプト/);
  assert.match(plan.promptText, /チャンネルのアイデア/);
});

test('side panel exposes a globe language control', () => {
  assert.match(sidepanelHtml, /id="languageButton"/);
  assert.match(sidepanelHtml, /data-language="ko"/);
  assert.match(sidepanelHtml, /data-language="en"/);
  assert.match(sidepanelHtml, /data-language="ja"/);
});
