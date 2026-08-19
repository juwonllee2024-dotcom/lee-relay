const $ = (id) => document.getElementById(id);
let meeting = null;
let supportedTabs = [];
let titleSaveTimer = null;

const els = {
  meetingTitle: $('meetingTitle'), meetingStatus: $('meetingStatus'), participantCount: $('participantCount'), participants: $('participants'),
  addParticipant: $('addParticipant'), refreshTabs: $('refreshTabs'), transcript: $('transcript'), turnCounter: $('turnCounter'), composer: $('composer'),
  sendUserMessage: $('sendUserMessage'), startMeeting: $('startMeeting'), pauseMeeting: $('pauseMeeting'), endMeeting: $('endMeeting'), uiNotice: $('uiNotice'),
  attentionStrip: $('attentionStrip'), attentionMessage: $('attentionMessage'), retryTransaction: $('retryTransaction'), skipParticipant: $('skipParticipant'), reconnectParticipant: $('reconnectParticipant'),
  maxTurns: $('maxTurns'), delaySeconds: $('delaySeconds'), retryLimit: $('retryLimit'), responseTimeout: $('responseTimeout'), smartRouting: $('smartRouting'), captureScreenshots: $('captureScreenshots'),
  clearTranscript: $('clearTranscript'), newMeeting: $('newMeeting'), activityCount: $('activityCount'), activityLog: $('activityLog'),
};

async function call(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || 'Lee Relay command failed.');
  if (result.meeting) meeting = result.meeting;
  return result;
}

function notice(text = '', error = false) {
  els.uiNotice.textContent = text;
  els.uiNotice.classList.toggle('error', Boolean(error));
}

