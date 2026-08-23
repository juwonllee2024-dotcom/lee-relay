import { createMeeting, durableMeetingState } from './meeting-engine.mjs';

export const WORKSPACE_VERSION = 1;
export const MAX_ROOMS = 100;

function uid(prefix = 'id') {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = '', max = 160) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return normalized || fallback;
}

function timestamp(value, fallback = Date.now()) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function durableMeeting(meeting) {
  return durableMeetingState(meeting || createMeeting());
}

export function createRoom(options = {}) {
  const meeting = durableMeeting(options.meeting || createMeeting({
    title: options.title || 'New AI Meeting',
    topicText: options.topicText || '',
    interactionMode: options.interactionMode,
    settings: options.settings,
    session: options.session,
    loopGuard: options.loopGuard,
  }));
  const now = timestamp(options.now);
  return {
    id: text(options.id, uid('room'), 120),
    title: text(options.title, text(meeting.title, 'New AI Meeting', 120), 120),
    purpose: text(options.purpose, 'General discussion', 160),
    createdAt: timestamp(options.createdAt, now),
    updatedAt: timestamp(options.updatedAt, now),
    playbookId: text(options.playbookId, meeting.session?.templateId || 'freeform', 80),
    meeting,
    runHistory: Array.isArray(options.runHistory) ? clone(options.runHistory).slice(-20) : [],
  };
}

function normalizeRoom(room = {}, fallbackMeeting = null, now = Date.now()) {
  const source = room && typeof room === 'object' ? room : {};
  const meeting = durableMeeting(source.meeting || fallbackMeeting || createMeeting({ now }));
  return {
    id: text(source.id, `room-${meeting.id || uid('room')}`, 120),
    title: text(source.title, text(meeting.title, 'New AI Meeting', 120), 120),
    purpose: text(source.purpose, 'General discussion', 160),
    createdAt: timestamp(source.createdAt, timestamp(meeting.createdAt, now)),
    updatedAt: timestamp(source.updatedAt, timestamp(meeting.updatedAt, now)),
    playbookId: text(source.playbookId, meeting.session?.templateId || 'freeform', 80),
    meeting,
    runHistory: Array.isArray(source.runHistory) ? clone(source.runHistory).slice(-20) : [],
  };
}

export function createWorkspace({ meeting = null, rooms = [], activeRoomId = null, now = Date.now() } = {}) {
  const initial = Array.isArray(rooms) && rooms.length
    ? rooms.map((room) => normalizeRoom(room, meeting, now))
    : [createRoom({ meeting: meeting || createMeeting({ now }), now })];
  const bounded = initial.slice(0, MAX_ROOMS);
  const active = bounded.find((room) => room.id === activeRoomId) || bounded[0];
  return {
    version: WORKSPACE_VERSION,
    updatedAt: timestamp(now),
    activeRoomId: active.id,
    rooms: bounded,
  };
}

export function normalizeWorkspace(value = {}, fallbackMeeting = null, now = Date.now()) {
  const source = value && typeof value === 'object' ? value : {};
  const rooms = Array.isArray(source.rooms)
    ? source.rooms.map((room) => normalizeRoom(room, fallbackMeeting, now)).slice(0, MAX_ROOMS)
    : [];
  if (!rooms.length) return createWorkspace({ meeting: fallbackMeeting, now });
  const active = rooms.find((room) => room.id === source.activeRoomId) || rooms[0];
  return {
    version: WORKSPACE_VERSION,
    updatedAt: timestamp(source.updatedAt, now),
    activeRoomId: active.id,
    rooms,
  };
}

export function migrateWorkspace(value, legacyMeeting = null, now = Date.now()) {
  if (value && Array.isArray(value.rooms) && value.rooms.length) return normalizeWorkspace(value, legacyMeeting, now);
  return createWorkspace({ meeting: legacyMeeting || createMeeting({ now }), now });
}

export function getActiveRoom(workspace = {}) {
  const normalized = normalizeWorkspace(workspace);
  return normalized.rooms.find((room) => room.id === normalized.activeRoomId) || normalized.rooms[0];
}

export function addRoom(workspace, room = {}) {
  const normalized = normalizeWorkspace(workspace);
  if (normalized.rooms.length >= MAX_ROOMS) throw new Error(`Maximum Room count is ${MAX_ROOMS}.`);
  const nextRoom = normalizeRoom(room, null, Date.now());
  if (normalized.rooms.some((candidate) => candidate.id === nextRoom.id)) throw new Error('Room ID already exists.');
  return {
    ...normalized,
    updatedAt: Date.now(),
    activeRoomId: nextRoom.id,
    rooms: [...normalized.rooms, nextRoom],
  };
}

export function selectRoom(workspace, roomId) {
  const normalized = normalizeWorkspace(workspace);
  if (!normalized.rooms.some((room) => room.id === roomId)) return normalized;
  return { ...normalized, activeRoomId: roomId, updatedAt: Date.now() };
}

export function updateRoom(workspace, roomId, patch = {}) {
  const normalized = normalizeWorkspace(workspace);
  const rooms = normalized.rooms.map((room) => {
    if (room.id !== roomId) return room;
    const nextMeeting = patch.meeting ? durableMeeting(patch.meeting) : room.meeting;
    return {
      ...room,
      title: Object.hasOwn(patch, 'title') ? text(patch.title, room.title, 120) : room.title,
      purpose: Object.hasOwn(patch, 'purpose') ? text(patch.purpose, room.purpose, 160) : room.purpose,
      playbookId: Object.hasOwn(patch, 'playbookId') ? text(patch.playbookId, room.playbookId, 80) : room.playbookId,
      meeting: nextMeeting,
      runHistory: Array.isArray(patch.runHistory) ? clone(patch.runHistory).slice(-20) : room.runHistory,
      updatedAt: Date.now(),
    };
  });
  return { ...normalized, rooms, updatedAt: Date.now() };
}

export function removeRoom(workspace, roomId) {
  const normalized = normalizeWorkspace(workspace);
  if (normalized.rooms.length <= 1) return normalized;
  const rooms = normalized.rooms.filter((room) => room.id !== roomId);
  if (rooms.length === normalized.rooms.length) return normalized;
  const activeRoomId = normalized.activeRoomId === roomId ? rooms[0].id : normalized.activeRoomId;
  return { ...normalized, rooms, activeRoomId, updatedAt: Date.now() };
}

export function replaceActiveRoomMeeting(workspace, meeting) {
  const normalized = normalizeWorkspace(workspace);
  const active = getActiveRoom(normalized);
  return updateRoom(normalized, active.id, { meeting, title: meeting?.title || active.title });
}

export function durableWorkspaceState(workspace) {
  const normalized = normalizeWorkspace(workspace);
  return clone({
    version: normalized.version,
    updatedAt: normalized.updatedAt,
    activeRoomId: normalized.activeRoomId,
    rooms: normalized.rooms.map((room) => ({
      ...room,
      meeting: durableMeeting(room.meeting),
      runHistory: clone(room.runHistory || []).slice(-20),
    })),
  });
}

export function publicWorkspaceState(workspace) {
  return durableWorkspaceState(workspace);
}
