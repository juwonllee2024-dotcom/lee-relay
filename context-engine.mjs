import { buildAutonomousCompactPrompt, buildCompactRelayPrompt, normalizeText } from './relay-core.mjs';
import { languageInstruction, localizedSessionPhase, promptText } from './language.mjs';

export const PROVIDER_CONTEXT_LIMITS = Object.freeze({
  copilot: Object.freeze({ inlineMaxChars: 5000, compactMaxChars: 8000, fallbackMaxChars: 7400, fileSwitchChars: 8000, maxFileChars: 160000 }),
  gemini: Object.freeze({ inlineMaxChars: 6000, compactMaxChars: 10000, fallbackMaxChars: 8500, fileSwitchChars: 10000, maxFileChars: 180000 }),
  chatgpt: Object.freeze({ inlineMaxChars: 6000, compactMaxChars: 12000, fallbackMaxChars: 9000, fileSwitchChars: 12000, maxFileChars: 200000 }),
  claude: Object.freeze({ inlineMaxChars: 6000, compactMaxChars: 12000, fallbackMaxChars: 9000, fileSwitchChars: 12000, maxFileChars: 200000 }),
});

const DEFAULT_LIMITS = PROVIDER_CONTEXT_LIMITS.chatgpt;

function limitsFor(provider) {
  return PROVIDER_CONTEXT_LIMITS[provider] || DEFAULT_LIMITS;
}

function localizedPrompt(language, key, variables = {}) {
  return promptText(language, key, variables);
}

function buildCoordinationText({ role = '', rolePrompt = '', sessionPhase = null, autonomous = false, language = 'ko' } = {}) {
  const roleText = normalizeText(role || '').slice(0, 80);
  const roleGuidance = normalizeText(rolePrompt || '').slice(0, 80);
  const localizedPhase = localizedSessionPhase(language, sessionPhase || {});
  const phaseName = normalizeText(localizedPhase?.name || '').slice(0, 80);
  const phaseInstruction = normalizeText(localizedPhase?.instruction || '').slice(0, 320);
  const parts = [];
  if (roleText) parts.push(localizedPrompt(language, 'coordination.role', { value: roleText }));
  if (roleGuidance) parts.push(localizedPrompt(language, 'coordination.guidance', { value: roleGuidance }));
  if (phaseName) parts.push(localizedPrompt(language, 'coordination.phase', { value: phaseName }));
  if (phaseInstruction) parts.push(phaseInstruction);
  if (!parts.length) return '';
  const prefix = localizedPrompt(language, autonomous ? 'coordination.autonomous' : 'coordination.interactive');
  return normalizeText(`${prefix} ${parts.join(' ')}`);
}

function appendCoordination(prompt, coordinationText, maxChars, language = 'ko') {
  const base = String(prompt || '');
  const coordination = normalizeText(coordinationText || '');
  if (!coordination) return base.slice(0, maxChars);
  const suffix = ` ${localizedPrompt(language, 'coordination.label')} ${coordination}`;
  if (base.length + suffix.length <= maxChars) return `${base}${suffix}`;
  const room = Math.max(240, maxChars - suffix.length);
  return `${base.slice(0, room)}${suffix}`.slice(0, maxChars);
}

function cleanEntries(entries = []) {
  return (entries || [])
    .map((entry) => ({
      speaker: normalizeText(entry?.speaker || 'Participant').replace(/\s+/g, ' ').trim() || 'Participant',
      text: normalizeText(entry?.text || ''),
    }))
    .filter((entry) => entry.text);
}

function cleanAutonomousEntries(entries = []) {
  return cleanEntries((entries || []).filter((entry) => {
    const speaker = normalizeText(entry?.speaker || '').toLowerCase();
    return entry?.speakerType !== 'USER' && speaker !== 'user' && speaker !== 'human';
  }));
}

function compactLength(entries = []) {
  return entries.reduce((sum, entry) => sum + entry.speaker.length + entry.text.replace(/\s+/g, ' ').length + 3, 0);
}

