import { languageInstruction, normalizeLanguage, promptText } from './language.mjs';

export const SUPPORTED_PROVIDERS = Object.freeze({
  gemini: { label: 'Gemini', hosts: ['gemini.google.com'] },
  copilot: { label: 'Copilot', hosts: ['copilot.microsoft.com'] },
  chatgpt: { label: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  claude: { label: 'Claude', hosts: ['claude.ai'] },
});

export function providerLabelFor(provider) {
  return SUPPORTED_PROVIDERS[provider]?.label || 'Unknown';
}

export function classifyUrl(url = '') {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [key, value] of Object.entries(SUPPORTED_PROVIDERS)) {
      if (value.hosts.includes(host)) return key;
    }
    return null;
  } catch {
    return null;
  }
}

const EDGE_NOISE = new Set([
  'copy', 'copy response', 'share', 'like', 'dislike', 'read aloud', 'regenerate',
  '복사', '공유', '좋아요', '싫어요', '소리내어 읽기', '다시 생성', '다시 시도',
]);

export function normalizeText(text = '') {
  const lines = String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim());

  while (lines.length && (!lines[0] || EDGE_NOISE.has(lines[0].toLowerCase()))) lines.shift();
  while (lines.length && (!lines.at(-1) || EDGE_NOISE.has(lines.at(-1).toLowerCase()))) lines.pop();

  return lines.filter(Boolean).join('\n').trim();
}

export function isRelayEnvelope(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const firstLine = normalized.split('\n', 1)[0].trim();
  return /^\[LEE RELAY MEETING\]$/i.test(firstLine);
}


function compactOneLine(text = '') {
  return normalizeText(text).replace(/\s+/g, ' ').trim();
}

export function buildCompactRelayPrompt({ targetLabel = 'AI', participants = [], entries = [], language = 'ko' } = {}) {
  const selectedLanguage = normalizeLanguage(language);
  const target = compactOneLine(targetLabel) || 'AI';
  const others = (participants || [])
    .map(compactOneLine)
    .filter((name) => name && name.toLowerCase() !== target.toLowerCase())
    .join(', ') || 'the other participants';
  const discussion = (entries || [])
    .map((entry) => ({ speaker: compactOneLine(entry?.speaker || 'Participant'), text: compactOneLine(entry?.text || '') }))
    .filter((entry) => entry.text && !isRelayEnvelope(entry.text))
    .map((entry) => `${entry.speaker}: ${entry.text}`)
    .join(' | ');
  const context = discussion || (selectedLanguage === 'ja' ? '会話は始まったばかりです。' : selectedLanguage === 'ko' ? '대화가 이제 시작되었습니다.' : 'The conversation has just started.');
  return compactOneLine([
    promptText(selectedLanguage, 'liveConversation', { target, others }),
    promptText(selectedLanguage, 'conversationSoFar', { discussion: context }),
    promptText(selectedLanguage, 'yourTurn', { target }),
    languageInstruction(selectedLanguage),
    promptText(selectedLanguage, 'noRepeat'),
    promptText(selectedLanguage, 'addressNext'),
  ].join(' '));
}

export function buildAutonomousCompactPrompt({ targetLabel = 'AI', participants = [], topicText = '', entries = [], language = 'ko' } = {}) {
  const selectedLanguage = normalizeLanguage(language);
  const target = compactOneLine(targetLabel) || 'AI';
  const others = (participants || [])
    .map(compactOneLine)
    .filter((name) => name && name.toLowerCase() !== target.toLowerCase())
    .join(', ') || 'the other participants';
  const topic = compactOneLine(topicText) || (selectedLanguage === 'ja' ? '選択したテーマ' : selectedLanguage === 'ko' ? '선택한 주제' : 'the selected topic');
  const discussion = (entries || [])
    .map((entry) => ({ speaker: compactOneLine(entry?.speaker || 'Participant'), text: compactOneLine(entry?.text || '') }))
    .filter((entry) => entry.text && !isRelayEnvelope(entry.text))
    .map((entry) => `${entry.speaker}: ${entry.text}`)
    .join(' | ') || (selectedLanguage === 'ja' ? '完了したAIターンはまだありません。' : selectedLanguage === 'ko' ? '완료된 AI 턴이 아직 없습니다.' : 'No AI turns have been completed yet.');
  return compactOneLine([
    promptText(selectedLanguage, 'autonomousConversation', { target, others }),
    promptText(selectedLanguage, 'topic', { topic }),
    promptText(selectedLanguage, 'aiDiscussion', { discussion }),
    promptText(selectedLanguage, 'continueDiscussion', { target }),
    languageInstruction(selectedLanguage),
    promptText(selectedLanguage, 'noInternal'),
    promptText(selectedLanguage, 'addressNext'),
  ].join(' '));
}

