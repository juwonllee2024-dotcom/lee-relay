import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('v4 background migrates v3 state and keeps v4 runtime keys separate', async () => {
  const source = await read('background.js');
  assert.match(source, /v4\.0\.0MeetingRuntime/);
  assert.match(source, /v4\.0\.0SavedMeeting/);
  assert.match(source, /v3\.0\.8MeetingRuntime/);
  assert.match(source, /v3\.0\.8SavedMeeting/);
  assert.match(source, /DEFAULT_MEETING_SETTINGS/);
});

test('v4 background wires role, session, and Loop Guard state into turns', async () => {
  const source = await read('background.js');
  for (const marker of ['currentSessionPhase', 'recordSessionTurn', 'recordLoopGuardHop', 'loopGuardDecision', 'UPDATE_PARTICIPANT_COORDINATION', 'UPDATE_SESSION_TEMPLATE', 'UPDATE_LOOP_GUARD']) {
    assert.match(source, new RegExp(marker));
  }
  assert.match(source, /stage: 'LOOP_GUARD'/);
  assert.match(source, /setMeetingStatus\([^\n]+, 'PAUSED'\)/);
});

test('background provider relay still uses the existing background-tab controller', async () => {
  const source = await read('background.js');
  assert.match(source, /createBackgroundTabController\(chrome\)/);
  assert.match(source, /backgroundTabController\.releaseAll/);
  assert.match(source, /scheduleActiveTurnCheck/);
});
