import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('side panel exposes compact status center and schedule controls', () => {
  const html = read('sidepanel.html');
  for (const id of ['statusCenterPanel', 'statusCenterList', 'schedulePanel', 'scheduleEnabled', 'scheduleMorningTime', 'scheduleEveningTime', 'saveSchedule', 'runScheduleNow']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('background exposes durable schedule and tab-status commands', () => {
  const background = read('background.js');
  assert.match(background, /case 'GET_TAB_STATUS'/);
  assert.match(background, /case 'GET_SCHEDULE'/);
  assert.match(background, /case 'UPDATE_SCHEDULE'/);
  assert.match(background, /slotIdFromAlarmName/);
  assert.match(background, /restoreScheduledAlarms/);
  assert.match(background, /return \{ \.\.\.result, ok: true \};/);
});

test('automatic recovery path contains no second send action', () => {
  const background = read('background.js');
  const start = background.indexOf('async function performAutomaticRecovery');
  const end = background.indexOf('async function watchdogRecover');
  assert.ok(start >= 0 && end > start);
  const recoveryBody = background.slice(start, end);
  assert.doesNotMatch(recoveryBody, /SUBMIT_MESSAGE/);
  assert.match(recoveryBody, /ensurePreparedOnPage/);
  assert.match(recoveryBody, /armResponse/);
  assert.match(read('sidepanel.js'), /if \(result\.error\) notice\(result\.error, true\)/);
});

test('all three UI languages contain the new reliability labels', () => {
  const language = read('language.mjs');
  for (const key of ['statusCenter.title', 'schedule.title', 'notice.scheduleSaved', 'aria.scheduleMorning']) {
    assert.equal((language.match(new RegExp(`['"]${key.replace('.', '\\.')}`,'g')) || []).length, 3, key);
  }
});
