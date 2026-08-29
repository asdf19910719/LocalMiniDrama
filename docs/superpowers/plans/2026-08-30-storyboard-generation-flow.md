# Storyboard Generation Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make storyboard generation prompts, references, timing, image rendering, merge, and TTS deterministic and testable.

**Architecture:** Preserve existing APIs while separating source prompts from compiled prompts in the drawer, deriving image references from target identity, and projecting actual job timing fields into candidate cards. Keep grid-image filtering centralized in storyboard media utilities.

**Tech Stack:** Vue 3, Pinia, Node.js, Express, SQLite, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-30-storyboard-generation-flow-design.md`

## Global Constraints

- Pure JavaScript; no new dependencies.
- Preserve existing API routes and Chinese user-facing labels.
- Do not reuse reference manifests across image-generation targets.
- Run backend tests with `cd backend-node && node --test test/*.test.js`.
- Run frontend tests with `cd frontweb && node --test test/*.test.js`.
- Build with `cd frontweb && npm run build`.

---

### Task 1: Separate universal and H3 prompt presentation

**Files:**
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue`
- Test: `frontweb/test/videoGenerationPanel.test.js`

**Interfaces:**
- `restoreLastUsedPrompt(groups)` continues returning the latest compiled fallback for compatibility.
- Add a pure helper returning `{ businessPrompt, lastCompiledPrompt }` from storyboard/context/history.

- [ ] Write a failing test proving a universal segment remains the form prompt while a historical H3 prompt is exposed separately.
- [ ] Run the focused test and confirm it fails because the helper/state does not exist.
- [ ] Implement the helper/state and render two explicit read-only/editable fields without changing the generate request shape.
- [ ] Run the focused frontend test and then the full frontend suite.

### Task 2: Bind ChatGPT web image references to the target

**Files:**
- Modify: `backend-node/src/services/imageGenerationTargetService.js`
- Modify: `backend-node/src/routes/imageGenerationTasks.js`
- Modify: `frontweb/src/components/dramaCanvas/CanvasStoryboardPanel.vue`
- Test: `backend-node/test/imageGenerationTargetService.test.js`

**Interfaces:**
- `buildGenerationInput(db, task)` remains the source of truth for prompt and references.
- Task creation accepts target identity and stores a target-derived reference manifest.

- [ ] Add a failing test showing a storyboard task ignores a caller-supplied stale manifest and resolves current scene/character/prop references.
- [ ] Run the focused backend test and confirm failure.
- [ ] Implement target-derived manifest replacement and ensure storyboard ChatGPT callers send universal/image prompt for the selected target.
- [ ] Run focused and full backend tests.

### Task 3: Persist and display accurate candidate timing

**Files:**
- Modify: `backend-node/src/director/candidateGroupService.js`
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue`
- Test: `backend-node/test/videoGenerationSnapshot.test.js`
- Test: `frontweb/test/videoGenerationPanel.test.js`

**Interfaces:**
- Candidate projection exposes `job_started_at`, `job_completed_at`, `video_created_at`, and `video_completed_at`.
- UI displays localizable `生成开始：YYYY-MM-DD HH:mm:ss` and existing elapsed duration.

- [ ] Add failing assertions for execution start timestamp and elapsed duration fallback.
- [ ] Run focused tests and confirm failure.
- [ ] Implement projection and formatting with legacy fallback to video creation time.
- [ ] Run focused and full suites.

### Task 4: Normalize storyboard main-image selection

**Files:**
- Modify: `frontweb/src/utils/storyboardMedia.js`
- Modify: `frontweb/src/composables/useCanvasStoryboardMedia.js` only if its response normalization bypasses `getSbImagesList`
- Test: `frontweb/test/storyboardMedia.test.js`

**Interfaces:**
- `getSbImagesList` and `resolveSbMainImageRecord` remain the public selectors.
- Grid source records are excluded when split child records are available; otherwise the most recent valid main record is used consistently.

- [ ] Add failing tests for a shot with a grid source plus split children and a shot with only a grid source.
- [ ] Run focused test and confirm failure.
- [ ] Implement centralized selection in `storyboardMedia.js`; update `useCanvasStoryboardMedia.js` only when the test demonstrates a bypass.
- [ ] Run full frontend suite and build.

### Task 5: End-to-end local workflow verification

**Files:**
- Modify: no production files; use existing local test fixtures and endpoints.
- Test: existing `backend-node/test/videoMergeDirectorTimeline.test.js`, `backend-node/test/voiceReference.test.js`, and frontend workflow tests.

- [ ] Start backend and frontend development services on configured ports.
- [ ] Exercise image task creation/reference binding, video candidate creation/selection, merge status, and TTS endpoints with local fixtures.
- [ ] Run backend tests, frontend tests, and frontend build.
- [ ] Record any external-AI limitation separately from local workflow behavior.
