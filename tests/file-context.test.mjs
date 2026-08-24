import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CONTEXT_FILES,
  MAX_CONTEXT_FILE_CHARS,
  MAX_CONTEXT_TOTAL_CHARS,
  buildSelectedFilesBlock,
  normalizeSelectedContextFiles,
} from '../file-context.mjs';

test('normalizes explicitly selected files without retaining local paths', () => {
  const files = normalizeSelectedContextFiles([{
    name: 'C:\\Users\\juwon\\project\\README.md',
    type: 'text/markdown',
    size: 18,
    lastModified: 123,
    sha256: 'abc123',
    text: '# Hello',
  }]);

  assert.deepEqual(files, [{
    id: 'readme-md-abc123',
    name: 'README.md',
    type: 'text/markdown',
    size: 18,
    lastModified: 123,
    sha256: 'abc123',
    text: '# Hello',
  }]);
  assert.doesNotMatch(JSON.stringify(files), /C:\\\\Users/);
});

test('rejects unsafe selection size and duplicate identity', () => {
  const base = { name: 'notes.txt', type: 'text/plain', size: 4, text: 'note', sha256: 'same' };
  assert.throws(() => normalizeSelectedContextFiles(Array.from({ length: MAX_CONTEXT_FILES + 1 }, (_, index) => ({
    ...base,
    name: `notes-${index}.txt`,
    sha256: String(index),
  }))), /最多|Maximum/);
  assert.throws(() => normalizeSelectedContextFiles([{ ...base, text: 'x'.repeat(MAX_CONTEXT_FILE_CHARS + 1) }]), /큰|large/);
  assert.throws(() => normalizeSelectedContextFiles([base, base]), /중복|[Dd]uplicate/);
  assert.throws(() => normalizeSelectedContextFiles([
    { ...base, name: 'other.txt', sha256: 'other', text: 'x'.repeat(MAX_CONTEXT_FILE_CHARS) },
    { ...base, name: 'second.txt', sha256: 'second', text: 'x'.repeat(MAX_CONTEXT_FILE_CHARS) },
    { ...base, name: 'third.txt', sha256: 'third', text: 'x' },
  ]), /총|total/);
});

test('builds a bounded, inspectable local-file context block', () => {
  const files = normalizeSelectedContextFiles([{
    name: 'design.md', type: 'text/markdown', size: 10, lastModified: 123,
    sha256: 'deadbeef', text: '# Design\nKeep this decision.',
  }]);
  const block = buildSelectedFilesBlock(files, { maxChars: 1200 });

  assert.match(block, /SELECTED LOCAL FILES/);
  assert.match(block, /design\.md/);
  assert.match(block, /sha256: deadbeef/);
  assert.match(block, /Keep this decision/);
  assert.ok(block.length <= 1200);
});
