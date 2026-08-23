const DIRECTIVE_PATTERN = /^\s*(?:next(?:\s+speaker)?\s*[:,-]?\s*)?@([^\s,:;!?()[\]{}]+)/u;
const PROVIDER_NAMES = Object.freeze({ chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot' });

function key(value = '') {
  return String(value).normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

function clean(value, max = 120) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function connected(participant) {
  return Number.isInteger(participant?.tabId) && (!participant.connectionState || participant.connectionState === 'READY');
}

function aliasesFor(participant) {
  const aliases = [participant?.label, participant?.role, PROVIDER_NAMES[participant?.provider], participant?.provider]
    .map((value) => clean(value))
    .filter(Boolean);
  return [...new Set(aliases.map(key).filter(Boolean))];
}

export function parseMentionDirective(text = '') {
  const match = String(text || '').match(DIRECTIVE_PATTERN);
  if (!match) return null;
  const alias = clean(match[1]);
  if (!alias) return null;
  const normalized = key(alias);
  return {
    alias,
    normalized,
    kind: normalized === 'all' || normalized === 'everyone' ? 'broadcast' : 'participant',
    raw: match[0],
    text: String(text || '').slice(match[0].length).trim(),
  };
}

export function resolveMentionDirective(text = '', participants = [], currentParticipantId = null) {
  const parsed = parseMentionDirective(text);
  if (!parsed) return { kind: 'none', target: null, targets: [], reason: 'No leading @AI directive.' };
  const list = Array.isArray(participants) ? participants : [];
  if (parsed.kind === 'broadcast') {
    const targets = list.filter(connected);
    return targets.length
      ? { ...parsed, target: null, targets, reason: '' }
      : { ...parsed, target: null, targets: [], reason: 'No connected participants are available for @all.' };
  }
  const allMatches = list.filter((participant) => aliasesFor(participant).includes(parsed.normalized));
  if (!allMatches.length) return { ...parsed, target: null, targets: [], reason: `Unknown AI target @${parsed.alias}.` };
  const liveMatches = allMatches.filter(connected);
  if (!liveMatches.length) return { ...parsed, target: null, targets: [], reason: `${parsed.alias} is not connected.` };
  if (liveMatches.length > 1) return { ...parsed, target: null, targets: liveMatches, reason: `@${parsed.alias} matches more than one connected participant.` };
  const target = liveMatches[0];
  if (currentParticipantId && target.id === currentParticipantId) {
    return { ...parsed, target: null, targets: [], reason: 'A participant cannot hand off to itself.' };
  }
  return { ...parsed, target, targets: [target], reason: '' };
}

export function withoutMentionDirective(text = '') {
  const parsed = parseMentionDirective(text);
  return parsed ? parsed.text : String(text || '').trim();
}
