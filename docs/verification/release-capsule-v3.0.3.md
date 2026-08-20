# Lee Relay v3.0.3 Verification Record

Date: 2026-08-20

Lee Relay v3.0.3 is the corrected, cross-platform verified Chrome extension release capsule for the browser-native AI meeting room.

## Real input and result

- Input: the repository's fixed 16-file extension allowlist and `manifest.json`.
- Result: `lee-relay-v3.0.3.zip`, containing 16 files with a root manifest at version `3.0.3`.
- Local Windows SHA-256: `1a7fab0a7edc5f57a27f6ba6417f0a45c83fd8b5a63473e7c79b37d405d491ac`
- Release: https://github.com/juwonllee2024-dotcom/lee-relay/releases/tag/v3.0.3

## Gates

| Check | Result |
| --- | --- |
| Unit and integration tests | passed, including line-ending repeatability |
| Syntax and manifest checks | passed |
| Deterministic package build | passed |
| ZIP structure verification | passed; 16 files |
| Extracted-install smoke test | passed; downloaded release extracted to 16 files with root manifest v3.0.3 |
| Production dependency audit | passed; 0 vulnerabilities with no lockfile and no production dependencies |
| Secret-pattern scan | passed |
| `git diff --check` | passed |
| Pull-request CI | passed on Node 20 and Node 22; [PR #3](https://github.com/juwonllee2024-dotcom/lee-relay/pull/3) |
| Release workflow | passed; [run 32392926924](https://github.com/juwonllee2024-dotcom/lee-relay/actions/runs/32392926924) |

Published asset SHA-256: `1a7fab0a7edc5f57a27f6ba6417f0a45c83fd8b5a63473e7c79b37d405d491ac`.

The package is intentionally dependency-free at runtime. Chrome's extension review, provider terms, and each provider's privacy policy remain outside this local verification boundary.
