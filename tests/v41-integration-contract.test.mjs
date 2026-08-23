import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('v4.1 meeting defaults include a bounded Run and report slot', () => {
  const source = read('meeting-engine.mjs');
  assert.match(source, /maxDurationMs/);
  assert.match(source, /maxHops/);
  assert.match(source, /activeRun/);
  assert.match(source, /runHistory/);
});

test('v4.1 background owns Room, Run, handoff, and Report integration seams', () => {
  const source = read('background.js');
  for (const marker of [
    'v4.1Workspace',
    'v4.1ActiveRun',
    'workspace-engine.mjs',
    'playbook-engine.mjs',
    'run-engine.mjs',
    'report-engine.mjs',
    'mention-router.mjs',
    'LIST_ROOMS',
    'CREATE_ROOM',
    'SELECT_ROOM',
    'GET_PLAYBOOKS',
    'UPDATE_ROOM',
    'runBudgetDecision',
    'recordRunHandoff',
    'buildRunArtifact',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /maxDurationMs/);
  assert.match(source, /resolveMentionDirective/);
});

test('v4.1 public state keeps reports portable and the side panel can request Rooms', () => {
  const background = read('background.js');
  const panel = read('sidepanel.js');
  assert.match(background, /publicWorkspaceState/);
  assert.match(background, /workspace:/);
  assert.match(panel, /LIST_ROOMS|GET_WORKSPACE_STATE/);
});
