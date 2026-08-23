# Lee Relay v3.0.4 verification record

Date: 2026-08-23

## Product change

Lee Relay now exports its browser-native AI meeting transcript as a local
Markdown reading record or a local JSON data record. The export keeps meeting
turns, participants, timestamps, and delivery/response verification statuses.
It omits live tab IDs, provider URLs, transaction IDs, and the activity log.

## TDD evidence

1. Added `tests/transcript-export.test.mjs` before `transcript-export.mjs` existed.
2. Ran `node --test tests/transcript-export.test.mjs` and observed the expected
   `ERR_MODULE_NOT_FOUND` failure.
3. Added the smallest formatter and filename implementation.
4. Re-ran the focused test: 3 passed.
5. Added the side-panel export contract test, observed its expected missing-button
   failure, then added the two buttons and local download path.
6. Re-ran the focused structure/export tests: 15 passed.

## Fresh verification

- `npm.cmd install --package-lock-only --ignore-scripts --no-audit` — passed; added
  the previously missing lockfile so `npm ci` is reproducible.
- `npm.cmd ci` — passed; 1 package audited, 0 vulnerabilities.
- `npm.cmd test` — passed; 69 tests, 0 failures.
- `npm.cmd run verify` — passed; test, syntax check, Manifest V3 check, package,
  and package verifier all passed.
- `npm.cmd audit --audit-level=high` — passed; 0 vulnerabilities.
- `npm.cmd audit --omit=dev --audit-level=high` — passed; 0 vulnerabilities.
- `git diff --check` — passed.

## Package evidence

- Package: `dist/lee-relay-v3.0.4.zip`
- Files: 17
- Size: 137,365 bytes
- SHA-256: `17682a2db3c99c84929d562d88d4e0ec41fc88f9bef4469172bf46c1c3f10d0a`
- Checksum file: `dist/lee-relay-v3.0.4.zip.sha256`

## Boundary

Export is local and user-triggered. It does not create a Lee Relay server,
upload meeting content, submit a provider message, or alter provider tabs.
Messages intentionally sent to ChatGPT, Claude, Gemini, or Copilot remain under
those providers' policies.
