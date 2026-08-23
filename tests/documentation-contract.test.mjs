import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

test('README documents both meeting interaction modes', () => {
  assert.match(readme, /Interactive/);
  assert.match(readme, /Full Auto/);
  assert.match(readme, /Join conversation/);
});

test('README documents observer controls and prompt-level limitation', () => {
  assert.match(readme, /Pause/);
  assert.match(readme, /End/);
  assert.match(readme, /prompt-level/);
  assert.match(readme, /user-composer/);
});

test('README documents fresh provider conversations for strict isolation', () => {
  assert.match(readme, /fresh provider/i);
  assert.match(readme, /provider history/i);
});
