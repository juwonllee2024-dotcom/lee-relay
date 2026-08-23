import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundTabController } from '../background-tab-controller.mjs';

function fakeChrome() {
  const calls = [];
  const tab = { id: 17, active: false, discarded: false };
  return {
    calls,
    api: {
      tabs: { get: async () => tab },
      debugger: {
        attach: async (...args) => calls.push(['attach', ...args]),
        sendCommand: async (...args) => { calls.push(['sendCommand', ...args]); return {}; },
        detach: async (...args) => calls.push(['detach', ...args]),
        onDetach: { addListener() {} },
      },
    },
  };
}

test('hidden Gemini tab receives focus and active lifecycle emulation without activation', async () => {
  const chrome = fakeChrome();
  const controller = createBackgroundTabController(chrome.api);

  const first = await controller.ensure({ tabId: 17, provider: 'gemini' });
  const second = await controller.ensure({ tabId: 17, provider: 'gemini' });

  assert.equal(first.ok, true);
  assert.equal(second.reused, true);
  assert.equal(chrome.calls.filter(([type]) => type === 'attach').length, 1);
  assert.equal(chrome.calls.some(([, target, method, params]) => method === 'Emulation.setFocusEmulationEnabled' && params.enabled === true), true);
  assert.equal(chrome.calls.some(([, target, method, params]) => method === 'Page.setWebLifecycleState' && params.state === 'active'), true);
  assert.equal(chrome.calls.some(([type]) => type === 'activateTab'), false);

  await controller.release(17);
  assert.equal(chrome.calls.filter(([type]) => type === 'detach').length, 1);
});
