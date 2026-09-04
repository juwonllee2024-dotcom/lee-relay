const PROVIDER_LABELS = Object.freeze({
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  copilot: 'Copilot',
});

const BUSY_TURN_STATES = new Set(['SENDING', 'VERIFYING', 'THINKING', 'RECEIVING', 'SPEAKING']);
const BUSY_TRANSACTION_STAGES = new Set([
  'PREPARING', 'SENDING', 'VERIFYING_DELIVERY', 'DELIVERED', 'WAITING_FOR_GENERATION',
  'RECEIVING', 'VERIFYING_RESPONSE', 'RETRYING',
]);
const ERROR_STATES = new Set(['ERROR', 'FAILED']);
const DISCONNECTED_STATES = new Set(['DISCONNECTED', 'RECONNECTING']);

function tabIdOf(value) {
  const tabId = Number(value);
  return Number.isInteger(tabId) ? tabId : null;
}

function providerLabel(provider) {
  return PROVIDER_LABELS[String(provider || '').toLowerCase()] || 'AI';
}

export function classifyTabHealth({
  tabId = null,
  participantId = null,
  connectionState = '',
  turnState = '',
  transactionStage = '',
  lastSeenAt = 0,
  now = Date.now(),
  staleAfterMs = 15 * 60 * 1000,
} = {}) {
  const connection = String(connectionState || '').toUpperCase();
  const turn = String(turnState || '').toUpperCase();
  const stage = String(transactionStage || '').toUpperCase();
  if (ERROR_STATES.has(connection)) return 'ERROR';
  if (!Number.isInteger(tabId)) return participantId ? 'DISCONNECTED' : 'UNBOUND';
  if (connection === 'UNBOUND' || (!participantId && !connection)) return 'UNBOUND';
  if (DISCONNECTED_STATES.has(connection)) return 'DISCONNECTED';
  if (BUSY_TRANSACTION_STAGES.has(stage) || BUSY_TURN_STATES.has(turn)) return 'BUSY';
  const seen = Number(lastSeenAt);
  const current = Number(now);
  const staleWindow = Math.max(1_000, Number(staleAfterMs) || 15 * 60 * 1000);
  if (seen > 0 && Number.isFinite(current) && current - seen > staleWindow) return 'STALE';
  return 'READY';
}

export function healthTone(health) {
  return {
    READY: 'good',
    BUSY: 'active',
    STALE: 'warn',
    ERROR: 'bad',
    DISCONNECTED: 'bad',
    UNBOUND: 'muted',
  }[String(health || '').toUpperCase()] || 'muted';
}

export function buildTabStatusSnapshot({
  tabs = [],
  participants = [],
  activeTransaction = null,
  now = Date.now(),
  staleAfterMs = 15 * 60 * 1000,
} = {}) {
  const participantList = Array.isArray(participants) ? participants : [];
  const participantsByTab = new Map();
  for (const participant of participantList) {
    const tabId = tabIdOf(participant?.tabId);
    if (tabId !== null) participantsByTab.set(tabId, participant);
  }

  const rows = [];
  const seenTabs = new Set();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const tabId = tabIdOf(tab?.tabId);
    if (tabId === null || seenTabs.has(tabId)) continue;
    seenTabs.add(tabId);
    const participant = participantsByTab.get(tabId) || null;
    const transaction = participant && activeTransaction?.participantId === participant.id ? activeTransaction : null;
    const row = {
      tabId,
      provider: tab?.provider || participant?.provider || null,
      providerLabel: tab?.providerLabel || providerLabel(tab?.provider || participant?.provider),
      label: tab?.label || participant?.label || providerLabel(tab?.provider || participant?.provider),
      title: tab?.title || '',
      url: tab?.url || participant?.url || '',
      active: Boolean(tab?.active),
      participantId: participant?.id || null,
      connectionState: participant?.connectionState || 'UNBOUND',
      turnState: participant?.turnState || 'WAITING',
      transactionStage: transaction?.stage || null,
      recoveryCount: Number(transaction?.recoveryCount) || 0,
      lastSeenAt: Number(participant?.lastSeenAt) || 0,
    };
    row.health = classifyTabHealth({ ...row, now, staleAfterMs });
    row.tone = healthTone(row.health);
    rows.push(row);
  }

  for (const participant of participantList) {
    const tabId = tabIdOf(participant?.tabId);
    if (tabId !== null && seenTabs.has(tabId)) continue;
    const transaction = activeTransaction?.participantId === participant?.id ? activeTransaction : null;
    const row = {
      tabId: null,
      provider: participant?.provider || null,
      providerLabel: providerLabel(participant?.provider),
      label: participant?.label || providerLabel(participant?.provider),
      title: '',
      url: participant?.url || '',
      active: false,
      participantId: participant?.id || null,
      connectionState: participant?.connectionState || 'DISCONNECTED',
      turnState: participant?.turnState || 'WAITING',
      transactionStage: transaction?.stage || null,
      recoveryCount: Number(transaction?.recoveryCount) || 0,
      lastSeenAt: Number(participant?.lastSeenAt) || 0,
    };
    row.health = classifyTabHealth({ ...row, now, staleAfterMs });
    row.tone = healthTone(row.health);
    rows.push(row);
  }
  return rows;
}
