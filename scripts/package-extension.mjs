import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PACKAGE_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'meeting-engine.mjs',
  'provider-adapters.mjs',
  'relay-core.mjs',
  'router.mjs',
  'sidepanel.css',
  'sidepanel.html',
  'sidepanel.js',
  'transaction-engine.mjs',
  'README.md',
  'LICENSE',
  'PRIVACY.md',
  'SECURITY.md',
  'CHANGELOG.md',
];

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 33;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function fileBuffer(data) {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function writeLocalHeader(name, data) {
  const nameBuffer = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30 + nameBuffer.length);
  header.writeUInt32LE(LOCAL_FILE_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(FIXED_DOS_TIME, 10);
  header.writeUInt16LE(FIXED_DOS_DATE, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  nameBuffer.copy(header, 30);
  return header;
}

function writeCentralHeader(name, data, localOffset) {
  const nameBuffer = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(46 + nameBuffer.length);
  header.writeUInt32LE(CENTRAL_FILE_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(FIXED_DOS_TIME, 12);
  header.writeUInt16LE(FIXED_DOS_DATE, 14);
  header.writeUInt32LE(crc32(data), 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  nameBuffer.copy(header, 46);
  return header;
}

/** Build a deterministic, stored ZIP buffer from named byte entries. */
export function createZipBuffer(entries) {
  const names = new Set();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`duplicate archive entry: ${entry.name}`);
    names.add(entry.name);
    const data = fileBuffer(entry.data);
    const localHeader = writeLocalHeader(entry.name, data);
    localParts.push(localHeader, data);
    centralParts.push(writeCentralHeader(entry.name, data, offset));
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function readManifest(rootDir) {
  const manifestPath = path.join(rootDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read manifest.json: ${error.message}`);
  }
  if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('manifest version must be semantic x.y.z');
  }
  return manifest;
}

export function buildArchiveBuffer(rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  const manifest = readManifest(absoluteRoot);
  const entries = PACKAGE_FILES.map((name) => {
    const filePath = path.resolve(absoluteRoot, name);
    const relative = path.relative(absoluteRoot, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`package path escapes workspace: ${name}`);
    }
    if (!fs.statSync(filePath).isFile()) throw new Error(`required package file is not a file: ${name}`);
    return { name, data: fs.readFileSync(filePath) };
  });
  if (JSON.parse(entries[0].data.toString('utf8')).version !== manifest.version) {
    throw new Error('manifest version changed while packaging');
  }
  return createZipBuffer(entries);
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function packageExtension(rootDir, outputDir = path.join(rootDir, 'dist')) {
  const manifest = readManifest(path.resolve(rootDir));
  const archive = buildArchiveBuffer(rootDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const archiveName = `lee-relay-v${manifest.version}.zip`;
  const archivePath = path.join(outputDir, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  fs.writeFileSync(archivePath, archive);
  fs.writeFileSync(checksumPath, `${sha256(archive)}  ${archiveName}\n`);
  return { archiveName, archivePath, checksumPath, sha256: sha256(archive), version: manifest.version };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = packageExtension(rootDir);
  console.log(`Packaged ${result.archiveName}`);
  console.log(`SHA-256: ${result.sha256}`);
}

