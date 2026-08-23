import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('v4 release identifies itself and documents coordination features', () => {
  const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
  const readme = fs.readFileSync(`${root}/README.md`, 'utf8');
  assert.equal(manifest.version, '4.1.0');
  assert.match(readme, /Participant roles/i);
  assert.match(readme, /Session templates/i);
  assert.match(readme, /Loop Guard/i);
  assert.match(readme, /ChatGPT.*capture/i);
});

test('v4.1 release documents the Blank-Slate Room workflow and packages its domain modules', () => {
  const manifest = fs.readFileSync(`${root}/manifest.json`, 'utf8');
  const readme = fs.readFileSync(`${root}/README.md`, 'utf8');
  const packer = fs.readFileSync(`${root}/scripts/package-extension.mjs`, 'utf8');
  assert.match(manifest, /"version":\s*"4\.1\.0"/);
  for (const marker of [/Room/, /Playbook/, /Run Budget/, /@AI/, /Reports/]) assert.match(readme, marker);
  for (const file of ['workspace-engine.mjs', 'playbook-engine.mjs', 'run-engine.mjs', 'report-engine.mjs', 'mention-router.mjs']) {
    assert.match(packer, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
