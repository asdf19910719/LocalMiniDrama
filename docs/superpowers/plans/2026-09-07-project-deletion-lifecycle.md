# Project Deletion Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project deletion permanently remove all project-owned database rows and project files, while fixing episode and asset deletion entry points and eliminating stale episode requests after project recreation.

**Architecture:** Add a focused deletion service that discovers owned IDs, deletes dependencies in SQLite transactions, and performs guarded project-directory cleanup. Expose dedicated project and episode deletion routes; make existing asset deletion services detach their relations. Keep frontend behavior thin: call the APIs, clear cross-project store state before loading, and route newly created empty projects to their detail page.

**Tech Stack:** Node.js 22, Express, better-sqlite3, Vue 3, Pinia, Element Plus, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-project-deletion-lifecycle-design.md`

## Global Constraints

- Project deletion is permanent; no trash or restore flow is introduced.
- Never delete `drama_id IS NULL` public library rows, global settings, AI configs, or another project's records.
- Never automatically execute legacy orphan cleanup.
- Filesystem deletion is limited to the exact stable project directory beneath configured `storage/projects`.
- Every production behavior change follows red-green TDD.
- Functional changes must be recorded in root `CHANGELOG.md` under `[未发布]` after verification.

---

### Task 1: Project deletion service and API

**Files:**
- Create: `backend-node/src/services/projectDeletionService.js`
- Create: `backend-node/test/projectDeletionService.test.js`
- Modify: `backend-node/src/routes/drama.js`
- Modify: `backend-node/test/projectDeletionRoutes.test.js`

**Interfaces:**
- Produces: `previewProjectDeletion(db, cfg, dramaId)` returning `{ project, counts, storage }`.
- Produces: `deleteProjectPermanently(db, cfg, log, dramaId)` returning `{ deleted, counts, storage }` or `null`.
- API: `DELETE /api/v1/dramas/:id` returns the deletion summary.

- [ ] Write tests that create two projects, project-owned descendants, public library rows, external generation rows and an exact project directory; assert preview has no mutation.
- [ ] Run the focused test and verify it fails because the deletion service does not exist.
- [ ] Implement ID discovery, leaf-to-root parameterized deletes, transaction boundaries, row-count reporting and guarded exact-directory cleanup.
- [ ] Run the focused test and verify project rows/files are gone while the second project and public rows remain.
- [ ] Add route tests for success and missing project; run them red then green after wiring `cfg` into the handler.

### Task 2: Dedicated episode deletion

**Files:**
- Modify: `backend-node/src/services/projectDeletionService.js`
- Modify: `backend-node/src/routes/drama.js`
- Modify: `backend-node/src/routes/index.js`
- Modify: `backend-node/test/projectDeletionService.test.js`
- Modify: `frontweb/src/api/drama.js`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Modify: `frontweb/test/dramaDetailDeletionContracts.test.js`

**Interfaces:**
- Produces: `deleteEpisodePermanently(db, log, episodeId)` returning `{ deleted, drama_id, episode_id, counts }` or `null`.
- API: `DELETE /api/v1/episodes/:id`.
- Frontend: `dramaAPI.deleteEpisode(id)`.

- [ ] Add a failing service test proving episode descendants are deleted while project-level assets and sibling episodes survive.
- [ ] Implement transactional episode deletion and run the focused service test green.
- [ ] Add a failing frontend contract test requiring `DramaDetail.vue` to call `deleteEpisode` rather than `saveEpisodes` for removal.
- [ ] Add the API method, route and handler, update the view, and run backend/frontend focused tests green.

### Task 3: Production asset deletion integrity and detail-page actions

**Files:**
- Modify: `backend-node/src/services/characterLibraryService.js`
- Modify: `backend-node/src/services/sceneService.js`
- Modify: `backend-node/src/services/propService.js`
- Create: `backend-node/test/productionAssetDeletion.test.js`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Modify: `frontweb/test/dramaDetailDeletionContracts.test.js`

**Interfaces:**
- Existing character/scene/prop delete endpoints remain stable.
- Character deletion removes episode/storyboard links and variants.
- Scene deletion nulls storyboard scene references.
- Prop deletion removes storyboard links.

- [ ] Add failing backend tests for every association rule and cross-project parent validation.
- [ ] Implement the minimum transactional association cleanup and run the focused backend tests green.
- [ ] Extend the failing frontend contract test for delete buttons and handlers in all three production-resource tabs.
- [ ] Implement confirmation handlers that call existing APIs and reload drama; run the frontend test green.

### Task 4: New-project navigation and stale episode reset

**Files:**
- Modify: `frontweb/src/stores/film.js`
- Modify: `frontweb/src/views/FilmList.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Create: `frontweb/test/projectLifecycleContracts.test.js`

**Interfaces:**
- `filmStore.beginDramaLoad(id)` atomically clears episode/script state and installs `{ id }` as the loading drama.
- New project navigation target is `/drama/:id`.

- [ ] Add failing contract tests for the new navigation target, store reset interface and `FilmCreate` route-loading order.
- [ ] Implement `beginDramaLoad`, use it before `loadDrama`, and remove an invalid `episode` query when switching projects.
- [ ] Run focused frontend tests green and confirm no immediate episode progress request is possible from old store state.

### Task 5: Explicit legacy orphan cleanup command

**Files:**
- Create: `backend-node/scripts/cleanup-deleted-project.js`
- Create: `backend-node/test/cleanupDeletedProjectCli.test.js`
- Modify: `backend-node/package.json`

**Interfaces:**
- Command: `npm run cleanup:deleted-project -- --drama-id <id>` previews only.
- Command: `npm run cleanup:deleted-project -- --drama-id <id> --execute` permanently cleans only an already-soft-deleted project.

- [ ] Add failing tests for default preview, live-project refusal, missing ID refusal and explicit execution.
- [ ] Implement argument parsing and reuse `previewProjectDeletion` / `deleteProjectPermanently` without duplicating SQL.
- [ ] Run focused CLI tests green; do not execute the command against the user's real database.

### Task 6: Documentation, regression verification and review

**Files:**
- Modify: `CHANGELOG.md`
- Modify: relevant tests only if verification exposes a real regression.

**Interfaces:**
- No new runtime interface.

- [ ] Update `[未发布]` with permanent project deletion, explicit episode deletion, production asset actions, safe legacy cleanup and new-project routing behavior.
- [ ] Run all backend tests with Node.js 22.
- [ ] Run all frontend tests.
- [ ] Run `npm run build` in `frontweb`.
- [ ] Review the complete diff for unrelated user-file changes and destructive operations.
- [ ] Request an independent code review, address Critical/Important findings, and repeat affected verification.
