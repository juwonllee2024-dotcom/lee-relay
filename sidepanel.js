import {
  formatMeetingJson,
  formatMeetingMarkdown,
  formatMeetingText,
  formatRunReportMarkdown,
  formatRunReportText,
  safeExportFilename,
} from './transcript-export.mjs';
import { languageInfo, normalizeLanguage, translate } from './language.mjs';
import { buildTabStatusSnapshot } from './status-center.mjs';
import { nextScheduledRun, normalizeSchedule } from './schedule-engine.mjs';

const $ = (id) => document.getElementById(id);
let meeting = null;
let workspace = null;
let supportedTabs = [];
let tabStatus = [];
let schedule = normalizeSchedule();
let titleSaveTimer = null;
let language = 'ko';
const SESSION_OPTIONS = [
  ['freeform', 'playbook.freeform'],
  ['channel-9-axis', 'playbook.channel9'],
  ['debate', 'playbook.debate'],
  ['planning', 'playbook.planning'],
  ['final-summary', 'playbook.finalSummary'],
];

const els = {
  meetingTitle: $('meetingTitle'), meetingStatus: $('meetingStatus'), participantCount: $('participantCount'), participants: $('participants'),
  roomSelect: $('roomSelect'), createRoom: $('createRoom'), playbookPicker: $('playbookPicker'), playbookHint: $('playbookHint'),
  addParticipant: $('addParticipant'), refreshTabs: $('refreshTabs'), transcript: $('transcript'), turnCounter: $('turnCounter'), exportMarkdown: $('exportMarkdown'), exportJson: $('exportJson'), composer: $('composer'),
  exportText: $('exportText'), exportReportMarkdown: $('exportReportMarkdown'), exportReportText: $('exportReportText'),
  interactionMode: $('interactionMode'), interactiveMode: $('interactiveMode'), autonomousMode: $('autonomousMode'), joinConversation: $('joinConversation'), modeHint: $('modeHint'),
  sendUserMessage: $('sendUserMessage'), startMeeting: $('startMeeting'), pauseMeeting: $('pauseMeeting'), endMeeting: $('endMeeting'), uiNotice: $('uiNotice'),
  attentionStrip: $('attentionStrip'), attentionMessage: $('attentionMessage'), retryTransaction: $('retryTransaction'), skipParticipant: $('skipParticipant'), reconnectParticipant: $('reconnectParticipant'),
  maxTurns: $('maxTurns'), maxDurationMinutes: $('maxDurationMinutes'), maxHops: $('maxHops'), delaySeconds: $('delaySeconds'), retryLimit: $('retryLimit'), responseTimeout: $('responseTimeout'), smartRouting: $('smartRouting'), captureScreenshots: $('captureScreenshots'),
  sessionTemplate: $('sessionTemplate'), sessionPhaseHint: $('sessionPhaseHint'), loopGuardEnabled: $('loopGuardEnabled'), loopGuardInteractive: $('loopGuardInteractive'),
  loopGuardMaxHops: $('loopGuardMaxHops'), loopGuardMaxSameSpeaker: $('loopGuardMaxSameSpeaker'), loopGuardMaxSameRoute: $('loopGuardMaxSameRoute'),
  clearTranscript: $('clearTranscript'), newMeeting: $('newMeeting'), activityCount: $('activityCount'), activityLog: $('activityLog'),
  statusCenterList: $('statusCenterList'), statusCenterSummary: $('statusCenterSummary'),
  scheduleEnabled: $('scheduleEnabled'), scheduleMorningEnabled: $('scheduleMorningEnabled'), scheduleMorningTime: $('scheduleMorningTime'),
  scheduleEveningEnabled: $('scheduleEveningEnabled'), scheduleEveningTime: $('scheduleEveningTime'), scheduleMode: $('scheduleMode'), scheduleTopic: $('scheduleTopic'),
  saveSchedule: $('saveSchedule'), runScheduleNow: $('runScheduleNow'), scheduleRunSlot: $('scheduleRunSlot'), scheduleNextSummary: $('scheduleNextSummary'),
  languageButton: $('languageButton'), languageMenu: $('languageMenu'),
};

function tr(key, variables = {}) {
  return translate(language, key, variables);
}

function turnLabel(count) {
  const value = Number(count) || 0;
  if (value === 0) return tr('turns.zero');
  if (value === 1) return tr('turns.one');
  return tr('turns.many', { count: value });
}

