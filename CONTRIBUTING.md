# Contributing to Lee Relay

Thanks for helping improve Lee Relay.

## Before you start

The highest-value contributions are usually one of:

1. A reproducible provider-adapter fix after a web UI change.
2. A regression test for a real relay failure.
3. A reliability improvement that preserves verified-delivery semantics.
4. A focused Side Panel UX improvement that does not hide failure state.

Please avoid broad rewrites that replace transaction verification with optimistic timing or simple `click() === success` assumptions.

## Local verification

Requires Node.js 20+.

```bash
npm test
npm run check
npm run verify
```

All three commands should pass before a pull request is opened.

## Provider adapter changes

When changing selectors:

- Prefer provider-specific assistant and user selectors over broad page selectors.
- Keep generation-state selectors explicit.
- Avoid selectors that can match both user and assistant turns.
- Do not treat input clearing alone as proof of delivery.
- Add or update a regression/structure test that captures the failure mode.

## Pull requests

Keep PRs focused. Include:

- What failed
- Root cause
- Why the proposed signal/selector/state change is reliable
- Tests added or changed
- Sanitized screenshots only when UI changes require them

Never include real cookies, tokens, private conversations, or account information in test fixtures.
