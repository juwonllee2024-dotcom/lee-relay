import { normalizePlaybook } from './playbook-engine.mjs';
import { normalizeRun } from './run-engine.mjs';

function clean(value, fallback = '', max = 800) {
  const result = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return result || fallback;
}

function score(value) {
  if (value == null || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? Math.min(5, Math.max(0, Math.round(result))) : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function list(value, max = 50) {
  return Array.isArray(value) ? value.map((item) => clean(item, '', 500)).filter(Boolean).slice(0, max) : [];
}

export function buildRunArtifact({ title = '', meeting = {}, run = {}, playbook = null, now = Date.now() } = {}) {
  const normalizedRun = normalizeRun(run);
  const normalizedPlaybook = normalizePlaybook(playbook || normalizedRun.playbook);
  const turnEvents = normalizedRun.events.filter((event) => event.type === 'turn');
  const phaseResults = normalizedPlaybook.phases.map((phase) => ({
    phaseId: phase.id,
    name: phase.name,
    instruction: phase.instruction,
    turns: turnEvents
      .filter((event) => event.data?.phaseId === phase.id)
      .map((event) => ({
        at: event.at,
        participantId: event.participantId,
        speaker: clean(event.data?.speaker, event.participantId || 'AI', 120),
        text: clean(event.message, '', 1200),
      })),
  }));
  const axes = normalizedPlaybook.output.scorecard
    ? (normalizedPlaybook.output.scorecardAxes || normalizedPlaybook.phases.map((phase) => phase.name)).slice(0, 9)
    : [];
  const scorecard = axes.map((axis) => {
    const events = turnEvents.filter((event) => event.data?.axis === axis || event.data?.phaseName === axis);
    const firstScore = events.map((event) => score(event.data?.score)).find((value) => value != null) ?? null;
    return {
      axis,
      score: firstScore,
      evidence: events.map((event) => clean(event.message, '', 400)).filter(Boolean).slice(0, 5),
    };
  });
  const transcript = Array.isArray(meeting.transcript) ? meeting.transcript : [];
  const lastAi = [...transcript].reverse().find((entry) => entry.speakerType === 'AI' && clean(entry.text));
  const summary = clean(run.summary || meeting.summary, `Run completed with ${normalizedRun.turnCount} AI turn${normalizedRun.turnCount === 1 ? '' : 's'}${lastAi ? `. Latest result: ${lastAi.text}` : '.'}`, 1600);
  return {
    formatVersion: 1,
    title: clean(title || meeting.title, 'Lee Relay Run', 160),
    runId: normalizedRun.id,
    roomId: normalizedRun.roomId,
    playbookId: normalizedPlaybook.id,
    status: normalizedRun.status,
    startedAt: normalizedRun.startedAt,
    endedAt: normalizedRun.endedAt,
    generatedAt: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
    summary,
    phaseResults,
    scorecard,
    decisions: list(run.decisions),
    actionItems: list(run.actionItems),
    stopReason: clean(normalizedRun.stopReason, '', 240),
    handoffCount: normalizedRun.hopCount,
  };
}

export function portableRunArtifact(artifact = {}) {
  return clone(buildRunArtifact({ run: artifact, playbook: artifact.playbook, title: artifact.title, now: artifact.generatedAt }));
}
