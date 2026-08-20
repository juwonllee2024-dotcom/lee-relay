# Lee Relay v3.0.2 Verification Record

Date: 2026-08-20

Lee Relay v3.0.2 is the verified Chrome extension release capsule for the browser-native AI meeting room.

## Real input and result

- Input: the repository's fixed 16-file extension allowlist and `manifest.json`.
- Result: `lee-relay-v3.0.2.zip`, containing 16 files with a root manifest at version `3.0.2`.
- SHA-256: `1040f0899d9a3e81229f88aa974a6f8a49f468a4cacf1760f078c83fb874a63d`
- Release: https://github.com/juwonllee2024-dotcom/lee-relay/releases/tag/v3.0.2

## Gates

| Check | Result |
| --- | --- |
| Unit and integration tests | 63 passed, 0 failed |
| Syntax and manifest checks | passed |
| Deterministic package build | passed |
| ZIP structure verification | passed; 16 files |
| Extracted-install smoke test | passed; root manifest present |
| Production dependency audit | passed; 0 vulnerabilities with no lockfile and no production dependencies |
| Secret-pattern scan | passed |
| `git diff --check` | passed |
| Pull-request CI | passed on Node 20 and Node 22 |

The package is intentionally dependency-free at runtime. Chrome's extension review, provider terms, and each provider's privacy policy remain outside this local verification boundary.
