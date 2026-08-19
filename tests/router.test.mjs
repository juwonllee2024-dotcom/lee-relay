import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeeting, bindParticipant, addParticipant, updateParticipant } from '../meeting-engine.mjs';
import { nextRoundRobinParticipant, detectExplicitAddressee, selectNextSpeaker } from '../router.mjs';

function meeting3() {
  let m = createMeeting();
  m = addParticipant(m);
  const [a,b,c] = m.participants;
  m = bindParticipant(m, a.id, { tabId: 1, provider: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' });
  m = bindParticipant(m, b.id, { tabId: 2, provider: 'claude', label: 'Claude', url: 'https://claude.ai/' });
  m = bindParticipant(m, c.id, { tabId: 3, provider: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/' });
  return m;
}

test('round robin cycles connected participants', () => {
  const m = meeting3();
  const [a,b,c] = m.participants;
  assert.equal(nextRoundRobinParticipant(m, a.id).id, b.id);
  assert.equal(nextRoundRobinParticipant(m, b.id).id, c.id);
  assert.equal(nextRoundRobinParticipant(m, c.id).id, a.id);
});

test('round robin skips disconnected participants', () => {
  let m = meeting3();
  const [a,b,c] = m.participants;
  m = updateParticipant(m, b.id, { connectionState: 'DISCONNECTED', tabId: null });
  assert.equal(nextRoundRobinParticipant(m, a.id).id, c.id);
});

test('round robin also skips reconnecting participants', () => {
  let m = meeting3();
  const [a,b,c] = m.participants;
  m = updateParticipant(m, b.id, { connectionState: 'RECONNECTING' });
  assert.equal(nextRoundRobinParticipant(m, a.id).id, c.id);
});

test('strong explicit English address selects named participant', () => {
  const m = meeting3();
  const claude = m.participants[1];
  assert.equal(detectExplicitAddressee('Claude, what do you think?', m.participants)?.id, claude.id);
  assert.equal(detectExplicitAddressee("I'd like Claude to answer next.", m.participants)?.id, claude.id);
});

test('strong Korean address selects named participant', () => {
  const m = meeting3();
  const gemini = m.participants[2];
  assert.equal(detectExplicitAddressee('Gemini에게 이 부분을 검토해 달라고 하자.', m.participants)?.id, gemini.id);
  assert.equal(detectExplicitAddressee('Gemini는 어떻게 생각해?', m.participants)?.id, gemini.id);
});

test('mere historical mention is ambiguous and falls back to round robin', () => {
  const m = meeting3();
  const [a,b] = m.participants;
  assert.equal(detectExplicitAddressee('Claude mentioned this earlier and I agree.', m.participants), null);
  assert.equal(selectNextSpeaker(m, 'Claude mentioned this earlier and I agree.', a.id).id, b.id);
});
