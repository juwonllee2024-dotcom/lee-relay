import { classifyUrl, normalizeText, signatureFor, providerLabelFor, isRelayEnvelope, buildCompactRelayPrompt, sanitizeRelayResponse } from './relay-core.mjs';
import {
  createMeeting,
  DEFAULT_MEETING_SETTINGS,
  addParticipant,
  removeParticipant,
  bindParticipant,
  updateParticipant,
  appendTranscript,
  appendActivity,
  setMeetingStatus,
  publicMeetingState,
  durableMeetingState,
  MAX_PARTICIPANTS,
  normalizeInteractionMode,
  normalizeTopicText,
} from './meeting-engine.mjs';
import {
  autonomousSeed,
  canAcceptUserMessage,
  canChangeInteractionMode,
} from './interaction-mode.mjs';
import {
  createTransaction,
  transitionTransaction,
  canAcceptEvent,
  deliveryEvidenceConfirmed,
  shouldRetryTransaction,
  markTransactionRetry,
  transactionTimedOut,
} from './transaction-engine.mjs';
import { selectNextSpeaker } from './router.mjs';
import {
  buildAdaptiveContextPlan,
  buildAutonomousContextPlan,
  buildAutonomousFallbackInlinePrompt,
  buildFallbackInlinePrompt,
} from './context-engine.mjs';
import { createBackgroundTabController } from './background-tab-controller.mjs';
import {
  addRoom,
  createRoom,
  getActiveRoom,
  migrateWorkspace,
  normalizeWorkspace,
  publicWorkspaceState,
  removeRoom,
  replaceActiveRoomMeeting,
  selectRoom,
  updateRoom,
  durableWorkspaceState,
} from './workspace-engine.mjs';
import { getPlaybook, getPlaybooks } from './playbook-engine.mjs';
import {
  createRun,
  finishRun,
  normalizeRun,
  pauseRun,
  recordRunHandoff,
  recordRunTurn,
  runBudgetDecision,
} from './run-engine.mjs';
import { buildRunArtifact } from './report-engine.mjs';
import { normalizeLanguage } from './language.mjs';
import { resolveMentionDirective } from './mention-router.mjs';
import {
  createLoopGuardState,
  currentSessionPhase,
  loopGuardDecision,
  normalizeMeetingCoordination,
  normalizeParticipantCoordination,
  normalizeSession,
  recordLoopGuardHop,
  recordSessionTurn,
  startSession,
} from './coordination-engine.mjs';
import { buildTabStatusSnapshot } from './status-center.mjs';
import {
  alarmNameForSlot,
  isScheduledSlotDue,
  nextRunForSlot,
  nextScheduledRun,
  normalizeSchedule,
  SCHEDULE_SLOT_IDS,
  slotIdFromAlarmName,
} from './schedule-engine.mjs';
import { nextRecoveryAction } from './recovery-engine.mjs';

const ACTIVE_RUNTIME_KEY = 'v4.0.0MeetingRuntime';
const SAVED_MEETING_KEY = 'v4.0.0SavedMeeting';
const CONTENT_SCRIPT_VERSION = '4.1.5';
const WORKSPACE_KEY = 'v4.1Workspace';
const ACTIVE_RUN_KEY = 'v4.1ActiveRun';
const LEGACY_ACTIVE_RUNTIME_KEY = 'v3.0.8MeetingRuntime';
const LEGACY_SAVED_MEETING_KEY = 'v3.0.8SavedMeeting';
const UI_SETTINGS_KEY = 'v3UiSettings';
const WATCHDOG_ALARM = 'lee-relay-v4.0.0-watchdog';
const SCHEDULE_KEY = 'v4.1Schedule';
const SCHEDULE_ALARM_LATE_LIMIT_MS = 6 * 60 * 60 * 1000;
const ACTIVE_TURN_CHECK_DELAY_MS = 2400;
let activeTurnCheckTimer = null;
let scheduleAlarmRestoreQueue = Promise.resolve();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let eventQueue = Promise.resolve();
const backgroundTabController = createBackgroundTabController(chrome);

function enqueue(task) {
  const run = eventQueue.then(task, task);
  eventQueue = run.catch(() => {});
  return run;
}

function withActivity(meeting, message, extra = {}) {
  return appendActivity(meeting, { message, ...extra });
}

function scheduleActiveTurnCheck(delayMs = ACTIVE_TURN_CHECK_DELAY_MS) {
  if (activeTurnCheckTimer) clearTimeout(activeTurnCheckTimer);
  const delay = Math.max(100, Number(delayMs) || ACTIVE_TURN_CHECK_DELAY_MS);
  activeTurnCheckTimer = setTimeout(() => {
    activeTurnCheckTimer = null;
    enqueue(() => watchdogRecover()).catch(() => {});
  }, delay);
}

async function enableSidePanelAction() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

enableSidePanelAction();

async function ensureWatchdog() {
  await chrome.alarms.create(WATCHDOG_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  await restoreScheduledAlarms().catch(() => {});
}

async function readSchedule() {
  const local = await chrome.storage.local.get([SCHEDULE_KEY]);
  return normalizeSchedule(local[SCHEDULE_KEY]);
}

async function clearScheduleAlarms() {
  if (typeof chrome.alarms?.clear !== 'function') return;
  for (const slotId of SCHEDULE_SLOT_IDS) {
    const name = alarmNameForSlot(slotId);
    if (name) await chrome.alarms.clear(name).catch(() => {});
  }
}

function restoreScheduledAlarms(schedule = null) {
  const work = scheduleAlarmRestoreQueue.then(async () => {
    const current = normalizeSchedule(schedule || await readSchedule());
    await clearScheduleAlarms();
    if (typeof chrome.alarms?.create !== 'function' || !current.enabled) return current;
    const now = Date.now();
    for (const slotId of SCHEDULE_SLOT_IDS) {
      const run = nextRunForSlot(current, slotId, now);
      const name = alarmNameForSlot(slotId);
      if (!run || !name) continue;
      await chrome.alarms.create(name, { when: run.at });
    }
    return current;
  });
  scheduleAlarmRestoreQueue = work.catch(() => {});
  return work;
}

async function saveSchedule(value = {}) {
  const schedule = normalizeSchedule({ ...value, updatedAt: Date.now() });
  await chrome.storage.local.set({ [SCHEDULE_KEY]: schedule });
  await restoreScheduledAlarms(schedule);
  return schedule;
}

function sanitizeMeetingTranscript(meeting) {
  if (!meeting?.transcript?.length) return meeting;
  let changed = false;
  const transcript = [];
  for (const entry of meeting.transcript) {
    if (entry.speakerType === 'USER' && isRelayEnvelope(entry.text)) {
      changed = true;
      continue;
    }
    if (entry.speakerType === 'AI') {
      const cleaned = sanitizeRelayResponse(entry.text, '');
      if (!cleaned) {
        changed = true;
        continue;
      }
      if (cleaned !== normalizeText(entry.text)) {
        changed = true;
        transcript.push({ ...entry, text: cleaned });
        continue;
      }
    }
    transcript.push(entry);
  }
  return changed ? { ...meeting, transcript } : meeting;
}

async function readWorkspace(fallbackMeeting = null) {
  const local = await chrome.storage.local.get([WORKSPACE_KEY]);
  return migrateWorkspace(local[WORKSPACE_KEY], fallbackMeeting, Date.now());
}

async function persistWorkspaceMeeting(meeting) {
  const local = await chrome.storage.local.get([WORKSPACE_KEY]);
  let workspace = migrateWorkspace(local[WORKSPACE_KEY], durableMeetingState(meeting), Date.now());
  const active = getActiveRoom(workspace);
  if (active?.meeting?.id !== meeting.id || Number(active?.meeting?.updatedAt) !== Number(meeting.updatedAt)) {
    workspace = replaceActiveRoomMeeting(workspace, meeting);
  }
  const durable = durableWorkspaceState(workspace);
  await chrome.storage.local.set({ [WORKSPACE_KEY]: durable });
  return durable;
}

async function ensureWorkspaceForMeeting(meeting) {
  const local = await chrome.storage.local.get([WORKSPACE_KEY]);
  let workspace = migrateWorkspace(local[WORKSPACE_KEY], durableMeetingState(meeting), Date.now());
  const active = getActiveRoom(workspace);
  if (!active || active.meeting.id !== meeting.id || Number(active.meeting.updatedAt) !== Number(meeting.updatedAt)) {
    workspace = replaceActiveRoomMeeting(workspace, meeting);
  }
  const durable = durableWorkspaceState(workspace);
  if (!local[WORKSPACE_KEY] || JSON.stringify(local[WORKSPACE_KEY]) !== JSON.stringify(durable)) {
    await chrome.storage.local.set({ [WORKSPACE_KEY]: durable });
  }
  return durable;
}

async function getMeeting() {
  const session = await chrome.storage.session.get([ACTIVE_RUNTIME_KEY, ACTIVE_RUN_KEY, LEGACY_ACTIVE_RUNTIME_KEY]);
  const activeStored = session[ACTIVE_RUNTIME_KEY] || session[LEGACY_ACTIVE_RUNTIME_KEY];
  if (activeStored) {
    const active = normalizeMeetingCoordination(sanitizeMeetingTranscript(activeStored));
    const next = {
      ...active,
      settings: { ...DEFAULT_MEETING_SETTINGS, ...(active.settings || {}) },
      interactionMode: normalizeInteractionMode(active.interactionMode),
      topicText: normalizeTopicText(active.topicText),
      activeRun: active.activeRun || session[ACTIVE_RUN_KEY] || null,
    };
    if (!session[ACTIVE_RUNTIME_KEY]) await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: next });
    await ensureWorkspaceForMeeting(next);
    return next;
  }
  const local = await chrome.storage.local.get([SAVED_MEETING_KEY, LEGACY_SAVED_MEETING_KEY, WORKSPACE_KEY]);
  const storedWorkspace = local[WORKSPACE_KEY] ? normalizeWorkspace(local[WORKSPACE_KEY]) : null;
  const stored = storedWorkspace ? getActiveRoom(storedWorkspace)?.meeting : (local[SAVED_MEETING_KEY] || local[LEGACY_SAVED_MEETING_KEY]);
  const restored = normalizeMeetingCoordination(sanitizeMeetingTranscript(stored || createMeeting()));
  const meeting = normalizeMeetingCoordination({
    ...restored,
    settings: { ...DEFAULT_MEETING_SETTINGS, ...(restored.settings || {}) },
    status: restored.status === 'FINISHED' ? 'FINISHED' : 'READY',
    interactionMode: normalizeInteractionMode(restored.interactionMode),
    topicText: normalizeTopicText(restored.topicText),
    activeTransaction: null,
    activeRun: restored.activeRun || null,
    participants: (restored.participants || []).map((p) => ({ ...p, tabId: null, url: '', connectionState: 'DISCONNECTED', turnState: 'WAITING' })),
  });
  await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: meeting, [ACTIVE_RUN_KEY]: meeting.activeRun || null });
  if (!local[SAVED_MEETING_KEY] && local[LEGACY_SAVED_MEETING_KEY]) {
    await chrome.storage.local.set({ [SAVED_MEETING_KEY]: durableMeetingState(meeting) });
  }
  await ensureWorkspaceForMeeting(meeting);
  return meeting;
}