function statusLabel(status) {
  const key = `status.${status}`;
  const value = tr(key);
  return value === key ? String(status || '').replaceAll('_', ' ') : value;
}

function isDefaultMeetingTitle(value) {
  return !value || ['New AI Meeting', '새 AI 회의', '新しいAI会議'].includes(value);
}

function syncLanguageFromMeeting() {
  const next = normalizeLanguage(meeting?.settings?.language || language);
  if (next !== language) language = next;
}

function applyTranslations() {
  const info = languageInfo(language);
  document.documentElement.lang = info.code;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = tr(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = tr(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll('[data-i18n-title]')) {
    element.title = tr(element.dataset.i18nTitle);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', tr(element.dataset.i18nAriaLabel));
  }
  for (const element of document.querySelectorAll('[data-i18n-value]')) {
    if (!element.value) element.value = tr(element.dataset.i18nValue);
  }
  for (const option of els.languageMenu?.querySelectorAll('[data-language]') || []) {
    option.setAttribute('aria-checked', String(option.dataset.language === language));
  }
}

async function call(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || 'Lee Relay command failed.');
  if (result.meeting) meeting = result.meeting;
  if (result.workspace) workspace = result.workspace;
  if (result.schedule) schedule = normalizeSchedule(result.schedule);
  if (result.status) tabStatus = result.status;
  return result;
}

function notice(text = '', error = false) {
  els.uiNotice.textContent = text;
  els.uiNotice.classList.toggle('error', Boolean(error));
}

function closeLanguageMenu() {
  if (!els.languageMenu || !els.languageButton) return;
  els.languageMenu.hidden = true;
  els.languageButton.setAttribute('aria-expanded', 'false');
}

async function chooseLanguage(nextLanguage) {
  const selected = normalizeLanguage(nextLanguage);
  try {
    await call('SET_LANGUAGE', { language: selected });
    language = selected;
    closeLanguageMenu();
    render();
    notice(tr('notice.languageChanged', { language: languageInfo(selected).label }));
  } catch (e) {
    notice(e.message, true);
  }
}

if (els.languageButton && els.languageMenu) {
  els.languageButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const nextHidden = !els.languageMenu.hidden;
    els.languageMenu.hidden = nextHidden;
    els.languageButton.setAttribute('aria-expanded', String(!nextHidden));
  });
  for (const option of els.languageMenu.querySelectorAll('[data-language]')) {
    option.addEventListener('click', () => chooseLanguage(option.dataset.language));
  }
  document.addEventListener('click', (event) => {
    if (!els.languageMenu.contains(event.target) && event.target !== els.languageButton) closeLanguageMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLanguageMenu();
  });
}

