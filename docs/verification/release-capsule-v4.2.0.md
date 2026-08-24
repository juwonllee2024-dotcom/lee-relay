# Lee Relay v4.2.0 verification record

Date: 2026-08-24

## Product change

Context Shelf lets a user explicitly select up to five local text files in the Side Panel, review filename, preview, byte count, and SHA-256, remove files, and use the selection in the next interactive or Full Auto AI turn.

Selected content stays in the active browser session. Durable Room state, transcript exports, and Lee Relay servers do not receive it. The provider receives one bounded `.txt` attachment; upload failure keeps a bounded excerpt inline instead of silently dropping the selection.

## TDD evidence

- RED: `node --test tests/file-context.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `file-context.mjs`.
- GREEN: file normalization and bounded block tests passed: 3/3.
- RED: selected-file integration tests returned `inline` instead of required `file` mode: 2 failures.
- GREEN: interactive and autonomous selected-file attachment tests passed: 2/2.
- RED: fallback tests omitted `project-plan.md` and its content: 2 failures.
- GREEN: bounded interactive and autonomous fallback tests passed: 4/4.

## Fresh verification

- `npm ci`: passed; 1 package audited; 0 vulnerabilities.
- `npm run verify`: passed; 141 tests, 0 failures; syntax check passed; manifest v4.2.0 passed; package verifier passed 31 files.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.

## Real input to output

Input: selected local path `C:\Users\juwon\project\plan.md`, text `# Plan` plus `Keep rollback step.`

Output: `mode=file`, `attachment=lee-relay-context-turn-001.txt`, `selectedFileCount=1`, content preserved, local path absent.

## Release artifact

- File: `dist/lee-relay-v4.2.0.zip`
- Files: 31
- SHA-256: `547643758255a241452e61604bafc6400d44cac75d1f7b44ba14ef6580292362`
- Checksum asset: `dist/lee-relay-v4.2.0.zip.sha256`

Boundary: no provider tab is activated by file selection; no server upload, account credential access, or automatic irreversible action occurs. Provider DOM changes can still require maintenance; the explicit fallback and Activity state remain the recovery path.