function fitNewestEntries(entries, maxChars, { reserve = 650, minimum = 1 } = {}) {
  const clean = cleanEntries(entries);
  const selected = [];
  let used = Math.max(0, Number(reserve) || 0);
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    const entry = clean[i];
    const lineChars = entry.speaker.length + entry.text.replace(/\s+/g, ' ').length + 3;
    if (selected.length >= minimum && used + lineChars > maxChars) break;
    if (!selected.length && lineChars + used > maxChars) {
      const room = Math.max(240, maxChars - used - entry.speaker.length - 8);
      selected.unshift({ ...entry, text: `${entry.text.slice(0, room)}…` });
      break;
    }
    selected.unshift(entry);
    used += lineChars;
  }
  return selected;
}

function buildCompactPromptWithin({ targetLabel, participants, entries, maxChars, omitted = false, coordinationText = '', language = 'ko' }) {
  const clean = cleanEntries(entries);
  let selected = fitNewestEntries(clean, maxChars, { reserve: omitted ? 920 : 700 });
  const omittedEntry = { speaker: 'Lee Relay', text: localizedPrompt(language, 'context.omittedEarlier') };
  let promptEntries = omitted && clean.length > selected.length
    ? [omittedEntry, ...selected]
    : selected;
  let prompt = appendCoordination(buildCompactRelayPrompt({ targetLabel, participants, entries: promptEntries, language }), coordinationText, maxChars, language);

  // buildCompactRelayPrompt adds a fixed instruction suffix. Tighten until the
  // complete composer text is guaranteed to fit the provider budget.
  while (prompt.length > maxChars && selected.length > 1) {
    selected = selected.slice(1);
    promptEntries = [omittedEntry, ...selected];
    prompt = appendCoordination(buildCompactRelayPrompt({ targetLabel, participants, entries: promptEntries, language }), coordinationText, maxChars, language);
  }
  if (prompt.length > maxChars && selected.length) {
    const latest = selected.at(-1);
    const over = prompt.length - maxChars;
    const trimmed = { ...latest, text: `${latest.text.slice(0, Math.max(200, latest.text.length - over - 80))}…` };
    prompt = appendCoordination(buildCompactRelayPrompt({
      targetLabel,
      participants,
      entries: [{ speaker: 'Lee Relay', text: localizedPrompt(language, 'context.omittedEarlierShort') }, trimmed],
      language,
    }), coordinationText, maxChars, language);
  }
  return prompt.slice(0, maxChars);
}

function formatEntry(entry) {
  return `${entry.speaker}:\n${entry.text}`;
}

function safeFileName(turnNumber = 0) {
  return `lee-relay-context-turn-${String(Math.max(0, Number(turnNumber) || 0)).padStart(3, '0')}.txt`;
}

function buildContextFile({ meetingTitle, targetLabel, participants, turnNumber, entries, maxChars, coordinationText = '', language = 'ko' }) {
  const clean = cleanEntries(entries);
  const latest = clean.at(-1) || { speaker: 'User', text: localizedPrompt(language, 'context.startedConversation') };
  const recent = clean.slice(Math.max(0, clean.length - 7), -1);
  const earlier = clean.slice(0, Math.max(0, clean.length - 7));
  const header = [
    localizedPrompt(language, 'context.header'),
    '',
    localizedPrompt(language, 'context.meeting', { value: normalizeText(meetingTitle || 'New AI Meeting') }),
    localizedPrompt(language, 'context.participants', { value: (participants || []).map((p) => normalizeText(p)).filter(Boolean).join(', ') }),
    localizedPrompt(language, 'context.youAre', { value: normalizeText(targetLabel || 'AI') }),
    localizedPrompt(language, 'context.turn', { value: Math.max(0, Number(turnNumber) || 0) }),
    '',
  ].join('\n');
  const recentBlock = [
    localizedPrompt(language, 'context.recent'),
    recent.length ? recent.map(formatEntry).join('\n\n') : localizedPrompt(language, 'context.noneRecent'),
    '',
    localizedPrompt(language, 'context.latest'),
    formatEntry(latest),
    '',
    localizedPrompt(language, 'context.task'),
    coordinationText ? `${localizedPrompt(language, 'context.coordination')}\n${coordinationText}` : '',
    localizedPrompt(language, 'context.taskInstruction', { instruction: languageInstruction(language), target: normalizeText(targetLabel || 'AI') }),
  ].join('\n');

  const fixedSize = header.length + recentBlock.length + 80;
  const earlierBudget = Math.max(0, maxChars - fixedSize);
  let earlierText = earlier.map(formatEntry).join('\n\n');
  let omitted = false;
  if (earlierText.length > earlierBudget) {
    omitted = true;
    // Keep the newest part of earlier history because it is most relevant,
    // while the RECENT/LATEST blocks remain intact below.
    const tail = earlierText.slice(-Math.max(0, earlierBudget - 140));
    earlierText = `${localizedPrompt(language, 'context.omittedOlder')}\n\n${tail}`;
  }
  const earlierBlock = `${localizedPrompt(language, 'context.earlier')}\n${earlierText || localizedPrompt(language, 'context.none')}\n\n`;
  return {
    name: safeFileName(turnNumber),
    mimeType: 'text/plain',
    text: `${header}${earlierBlock}${recentBlock}`,
    omittedOlderContext: omitted,
  };
}

