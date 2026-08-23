import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('side panel exposes the Full Auto mode controls', async () => {
  const html = await read('sidepanel.html');
  for (const id of ['interactionMode', 'interactiveMode', 'autonomousMode', 'joinConversation', 'modeHint']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('side panel sends mode commands and keeps pause/end available in observer mode', async () => {
  const js = await read('sidepanel.js');
  assert.match(js, /SET_INTERACTION_MODE/);
  assert.match(js, /START_MEETING.*mode/);
  assert.match(js, /autonomous.*LIVE/);
  assert.match(js, /pauseMeeting\.disabled/);
  assert.match(js, /endMeeting\.disabled/);
  assert.match(js, /Full Auto is observing/);
});

test('mode buttons stay clickable before a meeting is live', async () => {
  const js = await read('sidepanel.js');
  assert.match(js, /const canChangeMode = \['READY', 'PAUSED'\]\.includes\(status\);/);
  assert.doesNotMatch(js, /const canChangeMode = \['READY', 'PAUSED'\]\.includes\(status\) && !meeting\.activeTransaction;/);
});

test('side panel has mode selector and observe-only styles', async () => {
  const css = await read('sidepanel.css');
  assert.match(css, /\.mode-selector/);
  assert.match(css, /\.mode-hint/);
  assert.match(css, /observer/);
});

test('v4 side panel exposes role, session, and Loop Guard controls', async () => {
  const html = await read('sidepanel.html');
  const js = await read('sidepanel.js');
  for (const id of ['sessionTemplate', 'loopGuardEnabled', 'loopGuardMaxHops', 'loopGuardMaxSameSpeaker', 'loopGuardMaxSameRoute']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(js, /UPDATE_PARTICIPANT_COORDINATION/);
  assert.match(js, /UPDATE_SESSION_TEMPLATE/);
  assert.match(js, /UPDATE_LOOP_GUARD/);
});

test('v4.1 side panel keeps the primary Room → Playbook → Run path compact', async () => {
  const html = await read('sidepanel.html');
  const js = await read('sidepanel.js');
  for (const id of ['roomSelect', 'createRoom', 'playbookPicker', 'playbookHint', 'exportText', 'exportReportMarkdown', 'exportReportText', 'maxDurationMinutes', 'maxHops']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const marker of ['GET_WORKSPACE_STATE', 'SELECT_ROOM', 'CREATE_ROOM', 'UPDATE_PLAYBOOK', 'formatRunReportMarkdown', 'formatRunReportText', 'maxDurationMs']) {
    assert.match(js, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker);
  }
  assert.match(html, /id="meetingControls"[\s\S]*<details/);
});
