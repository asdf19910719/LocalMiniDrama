# Task 5 Report — Explicit legacy orphan cleanup command

## Status

Implemented the `cleanup:deleted-project` command with an injectable `run()` entry point.

- Default mode previews only.
- `--execute` permanently removes only a project whose `deleted_at` is set.
- Missing, invalid, live, and unknown targets are refused before calling the deletion service.
- The CLI passes `{ includeDeleted: true }` only after directly verifying the target is soft-deleted.
- Execution previews first and refuses `storage.cleanup_status === 'unsafe'`; it also rechecks `deleted_at` after preview before invoking permanent deletion.
- Execution resolves the preview directory and projects root with `realpathSync` when present, refusing symlinked directories that escape the projects root even if the service's lexical preview status is `pending`.
- Production cleanup continues to use `previewProjectDeletion` and `deleteProjectPermanently`; no SQL cleanup logic was duplicated.

## Verification

TDD red phase:

```text
node --test test/cleanupDeletedProjectCli.test.js
FAIL — Cannot find module '../scripts/cleanup-deleted-project'
```

Syntax verification passed:

```text
node --check scripts/cleanup-deleted-project.js
```

Focused green verification with Node22:

```text
npx -y node@22 --test test/cleanupDeletedProjectCli.test.js
pass 7, fail 0
```

Tests create a temporary on-disk SQLite database and temporary storage/config paths; no test or command was run against `backend-node/data/drama_generator.db`.

## Concern

The CLI performs a final soft-delete check immediately before calling the existing permanent-deletion service. A fully atomic check-and-delete would require changing that shared service's transaction contract, which is outside the Task 5 file scope; the immediate recheck closes the tested restore-between-preview-and-delete path but cannot eliminate an external concurrent writer between the recheck and service transaction.

## Commit

Review fix is pending parent-agent integration.
