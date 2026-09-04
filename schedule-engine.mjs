export const SCHEDULE_VERSION = 1;
export const SCHEDULE_SLOT_IDS = Object.freeze(['morning', 'evening']);
export const SCHEDULE_ALARM_PREFIX = 'lee-relay-v4.1-schedule-';

const DEFAULT_SLOTS = Object.freeze({
  morning: Object.freeze({ id: 'morning', label: 'Morning', enabled: false, time: '08:00', mode: 'autonomous', topic: '' }),
  evening: Object.freeze({ id: 'evening', label: 'Evening', enabled: false, time: '20:00', mode: 'autonomous', topic: '' }),
});

function cleanTopic(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function timeValue(value, fallback = '08:00') {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeSlot(slotId, value = {}) {
  const defaults = DEFAULT_SLOTS[slotId];
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: slotId,
    label: defaults.label,
    enabled: Boolean(source.enabled),
    time: timeValue(source.time, defaults.time),
    mode: source.mode === 'interactive' ? 'interactive' : 'autonomous',
    topic: cleanTopic(source.topic),
  };
}

export function normalizeSchedule(value = {}, now = Date.now()) {
  const source = value && typeof value === 'object' ? value : {};
  const slots = source.slots && typeof source.slots === 'object' ? source.slots : {};
  const timestamp = Number(now);
  return {
    version: SCHEDULE_VERSION,
    enabled: Boolean(source.enabled),
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : (Number.isFinite(timestamp) ? timestamp : Date.now()),
    slots: {
      morning: normalizeSlot('morning', slots.morning),
      evening: normalizeSlot('evening', slots.evening),
    },
  };
}

function parsedTime(time) {
  const [hours, minutes] = String(time).split(':').map(Number);
  return { hours, minutes };
}

export function nextRunForSlot(schedule, slotId, now = Date.now()) {
  if (!SCHEDULE_SLOT_IDS.includes(slotId)) return null;
  const normalized = schedule?.slots?.[slotId];
  if (!schedule?.enabled || !normalized?.enabled) return null;
  const current = Number(now);
  if (!Number.isFinite(current)) return null;
  const { hours, minutes } = parsedTime(normalized.time);
  const date = new Date(current);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= current) date.setDate(date.getDate() + 1);
  return { slotId, at: date.getTime(), slot: { ...normalized } };
}

export function nextScheduledRun(schedule, now = Date.now()) {
  const runs = SCHEDULE_SLOT_IDS
    .map((slotId) => nextRunForSlot(schedule, slotId, now))
    .filter(Boolean)
    .sort((left, right) => left.at - right.at);
  return runs[0] || null;
}

export function isScheduledSlotDue(slot, now, scheduledAt, maxLateMs = 6 * 60 * 60 * 1000) {
  if (!slot?.enabled) return false;
  const current = Number(now);
  const expected = Number(scheduledAt);
  const lateLimit = Math.max(0, Number(maxLateMs) || 0);
  return Number.isFinite(current) && Number.isFinite(expected) && current >= expected && current - expected <= lateLimit;
}

export function alarmNameForSlot(slotId) {
  return SCHEDULE_SLOT_IDS.includes(slotId) ? `${SCHEDULE_ALARM_PREFIX}${slotId}` : null;
}

export function slotIdFromAlarmName(name) {
  const value = String(name || '');
  if (!value.startsWith(SCHEDULE_ALARM_PREFIX)) return null;
  const slotId = value.slice(SCHEDULE_ALARM_PREFIX.length);
  return SCHEDULE_SLOT_IDS.includes(slotId) ? slotId : null;
}
