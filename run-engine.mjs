import { normalizePlaybook } from './playbook-engine.mjs';

export const DEFAULT_RUN_BUDGET = Object.freeze({
  maxDurationMs: 0,
  maxTurns: 20,
  maxHops: 20,
});

const MAX_EVENTS = 250;
const MAX_HANDOFFS = 100;

function clean(value, fallback = '', max = 300) {
  const result = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return result || fallback;
}

function count(value, fallback = 0, max = 1000000) {
  if (value === '' || value == null) return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? Math.min(max, Math.max(0, Math.floor(result))) : fallback;
}

function time(value, fallback = null) {
  if (value == null) return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix = 'run') {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function phaseFor(playbook, index) {
  const phases = playbook.phases || [];
  return phases[Math.min(Math.max(0, index), Math.max(0, phases.length - 1))] || { id: 'discussion', name: 'Discussion', instruction: '' };
}

export function normalizeRun(run = {}) {
  const source = run && typeof run === 'object' ? run : {};
  const playbook = normalizePlaybook(source.playbook || { id: source.playbookId || 'freeform' });
  const phaseIndex = Math.min(count(source.phaseIndex, 0, Math.max(0, playbook.phases.length - 1)), Math.max(0, playbook.phases.length - 1));
  const status = ['RUNNING', 'PAUSED', 'FINISHED'].includes(source.status) ? source.status : 'RUNNING';
  return {
    id: clean(source.id, uid('run'), 120),
    roomId: clean(source.roomId, 'room', 120),
    playbookId: playbook.id,
    playbook,
    status,
    startedAt: time(source.startedAt, Date.now()),
    endedAt: time(source.endedAt),
    phaseIndex,
    phaseId: phaseFor(playbook, phaseIndex).id,
    phaseTurnCount: count(source.phaseTurnCount),
    turnCount: count(source.turnCount),
    hopCount: count(source.hopCount),
    budget: {
      maxDurationMs: count(source.budget?.maxDurationMs, DEFAULT_RUN_BUDGET.maxDurationMs, 86400000 * 30),
      maxTurns: count(source.budget?.maxTurns, DEFAULT_RUN_BUDGET.maxTurns, 1000000),
      maxHops: count(source.budget?.maxHops, DEFAULT_RUN_BUDGET.maxHops, 1000000),
    },
    events: Array.isArray(source.events) ? clone(source.events).slice(-MAX_EVENTS) : [],
    handoffs: Array.isArray(source.handoffs) ? clone(source.handoffs).slice(-MAX_HANDOFFS) : [],
    stopReason: clean(source.stopReason, '', 240),
    artifact: source.artifact == null ? null : clone(source.artifact),
  };
}

export function createRun({ roomId = '', playbook = null, playbookId = 'freeform', budget = {}, now = Date.now() } = {}) {
  const normalizedPlaybook = normalizePlaybook(playbook || { id: playbookId });
  return normalizeRun({
    id: uid('run'), roomId, playbookId: normalizedPlaybook.id, playbook: normalizedPlaybook,
    status: 'RUNNING', startedAt: now, budget: { ...DEFAULT_RUN_BUDGET, ...budget },
  });
}

export function recordRunEvent(run, event = {}, now = Date.now()) {
  const current = normalizeRun(run);
  const nextEvent = {
    id: clean(event.id, uid('event'), 120),
    at: time(event.at, now),
    type: clean(event.type, 'activity', 80),
    participantId: clean(event.participantId, '', 120) || null,
    message: clean(event.message, '', 500),
    data: event.data == null ? null : clone(event.data),
  };
  return { ...current, events: [...current.events, nextEvent].slice(-MAX_EVENTS) };
}

export function recordRunHandoff(run, handoff = {}, now = Date.now()) {
  const current = normalizeRun(run);
  const next = {
    id: clean(handoff.id, uid('handoff'), 120),
    at: time(handoff.at, now),
    fromParticipantId: clean(handoff.fromParticipantId, '', 120) || null,
    toParticipantId: clean(handoff.toParticipantId, '', 120) || null,
    reason: clean(handoff.reason, '', 240),
  };
  return {
    ...recordRunEvent(current, { type: 'handoff', participantId: next.toParticipantId, message: next.reason, data: next }, now),
    handoffs: [...current.handoffs, next].slice(-MAX_HANDOFFS),
    hopCount: current.hopCount + 1,
  };
}

export function advanceRunPhase(run, now = Date.now()) {
  const current = normalizeRun(run);
  if (current.phaseIndex >= current.playbook.phases.length - 1) {
    return { ...current, status: 'FINISHED', endedAt: time(now, Date.now()), stopReason: 'playbook-complete' };
  }
  const phaseIndex = current.phaseIndex + 1;
  return { ...current, phaseIndex, phaseId: phaseFor(current.playbook, phaseIndex).id, phaseTurnCount: 0 };
}

export function recordRunTurn(run, turn = {}, now = Date.now()) {
  const current = normalizeRun(run);
  if (current.status !== 'RUNNING') return current;
  const phase = phaseFor(current.playbook, current.phaseIndex);
  let next = recordRunEvent(current, {
    type: 'turn', participantId: turn.participantId, message: clean(turn.text, '', 500),
    data: { turnNumber: current.turnCount + 1, phaseId: current.phaseId },
  }, now);
  next = { ...next, turnCount: current.turnCount + 1, phaseTurnCount: current.phaseTurnCount + 1 };
  if (phase.turnLimit > 0 && next.phaseTurnCount >= phase.turnLimit) next = advanceRunPhase(next, now);
  return next;
}

export function runBudgetDecision(run, now = Date.now()) {
  const current = normalizeRun(run);
  if (current.status !== 'RUNNING') return { blocked: false, reason: '', state: current };
  if (current.budget.maxDurationMs > 0 && now - current.startedAt >= current.budget.maxDurationMs) {
    return { blocked: true, reason: `Run Budget time limit stopped the run after ${current.budget.maxDurationMs} ms.`, state: { ...current, stopReason: 'max-duration' } };
  }
  if (current.budget.maxTurns > 0 && current.turnCount >= current.budget.maxTurns) {
    return { blocked: true, reason: `Run Budget stopped after ${current.turnCount} AI turns.`, state: { ...current, stopReason: 'max-turns' } };
  }
  if (current.budget.maxHops > 0 && current.hopCount >= current.budget.maxHops) {
    return { blocked: true, reason: `Run Budget stopped after ${current.hopCount} AI handoffs.`, state: { ...current, stopReason: 'max-hops' } };
  }
  return { blocked: false, reason: '', state: current };
}

export function finishRun(run, reason = 'completed', now = Date.now(), artifact = null) {
  const current = normalizeRun(run);
  return { ...current, status: 'FINISHED', endedAt: time(now, Date.now()), stopReason: clean(reason, 'completed', 240), artifact: artifact == null ? current.artifact : clone(artifact) };
}

export function pauseRun(run, reason = 'paused', now = Date.now()) {
  const current = normalizeRun(run);
  return { ...current, status: 'PAUSED', endedAt: time(now, Date.now()), stopReason: clean(reason, 'paused', 240) };
}
