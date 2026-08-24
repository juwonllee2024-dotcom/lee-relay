import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('release workflow is idempotent when a tag release already exists', () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /gh release create/);
});
