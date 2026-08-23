const MAX_COORDINATION_TEXT = 80;

export const BUILTIN_ROLES = Object.freeze([
  'Facilitator',
  'Researcher',
  'Critic',
  'Strategist',
  'Summarizer',
]);

export const SESSION_TEMPLATE_IDS = Object.freeze([
  'freeform',
  'channel-9-axis',
  'debate',
  'planning',
]);

const AXES = [
  ['Concept', 'Evaluate the channel idea, promise, audience, and distinct point of view.'],
  ['Narration', 'Evaluate the narrative structure, pacing, tension, and clarity.'],
  ['Visual Rhythm', 'Evaluate visual cadence, pattern changes, framing, and attention flow.'],
  ['Message Compression', 'Evaluate how much meaning survives when the message is compressed.'],
  ['Brand Signature', 'Evaluate recognizable voice, recurring devices, and identity.'],
  ['Packaging', 'Evaluate title, thumbnail, opening promise, and the reason to click.'],
  ['Retention', 'Evaluate the first seconds, drop-off risks, payoff timing, and return reasons.'],
  ['Repeatability', 'Evaluate whether the format can produce 50 to 100 strong episodes.'],
  ['Distribution', 'Evaluate search, recommendations, Shorts, external sharing, and growth loops.'],
];

const SESSION_TEMPLATES = Object.freeze({
  freeform: {
    id: 'freeform',
    name: 'Freeform',
    description: 'Open AI discussion with no forced phase changes.',
    phases: [{ id: 'discussion', name: 'Open Discussion', instruction: 'Discuss the topic naturally and build on the latest AI turn.', turnLimit: 0 }],
  },
  'channel-9-axis': {
    id: 'channel-9-axis',
    name: '9-axis Channel Analysis',
    description: 'Analyze a channel through the nine creative and growth axes.',
    phases: AXES.map(([name, instruction], index) => ({
      id: `axis-${index + 1}`,
      name,
      instruction: `Analyze the channel through the ${name} axis. ${instruction} Give concrete evidence, risks, and one improvement to test.`,
      turnLimit: 2,
    })),
  },
  debate: {
    id: 'debate',
    name: 'Debate',
    description: 'Frame, argue, rebut, and synthesize a decision.',
    phases: [
      { id: 'framing', name: 'Framing', instruction: 'Define the decision, terms, assumptions, and success criteria before arguing.', turnLimit: 2 },
      { id: 'arguments', name: 'Arguments', instruction: 'Present the strongest evidence-backed arguments for and against the proposal.', turnLimit: 2 },
      { id: 'rebuttals', name: 'Rebuttals', instruction: 'Challenge weak assumptions and respond directly to the strongest opposing argument.', turnLimit: 2 },
      { id: 'synthesis', name: 'Synthesis', instruction: 'Synthesize the debate into a clear recommendation, trade-offs, and unresolved questions.', turnLimit: 2 },
    ],
  },
  planning: {
    id: 'planning',
    name: 'Planning',
    description: 'Turn a topic into constraints, options, a decision, and next actions.',
    phases: [
      { id: 'objective', name: 'Objective', instruction: 'Define the desired outcome and how it will be measured.', turnLimit: 2 },
      { id: 'constraints', name: 'Constraints', instruction: 'List constraints, dependencies, risks, and non-negotiable requirements.', turnLimit: 2 },
      { id: 'options', name: 'Options', instruction: 'Generate and compare practical options with explicit trade-offs.', turnLimit: 2 },
      { id: 'decision', name: 'Decision', instruction: 'Choose the strongest option and explain why alternatives were rejected.', turnLimit: 2 },
      { id: 'next-actions', name: 'Next Actions', instruction: 'Convert the decision into ordered, testable next actions with owners or checkpoints.', turnLimit: 2 },
    ],
  },
});

export const DEFAULT_LOOP_GUARD = Object.freeze({
  enabled: true,
  maxHops: 20,
  maxSameSpeaker: 3,
  maxSameRoute: 6,
  hops: 0,
  lastSpeakerId: null,
  sameSpeakerStreak: 0,
  lastRouteKey: null,
  sameRouteStreak: 0,
  lastReason: '',
});

function cleanText(value, max = MAX_COORDINATION_TEXT) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function finiteNonNegative(value, fallback = 0, max = 100000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(number)));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeParticipantCoordination(participant = {}) {
  return {
    ...participant,
    role: cleanText(participant.role),
    rolePrompt: cleanText(participant.rolePrompt),
  };
}

export function getSessionTemplates() {
  return deepClone(SESSION_TEMPLATE_IDS.map((id) => SESSION_TEMPLATES[id]));
}

function templateFor(id) {
  return SESSION_TEMPLATES[id] || SESSION_TEMPLATES.freeform;
}

export function normalizeSession(session = {}) {
  const source = session && typeof session === 'object' ? session : {};
  const template = templateFor(cleanText(source.templateId, 40));
  const lastPhaseIndex = Math.max(0, template.phases.length - 1);
  const phaseIndex = Math.min(lastPhaseIndex, finiteNonNegative(source.phaseIndex, 0, lastPhaseIndex));
  const status = ['IDLE', 'RUNNING', 'COMPLETE'].includes(source.status) ? source.status : 'IDLE';
  return {
    templateId: template.id,
    status,
    phaseIndex,
    phaseTurnCount: finiteNonNegative(source.phaseTurnCount, 0, 100000),
    startedAt: Number.isFinite(Number(source.startedAt)) ? Number(source.startedAt) : null,
    completedAt: Number.isFinite(Number(source.completedAt)) ? Number(source.completedAt) : null,
  };
}

