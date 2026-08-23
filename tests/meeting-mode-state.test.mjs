import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMeeting,
  durableMeetingState,
  normalizeInteractionMode,
  normalizeTopicText,
} from '../meeting-engine.mjs';

test('new meetings default to interactive mode with no autonomous topic', () => {
  const meeting = createMeeting();
  assert.equal(meeting.interactionMode, 'interactive');
  assert.equal(meeting.topicText, '');
});

test('invalid interaction modes normalize to interactive', () => {
  assert.equal(normalizeInteractionMode('autonomous'), 'autonomous');
  assert.equal(normalizeInteractionMode('unknown'), 'interactive');
  assert.equal(normalizeInteractionMode(undefined), 'interactive');
});

test('durable state preserves autonomous mode and topic', () => {
  const meeting = createMeeting({ interactionMode: 'autonomous', topicText: 'Compare two ideas.' });
  const saved = durableMeetingState(meeting);
  assert.equal(saved.interactionMode, 'autonomous');
  assert.equal(saved.topicText, 'Compare two ideas.');
});

test('new meetings carry coordination defaults and durable state preserves them', () => {
  const meeting = createMeeting({ interactionMode: 'autonomous' });
  assert.equal(meeting.session.templateId, 'freeform');
  assert.equal(meeting.loopGuard.enabled, true);
  assert.equal(meeting.settings.loopGuardEnabled, true);
  assert.equal(meeting.settings.loopGuardMaxHops, 20);
  const saved = durableMeetingState(meeting);
  assert.equal(saved.session.templateId, 'freeform');
  assert.equal(saved.loopGuard.hops, 0);
  assert.equal(saved.participants[0].role, '');
});

test('topic normalization collapses whitespace and rejects empty values', () => {
  assert.equal(normalizeTopicText('  A   useful topic  '), 'A useful topic');
  assert.equal(normalizeTopicText('   '), '');
});
