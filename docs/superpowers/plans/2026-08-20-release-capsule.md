# Implementation Plan: Lee Relay Release Capsule

> **For execution:** follow each task in order. Tests first. Keep commits focused.

**Goal:** Make Lee Relay downloadable, verifiable, and installable from a public release without requiring a platform-specific ZIP utility.

**Architecture:** Node-only deterministic ZIP builder plus central-directory verifier. A fixed archive allowlist prevents accidental source or secret leakage. GitHub Actions calls the same npm verification command used locally.

**Stack:** Node.js 20+, native `node:fs`, `node:path`, `node:crypto`, `node:test`; Chrome Manifest V3.

## Task 1: Establish package contract with failing tests

**Files:** `tests/package.test.mjs`, `scripts/package-extension.mjs`, `scripts/verify-package.mjs`

- Add tests for the expected root inventory and manifest version.
- Add tests that reject traversal-like archive names and development-only entries.
- Run the focused package tests and confirm RED because package utilities do not exist yet.

## Task 2: Implement deterministic archive builder

**Files:** `scripts/package-extension.mjs`, `package.json`

- Define one fixed allowlist for runtime and trust files.
- Implement a dependency-free stored ZIP writer with CRC-32, central directory, fixed timestamps, and stable ordering.
- Read version from `manifest.json`; reject mismatch between package metadata and manifest.
- Write ZIP and SHA-256 files under ignored `dist/`.
- Add `npm run package`.
- Run focused tests and confirm GREEN.

## Task 3: Implement archive verifier and CI integration

**Files:** `scripts/verify-package.mjs`, `package.json`, `.github/workflows/release.yml`

- Parse central-directory entries without extracting files.
- Reject unsafe paths, duplicates, missing entries, unexpected development files, invalid manifest, and version mismatch.
- Add `npm run verify-package` and include package verification in `npm run verify`.
- Replace shell-specific packaging in the tag workflow with the shared Node commands.
- Upload ZIP and checksum only after all gates pass.

## Task 4: Improve activation copy and metadata

**Files:** `manifest.json`, `scripts/verify-manifest.mjs`, `README.md`, `CHANGELOG.md`

- Change extension display name from “Lee Relay Bot” to “Lee Relay — AI Meeting Room”.
- Bump version to 3.0.2.
- Put the exact release asset, checksum command, and unpacked-install steps above development details.
- State provider privacy/terms boundary without implying local-only data.
- Add 3.0.2 changelog entry.

## Task 5: Record and publish evidence

**Files:** `docs/verification/release-capsule-v3.0.2.md`

- Run RED→GREEN, full tests, syntax check, manifest check, package build, package verification, checksum, and clean extracted-folder smoke test.
- Run dependency audit equivalent (no npm dependencies; record `npm audit --omit=dev` result or unavailable with reason).
- Run `git diff --check`, secret scan, and inspect staged paths.
- Commit only intended files, push a feature branch, create one PR, wait for CI, merge, tag v3.0.2, and verify release assets.

