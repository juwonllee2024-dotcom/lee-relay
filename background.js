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

const ACTIVE_RUNTIME_KEY = 'v4.0.0MeetingRuntime';
const SAVED_MEETING_KEY = 'v4.0.0SavedMeeting';
const LEGACY_ACTIVE_RUNTIME_KEY = 'v3.0.8MeetingRuntime';
const LEGACY_SAVED_MEETING_KEY = 'v3.0.8SavedMeeting';
const UI_SETTINGS_KEY = 'v3UiSettings';
const WATCHDOG_ALARM = 'lee-relay-v4.0.0-watchdog';
const ACTIVE_TURN_CHECK_DELAY_MS = 2400;
let activeTurnCheckTimer = null;
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

async function getMeeting() {
  const session = await chrome.storage.session.get([ACTIVE_RUNTIME_KEY, LEGACY_ACTIVE_RUNTIME_KEY]);
  const activeStored = session[ACTIVE_RUNTIME_KEY] || session[LEGACY_ACTIVE_RUNTIME_KEY];
  if (activeStored) {
    const active = normalizeMeetingCoordination(sanitizeMeetingTranscript(activeStored));
    const next = {
      ...active,
      settings: { ...DEFAULT_MEETING_SETTINGS, ...(active.settings || {}) },
      interactionMode: normalizeInteractionMode(active.interactionMode),
      topicText: normalizeTopicText(active.topicText),
    };
    if (!session[ACTIVE_RUNTIME_KEY]) await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: next });
    return next;
  }
  const local = await chrome.storage.local.get([SAVED_MEETING_KEY, LEGACY_SAVED_MEETING_KEY]);
  const stored = local[SAVED_MEETING_KEY] || local[LEGACY_SAVED_MEETING_KEY];
  const restored = normalizeMeetingCoordination(sanitizeMeetingTranscript(stored || createMeeting()));
  const meeting = normalizeMeetingCoordination({
    ...restored,
    settings: { ...DEFAULT_MEETING_SETTINGS, ...(restored.settings || {}) },
    status: restored.status === 'FINISHED' ? 'FINISHED' : 'READY',
    interactionMode: normalizeInteractionMode(restored.interactionMode),
    topicText: normalizeTopicText(restored.topicText),
    activeTransaction: null,
    participants: (restored.participants || []).map((p) => ({ ...p, tabId: null, url: '', connectionState: 'DISCONNECTED', turnState: 'WAITING' })),
  });
  await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: meeting });
  if (!local[SAVED_MEETING_KEY] && local[LEGACY_SAVED_MEETING_KEY]) {
    await chrome.storage.local.set({ [SAVED_MEETING_KEY]: durableMeetingState(meeting) });
  }
  return meeting;
}

async function broadcastMeeting(meeting) {
  await chrome.runtime.sendMessage({ type: 'MEETING_STATE_CHANGED', meeting: publicMeetingState(meeting) }).catch(() => {});
}

async function saveMeeting(meeting, { broadcast = true } = {}) {
  const next = normalizeMeetingCoordination({
    ...meeting,
    updatedAt: Date.now(),
    settings: { ...DEFAULT_MEETING_SETTINGS, ...(meeting.settings || {}) },
  });
  await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: next });
  await chrome.storage.local.set({ [SAVED_MEETING_KEY]: durableMeetingState(next) });
  if (broadcast) await broadcastMeeting(next);
  return next;
}

