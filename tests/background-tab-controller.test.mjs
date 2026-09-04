import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundTabController } from '../background-tab-controller.mjs';

function event() {
  return { addListener() {} };
}

test('Gemini recovery releases a stale debugger session and attaches a fresh one', async () => {
  const calls = [];
  const api = {
    tabs: { get: async () => ({ id: 7, active: false, discarded: false }) },
    debugger: {
      onDetach: event(),
      attach: async (target) => calls.push(`attach:${target.tabId}`),
      detach: async (target) => calls.push(`detach:${target.tabId}`),
      sendCommand: async (target, method) => calls.push(`${method}:${target.tabId}`),
    },
  };
  const controller = createBackgroundTabController(api, { now: () => 1 });
  await controller.ensure({ tabId: 7, provider: 'gemini' });
  const recovered = await controller.recover({ tabId: 7, provider: 'gemini' });

  assert.equal(recovered.ok, true);
  assert.equal(calls.filter((call) => call === 'attach:7').length, 2);
  assert.equal(calls.filter((call) => call === 'detach:7').length, 1);
  assert.equal(controller.isAttached(7), true);
});

test('ChatGPT recovery stays content-script based and does not claim debugger ownership', async () => {
  const api = { tabs: { get: async () => ({ id: 8, active: false, discarded: false }) }, debugger: { onDetach: event() } };
  const controller = createBackgroundTabController(api);
  const recovered = await controller.recover({ tabId: 8, provider: 'chatgpt' });

  assert.equal(recovered.ok, true);
  assert.equal(recovered.skipped, true);
  assert.equal(controller.isAttached(8), false);
});