async function broadcastMeeting(meeting, workspace = null) {
  const state = workspace || await readWorkspace(meeting);
  await chrome.runtime.sendMessage({ type: 'MEETING_STATE_CHANGED', meeting: publicMeetingState(meeting), workspace: publicWorkspaceState(state) }).catch(() => {});
}

async function saveMeeting(meeting, { broadcast = true } = {}) {
  const next = normalizeMeetingCoordination({
    ...meeting,
    updatedAt: Date.now(),
    settings: { ...DEFAULT_MEETING_SETTINGS, ...(meeting.settings || {}) },
  });
  await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: next, [ACTIVE_RUN_KEY]: next.activeRun || null });
  await chrome.storage.local.set({ [SAVED_MEETING_KEY]: durableMeetingState(next) });
  const workspace = await persistWorkspaceMeeting(next);
  if (broadcast) await broadcastMeeting(next, workspace);
  return next;
}

async function newMeeting(options = {}) {
  const current = await getMeeting();
  if (current.status === 'LIVE') {
    await backgroundTabController.releaseAll().catch(() => {});
    await saveMeeting(setMeetingStatus({ ...current, activeTransaction: null }, 'PAUSED'), { broadcast: false });
  }
  const meeting = createMeeting({
    title: options.title || 'New AI Meeting',
    interactionMode: options.interactionMode,
    topicText: options.topicText,
    settings: {
      ...(options.settings || {}),
      language: normalizeLanguage(options.settings?.language || current.settings?.language),
    },
    session: options.session || {},
    loopGuard: options.loopGuard || {},
    playbookId: options.playbookId || options.session?.templateId || 'freeform',
  });
  let workspace = await readWorkspace(current);
  workspace = addRoom(workspace, createRoom({
    title: meeting.title,
    purpose: options.purpose,
    playbookId: meeting.playbookId,
    meeting,
  }));
  await chrome.storage.local.set({ [WORKSPACE_KEY]: durableWorkspaceState(workspace) });
  return saveMeeting(meeting);
}

function participantForTab(meeting, tabId) {
  return meeting.participants.find((p) => p.tabId === tabId) || null;
}

function participantById(meeting, id) {
  return meeting.participants.find((p) => p.id === id) || null;
}

function labelForTab(tab, provider) {
  const title = String(tab.title || '').replace(/\s+/g, ' ').trim();
  return title ? `${providerLabelFor(provider)} — ${title.slice(0, 54)}` : providerLabelFor(provider);
}

async function listSupportedTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((tab) => {
    const provider = classifyUrl(tab.url || '');
    if (!provider) return null;
    return {
      tabId: tab.id,
      provider,
      providerLabel: providerLabelFor(provider),
      label: labelForTab(tab, provider),
      title: tab.title || '',
      url: tab.url || '',
      active: Boolean(tab.active),
      windowId: tab.windowId,
    };
  }).filter(Boolean);
}

async function listTabStatus() {
  const meeting = await getMeeting();
  const tabs = await listSupportedTabs();
  return {
    tabs,
    status: buildTabStatusSnapshot({
      tabs,
      participants: meeting.participants,
      activeTransaction: meeting.activeTransaction,
      now: Date.now(),
    }),
  };
}

function bindOpenTabsToMeeting(meeting, tabs = []) {
  let next = meeting;
  const openTabs = Array.isArray(tabs) ? tabs : [];
  const openById = new Map(openTabs.map((tab) => [Number(tab.tabId), tab]));
  const used = new Set();
  for (const participant of next.participants || []) {
    const currentTab = Number.isInteger(participant.tabId) ? openById.get(participant.tabId) : null;
    let candidate = currentTab || null;
    if (!candidate || (participant.provider && candidate.provider !== participant.provider)) {
      candidate = openTabs.find((tab) => !used.has(tab.tabId) && (!participant.provider || tab.provider === participant.provider)) || null;
    }
    if (!candidate || used.has(candidate.tabId)) continue;
    try {
      next = bindParticipant(next, participant.id, {
        tabId: candidate.tabId,
        provider: candidate.provider,
        label: participant.label?.startsWith('AI ') ? candidate.providerLabel : participant.label,
        url: candidate.url,
        connectionState: 'READY',
      });
      used.add(candidate.tabId);
    } catch { /* a duplicate or stale binding is left for the next pass */ }
  }
  return next;
}

async function reconnectMeetingParticipants(meeting) {
  let next = meeting;
  for (const participant of next.participants || []) {
    if (!Number.isInteger(participant.tabId)) continue;
    try {
      next = await attachParticipant(next, participant.id);
    } catch (error) {
      next = updateParticipant(next, participant.id, {
        connectionState: 'ERROR',
        turnState: 'ERROR',
        lastRecoveryError: error.message || String(error),
      });
    }
  }
  return next;
}

function resetFinishedMeetingForSchedule(meeting, slot) {
  const participants = (meeting.participants || []).map((participant) => ({
    ...participant,
    tabId: null,
    url: '',
    connectionState: 'DISCONNECTED',
    turnState: 'WAITING',
    lastRecoveryError: '',
  }));
  return {
    ...meeting,
    status: 'READY',
    participants,
    transcript: [],
    currentTurn: 0,
    nextSpeakerParticipantId: null,
    topicText: normalizeTopicText(slot?.topic || ''),
    session: normalizeSession({ templateId: meeting.session?.templateId || meeting.playbookId || 'freeform', status: 'IDLE' }),
    loopGuard: createLoopGuardState({}),
    activeRun: null,
    artifact: null,
    activeTransaction: null,
  };
}

async function runScheduledSlot(slotId, { scheduledAt = null, force = false } = {}) {
  const schedule = await readSchedule();
  const slot = schedule.slots?.[slotId];
  if (!slot || (!force && (!schedule.enabled || !slot.enabled))) {
    await restoreScheduledAlarms(schedule);
    return { ok: false, skipped: true, reason: 'SCHEDULE_DISABLED' };
  }
  const now = Date.now();
  if (!force && !isScheduledSlotDue(slot, now, scheduledAt, SCHEDULE_ALARM_LATE_LIMIT_MS)) {
    await restoreScheduledAlarms(schedule);
    return { ok: false, skipped: true, reason: 'SCHEDULE_MISSED' };
  }

  try {
    let meeting = await getMeeting();
    if (meeting.status === 'LIVE' || meeting.activeTransaction) {
    meeting = withActivity(meeting, `${slot.label} scheduled run skipped because a meeting is already active.`, { level: 'WARN', stage: 'SCHEDULE' });
    await saveMeeting(meeting);
    await restoreScheduledAlarms(schedule);
    return { ok: false, skipped: true, reason: 'MEETING_ACTIVE', meeting };
    }
    if (meeting.status === 'FINISHED' || meeting.session?.status === 'COMPLETE' || meeting.activeRun?.status === 'FINISHED') {
    meeting = resetFinishedMeetingForSchedule(meeting, slot);
    }

    const tabs = await listSupportedTabs();
    meeting = bindOpenTabsToMeeting(meeting, tabs);
    meeting = await reconnectMeetingParticipants(meeting);
    const ready = meeting.participants.filter((participant) => Number.isInteger(participant.tabId) && participant.connectionState === 'READY');
    if (ready.length < 2) {
    meeting = withActivity(meeting, `${slot.label} scheduled run could not start: at least two AI tabs must be open and connected.`, { level: 'WARN', stage: 'SCHEDULE' });
    await saveMeeting(meeting);
    await restoreScheduledAlarms(schedule);
    return { ok: false, skipped: true, reason: 'NOT_ENOUGH_AI_TABS', meeting };
    }

    meeting = await saveMeeting(meeting);
    try {
      const started = await startMeeting(slot.topic || '', slot.mode);
      await restoreScheduledAlarms(schedule);
      return { ok: true, meeting: started };
    } catch (error) {
      let latest = await getMeeting();
      latest = withActivity(latest, `${slot.label} scheduled run failed: ${error.message || String(error)}`, { level: 'WARN', stage: 'SCHEDULE' });
      await saveMeeting(latest);
      await restoreScheduledAlarms(schedule);
      return { ok: false, error: error.message || String(error), meeting: latest };
    }
  } finally {
    await restoreScheduledAlarms(schedule).catch(() => {});
  }
}

async function ensureContent(tabId) {
  let pong = null;
  try {
    pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong?.ok && pong.contentVersion === CONTENT_SCRIPT_VERSION) return pong;
  } catch { /* inject below */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['chatgpt-input-engine.js', 'content.js'] });
  await sleep(120);
  const refreshed = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch((error) => ({
    ok: false,
    error: error?.message || String(error),
  }));
  if (!refreshed?.ok) {
    throw new Error(refreshed?.error || 'AI tab content script is unavailable.');
  }
  if (refreshed.contentVersion !== CONTENT_SCRIPT_VERSION) {
    throw new Error('AI tab is running an older Lee Relay content script. Reload the AI tab once, then retry.');
  }
  return refreshed;
}

