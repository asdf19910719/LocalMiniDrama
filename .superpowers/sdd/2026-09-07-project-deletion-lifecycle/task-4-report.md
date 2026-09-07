# Task 4 Report — New-project navigation and stale episode reset

Commit message: `fix: reset episode state before drama load`

## Delivered

- Added `filmStore.beginDramaLoad(id)`, which synchronously clears the prior current episode, premise and script before exposing the new loading drama ID.
- Changed newly created projects to open `/drama/:id`, keeping empty projects out of the episode-dependent production page.
- Updated `FilmCreate` route loading to clear the selected episode before calling `beginDramaLoad`, suspend URL synchronization during that transition, validate any `episode` query against the loaded project's episodes, and remove invalid queries safely.
- Guarded asynchronous detail loads so a response for a drama that is no longer current cannot overwrite the newer project state.
- Added `frontweb/test/projectLifecycleContracts.test.js` with real Pinia store coverage and Vue source contracts for routing, load ordering, and query sanitization.

## TDD evidence

Initial focused run (red):

```text
node --test test/projectLifecycleContracts.test.js
pass 0, fail 4
```

The failures were the expected missing `beginDramaLoad` interface, `/film/:id` new-project target, missing reset-before-load ordering, and missing invalid-query validation.

After the minimal implementation (green):

```text
node --test test/projectLifecycleContracts.test.js
pass 4, fail 0

node --test test/*.test.js
pass 244, fail 0

npm run build
✓ built in 5.43s
```

## Review

- `beginDramaLoad` writes `currentEpisode = null` before `drama = { id }`. The progress component receives only `currentEpisodeId`, so both synchronous and queued watchers observe no old episode once the loading drama becomes visible; no old progress request target remains.
- Route-query synchronization is suspended only during the async route transition and released after Vue has applied the selected valid episode, avoiding a stale query rewrite.
- The build produced the repository's pre-existing large-chunk warning only; it is unrelated to this task.
- `CHANGELOG.md` is deliberately untouched: Task 6 owns the lifecycle changelog update, and this worktree already contained unrelated changelog edits.

## Review fix round 1

- Added a per-invocation `dramaLoadSerial`; every asynchronous load stage checks both the token and current drama before applying results.
- Route transitions increment the serial immediately, preventing ABA switches and same-ID overlapping loads from reviving an older response.
- Added a regression contract for serial capture, route invalidation, and post-await guards.
- Propagated the token through `loadStoryboardMedia` and `restoreSelectionsFromBackend`; media maps and selected-image references are now assigned only while the load remains current.
- Cleared the component-local `storyInput` ref synchronously on project switch in addition to the Pinia store fields.

Focused regression verification after the fix:

```text
node --test test/projectLifecycleContracts.test.js
pass 6, fail 0
```
