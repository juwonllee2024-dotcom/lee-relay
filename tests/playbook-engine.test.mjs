import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_PLAYBOOK_IDS,
  createCustomPlaybook,
  getPlaybook,
  getPlaybooks,
  normalizePlaybook,
} from '../playbook-engine.mjs';

test('built-in Playbooks cover the recommended workflows and output schemas', () => {
  assert.deepEqual(BUILTIN_PLAYBOOK_IDS, ['freeform', 'channel-9-axis', 'debate', 'planning', 'final-summary']);
  const playbooks = getPlaybooks();
  assert.equal(playbooks.length, 5);
  assert.equal(getPlaybook('channel-9-axis').phases.length, 9);
  assert.equal(getPlaybook('channel-9-axis').output.scorecard, true);
  assert.equal(getPlaybook('final-summary').output.summary, true);
});

test('custom Playbooks are normalized, bounded, and remain editable', () => {
  const playbook = createCustomPlaybook({
    id: 'custom-test',
    name: 'My flow',
    description: 'A saved custom workflow',
    phases: [{ id: 'one', name: 'One', instruction: 'Do the first thing', turnLimit: 3 }],
  });
  assert.equal(playbook.builtIn, false);
  assert.equal(playbook.phases[0].turnLimit, 3);
  const normalized = normalizePlaybook({ ...playbook, phases: [{ name: 'Only name' }] });
  assert.equal(normalized.phases[0].id, 'phase-1');
  assert.equal(normalized.phases[0].turnLimit, 0);
  assert.equal(normalized.output.actionItems, true);
});

test('unknown Playbook IDs fall back to freeform', () => {
  assert.equal(normalizePlaybook({ id: 'missing' }).id, 'freeform');
});