async function sendToParticipant(participant, message) {
  if (!Number.isInteger(participant?.tabId)) throw new Error(`${participant?.label || 'Participant'} has no bound tab.`);
  const background = await backgroundTabController.ensure(participant).catch((error) => ({ ok: false, error: error?.message || String(error) }));
  if (background?.error) console.warn(`[Lee Relay] ${background.error}`);
  await ensureContent(participant.tabId);
  return chrome.tabs.sendMessage(participant.tabId, message);
}

async function attachParticipant(meeting, participantId) {
  let participant = participantById(meeting, participantId);
  if (!participant || !Number.isInteger(participant.tabId)) throw new Error('Participant is not bound to an AI tab.');
  const tab = await chrome.tabs.get(participant.tabId).catch(() => null);
  if (!tab) throw new Error(`${participant.label} tab is closed.`);
  const provider = classifyUrl(tab.url || '');
  if (!provider) throw new Error(`${participant.label} tab is not currently on a supported AI site.`);
  const response = await sendToParticipant(participant, { type: 'ATTACH_PARTICIPANT', meetingId: meeting.id, participantId: participant.id });
  if (!response?.ok) throw new Error(response?.error || 'Content script attachment failed.');
  if (response.inputAvailable === false) throw new Error(response.inputError || `${providerLabelFor(provider)} input editor is unavailable.`);
  meeting = updateParticipant(meeting, participant.id, {
    provider,
    label: participant.label?.startsWith('AI ') ? providerLabelFor(provider) : participant.label,
    url: tab.url || '',
    connectionState: 'READY',
    lastSeenAt: Date.now(),
  });
  return meeting;
}

function latestTranscriptText(meeting) {
  return [...(meeting.transcript || [])].reverse().find((e) => normalizeText(e.text))?.text || '';
}

function meetingContextEntries(meeting) {
  const entries = [];
  for (const entry of meeting.transcript || []) {
    if (entry.speakerType === 'USER' && isRelayEnvelope(entry.text)) continue;
    if (meeting.interactionMode === 'autonomous' && entry.speakerType !== 'AI') continue;
    const cleanedText = entry.speakerType === 'AI'
      ? sanitizeRelayResponse(entry.text, '')
      : normalizeText(entry.text);
    if (!cleanedText) continue;
    const speaker = entry.speakerType === 'USER'
      ? 'User'
      : (participantById(meeting, entry.participantId)?.label || entry.provider || entry.speakerType);
    entries.push({ speaker, text: cleanedText });
  }
  return entries;
}

function buildMeetingContextPlan(meeting, target, entries = meetingContextEntries(meeting)) {
  const phase = meeting.session?.status === 'COMPLETE' ? null : currentSessionPhase(meeting.session);
  const options = {
    provider: target.provider,
    meetingTitle: meeting.title,
    targetLabel: target.label,
    participants: meeting.participants.map((p) => p.label),
    turnNumber: meeting.currentTurn + 1,
    topicText: meeting.topicText,
    role: target.role,
    rolePrompt: target.rolePrompt,
    sessionPhase: phase,
    language: meeting.settings?.language,
    entries,
  };
  return meeting.interactionMode === 'autonomous'
    ? buildAutonomousContextPlan(options)
    : buildAdaptiveContextPlan(options);
}

function buildMeetingPrompt(meeting, target) {
  return buildMeetingContextPlan(meeting, target).promptText;
}

function buildFallbackPrompt(meeting, participant, entries) {
  const phase = meeting.session?.status === 'COMPLETE' ? null : currentSessionPhase(meeting.session);
  const options = {
    provider: participant.provider,
    targetLabel: participant.label,
    participants: meeting.participants.map((p) => p.label),
    topicText: meeting.topicText,
    role: participant.role,
    rolePrompt: participant.rolePrompt,
    sessionPhase: phase,
    language: meeting.settings?.language,
    entries,
  };
  return meeting.interactionMode === 'autonomous'
    ? buildAutonomousFallbackInlinePrompt(options)
    : buildFallbackInlinePrompt(options);
}

function setParticipantTurnStates(meeting, activeId, activeState) {
  let next = meeting;
  for (const p of meeting.participants) {
    const state = p.id === activeId ? activeState : (Number.isInteger(p.tabId) ? 'LISTENING' : 'WAITING');
    next = updateParticipant(next, p.id, { turnState: state });
  }
  return next;
}

async function enterNeedsAttention(meeting, reason, stage = null) {
  const tx = meeting.activeTransaction;
  let next = meeting;
  if (tx) next = { ...next, activeTransaction: { ...tx, stage: 'NEEDS_ATTENTION', error: String(reason || 'Unknown failure'), updatedAt: Date.now(), lastProgressAt: Date.now() } };
  next = setMeetingStatus(next, 'NEEDS_ATTENTION');
  if (tx?.participantId) next = updateParticipant(next, tx.participantId, { turnState: 'ERROR', connectionState: participantById(next, tx.participantId)?.connectionState || 'ERROR' });
  next = withActivity(next, reason, { level: 'WARN', stage: stage || tx?.stage || null, participantId: tx?.participantId || null, transactionId: tx?.transactionId || null });
  return saveMeeting(next);
}

async function armResponse(meeting, participant, tx) {
  const response = await sendToParticipant(participant, {
    type: 'ARM_RESPONSE_OBSERVER',
    meetingId: meeting.id,
    transactionId: tx.transactionId,
    participantId: participant.id,
    baselineAssistantSignature: tx.preAssistantSignature || null,
  });
  if (!response?.ok) throw new Error(response?.error || 'Failed to arm response observer.');
  // Do not rely on provider-page timers alone. Hidden Gemini/Copilot tabs can
  // throttle them, so the extension service worker schedules a near-term status
  // verification as an independent second wake-up path.
  scheduleActiveTurnCheck();
}

async function confirmDelivery(meeting, tx, evidence) {
  let nextTx = transitionTransaction(tx, 'DELIVERED', { deliveryEvidence: evidence, error: '' });
  nextTx = transitionTransaction(nextTx, 'WAITING_FOR_GENERATION');
  let next = { ...meeting, activeTransaction: nextTx };
  next = updateParticipant(next, tx.participantId, { turnState: 'THINKING', lastKnownUserSignature: evidence.userSignature || tx.promptSignature });
  next = withActivity(next, 'Delivery confirmed', { stage: 'DELIVERED', participantId: tx.participantId, transactionId: tx.transactionId });
  next = await saveMeeting(next);
  const participant = participantById(next, tx.participantId);
  await armResponse(next, participant, nextTx);
  return next;
}

async function ensurePreparedOnPage(meeting, participant, tx, { captureBaseline = false } = {}) {
  await sendToParticipant(participant, { type: 'ATTACH_PARTICIPANT', meetingId: meeting.id, participantId: participant.id });
  const restore = !captureBaseline && tx.baselineCaptured;
  const response = await sendToParticipant(participant, {
    type: 'PREPARE_DELIVERY',
    meetingId: meeting.id,
    transactionId: tx.transactionId,
    participantId: participant.id,
    text: tx.promptText,
    promptSignature: tx.promptSignature,
    baselineCaptured: Boolean(restore),
    ...(restore ? {
      baselineAssistantSignature: tx.preAssistantSignature ?? null,
      baselineAssistantCount: Number(tx.preAssistantCount) || 0,
      baselineUserSignature: tx.preUserSignature ?? null,
      baselineUserCount: Number(tx.preUserCount) || 0,
      baselineGenerating: Boolean(tx.preGenerating),
      baselineUrl: tx.preUrl || '',
    } : {}),
  });
  if (!response?.ok) throw new Error(response?.error || 'Failed to prepare delivery.');
  return response;
}

async function verifyDelivery(meeting, participant, tx, timeoutMs = 4500) {
  let response;
  try {
    response = await sendToParticipant(participant, {
      type: 'VERIFY_DELIVERY',
      meetingId: meeting.id,
      transactionId: tx.transactionId,
      participantId: participant.id,
      timeoutMs,
    });
  } catch (error) {
    await ensurePreparedOnPage(meeting, participant, tx, { captureBaseline: false });
    response = await sendToParticipant(participant, {
      type: 'VERIFY_DELIVERY', meetingId: meeting.id, transactionId: tx.transactionId, participantId: participant.id, timeoutMs,
    });
  }
  return response?.ok ? response : { matchingUserMessage: false, error: response?.error || 'Verification failed' };
}

async function deliveryWithRetries(meetingId) {
  let meeting = await getMeeting();
  if (meeting.id !== meetingId || !meeting.activeTransaction) return meeting;
  let tx = meeting.activeTransaction;
  const participant = participantById(meeting, tx.participantId);
  if (!participant) return enterNeedsAttention(meeting, 'Target participant no longer exists.', tx.stage);

  // Once a send action has happened, Lee Relay uses at-most-once delivery.
  // Provider DOM verification is fallible; automatically clicking Send again
  // can create the exact duplicate turns seen on Gemini. Retries below are
  // re-verification attempts only. A human may explicitly request a retry.
  while (true) {
    const evidence = await verifyDelivery(meeting, participant, tx, tx.attempt === 0 ? 7000 : 3000)
      .catch(() => ({ matchingUserMessage: false }));
    const enriched = {
      ...evidence,
      sendActionExecuted: Boolean(tx.sendActionExecuted),
      inputPrimed: Boolean(tx.inputPrimed || evidence.inputPrimed),
    };
    if (deliveryEvidenceConfirmed(enriched)) return confirmDelivery(meeting, tx, enriched);

    if (!shouldRetryTransaction(tx)) {
      return enterNeedsAttention(meeting, `${participant.label} delivery verification stayed inconclusive. Lee Relay did not resend automatically, to prevent a duplicate message.`, 'VERIFYING_DELIVERY');
    }

    tx = markTransactionRetry(tx, 'Delivery verification inconclusive; re-verifying without resending');
    meeting = { ...meeting, activeTransaction: tx };
    meeting = withActivity(meeting, `Delivery verification inconclusive · re-verify ${tx.attempt}/${tx.retryLimit} (no resend)`, { level: 'WARN', stage: 'RETRYING', participantId: tx.participantId, transactionId: tx.transactionId });
    meeting = await saveMeeting(meeting);
  }
}

