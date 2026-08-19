export const MAX_PARTICIPANTS = 6;
export const DEFAULT_MEETING_SETTINGS = Object.freeze({
  maxTurns: 20,
  minDelayMs: 4000,
  smartRouting: true,
  captureScreenshots: false,
  retryLimit: 3,
  responseTimeoutMs: 120000,
  contextCharBudget: 12000,
});

function uid(prefix = 'id') {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function stamp(meeting, now = Date.now()) {
  return { ...meeting, updatedAt: now };
}

export function createParticipant(slotIndex, binding = {}) {
  return {
    id: binding.id || uid('participant'),
    slotIndex,
    provider: binding.provider || null,
    label: binding.label || `AI ${slotIndex + 1}`,
    tabId: Number.isInteger(binding.tabId) ? binding.tabId : null,
    url: binding.url || '',
    connectionState: binding.connectionState || (Number.isInteger(binding.tabId) ? 'READY' : 'DISCONNECTED'),
    turnState: binding.turnState || 'WAITING',
    lastKnownAssistantSignature: binding.lastKnownAssistantSignature || null,
    lastKnownUserSignature: binding.lastKnownUserSignature || null,
    lastSeenAt: Number(binding.lastSeenAt) || 0,
  };
}

export function createMeeting(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const meeting = {
    id: options.id || uid('meeting'),
    title: options.title || 'New AI Meeting',
    status: 'READY',
    createdAt: now,
    updatedAt: now,
    participants: [createParticipant(0), createParticipant(1)],
    transcript: [],
    currentTurn: 0,
    nextSpeakerParticipantId: null,
    routingMode: 'smart',
    settings: { ...DEFAULT_MEETING_SETTINGS, ...(options.settings || {}) },
    activeTransaction: null,
    activityLog: [],
  };
  return meeting;
}

function nextSlotIndex(participants) {
  const used = new Set(participants.map((p) => p.slotIndex));
  for (let i = 0; i < MAX_PARTICIPANTS; i += 1) if (!used.has(i)) return i;
  return participants.length;
}

export function addParticipant(meeting, binding = {}) {
  if ((meeting.participants?.length || 0) >= MAX_PARTICIPANTS) {
    throw new Error(`Maximum participant count is ${MAX_PARTICIPANTS}.`);
  }
  const slotIndex = nextSlotIndex(meeting.participants || []);
  return stamp({ ...meeting, participants: [...(meeting.participants || []), createParticipant(slotIndex, binding)] });
}

export function removeParticipant(meeting, participantId) {
  if (!meeting.participants?.some((p) => p.id === participantId)) return meeting;
  const participants = meeting.participants.filter((p) => p.id !== participantId);
  return stamp({
    ...meeting,
    participants,
    nextSpeakerParticipantId: meeting.nextSpeakerParticipantId === participantId ? null : meeting.nextSpeakerParticipantId,
  });
}

export function bindParticipant(meeting, participantId, binding = {}) {
  const tabId = Number.isInteger(binding.tabId) ? binding.tabId : null;
  if (tabId != null && meeting.participants.some((p) => p.id !== participantId && p.tabId === tabId)) {
    throw new Error(`Tab ${tabId} is already bound to another participant.`);
  }
  let found = false;
  const participants = meeting.participants.map((p) => {
    if (p.id !== participantId) return p;
    found = true;
    return {
      ...p,
      provider: binding.provider ?? p.provider,
      label: binding.label ?? p.label,
      tabId,
      url: binding.url ?? p.url,
      connectionState: tabId == null ? 'DISCONNECTED' : (binding.connectionState || 'READY'),
      lastSeenAt: tabId == null ? p.lastSeenAt : Date.now(),
    };
  });
  if (!found) throw new Error('Participant not found.');
  return stamp({ ...meeting, participants });
}

export function updateParticipant(meeting, participantId, patch = {}) {
  let found = false;
  const participants = meeting.participants.map((p) => {
    if (p.id !== participantId) return p;
    found = true;
    return { ...p, ...patch };
  });
  return found ? stamp({ ...meeting, participants }) : meeting;
}

export function appendTranscript(meeting, entry = {}) {
  const now = Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now();
  const transcriptEntry = {
    id: entry.id || uid('entry'),
    meetingId: meeting.id,
    turnNumber: Number(entry.turnNumber) || 0,
    speakerType: entry.speakerType || 'SYSTEM',
    participantId: entry.participantId ?? null,
    provider: entry.provider ?? null,
    text: String(entry.text || ''),
    createdAt: now,
    deliveryStatus: entry.deliveryStatus || null,
    responseStatus: entry.responseStatus || null,
    transactionId: entry.transactionId ?? null,
  };
  return stamp({ ...meeting, transcript: [...(meeting.transcript || []), transcriptEntry] }, now);
}

export function appendActivity(meeting, entry = {}) {
  const now = Number.isFinite(entry.at) ? entry.at : Date.now();
  const activity = {
    id: entry.id || uid('activity'),
    at: now,
    level: entry.level || 'INFO',
    stage: entry.stage || null,
    participantId: entry.participantId ?? null,
    transactionId: entry.transactionId ?? null,
    message: String(entry.message || ''),
  };
  const activityLog = [...(meeting.activityLog || []), activity].slice(-250);
  return stamp({ ...meeting, activityLog }, now);
}

export function setMeetingStatus(meeting, status) {
  return stamp({ ...meeting, status });
}

export function publicMeetingState(meeting) {
  if (!meeting) return null;
  return JSON.parse(JSON.stringify(meeting));
}

export function durableMeetingState(meeting) {
  if (!meeting) return null;
  const copy = publicMeetingState(meeting);
  copy.participants = copy.participants.map((p) => ({
    ...p,
    tabId: null,
    url: '',
    connectionState: 'DISCONNECTED',
    turnState: 'WAITING',
  }));
  copy.activeTransaction = null;
  if (copy.status === 'LIVE' || copy.status === 'NEEDS_ATTENTION') copy.status = 'PAUSED';
  return copy;
}
