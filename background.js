import { classifyUrl, normalizeText, signatureFor, providerLabelFor } from './relay-core.mjs';
import {
  createMeeting,
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
} from './meeting-engine.mjs';
import {
  createTransaction,
  transitionTransaction,
  canAcceptEvent,
  deliveryEvidenceConfirmed,
  shouldRetryTransaction,
  markTransactionRetry,
  transactionTimedOut,
} from './transaction-engine.mjs';
import { selectNextSpeaker, nextRoundRobinParticipant } from './router.mjs';

const ACTIVE_RUNTIME_KEY = 'v3MeetingRuntime';
const SAVED_MEETING_KEY = 'v3SavedMeeting';
const UI_SETTINGS_KEY = 'v3UiSettings';
const WATCHDOG_ALARM = 'lee-relay-v3-watchdog';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let eventQueue = Promise.resolve();

function enqueue(task) {
  const run = eventQueue.then(task, task);
  eventQueue = run.catch(() => {});
  return run;
}

function withActivity(meeting, message, extra = {}) {
  return appendActivity(meeting, { message, ...extra });
}

async function enableSidePanelAction() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

enableSidePanelAction();

async function ensureWatchdog() {
  await chrome.alarms.create(WATCHDOG_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
}

async function getMeeting() {
  const session = await chrome.storage.session.get(ACTIVE_RUNTIME_KEY);
  if (session[ACTIVE_RUNTIME_KEY]) return session[ACTIVE_RUNTIME_KEY];
  const local = await chrome.storage.local.get(SAVED_MEETING_KEY);
  const restored = local[SAVED_MEETING_KEY] || createMeeting();
  const meeting = {
    ...restored,
    status: restored.status === 'FINISHED' ? 'FINISHED' : 'READY',
    activeTransaction: null,
    participants: (restored.participants || []).map((p) => ({ ...p, tabId: null, url: '', connectionState: 'DISCONNECTED', turnState: 'WAITING' })),
  };
  await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: meeting });
  return meeting;
}

async function broadcastMeeting(meeting) {
  await chrome.runtime.sendMessage({ type: 'MEETING_STATE_CHANGED', meeting: publicMeetingState(meeting) }).catch(() => {});
}

async function saveMeeting(meeting, { broadcast = true } = {}) {
  const next = { ...meeting, updatedAt: Date.now() };
  await chrome.storage.session.set({ [ACTIVE_RUNTIME_KEY]: next });
  await chrome.storage.local.set({ [SAVED_MEETING_KEY]: durableMeetingState(next) });
  if (broadcast) await broadcastMeeting(next);
  return next;
}

