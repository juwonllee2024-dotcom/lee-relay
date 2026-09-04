const POLICIES = Object.freeze({
  chatgpt: Object.freeze({
    provider: 'chatgpt',
    maxAttempts: 3,
    allowResend: false,
    actions: Object.freeze(['RECONNECT_CONTENT', 'REARM_OBSERVER', 'VERIFY_ONLY']),
  }),
  gemini: Object.freeze({
    provider: 'gemini',
    maxAttempts: 4,
    allowResend: false,
    actions: Object.freeze(['REFRESH_BACKGROUND', 'RECONNECT_CONTENT', 'REARM_OBSERVER', 'VERIFY_ONLY']),
  }),
  default: Object.freeze({
    provider: 'default',
    maxAttempts: 2,
    allowResend: false,
    actions: Object.freeze(['REARM_OBSERVER', 'VERIFY_ONLY']),
  }),
});

export function autoRecoveryPolicyFor(provider) {
  return POLICIES[String(provider || '').toLowerCase()] || POLICIES.default;
}

export function recoveryActionSequence(provider) {
  return [...autoRecoveryPolicyFor(provider).actions];
}

export function nextRecoveryAction({ provider, recoveryCount = 0 } = {}) {
  const policy = autoRecoveryPolicyFor(provider);
  const attempt = Math.max(0, Math.floor(Number(recoveryCount) || 0));
  if (attempt >= policy.maxAttempts) {
    return { action: 'ESCALATE', attempt, maxAttempts: policy.maxAttempts, allowResend: false };
  }
  return {
    action: policy.actions[attempt],
    attempt: attempt + 1,
    maxAttempts: policy.maxAttempts,
    allowResend: policy.allowResend,
  };
}
