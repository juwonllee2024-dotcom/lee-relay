# Changelog

## 3.0.2

### Added

- Reproducible, dependency-free release ZIP packaging for Windows, macOS, Linux, and GitHub Actions.
- Archive verifier that checks the manifest, exact runtime inventory, safe paths, CRCs, and version.
- SHA-256 checksum asset for every published extension release.
- Clearer Chrome display name: `Lee Relay — AI Meeting Room`.

### Fixed

- Closed the broken first-run path where README promised a release ZIP but no verified release artifact existed.

## 3.0.1 — 2026-08-19

### Fixed

- Fixed a ChatGPT long-prompt correlation failure where collapsed `Show more` outgoing messages could leave a completed response stuck in `THINKING`.
- Response observers now trust a verified background delivery receipt instead of requiring the outgoing prompt to remain text-identical in the rendered DOM.
- Response verification and watchdog recovery now share the same delivery-correlation rule.
- Prevented duplicate insertion of the same user seed topic when starting a meeting.

## 3.0.0 — 2026-08-19

### Added

- Persistent Chrome Side Panel meeting room.
- 2–6 participants.
- Master meeting transcript.
- Smart speaker routing with deterministic round-robin fallback.
- Transaction-aware turn lifecycle with verified delivery and response stages.
- `NEEDS ATTENTION` recovery UI with Retry / Skip / Reconnect.
- Activity log for failure-stage visibility.

### Changed

- Replaced popup-first control flow with Side Panel-first architecture.
- Replaced optimistic send-success accounting with observable delivery evidence.

## 2.2.2

- Added watchdog recovery for relay stalls and page reattachment.
- Improved recovery when completed responses were missed after navigation/reload.
