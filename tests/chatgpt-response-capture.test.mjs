import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('ChatGPT capture waits through an unobserved streaming pause before confirmation', async () => {
  const source = await read('content.js');
  assert.match(source, /streamingSelectors/);
  assert.match(source, /initialResponseQuietMs/);
  assert.match(source, /confirmationQuietMs/);
  assert.match(source, /__LEE_RELAY_RESPONSE_POLICY__/);
});