async function newMeeting(options = {}) {
  const meeting = createMeeting({ title: options.title || 'New AI Meeting', settings: options.settings || {} });
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

function buildMeetingPrompt(meeting, target) {
  const budget = Math.max(3000, Number(meeting.settings?.contextCharBudget) || 12000);
  const participants = meeting.participants.map((p) => p.label).join(', ');
  const lines = [];
  let chars = 0;
  for (let i = meeting.transcript.length - 1; i >= 0; i -= 1) {
    const entry = meeting.transcript[i];
    const speaker = entry.speakerType === 'USER'
      ? 'User'
      : (participantById(meeting, entry.participantId)?.label || entry.provider || entry.speakerType);
    const block = `${speaker}: ${normalizeText(entry.text)}`;
    if (!normalizeText(entry.text)) continue;
    if (chars + block.length > budget && lines.length) break;
    lines.unshift(block);
    chars += block.length;
  }
  return `[LEE RELAY MEETING]\nMeeting: ${meeting.title}\nParticipants: ${participants}\nYou are: ${target.label}\n\n[RECENT DISCUSSION]\n${lines.join('\n\n')}\n\n[YOUR TURN]\nContinue the meeting naturally.\nRespond to the group's current topic.\nIf you clearly want a specific participant to answer next, address them by participant name.`;
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
  const response = await sendToParticipant(participant, {
    type: 'PREPARE_DELIVERY',
    meetingId: meeting.id,
    transactionId: tx.transactionId,
    participantId: participant.id,
    text: tx.promptText,
    promptSignature: tx.promptSignature,
  });
  if (!response?.ok) throw new Error(response?.error || 'Failed to prepare delivery.');
  if (captureBaseline) return response;
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

  while (true) {
    let evidence = await verifyDelivery(meeting, participant, tx, 7000).catch(() => ({ matchingUserMessage: false }));
    if (deliveryEvidenceConfirmed({ ...evidence, sendActionExecuted: true })) return confirmDelivery(meeting, tx, { ...evidence, sendActionExecuted: true });

    if (!shouldRetryTransaction(tx)) return enterNeedsAttention(meeting, `${participant.label} delivery could not be confirmed after ${tx.attempt} retries.`, 'VERIFYING_DELIVERY');

    tx = markTransactionRetry(tx, 'Delivery not confirmed');
    meeting = { ...meeting, activeTransaction: tx };
    meeting = withActivity(meeting, `Delivery not confirmed · retry ${tx.attempt}/${tx.retryLimit}`, { level: 'WARN', stage: 'RETRYING', participantId: tx.participantId, transactionId: tx.transactionId });
    meeting = await saveMeeting(meeting);

    evidence = await verifyDelivery(meeting, participant, tx, 1800).catch(() => ({ matchingUserMessage: false }));
    if (deliveryEvidenceConfirmed({ ...evidence, sendActionExecuted: true })) return confirmDelivery(meeting, tx, { ...evidence, sendActionExecuted: true });

    try {
      await ensurePreparedOnPage(meeting, participant, tx, { captureBaseline: false });
      tx = transitionTransaction(tx, 'SENDING');
      meeting = { ...meeting, activeTransaction: tx };
      meeting = updateParticipant(meeting, participant.id, { turnState: 'SENDING' });
      meeting = await saveMeeting(meeting);
      const sent = await sendToParticipant(participant, {
        type: 'SUBMIT_MESSAGE', meetingId: meeting.id, transactionId: tx.transactionId, participantId: participant.id, text: tx.promptText,
      });
      if (!sent?.ok || !sent.sendActionExecuted) throw new Error(sent?.error || 'Send action failed.');
      tx = transitionTransaction(tx, 'VERIFYING_DELIVERY');
      meeting = { ...meeting, activeTransaction: tx };
      meeting = updateParticipant(meeting, participant.id, { turnState: 'VERIFYING' });
      meeting = withActivity(meeting, 'Send action executed; verifying delivery', { stage: 'VERIFYING_DELIVERY', participantId: participant.id, transactionId: tx.transactionId });
      meeting = await saveMeeting(meeting);
    } catch (error) {
      if (!shouldRetryTransaction(tx)) return enterNeedsAttention(meeting, `${participant.label}: ${error.message || String(error)}`, tx.stage);
    }
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

  const promptText = buildMeetingPrompt(meeting, participant);
  const promptSignature = await signatureFor(promptText);
  let tx = createTransaction({
    meetingId: meeting.id,
    participantId: participant.id,
    tabId: participant.tabId,
    turnNumber: meeting.currentTurn + 1,
    promptText,
    promptSignature,
    retryLimit: meeting.settings.retryLimit,
    responseTimeoutMs: meeting.settings.responseTimeoutMs,
  });
  meeting = { ...meeting, activeTransaction: tx, nextSpeakerParticipantId: participant.id };
  meeting = setParticipantTurnStates(meeting, participant.id, 'SENDING');
  meeting = withActivity(meeting, `Turn ${tx.turnNumber} prepared → ${participant.label}`, { stage: 'PREPARING', participantId: participant.id, transactionId: tx.transactionId });
  meeting = await saveMeeting(meeting);

  try {
    meeting = await attachParticipant(meeting, participant.id);
    participant = participantById(meeting, participant.id);
    tx = meeting.activeTransaction;
    const baseline = await ensurePreparedOnPage(meeting, participant, tx, { captureBaseline: true });
    if (baseline.generating) throw new Error(`${participant.label} is already generating a response. Wait for it to finish before starting this turn.`);
    tx = { ...tx, preAssistantSignature: baseline.assistantSignature || null, preUserSignature: baseline.userSignature || null };
    tx = transitionTransaction(tx, 'SENDING');
    meeting = { ...meeting, activeTransaction: tx };
    meeting = await saveMeeting(meeting);

    const sent = await sendToParticipant(participant, {
      type: 'SUBMIT_MESSAGE', meetingId: meeting.id, transactionId: tx.transactionId, participantId: participant.id, text: promptText,
    });
    if (!sent?.ok || !sent.sendActionExecuted) throw new Error(sent?.error || 'Send action failed.');

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

function scheduleSpeaker(meeting, latestText, currentParticipantId = null, delayMs = null) {
  if (meeting.status !== 'LIVE' || meeting.activeTransaction) return null;
  const target = selectNextSpeaker(meeting, latestText, currentParticipantId);
  if (!target) return null;
  const delay = delayMs == null ? Math.max(0, Number(meeting.settings.minDelayMs) || 0) : delayMs;
  setTimeout(() => enqueue(() => executeTurn(target.id)).catch(() => {}), delay);
  return target;
}

async function startMeeting(seedText = '') {
  let meeting = await getMeeting();
  if (meeting.status === 'LIVE') return meeting;
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
  const latestUserText = normalizeText([...meeting.transcript].reverse().find((entry) => entry.speakerType === 'USER' && normalizeText(entry.text))?.text || '');
  if (normalizedSeed && normalizedSeed !== latestUserText) {
    meeting = appendTranscript(meeting, { speakerType: 'USER', text: normalizedSeed, turnNumber: meeting.currentTurn });
  }
  if (!meeting.transcript.some((e) => normalizeText(e.text))) throw new Error('Write a starting topic before starting the meeting.');
  meeting = setMeetingStatus(meeting, 'LIVE');
  meeting = withActivity(meeting, 'Meeting started.');
  meeting = await saveMeeting(meeting);
  const latest = latestTranscriptText(meeting);
  scheduleSpeaker(meeting, latest, null, 0);
  return meeting;
}

async function completeResponse(message, senderTabId) {
  let meeting = await getMeeting();
  const tx = meeting.activeTransaction;
  if (!tx || !canAcceptEvent(tx, { ...message, tabId: senderTabId })) return meeting;
  if (!normalizeText(message.text) || !message.signature) return meeting;
  const participant = participantById(meeting, tx.participantId);
  if (!participant) return meeting;
  if (participant.lastKnownAssistantSignature === message.signature) return enterNeedsAttention(meeting, `${participant.label} returned a duplicate response.`, 'VERIFYING_RESPONSE');

  let verify = null;
  try {
    verify = await sendToParticipant(participant, { type: 'GET_TRANSACTION_STATUS', meetingId: meeting.id, transactionId: tx.transactionId, participantId: participant.id });
  } catch { }
  if (verify?.ok && (!(verify.deliveryConfirmed || verify.matchingUserMessage) || verify.assistantSignature !== message.signature || !verify.changed)) {
    return enterNeedsAttention(meeting, `${participant.label} response could not be correlated to the current turn.`, 'VERIFYING_RESPONSE');
  }

  let nextTx = tx;
  if (nextTx.stage === 'WAITING_FOR_GENERATION') nextTx = transitionTransaction(nextTx, 'RECEIVING');
  if (nextTx.stage === 'RECEIVING' || nextTx.stage === 'DELIVERED' || nextTx.stage === 'WAITING_FOR_GENERATION') nextTx = transitionTransaction(nextTx, 'VERIFYING_RESPONSE');
  nextTx = transitionTransaction(nextTx, 'COMPLETE', { responseText: normalizeText(message.text), responseSignature: message.signature, error: '' });

  meeting = { ...meeting, activeTransaction: nextTx };
  meeting = updateParticipant(meeting, participant.id, { turnState: 'SPEAKING', lastKnownAssistantSignature: message.signature, lastSeenAt: Date.now() });
  meeting = appendTranscript(meeting, {
    speakerType: 'AI', participantId: participant.id, provider: participant.provider, text: normalizeText(message.text), turnNumber: tx.turnNumber,
    deliveryStatus: 'CONFIRMED', responseStatus: 'CONFIRMED', transactionId: tx.transactionId,
  });
  meeting = { ...meeting, currentTurn: meeting.currentTurn + 1, activeTransaction: null };
  meeting = withActivity(meeting, `Turn ${tx.turnNumber} complete ← ${participant.label}`, { stage: 'COMPLETE', participantId: participant.id, transactionId: tx.transactionId });

  if (meeting.settings.maxTurns > 0 && meeting.currentTurn >= meeting.settings.maxTurns) {
    meeting = setMeetingStatus(meeting, 'FINISHED');
    meeting = withActivity(meeting, 'Meeting finished at the configured turn limit.');
    return saveMeeting(meeting);
  }
  meeting = await saveMeeting(meeting);
  maybeCaptureScreenshot(meeting, participant, tx.turnNumber).catch(() => {});
  if (meeting.status === 'LIVE') scheduleSpeaker(meeting, message.text, participant.id);
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
    if (status?.ok && (status.deliveryConfirmed || status.matchingUserMessage) && status.changed && status.assistantSignature && status.assistantText && (!status.generating || status.stableMs >= 90000)) {
      return completeResponse({ meetingId: meeting.id, transactionId: tx.transactionId, participantId: participant.id, text: status.assistantText, signature: status.assistantSignature }, participant.tabId);
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
    case 'NEW_MEETING': return { ok: true, meeting: await newMeeting(message.options || {}) };
    case 'ADD_PARTICIPANT': {
      let m = await getMeeting();
      m = addParticipant(m);
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'REMOVE_PARTICIPANT': {
      let m = await getMeeting();
      if (m.activeTransaction?.participantId === message.participantId) throw new Error('Skip or end the active turn before removing this participant.');
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
    case 'START_MEETING': return { ok: true, meeting: await startMeeting(message.seedText || '') };
    case 'PAUSE_MEETING': {
      let m = setMeetingStatus(await getMeeting(), 'PAUSED');
      m = withActivity(m, 'Meeting paused by user.');
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'RESUME_MEETING': {
      let m = await getMeeting();
      m = setMeetingStatus(m, 'LIVE');
      m = withActivity(m, 'Meeting resumed.');
      m = await saveMeeting(m);
      if (m.activeTransaction) setTimeout(() => enqueue(() => watchdogRecover()), 0);
      else scheduleSpeaker(m, latestTranscriptText(m), null, 0);
      return { ok: true, meeting: m };
    }
    case 'END_MEETING': {
      let m = await getMeeting();
      m = setMeetingStatus({ ...m, activeTransaction: null, nextSpeakerParticipantId: null }, 'FINISHED');
      m = withActivity(m, 'Meeting ended by user.');
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'USER_MESSAGE': {
      let m = await getMeeting();
      const text = normalizeText(message.text || '');
      if (!text) throw new Error('Message is empty.');
      m = appendTranscript(m, { speakerType: 'USER', text, turnNumber: m.currentTurn });
      m = withActivity(m, 'User added a message to the room.');
      m = await saveMeeting(m);
      if (m.status === 'LIVE' && !m.activeTransaction) scheduleSpeaker(m, text, null, 0);
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
      m = { ...m, settings: {
        ...m.settings,
        ...(Object.hasOwn(patch,'maxTurns') ? { maxTurns: Math.max(0, Number(patch.maxTurns) || 0) } : {}),
        ...(Object.hasOwn(patch,'minDelayMs') ? { minDelayMs: Math.max(0, Number(patch.minDelayMs) || 0) } : {}),
        ...(Object.hasOwn(patch,'smartRouting') ? { smartRouting: Boolean(patch.smartRouting) } : {}),
        ...(Object.hasOwn(patch,'captureScreenshots') ? { captureScreenshots: Boolean(patch.captureScreenshots) } : {}),
        ...(Object.hasOwn(patch,'retryLimit') ? { retryLimit: Math.min(5, Math.max(0, Number(patch.retryLimit) || 0)) } : {}),
        ...(Object.hasOwn(patch,'responseTimeoutMs') ? { responseTimeoutMs: Math.max(30000, Number(patch.responseTimeoutMs) || 120000) } : {}),
      } };
      return { ok: true, meeting: await saveMeeting(m) };
    }
    case 'RETRY_TRANSACTION': {
      let m = await getMeeting();
      const tx = m.activeTransaction;
      if (!tx) throw new Error('There is no transaction to retry.');
      const reset = { ...tx, stage: 'RETRYING', error: '', attempt: Math.max(0, Math.min(tx.attempt || 0, tx.retryLimit - 1)), lastProgressAt: Date.now(), updatedAt: Date.now() };
      m = setMeetingStatus({ ...m, activeTransaction: reset }, 'LIVE');
      m = withActivity(m, 'Manual retry requested.', { stage: 'RETRYING', participantId: tx.participantId, transactionId: tx.transactionId });
      m = await saveMeeting(m);
      setTimeout(() => enqueue(() => watchdogRecover()), 0);
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
      const target = nextRoundRobinParticipant(m, currentId);
      if (target) setTimeout(() => enqueue(() => executeTurn(target.id)), 0);
      return { ok: true, meeting: m };
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
      m = { ...m, transcript: [], currentTurn: 0, activeTransaction: null, nextSpeakerParticipantId: null };
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
