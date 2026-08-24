import { buildAutonomousCompactPrompt, buildCompactRelayPrompt, normalizeText } from './relay-core.mjs';
import { buildSelectedFilesBlock, normalizeSelectedContextFiles, selectedContextFileMetadata } from './file-context.mjs';

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

function buildCoordinationText({ role = '', rolePrompt = '', sessionPhase = null, autonomous = false } = {}) {
  const roleText = normalizeText(role || '').slice(0, 80);
  const roleGuidance = normalizeText(rolePrompt || '').slice(0, 80);
  const phaseName = normalizeText(sessionPhase?.name || '').slice(0, 80);
  const phaseInstruction = normalizeText(sessionPhase?.instruction || '').slice(0, 320);
  const parts = [];
  if (roleText) parts.push(`Role: ${roleText}.`);
  if (roleGuidance) parts.push(`Role guidance: ${roleGuidance}.`);
  if (phaseName) parts.push(`Current session phase: ${phaseName}.`);
  if (phaseInstruction) parts.push(phaseInstruction);
  if (!parts.length) return '';
  const prefix = autonomous ? 'You are an AI peer following this coordination context.' : 'Follow this participant coordination context.';
  return normalizeText(`${prefix} ${parts.join(' ')}`);
}

function appendCoordination(prompt, coordinationText, maxChars) {
  const base = String(prompt || '');
  const coordination = normalizeText(coordinationText || '');
  if (!coordination) return base.slice(0, maxChars);
  const suffix = ` Coordination: ${coordination}`;
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

function buildCompactPromptWithin({ targetLabel, participants, entries, maxChars, omitted = false, coordinationText = '' }) {
  const clean = cleanEntries(entries);
  let selected = fitNewestEntries(clean, maxChars, { reserve: omitted ? 920 : 700 });
  let promptEntries = omitted && clean.length > selected.length
    ? [{ speaker: 'Lee Relay', text: 'Earlier discussion omitted to fit this provider safely; prioritize the newest turns below.' }, ...selected]
    : selected;
  let prompt = appendCoordination(buildCompactRelayPrompt({ targetLabel, participants, entries: promptEntries }), coordinationText, maxChars);

  // buildCompactRelayPrompt adds a fixed instruction suffix. Tighten until the
  // complete composer text is guaranteed to fit the provider budget.
  while (prompt.length > maxChars && selected.length > 1) {
    selected = selected.slice(1);
    promptEntries = [{ speaker: 'Lee Relay', text: 'Earlier discussion omitted to fit this provider safely; prioritize the newest turns below.' }, ...selected];
    prompt = appendCoordination(buildCompactRelayPrompt({ targetLabel, participants, entries: promptEntries }), coordinationText, maxChars);
  }
  if (prompt.length > maxChars && selected.length) {
    const latest = selected.at(-1);
    const over = prompt.length - maxChars;
    const trimmed = { ...latest, text: `${latest.text.slice(0, Math.max(200, latest.text.length - over - 80))}…` };
    prompt = appendCoordination(buildCompactRelayPrompt({
      targetLabel,
      participants,
      entries: [{ speaker: 'Lee Relay', text: 'Earlier discussion omitted to fit this provider safely.' }, trimmed],
    }), coordinationText, maxChars);
  }
  return prompt.slice(0, maxChars);
}

function formatEntry(entry) {
  return `${entry.speaker}:\n${entry.text}`;
}

function safeFileName(turnNumber = 0) {
  return `lee-relay-context-turn-${String(Math.max(0, Number(turnNumber) || 0)).padStart(3, '0')}.txt`;
}

function buildContextFile({ meetingTitle, targetLabel, participants, turnNumber, entries, maxChars, coordinationText = '', selectedFiles = [] }) {
  const clean = cleanEntries(entries);
  const selected = normalizeSelectedContextFiles(selectedFiles);
  const latest = clean.at(-1) || { speaker: 'User', text: 'The conversation has just started.' };
  const recent = clean.slice(Math.max(0, clean.length - 7), -1);
  const earlier = clean.slice(0, Math.max(0, clean.length - 7));
  const header = [
    'LEE RELAY — MEETING CONTEXT',
    '',
    `Meeting: ${normalizeText(meetingTitle || 'New AI Meeting')}`,
    `Participants: ${(participants || []).map((p) => normalizeText(p)).filter(Boolean).join(', ')}`,
    `You are: ${normalizeText(targetLabel || 'AI')}`,
    `Turn: ${Math.max(0, Number(turnNumber) || 0)}`,
    '',
  ].join('\n');
  const recentBlock = [
    '[RECENT CONVERSATION]',
    recent.length ? recent.map(formatEntry).join('\n\n') : '(No additional recent turns.)',
    '',
    '[LATEST TURN]',
    formatEntry(latest),
    '',
    '[YOUR TASK]',
    coordinationText ? `[COORDINATION]\n${coordinationText}` : '',
    `Continue the conversation naturally as ${normalizeText(targetLabel || 'AI')}. Respond to the latest turn using the context above. Do not repeat or summarize this file unless asked. If you want a specific participant to answer next, address them by name.`,
  ].join('\n');

  const selectedBudget = selected.length
    ? Math.max(800, maxChars - header.length - recentBlock.length - 1200)
    : 0;
  const selectedBlock = selected.length
    ? buildSelectedFilesBlock(selected, { maxChars: selectedBudget })
    : '';
  const selectedSection = selectedBlock ? `${selectedBlock}\n\n` : '';
  const fixedSize = header.length + recentBlock.length + selectedSection.length + 80;
  const earlierBudget = Math.max(0, maxChars - fixedSize);
  let earlierText = earlier.map(formatEntry).join('\n\n');
  let omitted = false;
  if (earlierText.length > earlierBudget) {
    omitted = true;
    // Keep the newest part of earlier history because it is most relevant,
    // while the RECENT/LATEST blocks remain intact below.
    const tail = earlierText.slice(-Math.max(0, earlierBudget - 140));
    earlierText = `[... older context omitted to keep the attachment bounded ...]\n\n${tail}`;
  }
  const earlierBlock = `[EARLIER CONTEXT]\n${earlierText || '(None)'}\n\n`;
  return {
    name: safeFileName(turnNumber),
    mimeType: 'text/plain',
    text: `${header}${selectedSection}${earlierBlock}${recentBlock}`,
    omittedOlderContext: omitted,
    selectedFileCount: selected.length,
  };
}

function buildAutonomousCompactPromptWithin({ targetLabel, participants, topicText, entries, maxChars, omitted = false, coordinationText = '' }) {
  const clean = cleanAutonomousEntries(entries);
  let selected = fitNewestEntries(clean, maxChars, { reserve: omitted ? 920 : 700 });
  let promptEntries = omitted && clean.length > selected.length
    ? [{ speaker: 'Discussion', text: 'Earlier AI discussion omitted to fit this provider safely; prioritize the newest turns below.' }, ...selected]
    : selected;
  let prompt = appendCoordination(buildAutonomousCompactPrompt({ targetLabel, participants, topicText, entries: promptEntries }), coordinationText, maxChars);

  while (prompt.length > maxChars && selected.length > 1) {
    selected = selected.slice(1);
    promptEntries = [{ speaker: 'Discussion', text: 'Earlier AI discussion omitted to fit this provider safely; prioritize the newest turns below.' }, ...selected];
    prompt = appendCoordination(buildAutonomousCompactPrompt({ targetLabel, participants, topicText, entries: promptEntries }), coordinationText, maxChars);
  }
  if (prompt.length > maxChars && selected.length) {
    const latest = selected.at(-1);
    const over = prompt.length - maxChars;
    const trimmed = { ...latest, text: `${latest.text.slice(0, Math.max(200, latest.text.length - over - 80))}...` };
    prompt = appendCoordination(buildAutonomousCompactPrompt({
      targetLabel,
      participants,
      topicText,
      entries: [{ speaker: 'Discussion', text: 'Earlier AI discussion omitted to fit this provider safely.' }, trimmed],
    }), coordinationText, maxChars);
  }
  return prompt.slice(0, maxChars);
}

function buildAutonomousContextFile({ targetLabel, participants, topicText, turnNumber, entries, maxChars, coordinationText = '', selectedFiles = [] }) {
  const clean = cleanAutonomousEntries(entries);
  const selected = normalizeSelectedContextFiles(selectedFiles);
  const latest = clean.at(-1) || { speaker: 'Discussion', text: 'The discussion has just started.' };
  const recent = clean.slice(Math.max(0, clean.length - 7), -1);
  const earlier = clean.slice(0, Math.max(0, clean.length - 7));
  const header = [
    'AUTONOMOUS AI DISCUSSION',
    '',
    `Topic: ${normalizeText(topicText || 'The selected topic')}`,
    `Participants: ${(participants || []).map((p) => normalizeText(p)).filter(Boolean).join(', ')}`,
    `You are: ${normalizeText(targetLabel || 'AI')}`,
    `Turn: ${Math.max(0, Number(turnNumber) || 0)}`,
    '',
  ].join('\n');
  const recentBlock = [
    '[RECENT AI DISCUSSION]',
    recent.length ? recent.map(formatEntry).join('\n\n') : '(No additional AI turns.)',
    '',
    '[LATEST AI TURN]',
    formatEntry(latest),
    '',
    '[YOUR TASK]',
    coordinationText ? `[COORDINATION]\n${coordinationText}` : '',
    `Continue the discussion naturally as ${normalizeText(targetLabel || 'AI')}. Respond to the latest AI turn using the context above. Do not repeat or summarize this file unless asked. If you want a specific participant to answer next, address them by name.`,
  ].join('\n');

  const selectedBudget = selected.length
    ? Math.max(800, maxChars - header.length - recentBlock.length - 1200)
    : 0;
  const selectedBlock = selected.length
    ? buildSelectedFilesBlock(selected, { maxChars: selectedBudget })
    : '';
  const selectedSection = selectedBlock ? `${selectedBlock}\n\n` : '';
  const fixedSize = header.length + recentBlock.length + selectedSection.length + 80;
  const earlierBudget = Math.max(0, maxChars - fixedSize);
  let earlierText = earlier.map(formatEntry).join('\n\n');
  let omitted = false;
  if (earlierText.length > earlierBudget) {
    omitted = true;
    const tail = earlierText.slice(-Math.max(0, earlierBudget - 140));
    earlierText = `[... older AI context omitted to keep the attachment bounded ...]\n\n${tail}`;
  }
  const earlierBlock = `[EARLIER AI CONTEXT]\n${earlierText || '(None)'}\n\n`;
  return {
    name: safeFileName(turnNumber).replace('lee-relay-context', 'autonomous-ai-context'),
    mimeType: 'text/plain',
    text: `${header}${selectedSection}${earlierBlock}${recentBlock}`,
    omittedOlderContext: omitted,
    selectedFileCount: selected.length,
  };
}

export function buildFallbackInlinePrompt({ provider, targetLabel, participants, entries, role = '', rolePrompt = '', sessionPhase = null, selectedFiles = [] } = {}) {
  const limits = limitsFor(provider);
  const selected = normalizeSelectedContextFiles(selectedFiles);
  const coordinationText = buildCoordinationText({ role, rolePrompt, sessionPhase });
  const fileBlock = selected.length
    ? buildSelectedFilesBlock(selected, { maxChars: Math.min(2400, Math.floor(limits.fallbackMaxChars * 0.35)) })
    : '';
  const prompt = buildCompactPromptWithin({
    targetLabel,
    participants,
    entries,
    maxChars: Math.max(240, limits.fallbackMaxChars - fileBlock.length - (fileBlock ? 120 : 0)),
    omitted: true,
    coordinationText,
  });
  return `${prompt}${fileBlock ? `\n\n${fileBlock}` : ''}`.slice(0, limits.fallbackMaxChars);
}

export function buildAutonomousFallbackInlinePrompt({ provider, targetLabel, participants, topicText, entries, role = '', rolePrompt = '', sessionPhase = null, selectedFiles = [] } = {}) {
  const limits = limitsFor(provider);
  const selected = normalizeSelectedContextFiles(selectedFiles);
  const coordinationText = buildCoordinationText({ role, rolePrompt, sessionPhase, autonomous: true });
  const fileBlock = selected.length
    ? buildSelectedFilesBlock(selected, { maxChars: Math.min(2400, Math.floor(limits.fallbackMaxChars * 0.35)) })
    : '';
  const prompt = buildAutonomousCompactPromptWithin({
    targetLabel,
    participants,
    topicText,
    entries,
    maxChars: Math.max(240, limits.fallbackMaxChars - fileBlock.length - (fileBlock ? 120 : 0)),
    omitted: true,
    coordinationText,
  });
  return `${prompt}${fileBlock ? `\n\n${fileBlock}` : ''}`.slice(0, limits.fallbackMaxChars);
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
  selectedFiles = [],
} = {}) {
  const limits = limitsFor(provider);
  const clean = cleanEntries(entries);
  const selected = normalizeSelectedContextFiles(selectedFiles);
  const coordinationText = buildCoordinationText({ role, rolePrompt, sessionPhase });
  const fullPrompt = appendCoordination(buildCompactRelayPrompt({ targetLabel, participants, entries: clean }), coordinationText, limits.fileSwitchChars);

  if (selected.length) {
    const contextFile = buildContextFile({
      meetingTitle,
      targetLabel,
      participants,
      turnNumber,
      entries: clean,
      maxChars: limits.maxFileChars,
      coordinationText,
      selectedFiles: selected,
    });
    const otherParticipants = (participants || []).filter((p) => normalizeText(p).toLowerCase() !== normalizeText(targetLabel).toLowerCase()).join(', ') || 'the other participants';
    const promptText = appendCoordination(normalizeText(
      `You are ${targetLabel} in a live Lee Relay conversation with ${otherParticipants}. The full meeting context and selected local files are attached as ${contextFile.name}. Read [SELECTED LOCAL FILES], especially the file contents, then reply naturally to the latest message. Do not repeat the attachment or these instructions. If you want a specific participant to answer next, address them by name.`
    ).replace(/\s+/g, ' ').trim(), coordinationText, limits.inlineMaxChars);
    return {
      mode: 'file',
      promptText,
      contextFile,
      selectedFiles: selectedContextFileMetadata(selected),
      fullContextChars: compactLength(clean) + selected.reduce((sum, file) => sum + file.text.length, 0),
      omittedEntries: 0,
      selectedFileCount: selected.length,
    };
  }

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
  });
  const latest = clean.at(-1);
  const latestSnippet = latest
    ? `${latest.speaker}: ${latest.text.replace(/\s+/g, ' ').slice(0, 1200)}`
    : 'The conversation has just started.';
  const otherParticipants = (participants || []).filter((p) => normalizeText(p).toLowerCase() !== normalizeText(targetLabel).toLowerCase()).join(', ') || 'the other participants';
  const promptText = appendCoordination(normalizeText(
    `You are ${targetLabel} in a live Lee Relay conversation with ${otherParticipants}. The full meeting context is attached as ${contextFile.name}. Read the attachment, especially [RECENT CONVERSATION] and [LATEST TURN], then reply naturally to the latest message. Latest turn preview: ${latestSnippet}. Do not repeat the attachment or these instructions. If you want a specific participant to answer next, address them by name.`
  ).replace(/\s+/g, ' ').trim(), coordinationText, limits.inlineMaxChars);

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
  selectedFiles = [],
} = {}) {
  const limits = limitsFor(provider);
  const clean = cleanAutonomousEntries(entries);
  const selected = normalizeSelectedContextFiles(selectedFiles);
  const coordinationText = buildCoordinationText({ role, rolePrompt, sessionPhase, autonomous: true });
  const fullPrompt = appendCoordination(buildAutonomousCompactPrompt({ targetLabel, participants, topicText, entries: clean }), coordinationText, limits.fileSwitchChars);

  if (selected.length) {
    const contextFile = buildAutonomousContextFile({
      targetLabel,
      participants,
      topicText,
      turnNumber,
      entries: clean,
      maxChars: limits.maxFileChars,
      coordinationText,
      selectedFiles: selected,
    });
    const promptText = appendCoordination(normalizeText(
      `You are ${targetLabel}, one AI participant in an ongoing peer discussion. Topic: ${topicText || 'the selected topic'}. The full discussion context and selected local files are attached as ${contextFile.name}. Read [SELECTED LOCAL FILES], especially the file contents, then reply naturally to the latest AI turn. Do not repeat the attachment or these instructions. If you want a specific participant to answer next, address them by name.`
    ).replace(/\s+/g, ' ').trim(), coordinationText, limits.inlineMaxChars);
    return {
      mode: 'file',
      promptText,
      contextFile,
      selectedFiles: selectedContextFileMetadata(selected),
      fullContextChars: compactLength(clean) + selected.reduce((sum, file) => sum + file.text.length, 0),
      omittedEntries: 0,
      selectedFileCount: selected.length,
    };
  }

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
  });
  const latest = clean.at(-1);
  const latestSnippet = latest
    ? `${latest.speaker}: ${latest.text.replace(/\s+/g, ' ').slice(0, 1200)}`
    : 'The discussion has just started.';
  const promptText = appendCoordination(normalizeText(
    `You are ${targetLabel}, one AI participant in an ongoing peer discussion. Topic: ${topicText || 'the selected topic'}. The full discussion context is attached as ${contextFile.name}. Read the attachment, especially [RECENT AI DISCUSSION] and [LATEST AI TURN], then reply naturally to the latest AI turn. Latest turn preview: ${latestSnippet}. Do not repeat the attachment or these instructions. If you want a specific participant to answer next, address them by name.`
  ).replace(/\s+/g, ' ').trim(), coordinationText, limits.inlineMaxChars);

  return {
    mode: 'file',
    promptText,
    contextFile,
    fullContextChars: compactLength(clean),
    omittedEntries: 0,
  };
}