function buildAutonomousCompactPromptWithin({ targetLabel, participants, topicText, entries, maxChars, omitted = false, coordinationText = '', language = 'ko' }) {
  const clean = cleanAutonomousEntries(entries);
  let selected = fitNewestEntries(clean, maxChars, { reserve: omitted ? 920 : 700 });
  const omittedEntry = { speaker: 'Discussion', text: localizedPrompt(language, 'context.omittedEarlier') };
  let promptEntries = omitted && clean.length > selected.length
    ? [omittedEntry, ...selected]
    : selected;
  let prompt = appendCoordination(buildAutonomousCompactPrompt({ targetLabel, participants, topicText, entries: promptEntries, language }), coordinationText, maxChars, language);

  while (prompt.length > maxChars && selected.length > 1) {
    selected = selected.slice(1);
    promptEntries = [omittedEntry, ...selected];
    prompt = appendCoordination(buildAutonomousCompactPrompt({ targetLabel, participants, topicText, entries: promptEntries, language }), coordinationText, maxChars, language);
  }
  if (prompt.length > maxChars && selected.length) {
    const latest = selected.at(-1);
    const over = prompt.length - maxChars;
    const trimmed = { ...latest, text: `${latest.text.slice(0, Math.max(200, latest.text.length - over - 80))}...` };
    prompt = appendCoordination(buildAutonomousCompactPrompt({
      targetLabel,
      participants,
      topicText,
      entries: [{ speaker: 'Discussion', text: localizedPrompt(language, 'context.omittedEarlierShort') }, trimmed],
      language,
    }), coordinationText, maxChars, language);
  }
  return prompt.slice(0, maxChars);
}

