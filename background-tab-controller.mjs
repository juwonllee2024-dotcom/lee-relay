function targetFor(tabId) {
  return { tabId };
}

function errorText(error) {
  return error?.message || String(error);
}

export function createBackgroundTabController(chromeApi, { onStatus = () => {}, now = () => Date.now() } = {}) {
  const debuggerApi = chromeApi?.debugger || null;
  const live = new Map();

  const sendCommand = (tabId, method, params = {}) => {
    if (typeof debuggerApi?.sendCommand !== 'function') return Promise.reject(new Error('chrome.debugger is unavailable.'));
    return debuggerApi.sendCommand(targetFor(tabId), method, params);
  };

  const bestEffort = async (tabId, method, params = {}) => {
    try {
      await sendCommand(tabId, method, params);
      return true;
    } catch {
      return false;
    }
  };

  async function ensure(participant = {}) {
    const tabId = Number(participant.tabId);
    if (!Number.isInteger(tabId)) return { ok: false, error: 'Participant tab is unavailable.' };
    if (participant.provider !== 'gemini') return { ok: false, skipped: true, reason: 'PROVIDER_NOT_GEMINI' };

    const existing = live.get(tabId);
    if (existing) return { ok: true, reused: true, ...existing };

    const tab = await chromeApi?.tabs?.get?.(tabId).catch(() => null);
    if (!tab) return { ok: false, error: 'Gemini tab is no longer open.' };
    if (tab.active) return { ok: false, skipped: true, reason: 'TAB_ACTIVE' };
    if (tab.discarded) return { ok: false, error: 'Gemini tab is discarded by Chrome.' };
    if (typeof debuggerApi?.attach !== 'function') return { ok: false, error: 'Background debugger access is unavailable.' };

    try {
      await debuggerApi.attach(targetFor(tabId), '1.3');
    } catch (error) {
      return { ok: false, error: `Gemini background attach failed: ${errorText(error)}` };
    }

    const state = { tabId, provider: participant.provider, attachedAt: now(), capabilities: {} };
    live.set(tabId, state);
    const setup = [
      ['Runtime.enable', {}, 'runtime'],
      ['Page.enable', {}, 'page'],
      ['Emulation.setFocusEmulationEnabled', { enabled: true }, 'focusEmulation'],
      ['Page.setWebLifecycleState', { state: 'active' }, 'lifecycleActive'],
      ['Emulation.setIdleOverride', { isUserActive: true, isScreenUnlocked: true }, 'idleOverride'],
    ];
    for (const [method, params, capability] of setup) state.capabilities[capability] = await bestEffort(tabId, method, params);

    const result = { ok: true, attached: true, tabId, provider: participant.provider, capabilities: { ...state.capabilities } };
    try { onStatus({ type: 'ATTACHED', ...result }); } catch {}
    return result;
  }

  async function release(tabIdOrParticipant) {
    const tabId = Number(Number.isInteger(tabIdOrParticipant) ? tabIdOrParticipant : tabIdOrParticipant?.tabId);
    if (!Number.isInteger(tabId) || !live.has(tabId)) return { ok: true, released: false };
    await bestEffort(tabId, 'Emulation.clearIdleOverride');
    await bestEffort(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: false });
    try { await debuggerApi?.detach?.(targetFor(tabId)); } catch {}
    live.delete(tabId);
    try { onStatus({ type: 'DETACHED', tabId }); } catch {}
    return { ok: true, released: true, tabId };
  }

  async function releaseAll() {
    for (const tabId of [...live.keys()]) await release(tabId);
    return { ok: true };
  }

  async function recover(participant = {}) {
    const tabId = Number(participant.tabId);
    if (!Number.isInteger(tabId)) return { ok: false, error: 'Participant tab is unavailable.' };
    // A recovery pass deliberately drops the old debugger session. This makes
    // Gemini re-run the lifecycle/focus setup even when Chrome kept a stale
    // attachment after a background-page suspension.
    await release(tabId);
    if (participant.provider !== 'gemini') return { ok: true, skipped: true, reason: 'PROVIDER_NOT_GEMINI', tabId };
    return ensure(participant);
  }

  debuggerApi?.onDetach?.addListener?.((source, reason) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId) || !live.has(tabId)) return;
    live.delete(tabId);
    try { onStatus({ type: 'DETACHED', tabId, reason }); } catch {}
  });

  return { ensure, recover, release, releaseAll, isAttached: (tabId) => live.has(Number(tabId)) };
}