async function executeTurn(participantId) {
  let meeting = await getMeeting();
  if (meeting.status !== 'LIVE' || meeting.activeTransaction) return meeting;
  let participant = participantById(meeting, participantId);
  if (!participant || !Number.isInteger(participant.tabId)) return enterNeedsAttention(meeting, 'Next speaker is not connected.');
  if (meeting.settings.maxTurns > 0 && meeting.currentTurn >= meeting.settings.maxTurns) {
    meeting = setMeetingStatus(meeting, 'FINISHED');
    meeting = withActivity(meeting, 'Meeting reached the maximum completed AI turns.');
    return saveMeeting(meeting);
  }

  const contextEntries = meetingContextEntries(meeting);
  let contextPlan = buildMeetingContextPlan(meeting, participant, contextEntries);
  let promptText = contextPlan.promptText;
  let promptSignature = await signatureFor(promptText);
  let tx = createTransaction({
    meetingId: meeting.id,
    participantId: participant.id,
    tabId: participant.tabId,
    turnNumber: meeting.currentTurn + 1,
    promptText,
    promptSignature,
    retryLimit: meeting.settings.retryLimit,
    responseTimeoutMs: meeting.settings.responseTimeoutMs,
    contextMode: contextPlan.mode,
    contextFileName: contextPlan.contextFile?.name || '',
  });
  meeting = { ...meeting, activeTransaction: tx, nextSpeakerParticipantId: participant.id };
  meeting = setParticipantTurnStates(meeting, participant.id, 'SENDING');
  meeting = withActivity(meeting, `Turn ${tx.turnNumber} prepared → ${participant.label} · context ${contextPlan.mode.toUpperCase()}`, { stage: 'PREPARING', participantId: participant.id, transactionId: tx.transactionId });
  meeting = await saveMeeting(meeting);

  try {
    meeting = await attachParticipant(meeting, participant.id);
    participant = participantById(meeting, participant.id);
    tx = meeting.activeTransaction;
    const baseline = await ensurePreparedOnPage(meeting, participant, tx, { captureBaseline: true });
    if (baseline.generating) throw new Error(`${participant.label} is already generating a response. Wait for it to finish before starting this turn.`);
    tx = {
      ...tx,
      preAssistantSignature: baseline.assistantSignature || null,
      preAssistantCount: Number(baseline.assistantCount) || 0,
      preUserSignature: baseline.userSignature || null,
      preUserCount: Number(baseline.userCount) || 0,
      preGenerating: Boolean(baseline.generating),
      preUrl: baseline.url || '',
      baselineCaptured: true,
    };
    meeting = { ...meeting, activeTransaction: tx };
    meeting = await saveMeeting(meeting);

    if (contextPlan.mode === 'file' && contextPlan.contextFile) {
      const attachmentResult = await sendToParticipant(participant, {
        type: 'ATTACH_CONTEXT_FILE',
        meetingId: meeting.id,
        transactionId: tx.transactionId,
        participantId: participant.id,
        fileName: contextPlan.contextFile.name,
        fileText: contextPlan.contextFile.text,
        mimeType: contextPlan.contextFile.mimeType,
      }).catch((error) => ({ ok: false, attached: false, error: error.message || String(error) }));

      // A native file input accepting the File object is not enough: ChatGPT
      // can still be building its text-field attachment while the Send button
      // appears clickable. Only a content script that observed a settled
      // attachment may enter file mode; otherwise use the bounded inline plan
      // before attempting Send.
      if (!attachmentResult?.ok || !attachmentResult?.ready) {
        promptText = buildFallbackPrompt(meeting, participant, contextEntries);
        promptSignature = await signatureFor(promptText);
        contextPlan = { ...contextPlan, mode: 'fallback-inline', promptText, contextFile: null };
        tx = {
          ...tx,
          promptText,
          promptSignature,
          contextMode: 'fallback-inline',
          contextFileName: '',
          contextAttachmentConfirmed: false,
        };
        meeting = { ...meeting, activeTransaction: tx };
        meeting = withActivity(meeting, `Context file unavailable for ${participant.label}; using bounded inline fallback (${promptText.length} chars).`, { level: 'WARN', stage: 'PREPARING', participantId: participant.id, transactionId: tx.transactionId });
        meeting = await saveMeeting(meeting);
        await ensurePreparedOnPage(meeting, participant, tx, { captureBaseline: false });
      } else {
        tx = {
          ...tx,
          contextAttachmentConfirmed: Boolean(attachmentResult.ready && attachmentResult.confirmed),
          contextFileName: attachmentResult.fileName || contextPlan.contextFile.name,
        };
        meeting = { ...meeting, activeTransaction: tx };
        meeting = withActivity(meeting, `Context file attached → ${tx.contextFileName} (${contextPlan.contextFile.text.length} chars)`, { stage: 'PREPARING', participantId: participant.id, transactionId: tx.transactionId });
        meeting = await saveMeeting(meeting);
      }
    } else if (contextPlan.mode === 'compact') {
      meeting = withActivity(meeting, `Context compacted for ${participant.label} (${promptText.length} chars).`, { stage: 'PREPARING', participantId: participant.id, transactionId: tx.transactionId });
      meeting = await saveMeeting(meeting);
    }

    tx = transitionTransaction(tx, 'SENDING');
    meeting = { ...meeting, activeTransaction: tx };
    meeting = await saveMeeting(meeting);

    const sent = await sendToParticipant(participant, {
      type: 'SUBMIT_MESSAGE', meetingId: meeting.id, transactionId: tx.transactionId, participantId: participant.id, text: promptText,
    });
    if (!sent?.ok || !sent.sendActionExecuted) throw new Error(sent?.error || 'Send action failed.');
    tx = { ...tx, sendActionExecuted: true, inputPrimed: Boolean(sent.inputPrimed) };

    tx = transitionTransaction(tx, 'VERIFYING_DELIVERY');
    meeting = { ...meeting, activeTransaction: tx };
    meeting = updateParticipant(meeting, participant.id, { turnState: 'VERIFYING' });
    meeting = withActivity(meeting, 'Send action executed; waiting for delivery receipt', { stage: 'VERIFYING_DELIVERY', participantId: participant.id, transactionId: tx.transactionId });
    meeting = await saveMeeting(meeting);
    return deliveryWithRetries(meeting.id);
  } catch (error) {
    return enterNeedsAttention(await getMeeting(), `${participant.label}: ${error.message || String(error)}`, tx.stage);
  }
}

function loopGuardActive(meeting) {
  if (meeting.interactionMode === 'autonomous') return meeting.settings?.loopGuardEnabled !== false;
  return meeting.settings?.loopGuardInteractive === true;
}

function loopGuardSettings(meeting) {
  return {
    enabled: loopGuardActive(meeting),
    maxHops: meeting.settings?.loopGuardMaxHops,
    maxSameSpeaker: meeting.settings?.loopGuardMaxSameSpeaker,
    maxSameRoute: meeting.settings?.loopGuardMaxSameRoute,
  };
}

function runBudgetSettings(meeting) {
  return {
    maxDurationMs: meeting.settings?.maxDurationMs,
    maxTurns: meeting.settings?.maxTurns,
    maxHops: meeting.settings?.maxHops ?? meeting.settings?.loopGuardMaxHops,
  };
}

function runHistoryEntry(run, artifact) {
  return {
    id: run.id,
    roomId: run.roomId,
    playbookId: run.playbookId,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    stopReason: run.stopReason,
    artifact,
  };
}

function finishMeetingRun(meeting, reason = 'completed', status = 'FINISHED', now = Date.now()) {
  if (!meeting.activeRun) return setMeetingStatus(meeting, status);
  const run = finishRun(meeting.activeRun, reason, now);
  const artifact = buildRunArtifact({ title: meeting.title, meeting, run, playbook: run.playbook, now });
  const history = [...(meeting.runHistory || []).filter((item) => item.id !== run.id), runHistoryEntry(run, artifact)].slice(-20);
  return setMeetingStatus({ ...meeting, activeRun: { ...run, artifact }, artifact, runHistory: history }, status);
}

function budgetStop(meeting, now = Date.now()) {
  if (!meeting.activeRun) return { meeting, blocked: false, reason: '' };
  const decision = runBudgetDecision(meeting.activeRun, now);
  if (!decision.blocked) return { meeting, blocked: false, reason: '' };
  const next = finishMeetingRun(meeting, decision.state.stopReason || decision.reason, 'PAUSED', now);
  return { meeting: next, blocked: true, reason: decision.reason };
}

async function scheduleSpeaker(meeting, latestText, currentParticipantId = null, delayMs = null) {
  if (meeting.status !== 'LIVE' || meeting.activeTransaction) return null;
  const budget = budgetStop(meeting);
  if (budget.blocked) {
    let stopped = withActivity(budget.meeting, budget.reason, { level: 'WARN', stage: 'RUN_BUDGET' });
    await backgroundTabController.releaseAll().catch(() => {});
    await saveMeeting(stopped);
    return null;
  }
  const target = selectNextSpeaker(meeting, latestText, currentParticipantId);
  if (!target) return null;
  let next = meeting;
  if (currentParticipantId && loopGuardActive(meeting)) {
    const state = recordLoopGuardHop(meeting.loopGuard, { speakerId: currentParticipantId, targetId: target.id });
    const decision = loopGuardDecision(state, loopGuardSettings(meeting));
    next = { ...meeting, loopGuard: decision.state };
    if (decision.blocked) {
      next = setMeetingStatus({ ...next, activeTransaction: null, nextSpeakerParticipantId: null }, 'PAUSED');
      next = withActivity(next, decision.reason, { level: 'WARN', stage: 'LOOP_GUARD', participantId: target.id });
      await backgroundTabController.releaseAll().catch(() => {});
      await saveMeeting(next);
      return null;
    }
  }
  if (currentParticipantId && next.activeRun) {
    const mention = resolveMentionDirective(latestText, meeting.participants || [], currentParticipantId);
    const handoffReason = mention.target ? `Explicit @${mention.alias} handoff.` : 'Round-robin handoff.';
    next = { ...next, activeRun: recordRunHandoff(next.activeRun, { fromParticipantId: currentParticipantId, toParticipantId: target.id, reason: handoffReason }) };
    const runDecision = runBudgetDecision(next.activeRun);
    if (runDecision.blocked) {
      next = finishMeetingRun(next, runDecision.state.stopReason || runDecision.reason, 'PAUSED');
      next = withActivity(next, runDecision.reason, { level: 'WARN', stage: 'RUN_BUDGET', participantId: target.id });
      await backgroundTabController.releaseAll().catch(() => {});
      await saveMeeting(next);
      return null;
    }
  }
  if (next !== meeting) await saveMeeting(next);
  const delay = delayMs == null ? Math.max(0, Number(meeting.settings.minDelayMs) || 0) : delayMs;
  setTimeout(() => enqueue(() => executeTurn(target.id)).catch(() => {}), delay);
  return target;
}

