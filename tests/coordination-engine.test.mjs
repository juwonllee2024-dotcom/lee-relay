import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_ROLES,
  SESSION_TEMPLATE_IDS,
  createLoopGuardState,
  getSessionTemplates,
  normalizeLoopGuardState,
  normalizeMeetingCoordination,
  normalizeParticipantCoordination,
  normalizeSession,
  recordLoopGuardHop,
  loopGuardDecision,
  recordSessionTurn,
} from '../coordination-engine.mjs';

test('participant roles normalize built-ins and bounded custom instructions', () => {
  assert.deepEqual(BUILTIN_ROLES, ['Facilitator', 'Researcher', 'Critic', 'Strategist', 'Summarizer']);
  const normalized = normalizeParticipantCoordination({ role: '  Researcher  ', rolePrompt: `  ${'x'.repeat(120)}  ` });
  assert.equal(normalized.role, 'Researcher');
  assert.equal(normalized.rolePrompt.length, 80);
  assert.equal(normalizeParticipantCoordination({ role: '   ' }).role, '');
});

test('built-in session templates expose the supported workflows', () => {
  assert.deepEqual(SESSION_TEMPLATE_IDS, ['freeform', 'channel-9-axis', 'debate', 'planning']);
  const templates = getSessionTemplates();
  assert.equal(templates.length, 4);
  const channel = templates.find((template) => template.id === 'channel-9-axis');
  assert.deepEqual(channel.phases.map((phase) => phase.name), [
    'Concept', 'Narration', 'Visual Rhythm', 'Message Compression', 'Brand Signature',
    'Packaging', 'Retention', 'Repeatability', 'Distribution',
  ]);
  assert.equal(normalizeSession({ templateId: 'not-real' }).templateId, 'freeform');
});

test('session turns advance phases and complete the final phase', () => {
  let session = normalizeSession({ templateId: 'debate', status: 'RUNNING', phaseIndex: 0, phaseTurnCount: 0 });
  session = recordSessionTurn(session);
  assert.equal(session.phaseIndex, 0);
  assert.equal(session.phaseTurnCount, 1);
  const short = normalizeSession({ templateId: 'debate', status: 'RUNNING', phaseIndex: 0, phaseTurnCount: 1, phaseTurnLimit: 2 });
  const advanced = recordSessionTurn(short);
  assert.equal(advanced.phaseIndex, 1);
  assert.equal(advanced.phaseTurnCount, 0);
  let final = normalizeSession({ templateId: 'freeform', status: 'RUNNING', phaseIndex: 0, phaseTurnCount: 0 });
  final = recordSessionTurn(final);
  assert.equal(final.status, 'RUNNING');
  assert.equal(final.phaseTurnCount, 1);
});

test('Loop Guard counts hops, repeated speakers, and repeated routes', () => {
  let state = createLoopGuardState({ maxHops: 4, maxSameSpeaker: 2, maxSameRoute: 3 });
  state = recordLoopGuardHop(state, { speakerId: 'a', targetId: 'b' });
  state = recordLoopGuardHop(state, { speakerId: 'a', targetId: 'b' });
  assert.equal(state.hops, 2);
  assert.equal(state.sameSpeakerStreak, 2);
  assert.equal(state.sameRouteStreak, 2);
  assert.equal(loopGuardDecision(state, { enabled: true }).blocked, true);
  assert.match(loopGuardDecision(state, { enabled: true }).reason, /participant/i);
  const reset = recordLoopGuardHop(state, { speakerId: 'b', targetId: 'a' });
  assert.equal(reset.sameRouteStreak, 1);
});

test('Loop Guard disabled bounds never block and malformed counters normalize safely', () => {
  const state = normalizeLoopGuardState({ hops: -5, sameSpeakerStreak: 'nope', sameRouteStreak: 999 });
  assert.equal(state.hops, 0);
  assert.equal(state.sameSpeakerStreak, 0);
  const next = recordLoopGuardHop(state, { speakerId: 'a', targetId: 'b' });
  assert.equal(loopGuardDecision(next, { enabled: false, maxHops: 1, maxSameSpeaker: 1, maxSameRoute: 1 }).blocked, false);
});

test('meeting coordination migration preserves v3 fields and adds safe defaults', () => {
  const migrated = normalizeMeetingCoordination({
    title: 'Old meeting',
    topicText: 'Existing topic',
    interactionMode: 'autonomous',
    participants: [{ id: 'p1', label: 'Gemini', provider: 'gemini' }],
    transcript: [{ speakerType: 'AI', text: 'Keep me' }],
  });
  assert.equal(migrated.title, 'Old meeting');
  assert.equal(migrated.topicText, 'Existing topic');
  assert.equal(migrated.interactionMode, 'autonomous');
  assert.equal(migrated.participants[0].role, '');
  assert.equal(migrated.session.templateId, 'freeform');
  assert.equal(migrated.loopGuard.hops, 0);
});