function timeLabel(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function providerLabel(p) {
  return { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot' }[p] || 'Unbound AI';
}

function renderWorkspace() {
  if (!workspace || !els.roomSelect) return;
  els.roomSelect.replaceChildren();
  for (const room of workspace.rooms || []) {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = room.title || tr('meeting.defaultTitle');
    option.selected = room.id === workspace.activeRoomId;
    els.roomSelect.append(option);
  }
  if (els.playbookPicker) {
    els.playbookPicker.replaceChildren();
    for (const [value, labelKey] of SESSION_OPTIONS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = tr(labelKey);
      option.selected = value === (meeting?.playbookId || meeting?.session?.templateId || 'freeform');
      els.playbookPicker.append(option);
    }
    const active = SESSION_OPTIONS.find(([value]) => value === els.playbookPicker.value);
    if (els.playbookHint) els.playbookHint.textContent = tr(active?.[1] || 'playbook.freeform');
  }
}

function activeParticipantId() {
  return meeting?.activeTransaction?.participantId || meeting?.nextSpeakerParticipantId || null;
}

async function saveParticipantCoordination(participantId, role, rolePrompt) {
  try {
    await call('UPDATE_PARTICIPANT_COORDINATION', { participantId, role, rolePrompt });
    render();
  } catch (e) {
    notice(e.message, true);
  }
}

function renderParticipants() {
  const activeId = activeParticipantId();
  els.participants.replaceChildren();
  const usedTabIds = new Set(meeting.participants.map((p) => p.tabId).filter(Number.isInteger));
  for (const p of meeting.participants) {
    const card = document.createElement('article');
    card.className = 'participant-card';
    card.dataset.active = String(p.id === activeId);
    card.dataset.state = p.turnState || 'WAITING';
    card.dataset.error = String(['ERROR','DISCONNECTED','RECONNECTING'].includes(p.connectionState));

    const top = document.createElement('div'); top.className = 'participant-top';
    const name = document.createElement('div'); name.className = 'participant-name';
    const dot = document.createElement('span'); dot.className = 'provider-dot';
    const label = document.createElement('span'); label.textContent = p.label || providerLabel(p.provider);
    name.append(dot, label);
    const rawState = p.connectionState !== 'READY' ? p.connectionState : (p.turnState || 'WAITING');
    const stateKey = `participant.state.${rawState}`;
    const state = document.createElement('span'); state.className = 'participant-state'; state.textContent = tr(stateKey) === stateKey ? rawState : tr(stateKey);
    top.append(name, state);
    if (meeting.participants.length > 2 && p.id !== activeId) {
      const remove = document.createElement('button'); remove.className = 'remove-participant'; remove.type = 'button'; remove.textContent = '×'; remove.title = tr('participant.remove');
      remove.addEventListener('click', async () => { try { await call('REMOVE_PARTICIPANT', { participantId: p.id }); render(); } catch (e) { notice(e.message, true); } });
      top.append(remove);
    }

    const select = document.createElement('select'); select.className = 'participant-select'; select.setAttribute('aria-label', tr('participant.slot', { slot: p.slotIndex + 1 }));
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = tr('participant.chooseTab'); select.append(placeholder);
    for (const tab of supportedTabs) {
      if (usedTabIds.has(tab.tabId) && tab.tabId !== p.tabId) continue;
      const option = document.createElement('option'); option.value = String(tab.tabId); option.textContent = tab.label; option.selected = tab.tabId === p.tabId; select.append(option);
    }
    select.addEventListener('change', async () => {
      if (!select.value) return;
      select.disabled = true;
      try { await call('BIND_PARTICIPANT', { participantId: p.id, tabId: Number(select.value) }); await refreshTabs(false); render(); notice(tr('notice.tabConnected')); }
      catch (e) { notice(e.message, true); }
      finally { select.disabled = false; }
    });
    const role = document.createElement('input');
    role.className = 'participant-role';
    role.type = 'text';
    role.maxLength = 80;
    role.value = p.role || '';
    role.placeholder = tr('participant.role');
    role.setAttribute('aria-label', `${p.label || tr('participant.unbound')} ${tr('participant.role')}`);
    const rolePrompt = document.createElement('input');
    rolePrompt.className = 'participant-role-prompt';
    rolePrompt.type = 'text';
    rolePrompt.maxLength = 80;
    rolePrompt.value = p.rolePrompt || '';
    rolePrompt.placeholder = tr('participant.roleGuidance');
    rolePrompt.setAttribute('aria-label', `${p.label || tr('participant.unbound')} ${tr('participant.roleGuidance')}`);
    const coordinationEditable = meeting.status === 'READY' || (meeting.status === 'PAUSED' && !meeting.activeTransaction);
    role.disabled = !coordinationEditable;
    rolePrompt.disabled = !coordinationEditable;
    role.addEventListener('change', () => saveParticipantCoordination(p.id, role.value, rolePrompt.value));
    rolePrompt.addEventListener('change', () => saveParticipantCoordination(p.id, role.value, rolePrompt.value));
    card.append(top, select, role, rolePrompt);
    els.participants.append(card);
  }
  els.participantCount.textContent = `${meeting.participants.length} / 6`;
  els.addParticipant.disabled = meeting.participants.length >= 6;
}

function renderStatusCenter() {
  if (!els.statusCenterList || !meeting) return;
  const rows = tabStatus.length
    ? tabStatus
    : buildTabStatusSnapshot({ tabs: supportedTabs, participants: meeting.participants, activeTransaction: meeting.activeTransaction });
  els.statusCenterList.replaceChildren();
  const connectedCount = rows.filter((row) => ['READY', 'BUSY'].includes(row.health)).length;
  els.statusCenterSummary.textContent = tr('statusCenter.summary', { ready: connectedCount, total: rows.length });
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'status-center-empty';
    empty.textContent = tr('statusCenter.empty');
    els.statusCenterList.append(empty);
    return;
  }
  for (const row of rows) {
    const item = document.createElement('article');
    item.className = 'status-center-row';
    item.dataset.health = row.health;
    const header = document.createElement('div');
    header.className = 'status-center-row-head';
    const name = document.createElement('span');
    name.className = 'status-center-name';
    const dot = document.createElement('span');
    dot.className = 'status-center-dot';
    name.append(dot, document.createTextNode(row.label));
    const health = document.createElement('strong');
    health.className = 'status-center-health';
    health.textContent = tr(`tab.health.${row.health}`);
    header.append(name, health);

    const meta = document.createElement('div');
    meta.className = 'status-center-meta';
    const location = row.active ? tr('statusCenter.active') : tr('statusCenter.background');
    const tabLabel = row.tabId == null ? tr('statusCenter.tab', { id: '-' }) : tr('statusCenter.tab', { id: row.tabId });
    meta.textContent = `${row.providerLabel} · ${location} · ${tabLabel}`;
    item.append(header, meta);

    const details = [];
    if (row.participantId) details.push(tr('statusCenter.participant', { id: String(row.participantId).slice(-6) }));
    if (row.transactionStage) details.push(tr('statusCenter.transaction', { stage: row.transactionStage, count: row.recoveryCount }));
    if (row.lastSeenAt) details.push(tr('statusCenter.lastSeen', { time: timeLabel(row.lastSeenAt) }));
    if (details.length) {
      const footer = document.createElement('div');
      footer.className = 'status-center-meta status-center-detail';
      footer.textContent = details.join(' · ');
      item.append(footer);
    }
    els.statusCenterList.append(item);
  }
}

function scheduleDateLabel(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString(languageInfo(language).locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderSchedule() {
  if (!els.scheduleEnabled) return;
  const current = normalizeSchedule(schedule);
  const morning = current.slots.morning;
  const evening = current.slots.evening;
  const setChecked = (element, value) => { if (document.activeElement !== element) element.checked = Boolean(value); };
  const setValue = (element, value) => { if (document.activeElement !== element) element.value = value; };
  setChecked(els.scheduleEnabled, current.enabled);
  setChecked(els.scheduleMorningEnabled, morning.enabled);
  setChecked(els.scheduleEveningEnabled, evening.enabled);
  setValue(els.scheduleMorningTime, morning.time);
  setValue(els.scheduleEveningTime, evening.time);
  setValue(els.scheduleMode, morning.mode || evening.mode || 'autonomous');
  setValue(els.scheduleTopic, morning.topic || evening.topic || '');
  const next = nextScheduledRun(current, Date.now());
  els.scheduleNextSummary.textContent = next
    ? tr('schedule.next', { slot: tr(`schedule.${next.slotId}`), time: scheduleDateLabel(next.at) })
    : tr('schedule.none');
}

function renderTranscript() {
  els.transcript.replaceChildren();
  if (!meeting.transcript.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    const icon = document.createElement('div'); icon.className = 'empty-icon'; icon.textContent = '↔';
    const title = document.createElement('strong'); title.textContent = tr('empty.title');
    const description = document.createElement('span'); description.textContent = tr('empty.description');
    empty.append(icon, title, description);
    els.transcript.append(empty); return;
  }
  for (const entry of meeting.transcript) {
    const p = meeting.participants.find((x) => x.id === entry.participantId);
    const item = document.createElement('article'); item.className = `message ${entry.speakerType === 'USER' ? 'user' : 'ai'}`;
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const speaker = document.createElement('span'); speaker.className = 'message-speaker'; speaker.textContent = entry.speakerType === 'USER' ? tr('message.you') : (p?.label || providerLabel(entry.provider));
    const turn = document.createElement('span'); turn.textContent = entry.turnNumber ? tr('turn.label', { count: entry.turnNumber }) : tr('workspace.room');
    const time = document.createElement('span'); time.textContent = timeLabel(entry.createdAt);
    meta.append(speaker, turn, time);
    const bubble = document.createElement('div'); bubble.className = 'message-bubble'; bubble.textContent = entry.text;
    item.append(meta, bubble); els.transcript.append(item);
  }
  requestAnimationFrame(() => { els.transcript.scrollTop = els.transcript.scrollHeight; });
}

function renderActivity() {
  els.activityLog.replaceChildren();
  const logs = meeting.activityLog || [];
  els.activityCount.textContent = String(logs.length);
  for (const log of logs.slice(-80).reverse()) {
    const row = document.createElement('div'); row.className = `activity-item ${log.level === 'WARN' ? 'warn' : ''}`;
    const time = document.createElement('span'); time.className = 'activity-time'; time.textContent = new Date(log.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const text = document.createElement('span'); text.className = 'activity-message'; text.textContent = log.stage ? `${log.stage} · ${log.message}` : log.message;
    row.append(time, text); els.activityLog.append(row);
  }
}

function renderSettings() {
  const s = meeting.settings || {};
  const session = meeting.session || {};
  const coordinationEditable = meeting.status === 'READY' || (meeting.status === 'PAUSED' && !meeting.activeTransaction);
  els.maxTurns.value = s.maxTurns ?? 20;
  els.maxDurationMinutes.value = Math.round((s.maxDurationMs ?? 1800000) / 60000);
  els.maxHops.value = s.maxHops ?? 20;
  els.delaySeconds.value = ((s.minDelayMs ?? 4000) / 1000).toString();
  els.retryLimit.value = s.retryLimit ?? 3;
  els.responseTimeout.value = Math.round((s.responseTimeoutMs ?? 120000) / 1000);
  els.smartRouting.checked = s.smartRouting !== false;
  els.captureScreenshots.checked = Boolean(s.captureScreenshots);
  els.sessionTemplate.replaceChildren();
  for (const [value, labelKey] of SESSION_OPTIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = tr(labelKey);
    option.selected = value === (session.templateId || 'freeform');
    els.sessionTemplate.append(option);
  }
  els.sessionPhaseHint.textContent = session.status === 'COMPLETE'
    ? tr('session.complete')
    : tr('session.phase', { status: statusLabel(session.status || 'READY'), phase: (Number(session.phaseIndex) || 0) + 1 });
  els.loopGuardEnabled.checked = s.loopGuardEnabled !== false;
  els.loopGuardInteractive.checked = s.loopGuardInteractive === true;
  els.loopGuardMaxHops.value = s.loopGuardMaxHops ?? 20;
  els.loopGuardMaxSameSpeaker.value = s.loopGuardMaxSameSpeaker ?? 3;
  els.loopGuardMaxSameRoute.value = s.loopGuardMaxSameRoute ?? 6;
  for (const el of [els.maxDurationMinutes, els.maxHops, els.sessionTemplate, els.loopGuardEnabled, els.loopGuardInteractive, els.loopGuardMaxHops, els.loopGuardMaxSameSpeaker, els.loopGuardMaxSameRoute]) {
    el.disabled = !coordinationEditable;
  }
}

function renderAttention() {
  const needs = meeting.status === 'NEEDS_ATTENTION';
  const guardPause = meeting.status === 'PAUSED' && Boolean(meeting.loopGuard?.lastReason);
  els.attentionStrip.hidden = !(needs || guardPause);
  els.attentionMessage.textContent = guardPause
    ? meeting.loopGuard.lastReason
    : (meeting.activeTransaction?.error || tr('attention.message'));
  els.retryTransaction.disabled = guardPause;
  els.skipParticipant.disabled = guardPause;
  els.reconnectParticipant.disabled = guardPause;
}

function renderControls() {
  const status = meeting.status;
  const autonomous = meeting.interactionMode === 'autonomous';
  const canChangeMode = ['READY', 'PAUSED'].includes(status);
  els.meetingStatus.textContent = statusLabel(status); els.meetingStatus.dataset.status = status;
  if (document.activeElement !== els.meetingTitle) {
    els.meetingTitle.value = isDefaultMeetingTitle(meeting.title) ? tr('meeting.defaultTitle') : meeting.title;
  }
  els.turnCounter.textContent = turnLabel(meeting.currentTurn);
  els.interactionMode.dataset.mode = autonomous ? 'autonomous' : 'interactive';
  els.interactiveMode.setAttribute('aria-pressed', String(!autonomous));
  els.autonomousMode.setAttribute('aria-pressed', String(autonomous));
  els.interactiveMode.disabled = !canChangeMode;
  els.autonomousMode.disabled = !canChangeMode;
  els.modeHint.textContent = autonomous
    ? (status === 'LIVE' ? tr('mode.fullAutoLiveHint') : tr('mode.fullAutoReadyHint'))
    : tr('mode.interactiveHint');
  els.composer.closest('.composer-section').dataset.observer = String(autonomous && status === 'LIVE');
  els.composer.disabled = autonomous && status === 'LIVE';
  els.sendUserMessage.disabled = autonomous && status === 'LIVE';
  els.composer.placeholder = autonomous && status === 'LIVE' ? tr('composer.fullAutoPlaceholder') : tr('composer.placeholder');
  els.joinConversation.hidden = !(autonomous && status === 'PAUSED' && !meeting.activeTransaction);
  els.startMeeting.disabled = status === 'LIVE';
  els.startMeeting.textContent = status === 'PAUSED' ? tr('button.resumeMeeting') : (status === 'FINISHED' ? tr('button.restartMeeting') : tr('button.start'));
  els.pauseMeeting.disabled = !['LIVE','PAUSED'].includes(status);
  els.pauseMeeting.textContent = status === 'PAUSED' ? tr('button.resume') : tr('button.pause');
  els.endMeeting.disabled = status === 'FINISHED' || status === 'READY';
  const hasTranscript = Boolean(meeting.transcript?.length);
  els.exportMarkdown.disabled = !hasTranscript;
  els.exportJson.disabled = !hasTranscript;
  els.exportText.disabled = !hasTranscript;
  const hasReport = Boolean(meeting.artifact);
  els.exportReportMarkdown.disabled = !hasReport;
  els.exportReportText.disabled = !hasReport;
}

function render() {
  if (!meeting) return;
  syncLanguageFromMeeting();
  applyTranslations();
  renderWorkspace(); renderControls(); renderParticipants(); renderStatusCenter(); renderTranscript(); renderActivity(); renderSettings(); renderAttention(); renderSchedule();
}

async function refreshTabs(showNotice = true) {
  try {
    const result = await call('LIST_SUPPORTED_TABS');
    supportedTabs = result.tabs || [];
    tabStatus = result.status || buildTabStatusSnapshot({ tabs: supportedTabs, participants: meeting?.participants || [], activeTransaction: meeting?.activeTransaction });
    if (showNotice) notice(tr('notice.tabsFound', { count: supportedTabs.length }));
  }
  catch (e) { notice(e.message, true); }
}

async function load() {
  try {
    const [state, tabs, savedSchedule] = await Promise.all([call('GET_WORKSPACE_STATE'), call('LIST_SUPPORTED_TABS'), call('GET_SCHEDULE')]);
    meeting = state.meeting;
    workspace = state.workspace;
    supportedTabs = tabs.tabs || [];
    tabStatus = tabs.status || buildTabStatusSnapshot({ tabs: supportedTabs, participants: meeting.participants, activeTransaction: meeting.activeTransaction });
    schedule = normalizeSchedule(savedSchedule.schedule || schedule);
    render();
  } catch (e) { notice(e.message, true); }
}

els.refreshTabs.addEventListener('click', async () => { await refreshTabs(); renderParticipants(); renderStatusCenter(); });
els.addParticipant.addEventListener('click', async () => { try { await call('ADD_PARTICIPANT'); render(); } catch (e) { notice(e.message, true); } });
els.roomSelect.addEventListener('change', async () => {
  try { await call('SELECT_ROOM', { roomId: els.roomSelect.value }); await refreshTabs(false); render(); notice(tr('notice.roomLoaded')); }
  catch (e) { notice(e.message, true); }
});
els.createRoom.addEventListener('click', async () => {
  try { await call('CREATE_ROOM', { options: { title: 'New Room', playbookId: 'freeform', settings: { language } } }); await refreshTabs(false); render(); notice(tr('notice.roomCreated')); }
  catch (e) { notice(e.message, true); }
});
els.playbookPicker.addEventListener('change', async () => {
  try { await call('UPDATE_PLAYBOOK', { playbookId: els.playbookPicker.value }); render(); notice(tr('notice.playbookUpdated')); }
  catch (e) { notice(e.message, true); }
});

async function chooseInteractionMode(mode) {
  try { await call('SET_INTERACTION_MODE', { mode }); render(); }
  catch (e) { notice(e.message, true); }
}
els.interactiveMode.addEventListener('click', () => chooseInteractionMode('interactive'));
els.autonomousMode.addEventListener('click', () => chooseInteractionMode('autonomous'));
els.joinConversation.addEventListener('click', () => chooseInteractionMode('interactive'));

els.startMeeting.addEventListener('click', async () => {
  try {
    if (meeting.status === 'PAUSED') { await call('RESUME_MEETING'); }
    else if (meeting.status === 'FINISHED') {
      await call('NEW_MEETING', { options: { title: meeting.title, interactionMode: meeting.interactionMode, settings: { language }, session: { templateId: meeting.session?.templateId || 'freeform' } } });
      await refreshTabs(false);
      notice(tr('notice.reconnectTabs'));
    }
    else {
      const seedText = els.composer.value.trim();
      await call('START_MEETING', { seedText, mode: meeting.interactionMode || 'interactive' });
      if (seedText) els.composer.value = '';
    }
    render();
  } catch (e) { notice(e.message, true); }
});

els.pauseMeeting.addEventListener('click', async () => {
  try { await call(meeting.status === 'PAUSED' ? 'RESUME_MEETING' : 'PAUSE_MEETING'); render(); }
  catch (e) { notice(e.message, true); }
});
els.endMeeting.addEventListener('click', async () => { try { await call('END_MEETING'); render(); } catch (e) { notice(e.message, true); } });

async function sendComposer() {
  const text = els.composer.value.trim(); if (!text) return;
  if (meeting.interactionMode === 'autonomous' && meeting.status === 'LIVE') {
    notice(tr('notice.fullAutoBlocked'), true);
    return;
  }
  try {
    if (meeting.status === 'READY' && !meeting.transcript.length) {
      await call('USER_MESSAGE', { text });
      notice(tr('notice.topicAdded'));
    } else await call('USER_MESSAGE', { text });
    els.composer.value = ''; render();
  } catch (e) { notice(e.message, true); }
}

function downloadText(filename, content, mimeType) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportTranscript(format) {
  if (!meeting?.transcript?.length) {
    notice(tr('notice.noTranscript'));
    return;
  }
  if (format === 'markdown') {
    const filename = safeExportFilename(meeting.title, 'md');
    downloadText(filename, formatMeetingMarkdown(meeting), 'text/markdown');
    notice(tr('notice.saved', { filename }));
    return;
  }
  if (format === 'text') {
    const filename = safeExportFilename(meeting.title, 'txt');
    downloadText(filename, formatMeetingText(meeting), 'text/plain');
    notice(tr('notice.saved', { filename }));
    return;
  }
  const filename = safeExportFilename(meeting.title, 'json');
  downloadText(filename, formatMeetingJson(meeting), 'application/json');
  notice(tr('notice.saved', { filename }));
}

function exportReport(format) {
  if (!meeting?.artifact) {
    notice(tr('notice.reportFirst'));
    return;
  }
  const text = format === 'markdown' ? formatRunReportMarkdown(meeting.artifact) : formatRunReportText(meeting.artifact);
  const extension = format === 'markdown' ? 'md' : 'txt';
  const filename = safeExportFilename(`${meeting.title}-report`, extension);
  downloadText(filename, text, format === 'markdown' ? 'text/markdown' : 'text/plain');
  notice(tr('notice.saved', { filename }));
}

async function updateSchedule() {
  const current = normalizeSchedule(schedule);
  const topic = els.scheduleTopic.value.trim();
  const next = {
    ...current,
    enabled: els.scheduleEnabled.checked,
    slots: {
      morning: { ...current.slots.morning, enabled: els.scheduleMorningEnabled.checked, time: els.scheduleMorningTime.value || current.slots.morning.time, mode: els.scheduleMode.value, topic },
      evening: { ...current.slots.evening, enabled: els.scheduleEveningEnabled.checked, time: els.scheduleEveningTime.value || current.slots.evening.time, mode: els.scheduleMode.value, topic },
    },
  };
  try {
    const result = await call('UPDATE_SCHEDULE', { schedule: next });
    schedule = normalizeSchedule(result.schedule || next);
    renderSchedule();
    notice(tr('notice.scheduleSaved'));
  } catch (e) { notice(e.message, true); }
}

async function runScheduleNow() {
  try {
    const result = await call('RUN_SCHEDULE_NOW', { slotId: els.scheduleRunSlot.value });
    render();
    if (result.error) notice(result.error, true);
    else notice(result.skipped ? tr('notice.scheduleSkipped') : tr('notice.scheduleStarted'));
  } catch (e) { notice(e.message, true); }
}

els.sendUserMessage.addEventListener('click', sendComposer);
els.composer.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComposer(); } });
els.exportMarkdown.addEventListener('click', () => exportTranscript('markdown'));
els.exportJson.addEventListener('click', () => exportTranscript('json'));
els.exportText.addEventListener('click', () => exportTranscript('text'));
els.exportReportMarkdown.addEventListener('click', () => exportReport('markdown'));
els.exportReportText.addEventListener('click', () => exportReport('text'));
els.saveSchedule.addEventListener('click', updateSchedule);
els.runScheduleNow.addEventListener('click', runScheduleNow);

els.retryTransaction.addEventListener('click', async () => { try { await call('RETRY_TRANSACTION'); render(); } catch (e) { notice(e.message, true); } });
els.skipParticipant.addEventListener('click', async () => { try { await call('SKIP_PARTICIPANT'); render(); } catch (e) { notice(e.message, true); } });
els.reconnectParticipant.addEventListener('click', async () => { try { await call('RECONNECT_PARTICIPANT'); render(); } catch (e) { notice(`${e.message} ${tr('participant.chooseTab')}`, true); } });

async function updateSettings() {
  try {
    await call('UPDATE_MEETING_SETTINGS', { settings: {
      maxTurns: Number(els.maxTurns.value), minDelayMs: Number(els.delaySeconds.value) * 1000,
      retryLimit: Number(els.retryLimit.value), responseTimeoutMs: Number(els.responseTimeout.value) * 1000,
      maxDurationMs: Number(els.maxDurationMinutes.value) * 60000, maxHops: Number(els.maxHops.value),
      smartRouting: els.smartRouting.checked, captureScreenshots: els.captureScreenshots.checked,
    } }); render();
  } catch (e) { notice(e.message, true); }
}
for (const el of [els.maxTurns,els.maxDurationMinutes,els.maxHops,els.delaySeconds,els.retryLimit,els.responseTimeout,els.smartRouting]) el.addEventListener('change', updateSettings);
els.captureScreenshots.addEventListener('change', async () => {
  updateSettings();
});

async function updateLoopGuard() {
  try {
    await call('UPDATE_LOOP_GUARD', { settings: {
      loopGuardEnabled: els.loopGuardEnabled.checked,
      loopGuardInteractive: els.loopGuardInteractive.checked,
      loopGuardMaxHops: Number(els.loopGuardMaxHops.value),
      loopGuardMaxSameSpeaker: Number(els.loopGuardMaxSameSpeaker.value),
      loopGuardMaxSameRoute: Number(els.loopGuardMaxSameRoute.value),
    } });
    render();
  } catch (e) { notice(e.message, true); }
}
for (const el of [els.loopGuardEnabled, els.loopGuardInteractive, els.loopGuardMaxHops, els.loopGuardMaxSameSpeaker, els.loopGuardMaxSameRoute]) {
  el.addEventListener('change', updateLoopGuard);
}
els.sessionTemplate.addEventListener('change', async () => {
  try { await call('UPDATE_SESSION_TEMPLATE', { templateId: els.sessionTemplate.value }); render(); }
  catch (e) { notice(e.message, true); }
});

els.clearTranscript.addEventListener('click', async () => { try { await call('CLEAR_TRANSCRIPT'); render(); } catch (e) { notice(e.message, true); } });
els.newMeeting.addEventListener('click', async () => { try { await call('NEW_MEETING', { options: { title: tr('meeting.defaultTitle'), settings: { language } } }); await refreshTabs(false); render(); notice(tr('notice.newMeeting')); } catch (e) { notice(e.message, true); } });

els.meetingTitle.addEventListener('input', () => {
  clearTimeout(titleSaveTimer);
  titleSaveTimer = setTimeout(async () => {
    // Title persists through NEW_MEETING; a dedicated command is intentionally lightweight via settings-like mutation.
    try {
      const current = await call('GET_MEETING_STATE');
      if (current.meeting.title === els.meetingTitle.value.trim()) return;
      // Reuse a background command added for title updates.
      await call('UPDATE_MEETING_TITLE', { title: els.meetingTitle.value.trim() || tr('meeting.defaultTitle') });
    } catch (e) { notice(e.message, true); }
  }, 450);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'MEETING_STATE_CHANGED' && message.meeting) {
    meeting = message.meeting;
    workspace = message.workspace || workspace;
    tabStatus = buildTabStatusSnapshot({ tabs: supportedTabs, participants: meeting.participants, activeTransaction: meeting.activeTransaction });
    render();
  }
});

load();

// The Side Panel remains alive while the user browses other tabs. Use it as a
// heartbeat so the MV3 service worker re-checks the active provider turn even
// when Gemini/Claude/Copilot background pages throttle or freeze their timers.
setInterval(() => {
  if (!meeting?.activeTransaction || !['LIVE','PAUSED','NEEDS_ATTENTION'].includes(meeting.status)) return;
  chrome.runtime.sendMessage({ type: 'CHECK_ACTIVE_TURN' }).catch(() => {});
}, 1800);

setInterval(() => refreshTabs(false).then(() => { if (document.activeElement?.tagName !== 'SELECT') { renderParticipants(); renderStatusCenter(); } }).catch(() => {}), 8000);
