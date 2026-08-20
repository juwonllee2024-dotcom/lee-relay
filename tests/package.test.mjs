import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PACKAGE_FILES,
  buildArchiveBuffer,
  createZipBuffer,
} from '../scripts/package-extension.mjs';
import { verifyArchiveBuffer } from '../scripts/verify-package.mjs';

async function fixtureRoot(version = '9.9.9') {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lee-relay-package-'));
  for (const name of PACKAGE_FILES) {
    const filePath = path.join(root, name);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(
      filePath,
      name === 'manifest.json'
        ? JSON.stringify({ manifest_version: 3, name: 'Lee Relay', version })
        : `fixture:${name}\n`,
    );
  }
  return root;
}

test('builds exact root inventory and verifies manifest version', async () => {
  const root = await fixtureRoot();
  const archive = buildArchiveBuffer(root);
  const report = verifyArchiveBuffer(archive, '9.9.9');

  assert.deepEqual(report.files, [...PACKAGE_FILES].sort());
  assert.equal(report.version, '9.9.9');
});

test('rejects unsafe archive paths before extraction', () => {
  const archive = createZipBuffer([
    { name: 'manifest.json', data: Buffer.from('{"manifest_version":3,"version":"9.9.9"}') },
    { name: '../outside.txt', data: Buffer.from('must not extract') },
  ]);

  assert.throws(
    () => verifyArchiveBuffer(archive, '9.9.9'),
    /unsafe archive path: \.\.\/outside\.txt/,
  );
});

test('rejects development files and version drift', async () => {
  const root = await fixtureRoot();
  const archive = buildArchiveBuffer(root);

  assert.throws(
    () => verifyArchiveBuffer(archive, '3.0.2'),
    /manifest version mismatch/,
  );

  const devArchive = createZipBuffer([
    { name: 'manifest.json', data: Buffer.from('{"manifest_version":3,"version":"9.9.9"}') },
    { name: 'node_modules/secret.js', data: Buffer.from('no') },
  ]);
  assert.throws(
    () => verifyArchiveBuffer(devArchive, '9.9.9'),
    /unexpected archive files|missing archive files/,
  );
});

