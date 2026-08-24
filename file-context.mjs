export const MAX_CONTEXT_FILES = 5;
export const MAX_CONTEXT_FILE_CHARS = 120000;
export const MAX_CONTEXT_TOTAL_CHARS = 240000;

function basename(value) {
  const raw = String(value || '').replaceAll('\\', '/').split('/').at(-1) || '';
  const clean = raw.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  return clean.slice(0, 160);
}

function slug(value) {
  return basename(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

export function normalizeSelectedContextFiles(files = []) {
  if (!Array.isArray(files)) throw new Error('Selected files must be an array.');
  if (files.length > MAX_CONTEXT_FILES) throw new Error(`Maximum ${MAX_CONTEXT_FILES} selected files allowed.`);

  const seen = new Set();
  let totalChars = 0;
  const normalized = files.map((source) => {
    const file = source && typeof source === 'object' ? source : {};
    const name = basename(file.name);
    const text = String(file.text || '');
    const sha256 = String(file.sha256 || '').trim().toLowerCase().slice(0, 128);
    if (!name) throw new Error('Selected file name is required.');
    if (!text.trim()) throw new Error(`Selected file ${name} is empty.`);
    if (text.length > MAX_CONTEXT_FILE_CHARS) throw new Error(`Selected file ${name} is too large.`);
    totalChars += text.length;
    if (totalChars > MAX_CONTEXT_TOTAL_CHARS) throw new Error('Selected files exceed the total context limit.');
    const id = `${slug(name)}-${sha256 || `${numeric(file.size)}-${numeric(file.lastModified)}`}`;
    if (seen.has(id)) throw new Error(`Duplicate selected file: ${name}.`);
    seen.add(id);
    return {
      id,
      name,
      type: String(file.type || 'text/plain').slice(0, 120),
      size: numeric(file.size, text.length),
      lastModified: numeric(file.lastModified),
      sha256,
      text,
    };
  });
  return normalized;
}

function languageFor(name) {
  const extension = basename(name).split('.').at(-1)?.toLowerCase();
  return ({ md: 'markdown', markdown: 'markdown', js: 'javascript', mjs: 'javascript', ts: 'typescript',
    json: 'json', py: 'python', css: 'css', html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    csv: 'csv', sql: 'sql', txt: 'text', log: 'text' })[extension] || 'text';
}

export function buildSelectedFilesBlock(files = [], { maxChars = MAX_CONTEXT_TOTAL_CHARS } = {}) {
  const normalized = normalizeSelectedContextFiles(files);
  const limit = Math.max(240, numeric(maxChars, MAX_CONTEXT_TOTAL_CHARS));
  let output = '[SELECTED LOCAL FILES]\nThe user explicitly selected these files for this AI turn. Use their contents as source material.\n\n';

  for (const file of normalized) {
    const header = `[FILE ${file.name}]\ntype: ${file.type}\nbytes: ${file.size}\nsha256: ${file.sha256 || 'unavailable'}\n\n`;
    const fence = '```' + languageFor(file.name) + '\n';
    const closing = '\n```\n\n';
    const room = Math.max(0, limit - output.length - header.length - fence.length - closing.length);
    const clipped = file.text.length <= room ? file.text : `${file.text.slice(0, Math.max(0, room - 35))}\n[content clipped to context budget]`;
    output += `${header}${fence}${clipped}${closing}`;
    if (output.length >= limit) break;
  }
  return output.slice(0, limit);
}