function buildAutonomousContextFile({ targetLabel, participants, topicText, turnNumber, entries, maxChars, coordinationText = '', language = 'ko' }) {
  const clean = cleanAutonomousEntries(entries);
  const latest = clean.at(-1) || { speaker: 'Discussion', text: localizedPrompt(language, 'context.startedDiscussion') };
  const recent = clean.slice(Math.max(0, clean.length - 7), -1);
  const earlier = clean.slice(0, Math.max(0, clean.length - 7));
  const header = [
    localizedPrompt(language, 'context.autonomousHeader'),
    '',
    localizedPrompt(language, 'context.topic', { value: normalizeText(topicText || localizedPrompt(language, 'context.selectedTopic')) }),
    localizedPrompt(language, 'context.participants', { value: (participants || []).map((p) => normalizeText(p)).filter(Boolean).join(', ') }),
    localizedPrompt(language, 'context.youAre', { value: normalizeText(targetLabel || 'AI') }),
    localizedPrompt(language, 'context.turn', { value: Math.max(0, Number(turnNumber) || 0) }),
    '',
  ].join('\n');
  const recentBlock = [
    localizedPrompt(language, 'context.recentAi'),
    recent.length ? recent.map(formatEntry).join('\n\n') : localizedPrompt(language, 'context.noneAiRecent'),
    '',
    localizedPrompt(language, 'context.latestAi'),
    formatEntry(latest),
    '',
    localizedPrompt(language, 'context.task'),
    coordinationText ? `${localizedPrompt(language, 'context.coordination')}\n${coordinationText}` : '',
    localizedPrompt(language, 'context.autoTaskInstruction', { instruction: languageInstruction(language), target: normalizeText(targetLabel || 'AI') }),
  ].join('\n');

  const fixedSize = header.length + recentBlock.length + 80;
  const earlierBudget = Math.max(0, maxChars - fixedSize);
  let earlierText = earlier.map(formatEntry).join('\n\n');
  let omitted = false;
  if (earlierText.length > earlierBudget) {
    omitted = true;
    const tail = earlierText.slice(-Math.max(0, earlierBudget - 140));
    earlierText = `${localizedPrompt(language, 'context.omittedOlderAi')}\n\n${tail}`;
  }
  const earlierBlock = `${localizedPrompt(language, 'context.earlierAi')}\n${earlierText || localizedPrompt(language, 'context.none')}\n\n`;
  return {
    name: safeFileName(turnNumber).replace('lee-relay-context', 'autonomous-ai-context'),
    mimeType: 'text/plain',
    text: `${header}${earlierBlock}${recentBlock}`,
    omittedOlderContext: omitted,
  };
}

export function buildFallbackInlinePrompt({ provider, targetLabel, participants, entries, role = '', rolePrompt = '', sessionPhase = null, language = 'ko' } = {}) {
  const limits = limitsFor(provider);
  const coordinationText = buildCoordinationText({ role, rolePrompt, sessionPhase, language });
  return buildCompactPromptWithin({
    targetLabel,
    participants,
    entries,
    maxChars: limits.fallbackMaxChars,
    omitted: true,
    coordinationText,
    language,
  });
}

export function buildAutonomousFallbackInlinePrompt({ provider, targetLabel, participants, topicText, entries, role = '', rolePrompt = '', sessionPhase = null, language = 'ko' } = {}) {
  const limits = limitsFor(provider);
  const coordinationText = buildCoordinationText({ role, rolePrompt, sessionPhase, autonomous: true, language });
  return buildAutonomousCompactPromptWithin({
    targetLabel,
    participants,
    topicText,
    entries,
    maxChars: limits.fallbackMaxChars,
    omitted: true,
    coordinationText,
    language,
  });
}

export function buildAdaptiveContextPlan({
  provider,
  meetingTitle = 'New AI Meeting',
  targetLabel = 'AI',
  participants = [],
  turnNumber = 0,
  entries = [],
  role = '',
  rolePrompt = '',
  sessionPhase = null,
  language = 'ko',
} = {}) {
  const limits = limitsFor(provider);
  const clean = cleanEntries(entries);
  const coordinationText = buildCoordinationText({ role, rolePrompt, sessionPhase, language });
  // Keep the complete prompt for mode selection. Truncating it here would make
  // the file-mode branch unreachable because the length check would always see
  // the already-capped string.
  const fullPrompt = appendCoordination(buildCompactRelayPrompt({ targetLabel, participants, entries: clean, language }), coordinationText, Infinity, language);

  if (fullPrompt.length <= limits.inlineMaxChars) {
    return {
      mode: 'inline',
      promptText: fullPrompt,
      contextFile: null,
      fullContextChars: compactLength(clean),
      omittedEntries: 0,
    };
  }

  if (fullPrompt.length <= limits.fileSwitchChars) {
    const compactPrompt = buildCompactPromptWithin({
      targetLabel,
      participants,
      entries: clean,
      maxChars: limits.compactMaxChars,
      omitted: true,
      coordinationText,
      language,
    });
    return {
      mode: 'compact',
      promptText: compactPrompt,
      contextFile: null,
      fullContextChars: compactLength(clean),
      omittedEntries: Math.max(0, clean.length - fitNewestEntries(clean, limits.compactMaxChars, { reserve: 920 }).length),
    };
  }

  const contextFile = buildContextFile({
    meetingTitle,
    targetLabel,
    participants,
    turnNumber,
    entries: clean,
    maxChars: limits.maxFileChars,
    coordinationText,
    language,
  });
  const latest = clean.at(-1);
  const latestSnippet = latest
    ? `${latest.speaker}: ${latest.text.replace(/\s+/g, ' ').slice(0, 1200)}`
    : localizedPrompt(language, 'context.startedConversation');
  const otherParticipants = (participants || []).filter((p) => normalizeText(p).toLowerCase() !== normalizeText(targetLabel).toLowerCase()).join(', ') || localizedPrompt(language, 'context.otherParticipants');
  const promptText = appendCoordination(normalizeText(
    localizedPrompt(language, 'context.filePrompt', {
      target: normalizeText(targetLabel || 'AI'),
      others: otherParticipants,
      file: contextFile.name,
      latest: latestSnippet,
      instruction: languageInstruction(language),
    })
  ).replace(/\s+/g, ' ').trim(), coordinationText, limits.inlineMaxChars, language);

  return {
    mode: 'file',
    promptText,
    contextFile,
    fullContextChars: compactLength(clean),
    omittedEntries: 0,
  };
}

