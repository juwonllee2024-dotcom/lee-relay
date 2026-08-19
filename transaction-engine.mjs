export const TRANSACTION_STAGES = Object.freeze([
  'PREPARING',
  'SENDING',
  'VERIFYING_DELIVERY',
  'DELIVERED',
  'WAITING_FOR_GENERATION',
  'RECEIVING',
  'VERIFYING_RESPONSE',
  'COMPLETE',
  'RETRYING',
  'NEEDS_ATTENTION',
  'SKIPPED',
]);

const TERMINAL = new Set(['COMPLETE', 'NEEDS_ATTENTION', 'SKIPPED']);
const ALLOWED = new Map([
  ['PREPARING', new Set(['SENDING', 'RETRYING', 'NEEDS_ATTENTION', 'SKIPPED'])],
  ['SENDING', new Set(['VERIFYING_DELIVERY', 'RETRYING', 'NEEDS_ATTENTION', 'SKIPPED'])],
  ['VERIFYING_DELIVERY', new Set(['DELIVERED', 'RETRYING', 'NEEDS_ATTENTION', 'SKIPPED'])],
  ['DELIVERED', new Set(['WAITING_FOR_GENERATION', 'RECEIVING', 'VERIFYING_RESPONSE', 'RETRYING', 'NEEDS_ATTENTION', 'SKIPPED'])],
  ['WAITING_FOR_GENERATION', new Set(['RECEIVING', 'VERIFYING_RESPONSE', 'RETRYING', 'NEEDS_ATTENTION', 'SKIPPED'])],
  ['RECEIVING', new Set(['VERIFYING_RESPONSE', 'RETRYING', 'NEEDS_ATTENTION', 'SKIPPED'])],
  ['VERIFYING_RESPONSE', new Set(['COMPLETE', 'RETRYING', 'NEEDS_ATTENTION', 'SKIPPED'])],
  ['RETRYING', new Set(['PREPARING', 'SENDING', 'VERIFYING_DELIVERY', 'DELIVERED', 'WAITING_FOR_GENERATION', 'RECEIVING', 'VERIFYING_RESPONSE', 'NEEDS_ATTENTION', 'SKIPPED'])],
]);

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createTransaction(args = {}) {
  const now = Number.isFinite(args.now) ? args.now : Date.now();
  return {
    meetingId: args.meetingId,
    transactionId: args.transactionId || `tx-${uid()}`,
    participantId: args.participantId,
    tabId: args.tabId,
    turnNumber: Number(args.turnNumber) || 0,
    stage: 'PREPARING',
    promptText: String(args.promptText || ''),
    promptSignature: args.promptSignature || null,
    preAssistantSignature: args.preAssistantSignature || null,
    preUserSignature: args.preUserSignature || null,
    responseText: args.responseText || '',
    responseSignature: args.responseSignature || null,
    attempt: Number(args.attempt) || 0,
    retryLimit: Number.isFinite(args.retryLimit) ? Math.max(0, args.retryLimit) : 3,
    createdAt: now,
    updatedAt: now,
    lastProgressAt: now,
    responseTimeoutMs: Number.isFinite(args.responseTimeoutMs) ? Math.max(1000, args.responseTimeoutMs) : 120000,
    error: args.error || '',
    deliveryEvidence: args.deliveryEvidence || null,
    lastRetryStage: args.lastRetryStage || null,
  };
}

export function transitionTransaction(tx, nextStage, patch = {}, now = Date.now()) {
  if (!tx) throw new Error('Transaction is required.');
  if (!TRANSACTION_STAGES.includes(nextStage)) throw new Error(`Unknown transaction stage: ${nextStage}`);
  if (TERMINAL.has(tx.stage)) throw new Error(`Transaction is terminal at ${tx.stage}.`);
  if (tx.stage !== nextStage && !ALLOWED.get(tx.stage)?.has(nextStage)) {
    throw new Error(`Invalid transaction transition: ${tx.stage} -> ${nextStage}`);
  }
  return {
    ...tx,
    ...patch,
    stage: nextStage,
    updatedAt: now,
    lastProgressAt: now,
  };
}

export function canAcceptEvent(tx, event = {}) {
  if (!tx || TERMINAL.has(tx.stage)) return false;
  if (event.meetingId != null && event.meetingId !== tx.meetingId) return false;
  if (event.transactionId != null && event.transactionId !== tx.transactionId) return false;
  if (event.participantId != null && event.participantId !== tx.participantId) return false;
  if (event.tabId != null && event.tabId !== tx.tabId) return false;
  return true;
}

export function deliveryEvidenceConfirmed(evidence = {}) {
  return Boolean(evidence.matchingUserMessage || (evidence.sendActionExecuted && evidence.inputCleared && evidence.generationStarted));
}

export function shouldRetryTransaction(tx) {
  if (!tx || TERMINAL.has(tx.stage)) return false;
  return (Number(tx.attempt) || 0) < (Number(tx.retryLimit) || 0);
}

export function markTransactionRetry(tx, reason = '', now = Date.now()) {
  if (!tx) throw new Error('Transaction is required.');
  if (TERMINAL.has(tx.stage)) throw new Error(`Transaction is terminal at ${tx.stage}.`);
  return {
    ...tx,
    stage: 'RETRYING',
    attempt: (Number(tx.attempt) || 0) + 1,
    lastRetryStage: tx.stage,
    error: String(reason || ''),
    updatedAt: now,
    lastProgressAt: now,
  };
}

export function transactionTimedOut(tx, now = Date.now()) {
  if (!tx || TERMINAL.has(tx.stage)) return false;
  const timeout = Number(tx.responseTimeoutMs) || 120000;
  const last = Number(tx.lastProgressAt) || Number(tx.updatedAt) || Number(tx.createdAt) || 0;
  return now - last > timeout;
}

export function isTerminalTransaction(tx) {
  return Boolean(tx && TERMINAL.has(tx.stage));
}
