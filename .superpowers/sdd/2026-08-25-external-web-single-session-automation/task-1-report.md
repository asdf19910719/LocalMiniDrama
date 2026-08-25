# Task 1 report: external web generation data model

## Changes

- Added migration `backend-node/migrations/24_external_web_generation.sql` with the five external-generation tables, required uniqueness constraints, indexes, foreign keys, timestamps, and immutable reference-package metadata on jobs (`reference_manifest_json` and `reference_package_path`).
- Added `externalGenerationService.js`:
  - creates jobs with a frozen prompt snapshot and SHA-256 prompt hash;
  - allocates attempt sequence inside a SQLite transaction;
  - records idempotent attempt events by globally unique idempotency key;
  - upserts one browser session per drama/site;
  - keeps all lookups keyed by Job/Attempt IDs.
- Added `externalGenerationReferenceService.js`:
  - writes `prompt.txt`, `references/`, and stable `manifest.json` per Job;
  - records asset ID, reference role, order, file name, byte size, and SHA-256 in the manifest;
  - persists the manifest hash and package path and rejects changed packages;
  - rejects absolute paths and traversal components when resolving package files.
- Added focused service and reference-package tests covering prompt/reference hashes, session lookup, attempt sequencing, duplicate event/result rejection, immutable manifests, and path traversal.

## Design decisions and self-review

- UUID text IDs preserve provenance across external providers and avoid filename/current-job inference.
- Prompt and structured prompt objects use deterministic key ordering before hashing.
- Package storage defaults beside a file-backed database (or the OS temp directory for in-memory tests) and can be explicitly controlled with `EXTERNAL_GENERATION_PACKAGE_ROOT`.
- Reference bytes may be supplied directly or loaded from an asset's `local_path`; only safe package-relative names are exposed by `getReferenceFile`.
- Existing image/video tables and flows were left untouched. The migration is additive and uses `CREATE TABLE IF NOT EXISTS`.

## Verification

- `npx --yes node@22 --test test/externalGenerationService.test.js test/externalGenerationReferenceService.test.js`
  - 2 suites, 6 tests, 6 passed, 0 failed.
- `npx --yes node@22 --test test/*.test.js`
  - 39 suites, 170 tests, 170 passed, 0 failed.
- `git diff --check`
  - no output (clean).
- Migration smoke check with `runMigrationsAndEnsure` on a fresh in-memory database
  - migrations 01 through 24 completed; all five `external_generation_*` tables were present.
- System Node is v24 while the checked-in better-sqlite3 binary targets Node 22; tests therefore use the available `npx node@22` runner. No dependency files were changed.

## Concerns

- The package root is filesystem-configurable via environment variable; production wiring should set it to the application's configured storage root before exposing package files.
- This task persists external result schema but intentionally does not add result-ingestion routes or asset promotion logic; those consumers must continue to pass explicit attempt/result IDs.
