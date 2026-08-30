# Image Generation Environment Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Gate image-generation task creation and queue dispatch on channel-specific environment readiness, with actionable diagnostics in shared UI.

**Architecture:** Backend exposes a non-billable readiness report for service/configuration and task references. The browser extension exposes a diagnostic action for the workbench bridge and ChatGPT tab. The Pinia image-generation store aggregates both reports, caches health, gates creation, and pauses queue dispatch when a recheck fails.

**Tech Stack:** Express/SQLite backend, Chrome MV3 extension, Vue 3/Pinia frontend, Node built-in tests.

**Spec:** `docs/superpowers/specs/2026-08-30-image-generation-environment-check-design.md`

## Global Constraints

- Keep API and ChatGPT checks channel-specific.
- Do not issue billable generation requests during health checks.
- Do not expose API keys or cookies in diagnostics.
- Use `apply_patch` and add failing tests before production code.

---

### Task 1: Backend readiness contract

**Files:**
- Create: `backend-node/src/services/imageGenerationEnvironmentService.js`
- Modify: `backend-node/src/routes/imageGenerationTasks.js`
- Test: `backend-node/test/imageGenerationTaskRoutes.test.js`

**Interfaces:**
- Produces `GET /api/v1/dramas/:dramaId/image-generation-environment?channel=...` returning `{ canProceed, channel, checks, checkedAt }`.
- Checks drama existence, channel enablement, provider/model configuration presence, and task reference URL shape without downloading or generating.

- [x] Write a failing route test for API and ChatGPT channel-specific checks.
- [x] Run the focused backend test and verify it fails because the endpoint is missing.
- [x] Implement the readiness report and route with stable error codes.
- [x] Run the focused backend test and verify it passes.
- [x] Included in the consolidated environment-check commit.

### Task 2: Extension diagnostics

**Files:**
- Modify: `browser-extension/src/background.js`
- Modify: `browser-extension/src/workbench/content.js`
- Test: `browser-extension/test/autoAttach.test.js`

**Interfaces:**
- Consumes `{ action: 'diagnostics', dramaId, site, conversationId }`.
- Produces checks for bridge reachability, provider tab, conversation identity, content script identity, and composer readiness; no secrets.

- [x] Write failing tests for healthy, missing-tab, and conversation-mismatch diagnostics.
- [x] Run focused extension tests and verify failure.
- [x] Implement background diagnostics and workbench forwarding response.
- [x] Rebuild `browser-extension/src/sites/chatgpt/content.bundle.js` if provider-side support changes.
- [x] Run focused extension tests and verify pass.
- [x] Included in the consolidated environment-check commit.

### Task 3: Frontend preflight aggregator and queue gate

**Files:**
- Create: `frontweb/src/utils/imageGenerationEnvironment.js`
- Modify: `frontweb/src/api/imageGenerationTasks.js`
- Modify: `frontweb/src/stores/imageGenerationStore.js`
- Modify: `frontweb/src/utils/imageGenerationQueueDriver.js`
- Test: `frontweb/test/imageGenerationTaskState.test.js`
- Test: `frontweb/test/imageGenerationQueueDriver.test.js`

**Interfaces:**
- `runImageGenerationEnvironmentCheck({ dramaId, channel, task })` returns the structured aggregate result.
- Store exposes `environment`, `checkEnvironment`, and blocks `openTask` for failed full checks.
- Queue driver calls `beforeSend(task)` and emits `environment_blocked` without failing queued tasks.

- [x] Add failing tests for aggregation, channel branching, cache expiry, and queue blocking.
- [x] Run focused frontend tests and verify failure.
- [x] Implement API calls, bridge diagnostics, cache, and queue pause behavior.
- [x] Run focused frontend tests and verify pass.
- [x] Included in the consolidated environment-check commit.

### Task 4: Project status and drawer UI

**Files:**
- Create: `frontweb/src/components/imageGeneration/ImageGenerationEnvironmentStatus.vue`
- Modify: `frontweb/src/components/imageGeneration/ImageGenerationQueue.vue`
- Modify: `frontweb/src/components/imageGeneration/ImageGenerationDrawer.vue`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Modify: `frontweb/src/views/DramaCanvas.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Test: `frontweb/test/imageGenerationUi.test.js`

- [x] Add failing source/UI tests for status badge, checklist, disabled send, and remediation action.
- [x] Run focused UI tests and verify failure.
- [x] Implement shared status component and drawer integration without nested cards.
- [x] Run focused UI tests and verify pass.
- [x] Included in the consolidated environment-check commit.

### Task 5: Verification and progress record

**Files:**
- Modify: `docs/superpowers/progress/2026-08-30-storyboard-generation-flow-progress.md`

- [x] Run browser-extension, backend, and frontend full test suites.
- [x] Run extension and frontend production builds.
- [x] Perform read-only API smoke checks for environment endpoints.
- [x] Record evidence and include it in the consolidated environment-check commit.
