function connectedParticipants(meeting) {
  return (meeting?.participants || []).filter((p) => Number.isInteger(p.tabId) && p.connectionState === 'READY');
}

export function nextRoundRobinParticipant(meeting, currentParticipantId = null) {
  const participants = connectedParticipants(meeting);
  if (!participants.length) return null;
  if (!currentParticipantId) return participants[0];
  const all = meeting?.participants || [];
  const currentIndex = all.findIndex((p) => p.id === currentParticipantId);
  if (currentIndex < 0) return participants[0];
  for (let offset = 1; offset <= all.length; offset += 1) {
    const candidate = all[(currentIndex + offset) % all.length];
    if (candidate && participants.some((p) => p.id === candidate.id)) return candidate;
  }
  return participants[0];
}

function regexEscape(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasesFor(participant, participants) {
  const aliases = new Set();
  if (participant?.label) aliases.add(participant.label.trim());
  if (participant?.provider) {
    const sameProvider = participants.filter((p) => p.provider === participant.provider);
    if (sameProvider.length === 1) {
      const map = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot' };
      aliases.add(map[participant.provider] || participant.provider);
    }
  }
  return [...aliases].filter(Boolean);
}

function hasStrongAddress(text, alias) {
  const e = regexEscape(alias);
  const english = [
    new RegExp(`(^|[.!?]\\s*)${e}\\s*[,,:-]\\s*(what|how|can|could|would|please|do|tell|review|answer|respond)`, 'i'),
    new RegExp(`\\b(?:ask|let|have|want|like)\\s+${e}\\b.{0,45}\\b(?:answer|respond|review|speak|go|next)\\b`, 'i'),
    new RegExp(`\\b${e}\\b.{0,35}\\b(?:should|can|could|would)\\s+(?:answer|respond|review|go|speak)\\b`, 'i'),
    new RegExp(`\\b(?:I'd like|I want)\\s+${e}\\s+to\\s+(?:answer|respond|review|go)\\s*(?:next)?`, 'i'),
  ];
  const korean = [
    new RegExp(`${e}(?:에게|한테).{0,35}(?:검토|답|대답|물어|의견|생각|말해|말씀)`,'i'),
    new RegExp(`${e}(?:은|는|이|가).{0,25}(?:어떻게 생각|답해|대답해|검토해|말해)`,'i'),
    new RegExp(`${e}(?:의 의견|가 답|가 대답|에게 물어)`,'i'),
  ];
  return [...english, ...korean].some((re) => re.test(text));
}

export function detectExplicitAddressee(text = '', participants = []) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const connected = participants.filter((p) => Number.isInteger(p.tabId) && p.connectionState === 'READY');
  const matches = [];
  for (const participant of connected) {
    const aliases = aliasesFor(participant, participants);
    if (aliases.some((alias) => hasStrongAddress(clean, alias))) matches.push(participant);
  }
  return matches.length === 1 ? matches[0] : null;
}

export function selectNextSpeaker(meeting, latestText = '', currentParticipantId = null) {
  if (!meeting) return null;
  if (meeting.routingMode === 'smart' && meeting.settings?.smartRouting !== false) {
    const explicit = detectExplicitAddressee(latestText, meeting.participants || []);
    if (explicit) return explicit;
  }
  return nextRoundRobinParticipant(meeting, currentParticipantId);
}
