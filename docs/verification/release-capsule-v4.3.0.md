# Lee Relay v4.3.0 verification capsule

## Product change

Context Guard extends Context Shelf with an explicit file scope and a visible handoff receipt:

- `Every turn` keeps the selected files active until the user clears them.
- `Next turn only` clears selected files only after the provider response is verified complete.
- The receipt shows provider, delivery mode, file names, byte counts, short SHA-256 values, and whether one-turn cleanup happened.
- Receipt metadata never contains file contents or local paths. Durable Rooms strip both selected files and receipts.

## TDD evidence

- RED: new Context Guard imports, scope control, receipt contract, selected-file metadata, and one-turn cleanup assertions failed before implementation.
- GREEN: targeted Context Guard, Context Shelf, context-plan, and meeting-state tests passed `20/20`.

## Fresh verification

- `npm ci`: passed; 1 package audited, 0 vulnerabilities.
- `npm test`: passed; `147` tests, `147` passed, `0` failed.
- `npm run check`: passed for background, content, Side Panel, context, coordination, routing, report, run, transaction, and workspace modules.
- `node scripts/verify-manifest.mjs`: passed; Lee Relay `v4.3.0`, Chrome `120+`.
- `npm run package`: passed; 31 packaged files.
- `npm run verify-package`: passed; archive inventory and version checks passed.
- `npm audit --audit-level=high`: passed; 0 vulnerabilities.
- `npm audit --omit=dev --audit-level=high`: passed; 0 vulnerabilities.
- `git diff --check`: passed.

Package SHA-256:

`d5c85b3fa0fe9e0f919996b19836c6fde52c24c64ce01351f0a0aaf6da0fec6b`

## Real input to output

Input: policy `next-turn`, one explicitly selected local path ending in `plan.md`, and a receipt for Gemini.

Output: selected file count changed from `1` to `0` after verified-turn cleanup; `clearedAfterTurn=true`; receipt retained no content and no local path.

Recorded with:

`node --input-type=module -e "applyContextGuardAfterTurn(...)"`
