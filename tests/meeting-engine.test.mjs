import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PARTICIPANTS,
  createMeeting,
  addParticipant,
  removeParticipant,
  bindParticipant,
  appendTranscript,
  appendActivity,
  setMeetingStatus,
  publicMeetingState,
  durableMeetingState,
} from '../meeting-engine.mjs';

test('new meetings start READY with exactly two participant slots', () => {
  const meeting = createMeeting({ now: 1000 });
  assert.equal(meeting.status, 'READY');
  assert.equal(meeting.participants.length, 2);
  assert.equal(meeting.currentTurn, 0);
  assert.deepEqual(meeting.transcript, []);
  assert.equal(meeting.participants[0].slotIndex, 0);
  assert.equal(meeting.participants[1].slotIndex, 1);
});

test('participants can grow to six but no further', () => {
  let meeting = createMeeting();
  while (meeting.participants.length < MAX_PARTICIPANTS) meeting = addParticipant(meeting);
  assert.equal(meeting.participants.length, 6);
  assert.throws(() => addParticipant(meeting), /maximum/i);
});

test('same tab cannot be bound to two participants', () => {
  let meeting = createMeeting();
  meeting = bindParticipant(meeting, meeting.participants[0].id, {
    tabId: 44, provider: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/'
  });
  assert.throws(() => bindParticipant(meeting, meeting.participants[1].id, {
    tabId: 44, provider: 'claude', label: 'Claude', url: 'https://claude.ai/'
  }), /already bound/i);
});

test('removing a participant preserves their transcript history', () => {
  let meeting = createMeeting();
  const p = meeting.participants[1];
  meeting = appendTranscript(meeting, {
    speakerType: 'AI', participantId: p.id, provider: 'claude', text: 'Past answer', turnNumber: 1
  });
  meeting = removeParticipant(meeting, p.id);
  assert.equal(meeting.participants.length, 1);
  assert.equal(meeting.transcript.length, 1);
  assert.equal(meeting.transcript[0].participantId, p.id);
});

test('activity log is bounded to 250 newest entries', () => {
  let meeting = createMeeting();
  for (let i = 0; i < 270; i++) meeting = appendActivity(meeting, { message: `event-${i}`, at: i });
  assert.equal(meeting.activityLog.length, 250);
  assert.equal(meeting.activityLog[0].message, 'event-20');
  assert.equal(meeting.activityLog.at(-1).message, 'event-269');
});

test('public meeting state is serializable and durable state strips live tab bindings', () => {
  let meeting = createMeeting();
  const id = meeting.participants[0].id;
  meeting = bindParticipant(meeting, id, { tabId: 9, provider: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' });
  meeting = setMeetingStatus(meeting, 'LIVE');
  const pub = publicMeetingState(meeting);
  assert.equal(pub.participants[0].tabId, 9);
  assert.doesNotThrow(() => JSON.stringify(pub));

  const durable = durableMeetingState(meeting);
  assert.equal(durable.participants[0].tabId, null);
  assert.equal(durable.participants[0].provider, 'gemini');
  assert.equal(durable.activeTransaction, null);
});
