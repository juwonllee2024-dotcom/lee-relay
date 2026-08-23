import assert from 'node:assert/strict';
import test from 'node:test';

import { getPlaybook } from '../playbook-engine.mjs';
import {
  advanceRunPhase,
  createRun,
  finishRun,
  normalizeRun,
  recordRunEvent,
  recordRunHandoff,
  recordRunTurn,
  runBudgetDecision,
} from '../run-engine.mjs';

test('Run snapshots a Playbook and advances its bounded phases', () => {
  const playbook = getPlaybook('debate');
  let run = createRun({ roomId: 'room-1', playbook, now: 100, budget: { maxTurns: 8, maxHops: 4 } });
  assert.equal(run.status, 'RUNNING');
  assert.equal(run.phaseId, 'framing');
  assert.equal(run.budget.maxTurns, 8);
  run = recordRunTurn(run, { participantId: 'p1', text: 'frame' }, 110);
  run = recordRunTurn(run, { participantId: 'p2', text: 'frame 2' }, 120);
  assert.equal(run.phaseId, 'arguments');
  assert.equal(run.turnCount, 2);
  assert.equal(run.events.length, 2);
});

test('Run Budget blocks on time, turns, and handoffs with explicit reasons', () => {
  let run = createRun({ roomId: 'room-1', playbook: getPlaybook('freeform'), now: 100, budget: { maxDurationMs: 100, maxTurns: 2, maxHops: 2 } });
  assert.equal(runBudgetDecision(run, 199).blocked, false);
  run = recordRunTurn(run, { participantId: 'p1', text: 'one' }, 120);
  run = recordRunTurn(run, { participantId: 'p2', text: 'two' }, 130);
  assert.match(runBudgetDecision(run, 140).reason, /turn/i);
  run = { ...run, turnCount: 1, startedAt: 100 };
  run = recordRunHandoff(run, { fromParticipantId: 'p1', toParticipantId: 'p2' }, 150);
  run = recordRunHandoff(run, { fromParticipantId: 'p2', toParticipantId: 'p1' }, 160);
  assert.match(runBudgetDecision(run, 170).reason, /handoff/i);
  run = { ...run, hopCount: 0 };
  assert.match(runBudgetDecision(run, 201).reason, /time/i);
});

test('Run event and handoff history is bounded and completion is durable', () => {
  let run = createRun({ roomId: 'room-1', playbook: getPlaybook('freeform'), now: 100 });
  for (let i = 0; i < 300; i += 1) run = recordRunEvent(run, { type: 'activity', message: `event ${i}` }, 100 + i);
  assert.equal(run.events.length, 250);
  run = recordRunHandoff(run, { fromParticipantId: 'p1', toParticipantId: 'p2', reason: '@Copilot' }, 500);
  assert.equal(run.handoffs.length, 1);
  run = finishRun(run, 'completed', 600, { summary: 'done' });
  assert.equal(run.status, 'FINISHED');
  assert.equal(run.stopReason, 'completed');
  assert.deepEqual(run.artifact, { summary: 'done' });
  assert.equal(normalizeRun({ ...run, status: 'bad' }).status, 'RUNNING');
});

test('manual phase advance never moves past the final phase', () => {
  let run = createRun({ roomId: 'room-1', playbook: getPlaybook('final-summary'), now: 100 });
  run = advanceRunPhase(run, 110);
  assert.equal(run.status, 'FINISHED');
  assert.equal(run.phaseId, 'summary');
});