function timeLabel(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function providerLabel(p) {
  return { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot' }[p] || 'Unbound AI';
}

function activeParticipantId() {
  return meeting?.activeTransaction?.participantId || meeting?.nextSpeakerParticipantId || null;
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
    const state = document.createElement('span'); state.className = 'participant-state'; state.textContent = p.connectionState !== 'READY' ? p.connectionState : (p.turnState || 'WAITING');
    top.append(name, state);
    if (meeting.participants.length > 2 && p.id !== activeId) {
      const remove = document.createElement('button'); remove.className = 'remove-participant'; remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove participant';
      remove.addEventListener('click', async () => { try { await call('REMOVE_PARTICIPANT', { participantId: p.id }); render(); } catch (e) { notice(e.message, true); } });
      top.append(remove);
    }

    const select = document.createElement('select'); select.className = 'participant-select'; select.setAttribute('aria-label', `AI slot ${p.slotIndex + 1}`);
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose an open AI tab…'; select.append(placeholder);
    for (const tab of supportedTabs) {
      if (usedTabIds.has(tab.tabId) && tab.tabId !== p.tabId) continue;
      const option = document.createElement('option'); option.value = String(tab.tabId); option.textContent = tab.label; option.selected = tab.tabId === p.tabId; select.append(option);
    }
    select.addEventListener('change', async () => {
      if (!select.value) return;
      select.disabled = true;
      try { await call('BIND_PARTICIPANT', { participantId: p.id, tabId: Number(select.value) }); await refreshTabs(false); render(); notice('AI tab connected.'); }
      catch (e) { notice(e.message, true); }
      finally { select.disabled = false; }
    });
    card.append(top, select);
    els.participants.append(card);
  }
  els.participantCount.textContent = `${meeting.participants.length} / 6`;
  els.addParticipant.disabled = meeting.participants.length >= 6;
}

function renderTranscript() {
  els.transcript.replaceChildren();
  if (!meeting.transcript.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    empty.innerHTML = '<div class="empty-icon">↔</div><strong>Your meeting room is ready.</strong><span>Connect two AI tabs, write a topic, then start the meeting.</span>';
    els.transcript.append(empty); return;
  }
  for (const entry of meeting.transcript) {
    const p = meeting.participants.find((x) => x.id === entry.participantId);
    const item = document.createElement('article'); item.className = `message ${entry.speakerType === 'USER' ? 'user' : 'ai'}`;
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const speaker = document.createElement('span'); speaker.className = 'message-speaker'; speaker.textContent = entry.speakerType === 'USER' ? 'You' : (p?.label || providerLabel(entry.provider));
    const turn = document.createElement('span'); turn.textContent = entry.turnNumber ? `Turn ${entry.turnNumber}` : 'Room';
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
  els.maxTurns.value = s.maxTurns ?? 20;
  els.delaySeconds.value = ((s.minDelayMs ?? 4000) / 1000).toString();
  els.retryLimit.value = s.retryLimit ?? 3;
  els.responseTimeout.value = Math.round((s.responseTimeoutMs ?? 120000) / 1000);
  els.smartRouting.checked = s.smartRouting !== false;
  els.captureScreenshots.checked = Boolean(s.captureScreenshots);
}

function renderAttention() {
  const needs = meeting.status === 'NEEDS_ATTENTION';
  els.attentionStrip.hidden = !needs;
  els.attentionMessage.textContent = meeting.activeTransaction?.error || 'The active turn needs recovery.';
}

function renderControls() {
  const status = meeting.status;
  els.meetingStatus.textContent = status.replaceAll('_',' '); els.meetingStatus.dataset.status = status;
  els.meetingTitle.value = meeting.title || 'New AI Meeting';
  els.turnCounter.textContent = `${meeting.currentTurn} ${meeting.currentTurn === 1 ? 'turn' : 'turns'}`;
  els.startMeeting.disabled = status === 'LIVE';
  els.startMeeting.textContent = status === 'PAUSED' ? 'Resume Meeting' : (status === 'FINISHED' ? 'Restart Meeting' : 'Start Meeting');
  els.pauseMeeting.disabled = !['LIVE','PAUSED'].includes(status);
  els.pauseMeeting.textContent = status === 'PAUSED' ? 'Resume' : 'Pause';
  els.endMeeting.disabled = status === 'FINISHED' || status === 'READY';
}

function render() {
  if (!meeting) return;
  renderControls(); renderParticipants(); renderTranscript(); renderActivity(); renderSettings(); renderAttention();
}

async function refreshTabs(showNotice = true) {
  try { const result = await call('LIST_SUPPORTED_TABS'); supportedTabs = result.tabs || []; if (showNotice) notice(`${supportedTabs.length} supported AI tabs found.`); }
  catch (e) { notice(e.message, true); }
}

async function load() {
  try {
    const [state, tabs] = await Promise.all([call('GET_MEETING_STATE'), call('LIST_SUPPORTED_TABS')]);
    meeting = state.meeting; supportedTabs = tabs.tabs || []; render();
  } catch (e) { notice(e.message, true); }
}

els.refreshTabs.addEventListener('click', async () => { await refreshTabs(); renderParticipants(); });
els.addParticipant.addEventListener('click', async () => { try { await call('ADD_PARTICIPANT'); render(); } catch (e) { notice(e.message, true); } });

els.startMeeting.addEventListener('click', async () => {
  try {
    if (meeting.status === 'PAUSED') { await call('RESUME_MEETING'); }
    else if (meeting.status === 'FINISHED') { await call('NEW_MEETING', { options: { title: meeting.title } }); await refreshTabs(false); notice('New meeting created. Reconnect participant tabs.'); }
    else { const seedText = els.composer.value.trim(); await call('START_MEETING', { seedText }); if (seedText) els.composer.value = ''; }
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
  try {
    if (meeting.status === 'READY' && !meeting.transcript.length) {
      await call('USER_MESSAGE', { text });
      notice('Topic added. Press Start Meeting when ready.');
    } else await call('USER_MESSAGE', { text });
    els.composer.value = ''; render();
  } catch (e) { notice(e.message, true); }
}
els.sendUserMessage.addEventListener('click', sendComposer);
els.composer.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComposer(); } });

els.retryTransaction.addEventListener('click', async () => { try { await call('RETRY_TRANSACTION'); render(); } catch (e) { notice(e.message, true); } });
els.skipParticipant.addEventListener('click', async () => { try { await call('SKIP_PARTICIPANT'); render(); } catch (e) { notice(e.message, true); } });
els.reconnectParticipant.addEventListener('click', async () => { try { await call('RECONNECT_PARTICIPANT'); render(); } catch (e) { notice(`${e.message} Choose another tab from the participant card if needed.`, true); } });

async function updateSettings() {
  try {
    await call('UPDATE_MEETING_SETTINGS', { settings: {
      maxTurns: Number(els.maxTurns.value), minDelayMs: Number(els.delaySeconds.value) * 1000,
      retryLimit: Number(els.retryLimit.value), responseTimeoutMs: Number(els.responseTimeout.value) * 1000,
      smartRouting: els.smartRouting.checked, captureScreenshots: els.captureScreenshots.checked,
    } }); render();
  } catch (e) { notice(e.message, true); }
}
for (const el of [els.maxTurns,els.delaySeconds,els.retryLimit,els.responseTimeout,els.smartRouting]) el.addEventListener('change', updateSettings);
els.captureScreenshots.addEventListener('change', async () => {
  if (els.captureScreenshots.checked) {
    const granted = await chrome.permissions.request({ permissions: ['debugger'] }).catch(() => false);
    if (!granted) notice('Exact screenshot permission was not granted. Active-tab screenshots may still work without stealing focus.', true);
  }
  updateSettings();
});

els.clearTranscript.addEventListener('click', async () => { try { await call('CLEAR_TRANSCRIPT'); render(); } catch (e) { notice(e.message, true); } });
els.newMeeting.addEventListener('click', async () => { try { await call('NEW_MEETING', { options: { title: 'New AI Meeting' } }); await refreshTabs(false); render(); notice('New meeting created.'); } catch (e) { notice(e.message, true); } });

els.meetingTitle.addEventListener('input', () => {
  clearTimeout(titleSaveTimer);
  titleSaveTimer = setTimeout(async () => {
    try {
      const current = await call('GET_MEETING_STATE');
      if (current.meeting.title === els.meetingTitle.value.trim()) return;
      await call('UPDATE_MEETING_TITLE', { title: els.meetingTitle.value.trim() || 'New AI Meeting' });
    } catch (e) { notice(e.message, true); }
  }, 450);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'MEETING_STATE_CHANGED' && message.meeting) { meeting = message.meeting; render(); }
});

load();
setInterval(() => refreshTabs(false).then(() => { if (document.activeElement?.tagName !== 'SELECT') renderParticipants(); }).catch(() => {}), 8000);