async function startMeeting(seedText = '', requestedMode = null) {
  let meeting = await getMeeting();
  if (meeting.status === 'LIVE') return meeting;
  if (meeting.status === 'READY' && meeting.activeTransaction) {
    meeting = { ...meeting, activeTransaction: null, nextSpeakerParticipantId: null };
  }
  const interactionMode = normalizeInteractionMode(requestedMode ?? meeting.interactionMode);
  meeting = { ...meeting, interactionMode };
  const connected = meeting.participants.filter((p) => Number.isInteger(p.tabId));
  if (connected.length < 2) throw new Error('Connect at least two AI participants before starting.');
  for (const p of connected) {
    try { meeting = await attachParticipant(meeting, p.id); }
    catch (error) { meeting = updateParticipant(meeting, p.id, { connectionState: 'ERROR', turnState: 'ERROR' }); }
  }
  const ready = meeting.participants.filter((p) => Number.isInteger(p.tabId) && p.connectionState === 'READY');
  if (ready.length < 2) {
    meeting = setMeetingStatus(meeting, 'READY');
    meeting = withActivity(meeting, `Only ${ready.length} participant(s) could reconnect. At least two are required.`, { level: 'WARN' });
    await saveMeeting(meeting);
    throw new Error('At least two AI participants must reconnect successfully before starting.');
  }
  const normalizedSeed = normalizeText(seedText);
  if (normalizedSeed && isRelayEnvelope(normalizedSeed)) throw new Error('Lee Relay internal meeting envelopes cannot be used as a human starting topic.');
  if (interactionMode === 'autonomous') {
    const topicText = autonomousSeed({ meeting, seedText: normalizedSeed });
    if (!topicText) throw new Error('Write a starting topic before starting Full Auto.');
    meeting = { ...meeting, topicText };
  } else {
    const latestUserText = normalizeText([...meeting.transcript].reverse().find((entry) => entry.speakerType === 'USER' && normalizeText(entry.text))?.text || '');
    if (normalizedSeed && normalizedSeed !== latestUserText) {
      meeting = appendTranscript(meeting, { speakerType: 'USER', text: normalizedSeed, turnNumber: meeting.currentTurn });
    }
    if (!meeting.transcript.some((e) => normalizeText(e.text))) throw new Error('Write a starting topic before starting the meeting.');
  }
  meeting = {
    ...meeting,
    session: startSession(meeting.session),
    loopGuard: createLoopGuardState(meeting.loopGuard),
    playbookId: meeting.playbookId || meeting.session?.templateId || 'freeform',
    activeRun: createRun({
      roomId: meeting.id,
      playbook: getPlaybook(meeting.playbookId || meeting.session?.templateId || 'freeform'),
      budget: runBudgetSettings(meeting),
    }),
    artifact: null,
  };
  meeting = setMeetingStatus(meeting, 'LIVE');
  meeting = withActivity(meeting, interactionMode === 'autonomous' ? 'Full Auto meeting started.' : 'Meeting started.');
  meeting = await saveMeeting(meeting);
  const latest = latestTranscriptText(meeting);
  scheduleSpeaker(meeting, latest, null, 0).catch(() => {});
  return meeting;
}

async function completeResponse(message, senderTabId) {
  let meeting = await getMeeting();
  const tx = meeting.activeTransaction;
  if (!tx || !canAcceptEvent(tx, { ...message, tabId: senderTabId })) return meeting;
  if (!normalizeText(message.text) || !message.signature) return meeting;
  const cleanResponseText = sanitizeRelayResponse(message.text, tx.promptText);
  if (!cleanResponseText) return meeting;
  const participant = participantById(meeting, tx.participantId);
  if (!participant) return meeting;
  if (participant.lastKnownAssistantSignature === message.signature && !message.assistantNodeAdvanced) {
    return enterNeedsAttention(meeting, `${participant.label} returned a duplicate response.`, 'VERIFYING_RESPONSE');
  }

  let verify = null;
  try {
    verify = await sendToParticipant(participant, { type: 'GET_TRANSACTION_STATUS', meetingId: meeting.id, transactionId: tx.transactionId, participantId: participant.id });
  } catch { /* event itself remains usable if page changed immediately after sending it */ }
  if (verify?.ok && (!(verify.deliveryConfirmed || verify.matchingUserMessage) || verify.assistantSignature !== message.signature || !verify.changed)) {
    return enterNeedsAttention(meeting, `${participant.label} response could not be correlated to the current turn.`, 'VERIFYING_RESPONSE');
  }

  let nextTx = tx;
  if (nextTx.stage === 'WAITING_FOR_GENERATION') nextTx = transitionTransaction(nextTx, 'RECEIVING');
  if (nextTx.stage === 'RECEIVING' || nextTx.stage === 'DELIVERED' || nextTx.stage === 'WAITING_FOR_GENERATION') nextTx = transitionTransaction(nextTx, 'VERIFYING_RESPONSE');
  nextTx = transitionTransaction(nextTx, 'COMPLETE', { responseText: cleanResponseText, responseSignature: message.signature, error: '' });

  meeting = { ...meeting, activeTransaction: nextTx };
  meeting = updateParticipant(meeting, participant.id, { turnState: 'SPEAKING', lastKnownAssistantSignature: message.signature, lastSeenAt: Date.now() });
  meeting = appendTranscript(meeting, {
    speakerType: 'AI', participantId: participant.id, provider: participant.provider, text: cleanResponseText, turnNumber: tx.turnNumber,
    deliveryStatus: 'CONFIRMED', responseStatus: 'CONFIRMED', transactionId: tx.transactionId,
  });
  meeting = { ...meeting, currentTurn: meeting.currentTurn + 1, activeTransaction: null };
  const previousSession = meeting.session;
  const nextSession = recordSessionTurn(previousSession);
  const currentPhase = currentSessionPhase(previousSession);
  const nextRun = meeting.activeRun
    ? recordRunTurn(meeting.activeRun, {
      participantId: participant.id,
      text: cleanResponseText,
      data: { phaseId: meeting.activeRun.phaseId, phaseName: currentPhase?.name || '', speaker: participant.label, turnNumber: tx.turnNumber },
    })
    : null;
  meeting = { ...meeting, session: nextSession, activeRun: nextRun };
  const runDecision = nextRun ? runBudgetDecision(nextRun) : { blocked: false };
  if (runDecision.blocked) {
    meeting = finishMeetingRun(meeting, runDecision.state.stopReason || runDecision.reason, 'PAUSED');
    meeting = withActivity(meeting, runDecision.reason, { level: 'WARN', stage: 'RUN_BUDGET', participantId: participant.id, transactionId: tx.transactionId });
    await backgroundTabController.releaseAll().catch(() => {});
    return saveMeeting(meeting);
  }
  if (nextSession.status === 'COMPLETE') {
    meeting = withActivity(meeting, `Session complete ??${nextSession.templateId}.`, { stage: 'SESSION_COMPLETE' });
    meeting = finishMeetingRun(meeting, 'session-complete', 'FINISHED');
    return saveMeeting(meeting);
  }
  if (nextRun?.status === 'FINISHED') {
    meeting = withActivity(meeting, `Run complete ??${nextRun.playbookId}.`, { stage: 'RUN_COMPLETE' });
    meeting = finishMeetingRun(meeting, nextRun.stopReason || 'playbook-complete', 'FINISHED');
    return saveMeeting(meeting);
  }
  if (nextSession.phaseIndex !== previousSession.phaseIndex) {
    meeting = withActivity(meeting, `Session phase advanced ??${currentSessionPhase(nextSession).name}.`, { stage: 'SESSION_PHASE' });
  }

  meeting = withActivity(meeting, `Turn ${tx.turnNumber} complete ← ${participant.label}`, { stage: 'COMPLETE', participantId: participant.id, transactionId: tx.transactionId });

  if (meeting.settings.maxTurns > 0 && meeting.currentTurn >= meeting.settings.maxTurns) {
    meeting = finishMeetingRun(meeting, 'max-turns', 'FINISHED');
    meeting = withActivity(meeting, 'Meeting finished at the configured turn limit.');
    return saveMeeting(meeting);
  }
  meeting = await saveMeeting(meeting);
  maybeCaptureScreenshot(meeting, participant, tx.turnNumber).catch(() => {});
  if (meeting.status === 'LIVE') await scheduleSpeaker(meeting, cleanResponseText, participant.id);
  return meeting;
}