async function newMeeting(options = {}) {
  const meeting = createMeeting({
    title: options.title || 'New AI Meeting',
    interactionMode: options.interactionMode,
    topicText: options.topicText,
    settings: options.settings || {},
    session: options.session || {},
    loopGuard: options.loopGuard || {},
  });
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

async function ensureContent(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong?.ok) return pong;
  } catch { /* inject below */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await sleep(120);
  return chrome.tabs.sendMessage(tabId, { type: 'PING' });
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

      if (!attachmentResult?.ok || !attachmentResult.attached) {
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
          contextAttachmentConfirmed: Boolean(attachmentResult.confirmed),
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

async function scheduleSpeaker(meeting, latestText, currentParticipantId = null, delayMs = null) {
  if (meeting.status !== 'LIVE' || meeting.activeTransaction) return null;
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
    await saveMeeting(next);
  }
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
  meeting = { ...meeting, session: nextSession };
  if (nextSession.status === 'COMPLETE') {
    meeting = withActivity(meeting, `Session complete ??${nextSession.templateId}.`, { stage: 'SESSION_COMPLETE' });
    meeting = setMeetingStatus(meeting, 'FINISHED');
    return saveMeeting(meeting);
  }
  if (nextSession.phaseIndex !== previousSession.phaseIndex) {
    meeting = withActivity(meeting, `Session phase advanced ??${currentSessionPhase(nextSession).name}.`, { stage: 'SESSION_PHASE' });
  }

  meeting = withActivity(meeting, `Turn ${tx.turnNumber} complete ← ${participant.label}`, { stage: 'COMPLETE', participantId: participant.id, transactionId: tx.transactionId });

  if (meeting.settings.maxTurns > 0 && meeting.currentTurn >= meeting.settings.maxTurns) {
    meeting = setMeetingStatus(meeting, 'FINISHED');
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
      if (recoveries >= 2) return enterNeedsAttention(meeting, `${participant.label} response timed out after recovery attempts.`, tx.stage);
      const patched = { ...tx, recoveryCount: recoveries + 1, lastProgressAt: Date.now(), updatedAt: Date.now() };
      meeting = { ...meeting, activeTransaction: patched };
      meeting = withActivity(meeting, `Response watchdog re-armed ${participant.label} (${patched.recoveryCount}/2)`, { level: 'WARN', stage: tx.stage, participantId: participant.id, transactionId: tx.transactionId });
      meeting = await saveMeeting(meeting);
      await armResponse(meeting, participant, patched).catch(() => {});
    }
  }
  return meeting;
}

async function handleCommand(message, sender) {
  switch (message.type) {
    case 'GET_MEETING_STATE': return { ok: true, meeting: publicMeetingState(await getMeeting()) };
    case 'LIST_SUPPORTED_TABS': return { ok: true, tabs: await listSupportedTabs() };
    case 'CHECK_ACTIVE_TURN': return { ok: true, meeting: publicMeetingState(await watchdogRecover()) };
    case 'NEW_MEETING': return { ok: true, meeting: await newMeeting(message.options || {}) };
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
      let m = setMeetingStatus(await getMeeting(), 'PAUSED');
      await backgroundTabController.releaseAll().catch(() => {});
      m = withActivity(m, 'Meeting paused by user.');
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'RESUME_MEETING': {
      let m = await getMeeting();
      const resumedSession = m.session?.status === 'IDLE'
        ? startSession(m.session)
        : { ...normalizeSession(m.session), status: 'RUNNING' };
      m = {
        ...m,
        session: resumedSession,
        loopGuard: createLoopGuardState(m.loopGuard),
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
      m = setMeetingStatus({ ...m, activeTransaction: null, nextSpeakerParticipantId: null }, 'FINISHED');
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
        ...(Object.hasOwn(patch,'loopGuardEnabled') ? { loopGuardEnabled: Boolean(patch.loopGuardEnabled) } : {}),
        ...(Object.hasOwn(patch,'loopGuardInteractive') ? { loopGuardInteractive: Boolean(patch.loopGuardInteractive) } : {}),
        ...(Object.hasOwn(patch,'loopGuardMaxHops') ? { loopGuardMaxHops: guardNumber('loopGuardMaxHops', m.settings.loopGuardMaxHops) } : {}),
        ...(Object.hasOwn(patch,'loopGuardMaxSameSpeaker') ? { loopGuardMaxSameSpeaker: guardNumber('loopGuardMaxSameSpeaker', m.settings.loopGuardMaxSameSpeaker) } : {}),
        ...(Object.hasOwn(patch,'loopGuardMaxSameRoute') ? { loopGuardMaxSameRoute: guardNumber('loopGuardMaxSameRoute', m.settings.loopGuardMaxSameRoute) } : {}),
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
  const readOnly = new Set(['GET_MEETING_STATE','LIST_SUPPORTED_TABS']);
  const runner = readOnly.has(message?.type) ? () => handleCommand(message, sender) : () => enqueue(() => handleCommand(message, sender));
  runner().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== WATCHDOG_ALARM) return;
  enqueue(() => watchdogRecover()).catch(() => {});
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
