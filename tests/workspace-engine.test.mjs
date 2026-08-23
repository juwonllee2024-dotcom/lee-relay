import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addRoom,
  createRoom,
  createWorkspace,
  durableWorkspaceState,
  migrateWorkspace,
  normalizeWorkspace,
  removeRoom,
  selectRoom,
  updateRoom,
} from '../workspace-engine.mjs';

const legacyMeeting = {
  id: 'meeting-legacy',
  title: 'Saved channel room',
  status: 'PAUSED',
  createdAt: 10,
  updatedAt: 20,
  participants: [{ id: 'p1', label: 'Gemini', tabId: 42, url: 'https://gemini.google.com' }],
  transcript: [{ id: 'e1', speakerType: 'AI', text: 'Keep this.' }],
  activeTransaction: { transactionId: 'secret' },
};

test('workspace starts with one active durable Room', () => {
  const workspace = createWorkspace({ meeting: legacyMeeting, now: 100 });
  assert.equal(workspace.version, 1);
  assert.equal(workspace.rooms.length, 1);
  assert.equal(workspace.activeRoomId, workspace.rooms[0].id);
  assert.equal(workspace.rooms[0].meeting.id, 'meeting-legacy');
  assert.equal(workspace.rooms[0].meeting.participants[0].tabId, null);
  assert.equal(workspace.rooms[0].meeting.activeTransaction, null);
});

test('Rooms can be added and selected without losing conversation history', () => {
  let workspace = createWorkspace({ meeting: legacyMeeting, now: 100 });
  const room = createRoom({ title: 'Idea room', purpose: 'Ideas', now: 110 });
  workspace = addRoom(workspace, room);
  assert.equal(workspace.rooms.length, 2);
  workspace = selectRoom(workspace, room.id);
  assert.equal(workspace.activeRoomId, room.id);
  workspace = updateRoom(workspace, room.id, { title: 'Renamed ideas' });
  assert.equal(workspace.rooms.find((item) => item.id === room.id).title, 'Renamed ideas');
  workspace = selectRoom(workspace, 'meeting-legacy');
  assert.equal(workspace.rooms.find((item) => item.id === 'meeting-legacy'), undefined);
  assert.equal(workspace.rooms.find((item) => item.meeting.id === 'meeting-legacy').meeting.transcript[0].text, 'Keep this.');
});

test('removing the active Room selects a safe remaining Room and never removes the last one', () => {
  let workspace = createWorkspace({ meeting: legacyMeeting, now: 100 });
  const room = createRoom({ title: 'Second', now: 110 });
  workspace = addRoom(workspace, room);
  workspace = selectRoom(workspace, room.id);
  workspace = removeRoom(workspace, room.id);
  assert.equal(workspace.rooms.length, 1);
  assert.equal(workspace.activeRoomId, workspace.rooms[0].id);
  assert.equal(removeRoom(workspace, workspace.activeRoomId).rooms.length, 1);
});

test('legacy migration is idempotent and sanitizes live browser fields', () => {
  const first = migrateWorkspace(null, legacyMeeting, 100);
  const second = migrateWorkspace(first, legacyMeeting, 200);
  assert.deepEqual(second, first);
  const durable = durableWorkspaceState(first);
  assert.equal(durable.rooms[0].meeting.participants[0].tabId, null);
  assert.equal(durable.rooms[0].meeting.participants[0].url, '');
  assert.equal(durable.rooms[0].meeting.activeTransaction, null);
});

test('malformed workspace normalizes to one safe Room', () => {
  const workspace = normalizeWorkspace({ rooms: [], activeRoomId: 'missing' }, legacyMeeting, 300);
  assert.equal(workspace.rooms.length, 1);
  assert.equal(workspace.activeRoomId, workspace.rooms[0].id);
});
