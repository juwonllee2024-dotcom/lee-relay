import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const requiredHosts = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
  'https://copilot.microsoft.com/*',
];

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(manifest.version === '3.0.3', 'manifest version must be 3.0.3');
check(manifest.name === 'Lee Relay — AI Meeting Room', 'manifest name must identify the AI meeting room');
check(Number(manifest.minimum_chrome_version) >= 120, 'minimum Chrome version must be >= 120');
check(manifest.permissions?.includes('sidePanel'), 'sidePanel permission is required');
check(manifest.permissions?.includes('alarms'), 'alarms permission is required for watchdog recovery');
check(manifest.side_panel?.default_path === 'sidepanel.html', 'side panel entrypoint must be sidepanel.html');
check(!manifest.action?.default_popup, 'v3 must not use a disappearing popup UI');
check(manifest.background?.service_worker === 'background.js', 'background service worker must be background.js');
check(manifest.background?.type === 'module', 'background service worker must be a module');
for (const host of requiredHosts) check(manifest.host_permissions?.includes(host), `missing host permission: ${host}`);

if (failures.length) {
  console.error('Manifest verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Manifest OK: Lee Relay v${manifest.version}, Chrome ${manifest.minimum_chrome_version}+`);