async function maybeCaptureScreenshot(meeting, participant, turnNumber) {
  if (!meeting.settings.captureScreenshots || !participant?.tabId) return;
  try {
    const granted = await chrome.permissions.contains({ permissions: ['debugger'] }).catch(() => false);
    if (!granted) {
      const tab = await chrome.tabs.get(participant.tabId).catch(() => null);
      if (!tab?.active) throw new Error('Exact screenshot permission not granted; background tab capture skipped without stealing focus.');
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const filename = `lee-relay-meetings/${meeting.id}/turn-${String(turnNumber).padStart(3,'0')}_${participant.provider}_${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
      await chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: 'uniquify' });
      return;
    }
    const target = { tabId: participant.tabId };
    let attached = false;
    try {
      const rectResponse = await sendToParticipant(participant, { type: 'GET_LATEST_RESPONSE_RECT' }).catch(() => null);
      const rect = rectResponse?.rect;
      await chrome.debugger.attach(target, '1.3'); attached = true;
      const shot = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, ...(rect ? { clip: rect } : {}) });
      const filename = `lee-relay-meetings/${meeting.id}/turn-${String(turnNumber).padStart(3,'0')}_${participant.provider}_${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
      await chrome.downloads.download({ url: `data:image/png;base64,${shot.data}`, filename, saveAs: false, conflictAction: 'uniquify' });
    } finally { if (attached) await chrome.debugger.detach(target).catch(() => {}); }
  } catch (error) {
    let latest = await getMeeting();
    latest = withActivity(latest, `Screenshot warning: ${error.message || String(error)}`, { level: 'WARN' });
    await saveMeeting(latest);
  }
}

async function performAutomaticRecovery(meeting, participant, tx, action) {
  let next = updateParticipant(meeting, participant.id, {
    connectionState: 'RECONNECTING',
    lastRecoveryError: '',
  });
  next = withActivity(next, `Automatic recovery ${action.action} for ${participant.label} (${action.attempt}/${action.maxAttempts}).`, { level: 'WARN', stage: 'AUTO_RECOVERY', participantId: participant.id, transactionId: tx.transactionId });
  next = await saveMeeting(next);

  if (action.action === 'REFRESH_BACKGROUND' || action.action === 'RECONNECT_CONTENT') {
    const background = await backgroundTabController.recover(participant);
    if (!background?.ok && !background?.skipped) throw new Error(background?.error || 'Background tab recovery failed.');
  }

  next = await attachParticipant(next, participant.id);
  const refreshedParticipant = participantById(next, participant.id);
  await ensurePreparedOnPage(next, refreshedParticipant, tx, { captureBaseline: false });
  await armResponse(next, refreshedParticipant, tx);
  next = updateParticipant(next, participant.id, {
    connectionState: 'READY',
    turnState: 'THINKING',
    lastSeenAt: Date.now(),
    lastRecoveryError: '',
  });
  next = withActivity(next, `Automatic recovery ${action.action} succeeded for ${participant.label}.`, { stage: 'AUTO_RECOVERY', participantId: participant.id, transactionId: tx.transactionId });
  return saveMeeting(next);
}

async function watchdogRecover() {
  let meeting = await getMeeting();
  const tx = meeting.activeTransaction;
  if (!tx || !['LIVE','PAUSED','NEEDS_ATTENTION'].includes(meeting.status)) return meeting;
  const participant = participantById(meeting, tx.participantId);
  if (!participant || !Number.isInteger(participant.tabId)) return enterNeedsAttention(meeting, 'Active participant tab is disconnected.', tx.stage);

  if (['SENDING','VERIFYING_DELIVERY','RETRYING','PREPARING'].includes(tx.stage)) {
    if (meeting.status === 'NEEDS_ATTENTION') return meeting;
    return deliveryWithRetries(meeting.id);
  }

  if (['DELIVERED','WAITING_FOR_GENERATION','RECEIVING','VERIFYING_RESPONSE'].includes(tx.stage)) {
    let status = null;
    try {
      await attachParticipant(meeting, participant.id);
      status = await sendToParticipant(participant, { type: 'GET_TRANSACTION_STATUS', meetingId: meeting.id, transactionId: tx.transactionId, participantId: participant.id });
    } catch {
      try {
        await ensurePreparedOnPage(meeting, participant, tx, { captureBaseline: false });
        await armResponse(meeting, participant, tx);
      } catch (error) {
        if (transactionTimedOut(tx)) return enterNeedsAttention(meeting, `${participant.label} could not reconnect: ${error.message || String(error)}`, tx.stage);
        return meeting;
      }
    }
    const quietMs = Math.max(500, Number(status?.quietMs) || 2000);
    const responseStable = Boolean(status?.changed && Number(status.stableMs) >= quietMs);
    if (status?.ok && (status.deliveryConfirmed || status.matchingUserMessage) && responseStable && status.assistantSignature && status.assistantText && (!status.generating || status.stableMs >= 90000)) {
      return completeResponse({
        meetingId: meeting.id,
        transactionId: tx.transactionId,
        participantId: participant.id,
        text: status.assistantText,
        signature: status.assistantSignature,
        assistantNodeAdvanced: Boolean(status.assistantNodeAdvanced),
        assistantCount: Number(status.assistantCount) || 0,
      }, participant.tabId);
    }
    if (status?.ok && !transactionTimedOut(tx)) {
      // Keep checking the current provider tab while its response settles. This
      // is independent of which browser tab the user is viewing.
      const remainingQuiet = status.changed
        ? Math.max(150, quietMs - Number(status.stableMs || 0) + 100)
        : ACTIVE_TURN_CHECK_DELAY_MS;
      scheduleActiveTurnCheck(Math.min(ACTIVE_TURN_CHECK_DELAY_MS, remainingQuiet));
    }
    if (transactionTimedOut(tx)) {
      const recoveries = Number(tx.recoveryCount) || 0;
      const action = nextRecoveryAction({ provider: participant.provider, recoveryCount: recoveries });
      if (action.action === 'ESCALATE') return enterNeedsAttention(meeting, `${participant.label} response timed out after ${action.maxAttempts} automatic recovery attempts.`, tx.stage);
      const patched = {
        ...tx,
        recoveryCount: recoveries + 1,
        lastRecoveryAction: action.action,
        lastProgressAt: Date.now(),
        updatedAt: Date.now(),
      };
      meeting = { ...meeting, activeTransaction: patched };
      try {
        return await performAutomaticRecovery(meeting, participant, patched, action);
      } catch (error) {
        const latest = await getMeeting();
        const failed = {
          ...latest,
          activeTransaction: {
            ...(latest.activeTransaction || patched),
            lastRecoveryError: error.message || String(error),
            lastProgressAt: Date.now(),
            updatedAt: Date.now(),
          },
        };
        const marked = updateParticipant(failed, participant.id, {
          connectionState: 'RECONNECTING',
          lastRecoveryError: error.message || String(error),
        });
        const logged = withActivity(marked, `Automatic recovery ${action.action} failed for ${participant.label}: ${error.message || String(error)}`, { level: 'WARN', stage: 'AUTO_RECOVERY', participantId: participant.id, transactionId: tx.transactionId });
        return saveMeeting(logged);
      }
    }
  }
  return meeting;
}

function roomSummary(room) {
  return {
    id: room.id,
    title: room.title,
    purpose: room.purpose,
    playbookId: room.playbookId,
    updatedAt: room.updatedAt,
    status: room.meeting?.status || 'READY',
    turns: Number(room.meeting?.currentTurn) || 0,
    runCount: Array.isArray(room.runHistory) ? room.runHistory.length : 0,
  };
}

async function listRooms() {
  const meeting = await getMeeting();
  const workspace = await readWorkspace(meeting);
  return {
    activeRoomId: workspace.activeRoomId,
    rooms: workspace.rooms.map(roomSummary),
  };
}

async function selectSavedRoom(roomId) {
  let current = await getMeeting();
  const workspace = await readWorkspace(current);
  if (!workspace.rooms.some((room) => room.id === roomId)) throw new Error('Room not found.');
  if (workspace.activeRoomId === roomId) return { meeting: current, workspace };
  if (current.status === 'LIVE' || current.activeTransaction) {
    await backgroundTabController.releaseAll().catch(() => {});
    current = { ...current, activeTransaction: null, nextSpeakerParticipantId: null };
    if (current.activeRun?.status === 'RUNNING') current = { ...current, activeRun: pauseRun(current.activeRun, 'room-switched') };
    current = setMeetingStatus(current, 'PAUSED');
    current = withActivity(current, 'Room switched; previous Run paused.', { level: 'INFO', stage: 'ROOM_SWITCH' });
    await saveMeeting(current, { broadcast: false });
  }
  const nextWorkspace = selectRoom(await readWorkspace(current), roomId);
  const room = getActiveRoom(nextWorkspace);
  const stored = room.meeting || createMeeting({ title: room.title });
  const loaded = normalizeMeetingCoordination({
    ...stored,
    activeTransaction: null,
    participants: (stored.participants || []).map((participant) => ({ ...participant, tabId: null, url: '', connectionState: 'DISCONNECTED', turnState: 'WAITING' })),
    status: stored.status === 'FINISHED' ? 'FINISHED' : (stored.status === 'PAUSED' ? 'PAUSED' : 'READY'),
  });
  await chrome.storage.local.set({ [WORKSPACE_KEY]: durableWorkspaceState(nextWorkspace) });
  await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: loaded, [ACTIVE_RUN_KEY]: loaded.activeRun || null });
  return { meeting: await saveMeeting(loaded), workspace: await readWorkspace(loaded) };
}

async function updateActiveRoom(patch = {}) {
  const meeting = await getMeeting();
  const workspace = await readWorkspace(meeting);
  const active = getActiveRoom(workspace);
  const nextWorkspace = updateRoom(workspace, active.id, {
    ...patch,
    meeting: Object.hasOwn(patch, 'title') ? { ...meeting, title: normalizeText(patch.title || '') || meeting.title } : meeting,
  });
  await chrome.storage.local.set({ [WORKSPACE_KEY]: durableWorkspaceState(nextWorkspace) });
  const nextMeeting = Object.hasOwn(patch, 'title')
    ? { ...meeting, title: normalizeText(patch.title || '') || 'New AI Meeting' }
    : meeting;
  return saveMeeting(nextMeeting);
}

async function updatePlaybook(templateId) {
  let meeting = await getMeeting();
  if (!canChangeInteractionMode(meeting)) throw new Error('Pause the meeting and finish the active turn before changing the Playbook.');
  const playbook = getPlaybook(templateId);
  meeting = {
    ...meeting,
    playbookId: playbook.id,
    session: normalizeSession({ templateId: playbook.id, status: 'IDLE' }),
    artifact: null,
  };
  meeting = withActivity(meeting, `Playbook selected · ${playbook.name}.`);
  return saveMeeting(meeting);
}

