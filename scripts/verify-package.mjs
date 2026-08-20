import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PACKAGE_FILES } from './package-extension.mjs';

const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    let current = (value ^ byte) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) current = (current & 1) ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    value = (value >>> 8) ^ current;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const firstOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= firstOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_SIGNATURE) return offset;
  }
  throw new Error('ZIP end-of-central-directory record missing');
}

function unsafeName(name) {
  return name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name) || name.includes('\\') || name.split('/').includes('..');
}

export function readZipEntries(buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const count = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (disk !== 0 || centralDisk !== 0) throw new Error('multi-disk ZIP archives are not supported');
  if (centralOffset + centralSize > endOffset) throw new Error('ZIP central directory is truncated');

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_SIGNATURE) throw new Error('invalid ZIP central directory entry');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (flags !== 0) throw new Error(`unsupported ZIP flags for ${name}`);
    if (method !== 0) throw new Error(`unsupported ZIP compression for ${name}`);
    if (compressedSize !== uncompressedSize) throw new Error(`unexpected stored size for ${name}`);
    if (unsafeName(name)) throw new Error(`unsafe archive path: ${name}`);
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) throw new Error(`local ZIP header missing: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + uncompressedSize;
    if (dataEnd > buffer.length) throw new Error(`truncated ZIP data: ${name}`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch: ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

export function verifyArchiveBuffer(buffer, expectedVersion) {
  const entries = readZipEntries(buffer);
  const names = entries.map((entry) => entry.name);
  const uniqueNames = new Set(names);
  if (uniqueNames.size !== names.length) throw new Error('duplicate archive files');
  const expectedNames = new Set(PACKAGE_FILES);
  const missing = PACKAGE_FILES.filter((name) => !uniqueNames.has(name));
  const unexpected = names.filter((name) => !expectedNames.has(name));
  if (missing.length) throw new Error(`missing archive files: ${missing.join(', ')}`);
  if (unexpected.length) throw new Error(`unexpected archive files: ${unexpected.join(', ')}`);

  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch (error) {
    throw new Error(`invalid packaged manifest: ${error.message}`);
  }
  if (manifest.manifest_version !== 3) throw new Error('packaged manifest_version must be 3');
  if (typeof manifest.version !== 'string') throw new Error('packaged manifest version missing');
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(`manifest version mismatch: expected ${expectedVersion}, found ${manifest.version}`);
  }
  return { files: [...uniqueNames].sort(), version: manifest.version };
}

export function verifyPackage(archivePath, expectedVersion) {
  const buffer = fs.readFileSync(archivePath);
  const report = verifyArchiveBuffer(buffer, expectedVersion);
  return { ...report, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  let archivePath = process.argv[2];
  if (!archivePath) {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const distDir = path.join(rootDir, 'dist');
    const candidates = fs.existsSync(distDir)
      ? fs.readdirSync(distDir).filter((name) => /^lee-relay-v\d+\.\d+\.\d+\.zip$/.test(name))
      : [];
    if (candidates.length !== 1) {
      throw new Error(`expected exactly one release archive in dist, found ${candidates.length}`);
    }
    archivePath = path.join(distDir, candidates[0]);
  }
  const name = path.basename(archivePath);
  const match = name.match(/^lee-relay-v(\d+\.\d+\.\d+)\.zip$/);
  const report = verifyPackage(archivePath, match?.[1]);
  console.log(`Package OK: Lee Relay v${report.version}`);
  console.log(`Files: ${report.files.length}`);
  console.log(`SHA-256: ${report.sha256}`);
}
