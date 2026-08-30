# Episode Generation Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent current-episode image/video progress panel below the one-click pipeline.

**Architecture:** The backend derives a read-only episode snapshot from existing entity, image, video, async-task, and merge tables. The frontend polls that snapshot through a focused component, while the existing image-generation store supplies channel-specific environment health. No new workflow table is introduced.

**Tech Stack:** Express, better-sqlite3, Vue 3, Pinia, Element Plus, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-30-episode-generation-progress-design.md`

## Global Constraints

- Keep image environment health separate from task lifecycle counts.
- Treat uploaded/imported usable media as completed targets.
- Do not combine image and video percentages into one misleading number.
- Use existing routes, response helpers, polling patterns, and status utilities.
- Use `apply_patch` for edits and add failing tests before production code.

---

### Task 1: Backend Episode Progress Aggregator

**Files:**
- Create: `backend-node/src/services/episodeGenerationProgressService.js`
- Test: `backend-node/test/episodeGenerationProgressService.test.js`

**Interfaces:**
- Consumes: `db`, numeric `episodeId`.
- Produces: `getEpisodeGenerationProgress(db, episodeId)` returning the snapshot defined in the spec.

- [ ] **Step 1: Write failing service tests**

Create an in-memory SQLite fixture with `episodes`, `characters`, `scenes`, `props`, `storyboards`, `image_generations`, `image_generation_tasks`, `video_generations`, `async_tasks`, and `video_merges`. Assert that bound media counts as completed, active/review/failed tasks are separated, first/last-frame targets obey classic-mode metadata, playable video requires a URL/path, and merge progress comes from its async task.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `cd backend-node; node --test test/episodeGenerationProgressService.test.js`.

Expected: FAIL because `episodeGenerationProgressService.js` does not exist.

- [ ] **Step 3: Implement target discovery and status reduction**

Implement small pure helpers for `bucket()`, `percent()`, usable image/video checks, and latest-record selection. Query episode-owned assets and storyboards, then query image tasks/generations and video generations in batches. Use status precedence `completed > active/review > failed > pending` for each target, while retaining independent completed counts for already-bound media. Normalize video `processing` to `running` and use joined `async_tasks.progress`.

- [ ] **Step 4: Implement merge snapshot and response envelope**

Load the latest non-deleted `video_merges` row for the episode, join its task progress/message/error, and return `merge: null` when none exists. Add `generated_at` as an ISO timestamp and throw a typed not-found error when the episode is absent.

- [ ] **Step 5: Run focused tests and verify they pass**

Run `cd backend-node; node --test test/episodeGenerationProgressService.test.js`.

Expected: PASS for all aggregator cases.

- [ ] **Step 6: Commit the backend service**

Run `git add backend-node/src/services/episodeGenerationProgressService.js backend-node/test/episodeGenerationProgressService.test.js; git commit -m "feat: aggregate episode media generation progress"`.

### Task 2: Backend Route and Frontend API

**Files:**
- Modify: `backend-node/src/routes/index.js`
- Create: `backend-node/src/routes/episodeGenerationProgress.js`
- Create: `frontweb/src/api/episodeGenerationProgress.js`
- Test: `backend-node/test/episodeGenerationProgressRoutes.test.js`

**Interfaces:**
- Consumes: `getEpisodeGenerationProgress(db, episodeId)` from Task 1.
- Produces: `GET /api/v1/episodes/:episodeId/generation-progress` and `episodeGenerationProgressAPI.get(episodeId)`.

- [ ] **Step 1: Write failing route and API contract tests**

Assert the route returns the envelope for a valid episode, returns 404 for a missing episode, and that the frontend API builds the exact path with URL encoding.

- [ ] **Step 2: Run focused route tests and verify they fail**

Run `cd backend-node; node --test test/episodeGenerationProgressRoutes.test.js`.

Expected: FAIL because the route and API module are missing.

- [ ] **Step 3: Implement the route using existing response helpers**

Follow `imageGenerationTasks.js` route construction. Validate a positive numeric episode id, call the service, map not-found to `response.notFound`, and map unexpected errors to `response.internalError` with the existing logger.

- [ ] **Step 4: Register the route under the `/api/v1` router**

Import the route factory in `backend-node/src/routes/index.js` and mount `r.get('/episodes/:episodeId/generation-progress', episodeGenerationProgress.get)` without changing existing route order or behavior.

- [ ] **Step 5: Add the frontend API wrapper and pass tests**

Implement:

```js
export const episodeGenerationProgressAPI = {
  get(episodeId) {
    return request.get(`/episodes/${encodeURIComponent(episodeId)}/generation-progress`)
  },
}
```

Run `cd backend-node; node --test test/episodeGenerationProgressRoutes.test.js` and the frontend API source test. Expected: PASS.

- [ ] **Step 6: Commit route and API**

Run `git add backend-node/src/routes/index.js backend-node/src/routes/episodeGenerationProgress.js backend-node/test/episodeGenerationProgressRoutes.test.js frontweb/src/api/episodeGenerationProgress.js frontweb/test/episodeGenerationProgressApi.test.js; git commit -m "feat: expose episode generation progress API"`.

### Task 3: Frontend Progress State and Component

**Files:**
- Create: `frontweb/src/components/EpisodeGenerationProgress.vue`
- Create: `frontweb/src/composables/useEpisodeGenerationProgress.js`
- Create: `frontweb/test/episodeGenerationProgress.test.js`

**Interfaces:**
- Consumes: `episodeGenerationProgressAPI.get`, `environment` ref from the image store, and optional `onOpenStoryboard(storyboardId)` callback.
- Produces: a component with `episodeId` prop, `environment` prop, and `open-storyboard` event; polling starts on mount and stops on unmount.

- [ ] **Step 1: Write failing utility/component tests**

Cover percent clamping, `total === 0` behavior, image environment not affecting image failure/percent, rendering of image/video/merge counts, preserving the last snapshot after a rejected refresh, and clearing the interval on unmount.

- [ ] **Step 2: Run focused frontend tests and verify they fail**

Run `cd frontweb; node --test test/episodeGenerationProgress.test.js`.

Expected: FAIL because the composable and component do not exist.

- [ ] **Step 3: Implement the composable**

Implement `useEpisodeGenerationProgress(episodeId)` with `snapshot`, `loading`, `error`, `lastUpdated`, `refresh()`, `startPolling()`, and `stopPolling()`. Poll every 5000 ms, ignore stale responses when the episode id changes, and retain the previous snapshot on refresh errors.

- [ ] **Step 4: Implement the component template and interactions**

Render two independent `el-progress` bars, count tags, environment status using `ImageGenerationEnvironmentStatus`, merge status, and an active-item list. Emit `open-storyboard` with the storyboard id; do not call cancel/retry APIs from this component. Use explicit empty/loading/error states and a manual refresh icon button.

- [ ] **Step 5: Run focused tests and verify they pass**

Run `cd frontweb; node --test test/episodeGenerationProgress.test.js`.

Expected: PASS.

- [ ] **Step 6: Commit the component**

Run `git add frontweb/src/components/EpisodeGenerationProgress.vue frontweb/src/composables/useEpisodeGenerationProgress.js frontweb/test/episodeGenerationProgress.test.js; git commit -m "feat: add episode generation progress component"`.

### Task 4: FilmCreate Integration and Navigation

**Files:**
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/test/imageGenerationUi.test.js`
- Create: `frontweb/test/filmCreateEpisodeProgress.test.js`

