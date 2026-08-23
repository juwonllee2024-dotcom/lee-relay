import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
const popupSource = fs.readFileSync(`${root}/popup.js`, 'utf8');
const sidepanelSource = fs.readFileSync(`${root}/sidepanel.js`, 'utf8');

test('debugger permission is required and not requested at runtime', () => {
  assert.equal(manifest.permissions.includes('debugger'), true);
  assert.equal(manifest.optional_permissions?.includes('debugger') ?? false, false);
  assert.doesNotMatch(popupSource, /permissions\.request\(\{\s*permissions:\s*\[\s*['"]debugger['"]\s*\]/);
  assert.doesNotMatch(sidepanelSource, /permissions\.request\(\{\s*permissions:\s*\[\s*['"]debugger['"]\s*\]/);
});
