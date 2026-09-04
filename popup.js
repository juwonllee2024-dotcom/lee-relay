const $ = (id) => document.getElementById(id);

const startButton = $('start');
const stopButton = $('stop');
const statusBox = $('status');
const eventBox = $('event');
const captureScreenshotsCheckbox = $('captureScreenshots');
const tabASelect = $('tabA');
const tabBSelect = $('tabB');
const firstSpeakerInput = $('firstSpeaker');
const starterA = $('starterA');
const starterB = $('starterB');
const refreshTabsButton = $('refreshTabs');
const relayLink = $('relayLink');
const maxTurnsInput = $('maxTurns');
const delaySecondsInput = $('delaySeconds');

let latestTabs = [];

const PROVIDER_UI = {
  chatgpt: { label: 'ChatGPT', icon: 'GPT' },
  claude: { label: 'Claude', icon: 'C' },
  gemini: { label: 'Gemini', icon: 'G' },
  copilot: { label: 'Copilot', icon: 'M' },
};

function setStatus(text, isError = false) {
  statusBox.textContent = text;
  statusBox.classList.toggle('error', isError);
}

function findTab(tabId) {
  return latestTabs.find((tab) => String(tab.tabId) === String(tabId || '')) || null;
}

function fillSelect(select, options, selectedValue) {
  if (document.activeElement === select) return;
  const current = String(selectedValue ?? '');
  select.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = options.length ? 'Choose an open AI tab' : 'No supported AI tabs open';
  select.appendChild(placeholder);

  for (const option of options) {
    const el = document.createElement('option');
    el.value = String(option.tabId);
    el.textContent = option.label;
    if (String(option.tabId) === current) el.selected = true;
    select.appendChild(el);
  }

  if (current && !options.some((option) => String(option.tabId) === current)) {
    select.value = '';
  }
}

function updateProviderCard(slot, tab) {
  const suffix = slot === 'a' ? 'A' : 'B';
  const card = document.querySelector(`.ai-card[data-slot="${slot}"]`);
  const icon = $(`providerIcon${suffix}`);
  const name = $(`providerName${suffix}`);
  const meta = $(`providerMeta${suffix}`);

  icon.className = 'provider-icon neutral';
  if (!tab) {
    icon.textContent = 'AI';
    name.textContent = 'Choose AI';
    meta.textContent = 'Select an open tab';
    card?.classList.remove('connected');
    return;
  }

  const provider = PROVIDER_UI[tab.provider] || { label: tab.providerLabel || 'AI', icon: 'AI' };
  icon.classList.add(tab.provider || 'neutral');
  icon.textContent = provider.icon;
  name.textContent = provider.label;
  meta.textContent = tab.title || 'Open conversation';
  card?.classList.add('connected');
}

function updateStarterButtons() {
  const tabA = findTab(tabASelect.value);
  const tabB = findTab(tabBSelect.value);
  const selected = firstSpeakerInput.value === 'b' ? 'b' : 'a';

  starterA.querySelector('.starter-name').textContent = tabA?.providerLabel || 'AI 1';
  starterB.querySelector('.starter-name').textContent = tabB?.providerLabel || 'AI 2';
  starterA.classList.toggle('selected', selected === 'a');
  starterB.classList.toggle('selected', selected === 'b');
}

function setStarter(speaker, { persist = true } = {}) {
  firstSpeakerInput.value = speaker === 'b' ? 'b' : 'a';
  updateStarterButtons();
  if (persist) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_OPTIONS',
      options: { firstSpeaker: firstSpeakerInput.value },
    }).catch((error) => setStatus(error.message || String(error), true));
  }
}

function updateRunVisuals(state) {
  const running = Boolean(state.running);
  $('stateBadge').className = `status-pill ${running ? 'running' : 'stopped'}`;
  $('stateBadge').querySelector('span').textContent = running ? 'LIVE' : 'READY';
  relayLink.classList.toggle('live', running);

  startButton.disabled = running;
  stopButton.disabled = !running;
  tabASelect.disabled = running;
  tabBSelect.disabled = running;
  starterA.disabled = running;
  starterB.disabled = running;
  maxTurnsInput.disabled = running;
  delaySecondsInput.disabled = running;

  const launchStrong = startButton.querySelector('.launch-copy strong');
  const launchSmall = startButton.querySelector('.launch-copy small');
  if (running) {
    launchStrong.textContent = 'RELAY LIVE';
    launchSmall.textContent = `Turn ${state.turnCount}${state.maxTurns ? ` of ${state.maxTurns}` : ''}`;
  } else {
    launchStrong.textContent = 'START RELAY';
    launchSmall.textContent = 'Connect selected AIs';
  }
}