export function currentSessionPhase(session = {}) {
  const normalized = normalizeSession(session);
  const template = templateFor(normalized.templateId);
  return deepClone(template.phases[normalized.phaseIndex] || template.phases.at(-1));
}

export function startSession(session = {}, now = Date.now()) {
  const normalized = normalizeSession(session);
  return {
    ...normalized,
    status: 'RUNNING',
    phaseIndex: 0,
    phaseTurnCount: 0,
    startedAt: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
    completedAt: null,
  };
}

export function advanceSessionPhase(session = {}, now = Date.now()) {
  const normalized = normalizeSession(session);
  const template = templateFor(normalized.templateId);
  if (normalized.phaseIndex >= template.phases.length - 1) {
    return { ...normalized, status: 'COMPLETE', completedAt: Number.isFinite(Number(now)) ? Number(now) : Date.now() };
  }
  return { ...normalized, status: 'RUNNING', phaseIndex: normalized.phaseIndex + 1, phaseTurnCount: 0 };
}

export function recordSessionTurn(session = {}, now = Date.now()) {
  const normalized = normalizeSession(session);
  if (normalized.status === 'COMPLETE') return normalized;
  const phase = currentSessionPhase(normalized);
  const next = { ...normalized, phaseTurnCount: normalized.phaseTurnCount + 1 };
  if (phase.turnLimit > 0 && next.phaseTurnCount >= phase.turnLimit) return advanceSessionPhase(next, now);
  return next;
}

export function createLoopGuardState(options = {}) {
  return normalizeLoopGuardState({ ...DEFAULT_LOOP_GUARD, ...(options || {}), hops: 0, sameSpeakerStreak: 0, sameRouteStreak: 0, lastReason: '' });
}

export function normalizeLoopGuardState(state = {}) {
  const source = state && typeof state === 'object' ? state : {};
  return {
    enabled: source.enabled !== false,
    maxHops: finiteNonNegative(source.maxHops, DEFAULT_LOOP_GUARD.maxHops, 100000),
    maxSameSpeaker: finiteNonNegative(source.maxSameSpeaker, DEFAULT_LOOP_GUARD.maxSameSpeaker, 100000),
    maxSameRoute: finiteNonNegative(source.maxSameRoute, DEFAULT_LOOP_GUARD.maxSameRoute, 100000),
    hops: finiteNonNegative(source.hops, 0, 1000000),
    lastSpeakerId: cleanText(source.lastSpeakerId, 120) || null,
    sameSpeakerStreak: finiteNonNegative(source.sameSpeakerStreak, 0, 1000000),
    lastRouteKey: cleanText(source.lastRouteKey, 240) || null,
    sameRouteStreak: finiteNonNegative(source.sameRouteStreak, 0, 1000000),
    lastReason: cleanText(source.lastReason, 240),
  };
}

export function recordLoopGuardHop(state = {}, { speakerId = '', targetId = '' } = {}) {
  const current = normalizeLoopGuardState(state);
  const speaker = cleanText(speakerId, 120) || 'unknown-speaker';
  const target = cleanText(targetId, 120) || 'unknown-target';
  const routeKey = `${speaker}->${target}`;
  return {
    ...current,
    hops: current.hops + 1,
    lastSpeakerId: target,
    sameSpeakerStreak: current.lastSpeakerId === target ? current.sameSpeakerStreak + 1 : 1,
    lastRouteKey: routeKey,
    sameRouteStreak: current.lastRouteKey === routeKey ? current.sameRouteStreak + 1 : 1,
    lastReason: '',
  };
}

export function loopGuardDecision(state = {}, settings = {}) {
  const current = normalizeLoopGuardState(state);
  const enabled = settings.enabled ?? current.enabled;
  if (!enabled) return { blocked: false, reason: '', state: current };
  const maxHops = finiteNonNegative(settings.maxHops, current.maxHops, 1000000);
  const maxSameSpeaker = finiteNonNegative(settings.maxSameSpeaker, current.maxSameSpeaker, 1000000);
  const maxSameRoute = finiteNonNegative(settings.maxSameRoute, current.maxSameRoute, 1000000);
  if (maxHops > 0 && current.hops >= maxHops) return { blocked: true, reason: `Loop Guard paused after ${current.hops} autonomous hops.`, state: { ...current, lastReason: `Maximum hops reached (${maxHops}).` } };
  if (maxSameSpeaker > 0 && current.sameSpeakerStreak >= maxSameSpeaker) return { blocked: true, reason: `Loop Guard paused after ${current.sameSpeakerStreak} consecutive turns for one participant.`, state: { ...current, lastReason: `Same speaker streak reached (${maxSameSpeaker}).` } };
  if (maxSameRoute > 0 && current.sameRouteStreak >= maxSameRoute) return { blocked: true, reason: `Loop Guard paused after ${current.sameRouteStreak} repeated speaker routes.`, state: { ...current, lastReason: `Same route streak reached (${maxSameRoute}).` } };
  return { blocked: false, reason: '', state: current };
}

export function normalizeMeetingCoordination(meeting = {}) {
  const source = meeting && typeof meeting === 'object' ? meeting : {};
  return {
    ...source,
    participants: Array.isArray(source.participants) ? source.participants.map(normalizeParticipantCoordination) : [],
    session: normalizeSession(source.session),
    loopGuard: normalizeLoopGuardState(source.loopGuard),
  };
}

export function migrateStoredMeeting(meeting = {}) {
  return normalizeMeetingCoordination(meeting);
}
