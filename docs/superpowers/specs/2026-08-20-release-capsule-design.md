# Lee Relay Release Capsule Design

Date: 2026-08-20

## Problem

Lee Relay README tells people to download a release ZIP, but the public repository has no release yet. The existing tag workflow packages files with a shell `zip` command and does not verify the resulting archive. That leaves the most important user journey—download, extract, load unpacked—unproven.

The product promise is a browser-native AI meeting room. The release promise must be equally concrete: one public ZIP, one checksum, one deterministic verification command, and an install path that does not require npm, an API key, a relay server, or a build tool.

## Goals

- Publish a usable Chrome extension archive from a version tag.
- Keep the archive self-contained at its root with `manifest.json` and all runtime files.
- Verify archive safety before release: required files present, no traversal paths, valid manifest, and no development-only files.
- Produce a SHA-256 checksum users can verify locally.
- Make local and GitHub Actions packaging use the same Node-only implementation.
- Update the visible product name and install documentation so the first 60 seconds are unambiguous.

## Non-goals

- No provider API integration.
- No cloud relay, telemetry, account system, or remote code.
- No automatic Chrome Web Store submission.
- No claims that browser automation is immune to provider DOM or terms changes.

## Design

`npm run package` reads the version from `manifest.json`, validates a fixed allowlist of runtime and trust documents, writes `dist/lee-relay-v<version>.zip`, and writes a sibling `.sha256` file. The ZIP writer uses Node built-ins and deterministic metadata, so packaging works on Windows, macOS, Linux, and GitHub Actions without a shell-specific `zip` binary.

`npm run verify-package` parses the ZIP central directory without extracting untrusted paths. It rejects absolute paths, `..` traversal, duplicate entries, missing required files, development artifacts, invalid JSON, and manifest/version mismatches. The verifier checks that the archive contains exactly the allowed release surface.

`npm run verify` runs tests, syntax checks, manifest checks, packaging, and package verification. The tag workflow invokes that same command, then publishes the ZIP and checksum as release assets. A release is not considered verified if the archive job fails.

## Release surface

Runtime files: `manifest.json`, `background.js`, `content.js`, `meeting-engine.mjs`, `provider-adapters.mjs`, `relay-core.mjs`, `router.mjs`, `sidepanel.css`, `sidepanel.html`, `sidepanel.js`, `transaction-engine.mjs`.

Trust and onboarding files: `README.md`, `LICENSE`, `PRIVACY.md`, `SECURITY.md`, `CHANGELOG.md`.

No source maps, `node_modules`, test fixtures, temporary recordings, `.git` data, or development configuration enter the archive.

## Failure behavior

- Missing allowlisted input: fail with the exact path.
- Invalid or unsupported manifest version: fail before archive creation.
- Unsafe archive entry: verifier exits non-zero and names the entry.
- Existing output: replace only the generated `dist/lee-relay-v<version>.zip` and checksum.
- Any release workflow failure: no success claim; GitHub release remains absent or incomplete.

## Testing

TDD starts with package unit tests that assert the archive inventory and verifier rejection cases. The real command then runs against the repository and verifies the generated ZIP. CI runs Node 20 and 22. The final verification record captures the archive SHA-256, file inventory, local install smoke result, CI URL, and release URL.

