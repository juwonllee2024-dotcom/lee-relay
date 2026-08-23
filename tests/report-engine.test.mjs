import assert from 'node:assert/strict';
import test from 'node:test';

import { getPlaybook } from '../playbook-engine.mjs';
import { createRun, recordRunEvent } from '../run-engine.mjs';
import { buildRunArtifact } from '../report-engine.mjs';

test('report artifact groups Run events by phase and creates a 9-axis scorecard', () => {
  const playbook = getPlaybook('channel-9-axis');
  let run = createRun({ roomId: 'room-1', playbook, now: 100 });
  run = recordRunEvent(run, { type: 'turn', participantId: 'p1', message: 'Concept evidence', data: { phaseId: 'axis-1' } }, 110);
  run = recordRunEvent(run, { type: 'turn', participantId: 'p2', message: 'Packaging risk', data: { phaseId: 'axis-6' } }, 120);
  const artifact = buildRunArtifact({ title: 'Channel review', meeting: { id: 'm1', transcript: [] }, run, playbook, now: 130 });
  assert.equal(artifact.runId, run.id);
  assert.equal(artifact.phaseResults.length, 9);
  assert.equal(artifact.phaseResults[0].turns[0].text, 'Concept evidence');
  assert.equal(artifact.scorecard.length, 9);
  assert.equal(artifact.scorecard[5].axis, 'Packaging');
  assert.equal('tabId' in artifact, false);
});

test('report artifact preserves explicit decisions and action items without live fields', () => {
  const playbook = getPlaybook('planning');
  const run = createRun({ roomId: 'room-2', playbook, now: 100 });
  const artifact = buildRunArtifact({
    title: 'Plan',
    run: { ...run, decisions: ['Choose option A'], actionItems: ['Test option A this week'] },
    meeting: { id: 'm2', participants: [{ id: 'p1', tabId: 9, url: 'https://example.test' }], transcript: [] },
    playbook,
    now: 200,
  });
  assert.deepEqual(artifact.decisions, ['Choose option A']);
  assert.deepEqual(artifact.actionItems, ['Test option A this week']);
  assert.equal(JSON.stringify(artifact).includes('example.test'), false);
});
