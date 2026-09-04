import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('ChatGPT context-file handoff waits for a settled attachment', () => {
  const content = read('content.js');
  const background = read('background.js');

  assert.match(content, /contextAttachmentBusy/);
  assert.match(content, /waitForContextFileReady/);
  assert.match(content, /Send was not attempted/);
  assert.match(background, /attachmentResult\?\.ready/);
  assert.match(background, /fallback-inline/);
});

test('a confirmed context attachment is reused within one transaction', () => {
  const content = read('content.js');

  assert.match(content, /transaction\.contextFileAttached/);
  assert.match(content, /transaction\.contextFileName === fileName/);
  assert.match(content, /reused: true/);
});

test('release metadata advances to the ChatGPT context-file bugfix version', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(manifest.version, '4.3.1');
  assert.equal(packageJson.version, '4.3.1');
});