export function sanitizeRelayResponse(rawText = '', promptText = '') {
  let raw = normalizeText(rawText);
  if (!raw) return '';

  const compactRaw = () => raw.replace(/\s+/g, ' ').trim();
  const prompt = compactOneLine(promptText);
  if (prompt) {
    const oneLine = compactRaw();
    if (oneLine === prompt) return '';
    if (oneLine.startsWith(`${prompt} `)) raw = oneLine.slice(prompt.length).trim();
  }

  // v3.0.1-v3.0.3 used this visible protocol scaffold. Gemini can echo
  // the whole outgoing prompt as part of the element we observe as a response.
  // Strip only a leading legacy scaffold, never an incidental mention later on.
  let oneLine = compactRaw();
  const legacyStart = /^\[LEE RELAY MEETING\]/i;
  const legacyTail = 'if you clearly want a specific participant to answer next, address them by participant name.';
  for (let i = 0; i < 4 && legacyStart.test(oneLine); i += 1) {
    const lower = oneLine.toLowerCase();
    const idx = lower.lastIndexOf(legacyTail);
    if (idx < 0) return /^\[LEE RELAY MEETING\]\s*$/i.test(oneLine) ? '' : oneLine;
    oneLine = oneLine.slice(idx + legacyTail.length).trim();
  }
  return normalizeText(oneLine);
}

export async function signatureFor(text = '') {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Kept for backwards compatibility with the first two-provider implementation.
export function targetSiteFor(site) {
  if (site === 'gemini') return 'copilot';
  if (site === 'copilot') return 'gemini';
  return null;
}

export function otherSlotFor(slot) {
  if (slot === 'a') return 'b';
  if (slot === 'b') return 'a';
  return null;
}

export function selectedSlotForTabId(selectedTabs = {}, tabId) {
  if (selectedTabs?.a?.tabId === tabId) return 'a';
  if (selectedTabs?.b?.tabId === tabId) return 'b';
  return null;
}

export function shouldAutoResume(state, tabId, url = '') {
  if (!state?.running) return false;
  if (!selectedSlotForTabId(state.selectedTabs, tabId)) return false;
  return Boolean(classifyUrl(url));
}

// Legacy predicate used by older tests and helpers.
export function shouldForward(state, site, text, signature) {
  if (!state?.running) return false;
  if (!site || !normalizeText(text)) return false;
  if (state.maxTurns > 0 && state.turnCount >= state.maxTurns) return false;
  if (state.lastSignatureByTabId?.[site] === signature) return false;
  if (state.lastSignatureBySite?.[site] === signature) return false;
  return true;
}


export function shouldRetryPendingDelivery(runtime, tabId) {
  if (!runtime?.running) return false;
  if (!runtime.pendingDelivery || runtime.pendingDelivery.tabId !== tabId) return false;
  return Boolean(normalizeText(runtime.pendingDelivery.text || ''));
}

export function shouldAcceptResponse(state, tabId, signature) {
  if (!state?.running) return false;
  if (!tabId || state.awaitingTabId !== tabId) return false;
  if (!signature) return false;
  if (state.maxTurns > 0 && state.turnCount >= state.maxTurns) return false;
  if (state.lastSignatureByTabId?.[String(tabId)] === signature) return false;
  return true;
}


export function mergeRuntimeState(current = {}, patch = {}) {
  return {
    ...current,
    ...patch,
    selectedTabs: { ...(current.selectedTabs || {}), ...(patch.selectedTabs || {}) },
    lastSignatureByTabId: { ...(current.lastSignatureByTabId || {}), ...(patch.lastSignatureByTabId || {}) },
    pendingScreenshots: Object.prototype.hasOwnProperty.call(patch, 'pendingScreenshots')
      ? { ...(patch.pendingScreenshots || {}) }
      : { ...(current.pendingScreenshots || {}) },
  };
}

export function responseReady({
  text = '',
  previousText = '',
  lastChangedAt = 0,
  now = Date.now(),
  quietMs = 4000,
  generating = false,
} = {}) {
  if (generating) return false;
  if (!normalizeText(text)) return false;
  if (text !== previousText) return false;
  if (!Number.isFinite(lastChangedAt) || lastChangedAt <= 0) return false;
  return now - lastChangedAt >= quietMs;
}

function padTurn(turnCount = 0) {
  return String(Math.max(0, Number(turnCount) || 0)).padStart(3, '0');
}

function formatTimestampForFilename(date = new Date()) {
  return new Date(date).toISOString().replace(/[:.]/g, '-');
}

export function buildScreenshotFilename(site = 'unknown', turnCount = 0, date = new Date()) {
  const safeSite = String(site || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'unknown';
  const iso = new Date(date).toISOString();
  const day = iso.slice(0, 10);
  const timestamp = formatTimestampForFilename(date);
  return `lee-relay-bot-screenshots/${safeSite}/${day}/turn-${padTurn(turnCount)}_${safeSite}_${timestamp}.png`;
}


export function responseActivityObserved({
  sawGeneration = false,
  text = '',
  initialText = '',
  currentSignature = null,
  knownSignature = null,
  resumeRecovery = false,
} = {}) {
  if (!normalizeText(text)) return false;
  if (sawGeneration) return true;
  if (normalizeText(text) !== normalizeText(initialText)) return true;
  if (resumeRecovery) {
    if (!knownSignature && currentSignature) return true;
    if (knownSignature && currentSignature && knownSignature !== currentSignature) return true;
  }
  return Boolean(knownSignature && currentSignature && knownSignature !== currentSignature);
}

export function watchdogResponseRecoverable({
  running = false,
  expectedTabMatches = false,
  signatureChanged = false,
  stableMs = 0,
  generating = false,
  minStableMs = 2500,
  staleGeneratingMs = 90000,
} = {}) {
  if (!running || !expectedTabMatches || !signatureChanged) return false;
  if (!Number.isFinite(stableMs) || stableMs < minStableMs) return false;
  if (!generating) return true;
  return stableMs >= staleGeneratingMs;
}