**Interfaces:**
- Consumes: `EpisodeGenerationProgress` from Task 3 and current `currentEpisodeId`, `imageGenerationEnvironment`, `checkImageGenerationEnvironment`.
- Produces: the persistent current-episode progress section below the pipeline and storyboard navigation on active-item click.

- [ ] **Step 1: Write failing integration/source tests**

Assert `FilmCreate.vue` imports and mounts `EpisodeGenerationProgress` below the pipeline section, passes the current episode and environment, wires the refresh/check callback, and defines a handler that scrolls to `sb-${storyboardId}` and opens the video drawer target.

- [ ] **Step 2: Run focused integration tests and verify they fail**

Run `cd frontweb; node --test test/filmCreateEpisodeProgress.test.js`.

Expected: FAIL because the component is not mounted and the handler is absent.

- [ ] **Step 3: Mount the panel and wire its props/events**

Add the component immediately after the pipeline section, before resource management. Pass `:episode-id="currentEpisodeId"`, `:environment="imageGenerationEnvironment"`, `:environment-checking="..."`, and handle `@open-storyboard="onEpisodeProgressOpenStoryboard"`.

- [ ] **Step 4: Implement storyboard navigation handler**

Find the storyboard in `store.storyboards`, call `scrollToAnchor('sb-' + id)`, and call `openVideoGenerationPanel(sb)` after `nextTick()` so the existing drawer opens against the current storyboard. Ignore missing/deleted ids without throwing.

- [ ] **Step 5: Avoid duplicate environment polling**

Keep the shared store cache as the source of truth. The new panel only renders the passed environment and invokes the existing check callback for manual refresh; it must not create its own environment interval.

- [ ] **Step 6: Run focused tests and build**

Run `cd frontweb; node --test test/filmCreateEpisodeProgress.test.js test/imageGenerationUi.test.js; npm run build`.

Expected: PASS and a successful production build.

- [ ] **Step 7: Commit FilmCreate integration**

Run `git add frontweb/src/views/FilmCreate.vue frontweb/test/imageGenerationUi.test.js frontweb/test/filmCreateEpisodeProgress.test.js; git commit -m "feat: show current episode generation progress"`.

### Task 5: Full Verification and Progress Documentation

**Files:**
- Modify: `docs/superpowers/progress/2026-08-30-storyboard-generation-flow-progress.md`

- [ ] **Step 1: Run backend full suite**

Run `cd backend-node; node --test test/*.test.js` and record the pass count.

- [ ] **Step 2: Run frontend full suite and production build**

Run `cd frontweb; node --test test/*.test.js; npm run build` and record both results.

- [ ] **Step 3: Perform read-only API smoke checks**

With the documented backend server running, request `/health` and `/api/v1/episodes/:episodeId/generation-progress` for an existing episode. Confirm the response has separate image/video/merge sections and does not expose API keys or browser secrets.

- [ ] **Step 4: Update the progress document**

Append the implementation commit, test/build evidence, API smoke result, and the explicit boundary that exact one-click step recovery remains future work.

- [ ] **Step 5: Run final git diff/status review**

Run `git diff --check` and `git status --short`; ensure only intended source, test, and documentation files are changed.

