# Changelog

## 4.1.0

### Added

- Blank-Slate Room → Playbook → Run → Report workflow.
- Persistent Rooms with safe v3/v4 meeting migration and one active Run at a time.
- Built-in Playbooks for 9-axis channel analysis, debate, planning review, and final summary.
- Unified Run Budget for maximum duration, AI turns, and AI-to-AI handoffs.
- Structured `@AI` routing with safe handling for unknown, disconnected, ambiguous, and self targets.
- Durable phase reports with 9-axis scorecards and Markdown/TXT/JSON exports.
- Compact Room and Playbook controls in the Side Panel; advanced controls remain disclosed.

### Fixed

- Repeated session normalization now preserves null start/completion timestamps idempotently.

## 4.0.1

### Fixed

- ChatGPT long responses are captured from the complete Markdown body instead of being finalized after a short streaming pause.
- ChatGPT streaming markers are recognized, with a pause-safe fallback confirmation window when the provider does not expose one.

### Added

- Interactive and Full Auto meeting modes.
- Participant roles, session templates, coordination phases, and Loop Guard.
- Background-tab response recovery with adaptive inline, compact, and context-file delivery.
## 3.0.4 — 2026-08-23

### Added

- Export the complete Lee Relay meeting transcript to local Markdown or JSON.
- Preserve turn numbers, participants, timestamps, and delivery/response verification statuses.
- Sanitize exports so live tab IDs, provider URLs, transaction IDs, and activity logs never leave the extension.
- Add a safe filename derived from the meeting title.

## 3.0.3

- normalize text line endings in the release packer so Windows and Linux produce the same archive bytes
- add a cross-platform repeatability regression test
- publish a corrected release capsule and verification record

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