async function handleCommand(message, sender) {
  switch (message.type) {
    case 'GET_WORKSPACE_STATE': {
      const meeting = await getMeeting();
      return { ok: true, meeting: publicMeetingState(meeting), workspace: publicWorkspaceState(await readWorkspace(meeting)) };
    }
    case 'LIST_ROOMS': return { ok: true, ...(await listRooms()) };
    case 'GET_PLAYBOOKS': return { ok: true, playbooks: getPlaybooks() };
    case 'CREATE_ROOM': {
      const created = await newMeeting(message.options || {});
      return { ok: true, meeting: created, workspace: publicWorkspaceState(await readWorkspace(created)) };
    }
    case 'SELECT_ROOM': {
      const selected = await selectSavedRoom(message.roomId);
      return { ok: true, meeting: publicMeetingState(selected.meeting), workspace: publicWorkspaceState(selected.workspace) };
    }
    case 'UPDATE_ROOM': return { ok: true, meeting: await updateActiveRoom(message.patch || {}) };
    case 'DELETE_ROOM': {
      const meeting = await getMeeting();
      const workspace = await readWorkspace(meeting);
      if (workspace.rooms.length <= 1) throw new Error('At least one Room must remain.');
      const nextWorkspace = removeRoom(workspace, message.roomId);
      await chrome.storage.local.set({ [WORKSPACE_KEY]: durableWorkspaceState(nextWorkspace) });
      if (workspace.activeRoomId === message.roomId) {
        const selected = await selectSavedRoom(nextWorkspace.activeRoomId);
        return { ok: true, meeting: publicMeetingState(selected.meeting), workspace: publicWorkspaceState(selected.workspace) };
      }
      return { ok: true, meeting: publicMeetingState(meeting), workspace: publicWorkspaceState(nextWorkspace) };
    }
    case 'GET_MEETING_STATE': {
      const meeting = await getMeeting();
      return { ok: true, meeting: publicMeetingState(meeting), workspace: publicWorkspaceState(await readWorkspace(meeting)) };
    }
    case 'LIST_SUPPORTED_TABS': {
      const tabState = await listTabStatus();
      return { ok: true, tabs: tabState.tabs, status: tabState.status };
    }
    case 'GET_TAB_STATUS': {
      const tabState = await listTabStatus();
      return { ok: true, tabs: tabState.tabs, status: tabState.status };
    }
    case 'GET_SCHEDULE': {
      const schedule = await readSchedule();
      return { ok: true, schedule, nextRun: nextScheduledRun(schedule, Date.now()) };
    }
    case 'UPDATE_SCHEDULE': {
      const schedule = await saveSchedule(message.schedule || {});
      return { ok: true, schedule, nextRun: nextScheduledRun(schedule, Date.now()) };
    }
    case 'RUN_SCHEDULE_NOW': {
      const result = await runScheduledSlot(message.slotId || 'morning', { force: true });
      return { ...result, ok: true };
    }
    case 'CHECK_ACTIVE_TURN': return { ok: true, meeting: publicMeetingState(await watchdogRecover()) };
    case 'NEW_MEETING': {
      const created = await newMeeting(message.options || {});
      return { ok: true, meeting: created, workspace: publicWorkspaceState(await readWorkspace(created)) };
    }
    case 'ADD_PARTICIPANT': {
      let m = await getMeeting();
      m = addParticipant(m);
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'REMOVE_PARTICIPANT': {
      let m = await getMeeting();
      if (m.activeTransaction?.participantId === message.participantId) throw new Error('Skip or end the active turn before removing this participant.');
      const removed = participantById(m, message.participantId);
      await backgroundTabController.release(removed).catch(() => {});
      m = removeParticipant(m, message.participantId);
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'BIND_PARTICIPANT': {
      let m = await getMeeting();
      const tab = await chrome.tabs.get(Number(message.tabId)).catch(() => null);
      if (!tab) throw new Error('Selected tab is no longer open.');
      const provider = classifyUrl(tab.url || '');
      if (!provider) throw new Error('Selected tab is not a supported AI site.');
      m = bindParticipant(m, message.participantId, { tabId: tab.id, provider, label: providerLabelFor(provider), url: tab.url || '', connectionState: 'READY' });
      m = await attachParticipant(m, message.participantId).catch(() => updateParticipant(m, message.participantId, { connectionState: 'ERROR' }));
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'START_MEETING': return { ok: true, meeting: await startMeeting(message.seedText || '', message.mode || null) };
    case 'UPDATE_PLAYBOOK': return { ok: true, meeting: await updatePlaybook(message.playbookId || message.templateId || 'freeform') };
    case 'SET_INTERACTION_MODE': {
      let m = await getMeeting();
      if (!canChangeInteractionMode(m)) throw new Error('Pause the meeting and finish the active turn before changing modes.');
      const mode = normalizeInteractionMode(message.mode);
      const topicText = mode === 'autonomous'
        ? (normalizeTopicText(m.topicText) || normalizeText([...m.transcript].reverse().find((entry) => entry.speakerType === 'USER' && normalizeText(entry.text))?.text || ''))
        : m.topicText;
      m = {
        ...m,
        interactionMode: mode,
        topicText,
        ...(m.status === 'READY' ? { activeTransaction: null, nextSpeakerParticipantId: null } : {}),
      };
      m = withActivity(m, mode === 'autonomous' ? 'Full Auto mode selected.' : 'Interactive mode selected.');
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'PAUSE_MEETING': {
      let m = await getMeeting();
      if (m.activeRun?.status === 'RUNNING') m = { ...m, activeRun: pauseRun(m.activeRun, 'paused-by-user') };
      m = setMeetingStatus(m, 'PAUSED');
      await backgroundTabController.releaseAll().catch(() => {});
      m = withActivity(m, 'Meeting paused by user.');
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'RESUME_MEETING': {
      let m = await getMeeting();
      if (m.activeRun?.status === 'FINISHED' && ['max-duration', 'max-turns', 'max-hops'].includes(m.activeRun.stopReason)) {
        throw new Error('This Run reached its safety budget. Start a new Run or increase the Run Budget first.');
      }
      const resumedSession = m.session?.status === 'IDLE'
        ? startSession(m.session)
        : { ...normalizeSession(m.session), status: 'RUNNING' };
      const resumedRun = m.activeRun?.status === 'PAUSED'
        ? normalizeRun({ ...m.activeRun, status: 'RUNNING', endedAt: null, stopReason: '' })
        : (m.activeRun || createRun({ roomId: m.id, playbook: getPlaybook(m.playbookId || m.session?.templateId), budget: runBudgetSettings(m) }));
      m = {
        ...m,
        session: resumedSession,
        loopGuard: createLoopGuardState(m.loopGuard),
        activeRun: resumedRun,
      };
      m = setMeetingStatus(m, 'LIVE');
      m = withActivity(m, 'Meeting resumed.');
      m = await saveMeeting(m);
      if (m.activeTransaction) setTimeout(() => enqueue(() => watchdogRecover()), 0);
      else await scheduleSpeaker(m, latestTranscriptText(m), null, 0);
      return { ok: true, meeting: await getMeeting() };
    }
    case 'END_MEETING': {
      let m = await getMeeting();
      await backgroundTabController.releaseAll().catch(() => {});
      m = finishMeetingRun({ ...m, activeTransaction: null, nextSpeakerParticipantId: null }, 'ended-by-user', 'FINISHED');
      m = withActivity(m, 'Meeting ended by user.');
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'USER_MESSAGE': {
      let m = await getMeeting();
      const text = normalizeText(message.text || '');
      if (!text) throw new Error('Message is empty.');
      if (!canAcceptUserMessage(m)) throw new Error('Full Auto is observing only. Pause and join the conversation to send a user message.');
      if (isRelayEnvelope(text)) throw new Error('Lee Relay internal meeting envelopes cannot be added as human messages.');
      if (m.interactionMode === 'autonomous') {
        m = { ...m, topicText: text };
        m = withActivity(m, 'Full Auto topic updated.');
      } else {
        m = appendTranscript(m, { speakerType: 'USER', text, turnNumber: m.currentTurn });
        m = withActivity(m, 'User added a message to the room.');
      }
      m = await saveMeeting(m);
      if (m.status === 'LIVE' && !m.activeTransaction) await scheduleSpeaker(m, text, null, 0);
      return { ok: true, meeting: m };
    }
    case 'UPDATE_MEETING_TITLE': {
      let m = await getMeeting();
      m = { ...m, title: normalizeText(message.title || '') || 'New AI Meeting' };
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'UPDATE_MEETING_SETTINGS': {
      let m = await getMeeting();
      const patch = message.settings || {};
      const guardNumber = (key, fallback) => {
        if (!Object.hasOwn(patch, key)) return fallback;
        const value = Number(patch[key]);
        return Number.isFinite(value) ? Math.min(100000, Math.max(0, Math.floor(value))) : fallback;
      };
      m = { ...m, settings: {
        ...m.settings,
        ...(Object.hasOwn(patch,'maxTurns') ? { maxTurns: Math.max(0, Number(patch.maxTurns) || 0) } : {}),
        ...(Object.hasOwn(patch,'minDelayMs') ? { minDelayMs: Math.max(0, Number(patch.minDelayMs) || 0) } : {}),
        ...(Object.hasOwn(patch,'smartRouting') ? { smartRouting: Boolean(patch.smartRouting) } : {}),
        ...(Object.hasOwn(patch,'captureScreenshots') ? { captureScreenshots: Boolean(patch.captureScreenshots) } : {}),
        ...(Object.hasOwn(patch,'retryLimit') ? { retryLimit: Math.min(5, Math.max(0, Number(patch.retryLimit) || 0)) } : {}),
        ...(Object.hasOwn(patch,'responseTimeoutMs') ? { responseTimeoutMs: Math.max(30000, Number(patch.responseTimeoutMs) || 120000) } : {}),
        ...(Object.hasOwn(patch,'maxDurationMs') ? { maxDurationMs: guardNumber('maxDurationMs', m.settings.maxDurationMs) } : {}),
        ...(Object.hasOwn(patch,'maxHops') ? { maxHops: guardNumber('maxHops', m.settings.maxHops) } : {}),
        ...(Object.hasOwn(patch,'loopGuardEnabled') ? { loopGuardEnabled: Boolean(patch.loopGuardEnabled) } : {}),
        ...(Object.hasOwn(patch,'loopGuardInteractive') ? { loopGuardInteractive: Boolean(patch.loopGuardInteractive) } : {}),
         ...(Object.hasOwn(patch,'loopGuardMaxHops') ? { loopGuardMaxHops: guardNumber('loopGuardMaxHops', m.settings.loopGuardMaxHops) } : {}),
         ...(Object.hasOwn(patch,'loopGuardMaxSameSpeaker') ? { loopGuardMaxSameSpeaker: guardNumber('loopGuardMaxSameSpeaker', m.settings.loopGuardMaxSameSpeaker) } : {}),
         ...(Object.hasOwn(patch,'loopGuardMaxSameRoute') ? { loopGuardMaxSameRoute: guardNumber('loopGuardMaxSameRoute', m.settings.loopGuardMaxSameRoute) } : {}),
         ...(Object.hasOwn(patch,'language') ? { language: normalizeLanguage(patch.language) } : {}),
       } };
      m = { ...m, loopGuard: {
        ...m.loopGuard,
        enabled: m.settings.loopGuardEnabled !== false,
        maxHops: m.settings.loopGuardMaxHops,
        maxSameSpeaker: m.settings.loopGuardMaxSameSpeaker,
        maxSameRoute: m.settings.loopGuardMaxSameRoute,
      } };
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'SET_LANGUAGE': {
      let m = await getMeeting();
      const language = normalizeLanguage(message.language);
      m = { ...m, settings: { ...m.settings, language } };
      m = withActivity(m, `Language changed · ${language}.`);
      return { ok: true, language, meeting: await saveMeeting(m) };
    }
    case 'UPDATE_PARTICIPANT_COORDINATION': {
      let m = await getMeeting();
      if (!canChangeInteractionMode(m)) throw new Error('Pause the meeting and finish the active turn before changing participant roles.');
      const participant = participantById(m, message.participantId);
      if (!participant) throw new Error('Participant not found.');
      const coordination = normalizeParticipantCoordination({ role: message.role, rolePrompt: message.rolePrompt });
      m = updateParticipant(m, participant.id, { role: coordination.role, rolePrompt: coordination.rolePrompt });
      m = withActivity(m, `${participant.label} role updated.`);
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'UPDATE_SESSION_TEMPLATE': {
      let m = await getMeeting();
      if (!canChangeInteractionMode(m)) throw new Error('Pause the meeting and finish the active turn before changing the session.');
      m = { ...m, session: normalizeSession({ templateId: message.templateId, status: 'IDLE' }) };
      m = { ...m, playbookId: m.session.templateId, artifact: null };
      m = withActivity(m, `Session template selected ??${m.session.templateId}.`);
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'UPDATE_LOOP_GUARD': {
      let m = await getMeeting();
      if (!canChangeInteractionMode(m)) throw new Error('Pause the meeting and finish the active turn before changing Loop Guard.');
      const patch = message.settings || {};
      const guardNumber = (key, fallback) => {
        const value = Number(patch[key]);
        return Number.isFinite(value) ? Math.min(100000, Math.max(0, Math.floor(value))) : fallback;
      };
      const settings = {
        ...m.settings,
        ...(Object.hasOwn(patch, 'loopGuardEnabled') ? { loopGuardEnabled: Boolean(patch.loopGuardEnabled) } : {}),
        ...(Object.hasOwn(patch, 'loopGuardInteractive') ? { loopGuardInteractive: Boolean(patch.loopGuardInteractive) } : {}),
        ...(Object.hasOwn(patch, 'loopGuardMaxHops') ? { loopGuardMaxHops: guardNumber('loopGuardMaxHops', m.settings.loopGuardMaxHops) } : {}),
        ...(Object.hasOwn(patch, 'loopGuardMaxSameSpeaker') ? { loopGuardMaxSameSpeaker: guardNumber('loopGuardMaxSameSpeaker', m.settings.loopGuardMaxSameSpeaker) } : {}),
        ...(Object.hasOwn(patch, 'loopGuardMaxSameRoute') ? { loopGuardMaxSameRoute: guardNumber('loopGuardMaxSameRoute', m.settings.loopGuardMaxSameRoute) } : {}),
      };
      m = { ...m, settings, loopGuard: {
        ...m.loopGuard,
        enabled: settings.loopGuardEnabled !== false,
        maxHops: settings.loopGuardMaxHops,
        maxSameSpeaker: settings.loopGuardMaxSameSpeaker,
        maxSameRoute: settings.loopGuardMaxSameRoute,
      } };
      m = withActivity(m, 'Loop Guard settings updated.');
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'RETRY_TRANSACTION': {
      let m = await getMeeting();
      const tx = m.activeTransaction;
      if (!tx) throw new Error('There is no transaction to retry.');
      const participantId = tx.participantId;
      // Automatic recovery is at-most-once. A fresh send is allowed only when
      // the human explicitly presses Retry, and it gets a fresh transaction id
      // so stale provider events cannot complete the new attempt.
      m = setMeetingStatus({ ...m, activeTransaction: null }, 'LIVE');
      m = withActivity(m, 'Manual retry requested; starting a fresh transaction.', { stage: 'RETRYING', participantId, transactionId: tx.transactionId });
      m = await saveMeeting(m);
      setTimeout(() => enqueue(() => executeTurn(participantId)), 0);
      return { ok: true, meeting: m };
    }
    case 'SKIP_PARTICIPANT': {
      let m = await getMeeting();
      const tx = m.activeTransaction;
      if (!tx) throw new Error('There is no active participant to skip.');
      const currentId = tx.participantId;
      m = withActivity(m, `Skipped ${participantById(m, currentId)?.label || 'participant'}.`, { level: 'WARN', stage: 'SKIPPED', participantId: currentId, transactionId: tx.transactionId });
      m = updateParticipant(m, currentId, { turnState: 'LISTENING' });
      m = setMeetingStatus({ ...m, activeTransaction: null }, 'LIVE');
      m = await saveMeeting(m);
      await scheduleSpeaker(m, latestTranscriptText(m), currentId, 0);
      return { ok: true, meeting: await getMeeting() };
    }
    case 'RECONNECT_PARTICIPANT': {
      let m = await getMeeting();
      const id = message.participantId || m.activeTransaction?.participantId;
      if (!id) throw new Error('No participant selected for reconnect.');
      m = await attachParticipant(m, id);
      m = withActivity(m, `${participantById(m,id)?.label || 'Participant'} reconnected.`);
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'CLEAR_TRANSCRIPT': {
      let m = await getMeeting();
      if (m.status === 'LIVE' && m.activeTransaction) throw new Error('Pause or end the active turn before clearing the transcript.');
      m = {
        ...m,
        transcript: [],
        currentTurn: 0,
        activeTransaction: null,
        nextSpeakerParticipantId: null,
        session: normalizeSession({ templateId: m.session?.templateId, status: 'IDLE' }),
        loopGuard: createLoopGuardState(m.loopGuard),
        activeRun: null,
        artifact: null,
      };
      m = withActivity(m, 'Transcript cleared.');
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'RESPONSE_CANDIDATE': {
      let m = await getMeeting();
      const tx = m.activeTransaction;
      if (tx && canAcceptEvent(tx, { ...message, tabId: sender.tab?.id })) {
        if (tx.stage === 'WAITING_FOR_GENERATION') {
          const nextTx = transitionTransaction(tx, 'RECEIVING');
          m = { ...m, activeTransaction: nextTx };
          m = updateParticipant(m, tx.participantId, { turnState: 'RECEIVING' });
          m = withActivity(m, 'Response candidate detected.', { stage: 'RECEIVING', participantId: tx.participantId, transactionId: tx.transactionId });
          m = await saveMeeting(m);
        }
        scheduleActiveTurnCheck();
      }
      return { ok: true, meeting: m };
    }
    case 'RESPONSE_CONFIRMED': return { ok: true, meeting: await completeResponse(message, sender.tab?.id) };
    case 'PAGE_READY': {
      let m = await getMeeting();
      const tabId = sender.tab?.id;
      const p = participantForTab(m, tabId);
      if (p) {
        const provider = classifyUrl(sender.tab?.url || message.url || '');
        if (provider) {
          m = updateParticipant(m, p.id, { provider, url: sender.tab?.url || message.url || '', connectionState: 'READY', lastSeenAt: Date.now() });
          m = await saveMeeting(m);
          await sendToParticipant(participantById(m,p.id), { type: 'ATTACH_PARTICIPANT', meetingId: m.id, participantId: p.id }).catch(() => {});
          if (m.activeTransaction?.participantId === p.id) setTimeout(() => enqueue(() => watchdogRecover()), 250);
        }
      }
      return { ok: true };
    }
    default: return { ok: false, error: 'Unknown message' };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelAction();
  ensureWatchdog();
  getMeeting().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { enableSidePanelAction(); ensureWatchdog(); getMeeting().catch(() => {}); });
ensureWatchdog().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const readOnly = new Set(['GET_MEETING_STATE','GET_WORKSPACE_STATE','LIST_ROOMS','GET_PLAYBOOKS','LIST_SUPPORTED_TABS','GET_TAB_STATUS','GET_SCHEDULE']);
  const runner = readOnly.has(message?.type) ? () => handleCommand(message, sender) : () => enqueue(() => handleCommand(message, sender));
  runner().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === WATCHDOG_ALARM) {
    enqueue(() => watchdogRecover()).catch(() => {});
    return;
  }
  const slotId = slotIdFromAlarmName(alarm?.name);
  if (slotId) enqueue(() => runScheduledSlot(slotId, { scheduledAt: alarm.scheduledTime })).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    await backgroundTabController.release(tabId).catch(() => {});
    let m = await getMeeting();
    const p = participantForTab(m, tabId);
    if (!p) return;
    m = updateParticipant(m, p.id, { tabId: null, url: '', connectionState: 'DISCONNECTED', turnState: 'WAITING' });
    m = withActivity(m, `${p.label} tab closed.`, { level: 'WARN', participantId: p.id });
    if (m.activeTransaction?.participantId === p.id) return enterNeedsAttention(m, `${p.label} tab closed during an active turn.`, m.activeTransaction.stage);
    await saveMeeting(m);
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  enqueue(async () => {
    let m = await getMeeting();
    const p = participantForTab(m, tabId);
    if (!p) return;
    const provider = classifyUrl(tab.url || '');
    if (!provider) {
      m = updateParticipant(m, p.id, { connectionState: 'RECONNECTING', url: tab.url || '' });
      await saveMeeting(m);
      return;
    }
    m = updateParticipant(m, p.id, { provider, connectionState: 'READY', url: tab.url || '', lastSeenAt: Date.now() });
    m = await saveMeeting(m);
    await attachParticipant(m, p.id).catch(() => {});
    if (m.activeTransaction?.participantId === p.id) setTimeout(() => enqueue(() => watchdogRecover()), 250);
  }).catch(() => {});
});
