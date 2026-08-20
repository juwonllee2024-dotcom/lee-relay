import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PACKAGE_FILES,
  buildArchiveBuffer,
  createZipBuffer,
  packageExtension,
} from '../scripts/package-extension.mjs';
import { verifyArchiveBuffer } from '../scripts/verify-package.mjs';

async function fixtureRoot(version = '9.9.9', lineEnding = '\n') {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lee-relay-package-'));
  for (const name of PACKAGE_FILES) {
    const filePath = path.join(root, name);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const fixture = `fixture:${name}\n`.replaceAll('\n', lineEnding);
    await fs.promises.writeFile(
      filePath,
      name === 'manifest.json'
        ? JSON.stringify({ manifest_version: 3, name: 'Lee Relay', version })
        : fixture,
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

test('normalizes text line endings for cross-platform repeatability', async () => {
  const unixArchive = buildArchiveBuffer(await fixtureRoot('9.9.9', '\n'));
  const windowsArchive = buildArchiveBuffer(await fixtureRoot('9.9.9', '\r\n'));

  assert.deepEqual(windowsArchive, unixArchive);
});

test('removes stale release artifacts before writing a new capsule', async () => {
  const root = await fixtureRoot();
  const outputDir = path.join(root, 'dist');
  await fs.promises.mkdir(outputDir);
  await fs.promises.writeFile(path.join(outputDir, 'lee-relay-v0.0.0.zip'), 'stale');

  packageExtension(root, outputDir);

  assert.deepEqual((await fs.promises.readdir(outputDir)).sort(), [
    'lee-relay-v9.9.9.zip',
    'lee-relay-v9.9.9.zip.sha256',
  ]);
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
    () => verifyArchiveBuffer(archive, '3.0.3'),
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