export function buildAutonomousContextPlan({
  provider,
  targetLabel = 'AI',
  participants = [],
  topicText = '',
  turnNumber = 0,
  entries = [],
  role = '',
  rolePrompt = '',
  sessionPhase = null,
  language = 'ko',
} = {}) {
  const limits = limitsFor(provider);
  const clean = cleanAutonomousEntries(entries);
  const coordinationText = buildCoordinationText({ role, rolePrompt, sessionPhase, autonomous: true, language });
  // Keep the complete prompt for mode selection. Truncating it here would make
  // the file-mode branch unreachable because the length check would always see
  // the already-capped string.
  const fullPrompt = appendCoordination(buildAutonomousCompactPrompt({ targetLabel, participants, topicText, entries: clean, language }), coordinationText, Infinity, language);

  if (fullPrompt.length <= limits.inlineMaxChars) {
    return {
      mode: 'inline',
      promptText: fullPrompt,
      contextFile: null,
      fullContextChars: compactLength(clean),
      omittedEntries: 0,
    };
  }

  if (fullPrompt.length <= limits.fileSwitchChars) {
    const compactPrompt = buildAutonomousCompactPromptWithin({
      targetLabel,
      participants,
      topicText,
      entries: clean,
      maxChars: limits.compactMaxChars,
      omitted: true,
      coordinationText,
      language,
    });
    return {
      mode: 'compact',
      promptText: compactPrompt,
      contextFile: null,
      fullContextChars: compactLength(clean),
      omittedEntries: Math.max(0, clean.length - fitNewestEntries(clean, limits.compactMaxChars, { reserve: 920 }).length),
    };
  }

  const contextFile = buildAutonomousContextFile({
    targetLabel,
    participants,
    topicText,
    turnNumber,
    entries: clean,
    maxChars: limits.maxFileChars,
    coordinationText,
    language,
  });
  const latest = clean.at(-1);
  const latestSnippet = latest
    ? `${latest.speaker}: ${latest.text.replace(/\s+/g, ' ').slice(0, 1200)}`
    : localizedPrompt(language, 'context.startedDiscussion');
  const promptText = appendCoordination(normalizeText(
    localizedPrompt(language, 'context.autoFilePrompt', {
      target: normalizeText(targetLabel || 'AI'),
      topic: normalizeText(topicText || localizedPrompt(language, 'context.selectedTopic')),
      file: contextFile.name,
      latest: latestSnippet,
      instruction: languageInstruction(language),
    })
  ).replace(/\s+/g, ' ').trim(), coordinationText, limits.inlineMaxChars, language);

  return {
    mode: 'file',
    promptText,
    contextFile,
    fullContextChars: compactLength(clean),
    omittedEntries: 0,
  };
}
