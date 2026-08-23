import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('v4 release identifies itself and documents coordination features', () => {
  const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
  const readme = fs.readFileSync(`${root}/README.md`, 'utf8');
  assert.equal(manifest.version, '4.0.1');
  assert.match(readme, /Participant roles/i);
  assert.match(readme, /Session templates/i);
  assert.match(readme, /Loop Guard/i);
  assert.match(readme, /ChatGPT.*capture/i);
});