function render(payload) {
  if (!payload?.ok) {
    setStatus(payload?.error || 'Unable to read relay status.', true);
    return;
  }

  const { state, availableTabs = [] } = payload;
  latestTabs = availableTabs;

  if (document.activeElement !== captureScreenshotsCheckbox) {
    captureScreenshotsCheckbox.checked = Boolean(state.captureScreenshots);
  }
  if (document.activeElement !== maxTurnsInput) maxTurnsInput.value = String(state.maxTurns ?? 20);
  if (document.activeElement !== delaySecondsInput) {
    delaySecondsInput.value = String(Math.max(3, Math.round((state.minDelayMs ?? 4000) / 1000)));
  }

  fillSelect(tabASelect, availableTabs, state.selectedTabs?.a?.tabId);
  fillSelect(tabBSelect, availableTabs, state.selectedTabs?.b?.tabId);
  updateProviderCard('a', findTab(tabASelect.value));
  updateProviderCard('b', findTab(tabBSelect.value));

  if (document.activeElement !== starterA && document.activeElement !== starterB) {
    setStarter(state.firstSpeaker === 'b' ? 'b' : 'a', { persist: false });
  } else {
    updateStarterButtons();
  }

  updateRunVisuals(state);

  const selectedA = state.selectedTabs?.a?.tabId;
  const selectedB = state.selectedTabs?.b?.tabId;
  if (state.lastError) setStatus(state.lastError, true);
  else if (!availableTabs.length) setStatus('Open at least two supported AI tabs to begin.', true);
  else if (!selectedA || !selectedB) setStatus('Choose two AI tabs to create a relay.');
  else if (selectedA === selectedB) setStatus('AI 1 and AI 2 must be different tabs.', true);
  else if (state.running) setStatus(`Relay live · ${state.turnCount}${state.maxTurns ? ` / ${state.maxTurns}` : ''} turns delivered`);
  else setStatus('Ready to connect the selected AIs.');

  eventBox.textContent = state.lastEvent || '';
}

async function refresh() {
  try {
    render(await chrome.runtime.sendMessage({ type: 'GET_STATUS' }));
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

async function persistTabSelections() {
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_OPTIONS',
      options: {
        selectedTabA: Number(tabASelect.value || 0),
        selectedTabB: Number(tabBSelect.value || 0),
      },
    });
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  setStatus('Starting relay…');
  const options = {
    seed: $('seed').value,
    maxTurns: Number(maxTurnsInput.value || 20),
    minDelayMs: Number(delaySecondsInput.value || 4) * 1000,
    captureScreenshots: captureScreenshotsCheckbox.checked,
    selectedTabA: Number(tabASelect.value || 0),
    selectedTabB: Number(tabBSelect.value || 0),
    firstSpeaker: firstSpeakerInput.value === 'b' ? 'b' : 'a',
  };

  try {
    const result = await chrome.runtime.sendMessage({ type: 'START_RELAY', options });
    if (!result?.ok) setStatus(result?.error || 'Unable to start relay.', true);
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
  await refresh();
});

stopButton.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_RELAY' });
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
  await refresh();
});

captureScreenshotsCheckbox.addEventListener('change', async () => {
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'UPDATE_OPTIONS',
      options: { captureScreenshots: captureScreenshotsCheckbox.checked },
    });
    if (!result?.ok) setStatus(result?.error || 'Unable to save screenshot setting.', true);
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
  await refresh();
});

starterA.addEventListener('click', () => setStarter('a'));
starterB.addEventListener('click', () => setStarter('b'));

refreshTabsButton.addEventListener('click', refresh);

tabASelect.addEventListener('change', async () => {
  updateProviderCard('a', findTab(tabASelect.value));
  updateStarterButtons();
  await persistTabSelections();
  await refresh();
});

tabBSelect.addEventListener('change', async () => {
  updateProviderCard('b', findTab(tabBSelect.value));
  updateStarterButtons();
  await persistTabSelections();
  await refresh();
});

refresh();
setInterval(refresh, 2000);
