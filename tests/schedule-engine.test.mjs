import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alarmNameForSlot,
  isScheduledSlotDue,
  nextRunForSlot,
  nextScheduledRun,
  normalizeSchedule,
  slotIdFromAlarmName,
} from '../schedule-engine.mjs';

test('schedule normalization keeps two safe daily slots and clamps invalid input', () => {
  const schedule = normalizeSchedule({
    enabled: true,
    slots: {
      morning: { enabled: true, time: '7:05', mode: 'autonomous', topic: '  morning topic  ' },
      evening: { enabled: true, time: '99:99', mode: 'invalid', topic: 'x'.repeat(500) },
    },
  }, 123);

  assert.equal(schedule.version, 1);
  assert.equal(schedule.enabled, true);
  assert.equal(schedule.slots.morning.time, '07:05');
  assert.equal(schedule.slots.morning.mode, 'autonomous');
  assert.equal(schedule.slots.morning.topic, 'morning topic');
  assert.equal(schedule.slots.evening.time, '20:00');
  assert.equal(schedule.slots.evening.mode, 'autonomous');
  assert.ok(schedule.slots.evening.topic.length <= 240);
});

test('next run uses local clock and rolls a passed slot to tomorrow', () => {
  const now = new Date(2026, 7, 31, 8, 0, 0, 0);
  const schedule = normalizeSchedule({
    enabled: true,
    slots: { morning: { enabled: true, time: '09:30' }, evening: { enabled: true, time: '18:15' } },
  }, now.getTime());

  const morning = nextRunForSlot(schedule, 'morning', now.getTime());
  assert.equal(new Date(morning.at).getHours(), 9);
  assert.equal(new Date(morning.at).getMinutes(), 30);
  assert.equal(nextScheduledRun(schedule, now.getTime()).slotId, 'morning');

  const afterMorning = new Date(2026, 7, 31, 10, 0, 0, 0).getTime();
  const next = nextScheduledRun(schedule, afterMorning);
  assert.equal(next.slotId, 'evening');
  assert.equal(new Date(next.at).getDate(), 31);
});

test('disabled slots have no alarm and late alarms are bounded', () => {
  const schedule = normalizeSchedule({ enabled: true, slots: { morning: { enabled: false, time: '08:00' }, evening: { enabled: true, time: '20:00' } } });
  assert.equal(nextRunForSlot(schedule, 'morning', Date.now()), null);
  assert.equal(nextScheduledRun(schedule, Date.now()).slotId, 'evening');
  assert.equal(isScheduledSlotDue(schedule.slots.evening, 100_000, 99_000, 2_000), true);
  assert.equal(isScheduledSlotDue(schedule.slots.evening, 110_000, 99_000, 2_000), false);
});

test('alarm names round-trip their slot ids', () => {
  assert.equal(slotIdFromAlarmName(alarmNameForSlot('morning')), 'morning');
  assert.equal(slotIdFromAlarmName('other-alarm'), null);
});
