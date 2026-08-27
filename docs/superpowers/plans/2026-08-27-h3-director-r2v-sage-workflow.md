# H3 Director R2V Sage Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unified video service execute the verified single-segment H3 Director R2V workflow with KJ Sage acceleration, immutable routing snapshots, safe reference staging, and capability-driven clients.

**Architecture:** Keep lifecycle/state/database ownership in `UnifiedVideoGenerationService`. Add a workflow adapter registry and a controlled reference staging service behind the ComfyUI provider; resolve and hash the workflow and plan before persistence, then use only those snapshot values for submit/retry/recovery. Expose a read-only capabilities endpoint and update the Director/video UI to consume it without enabling continuity in V1.

**Tech Stack:** Node.js 22, Express-style route factories, better-sqlite3, ComfyUI API JSON workflows, Vue 3.

---

### Task 1: Registry, official API workflow, adapter contract

**Files:**
- Create: `backend-node/src/director/adapters/h3DirectorR2VAdapter.js`
- Create: `backend-node/src/director/adapters/index.js`
- Create: `backend-node/configs/workflows/minimax_h3_director_r2v.json`
- Modify: `backend-node/src/director/workflowRegistry.js`
- Modify: `backend-node/configs/director-workflows.json`
- Test: `backend-node/test/directorWorkflowRegistry.test.js`

- [x] Add a fail-closed adapter registry with `validate`, `buildPrompt`, and `describeCapabilities` methods. The H3 adapter must inject `task_type: "r2v"`, one `s0` segment, 1-9 staged refs, H3 prompt fields, and `continuityEnabled: false`.
- [x] Copy the known API-format R2V graph, replace the unsafe memory-efficient Sage patch with `PathchSageAttentionKJ` (`sage_attention: auto`, `allow_compile: false`), use the `ref2va` UNET and the existing H3 CLIP/video/audio VAE files, then hash and register it as `minimax_h3_director_r2v` / `official_sage`.
- [x] Extend registry shape validation with family, adapter, variant, workflow format, capabilities, and schema version. Reject UI-format graphs and missing required Sage/ref2va nodes.
- [x] Write failing registry/adapter tests, run them with Node 22, implement, and rerun the focused suite.

### Task 2: Generation plan, immutable snapshot, and strict V1 validation

**Files:**
- Create: `backend-node/src/services/videoGenerationPlan.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/src/services/videoGenerationSnapshot.js`
- Modify: `backend-node/src/services/videoConfigResolver.js`
- Test: `backend-node/test/videoGenerationPlan.test.js`
- Test: `backend-node/test/videoGenerationSnapshot.test.js`
- Test: `backend-node/test/unifiedVideoGenerationService.test.js`

- [x] Build a canonical plan with `workflowId`, `mode`, `common`, and exactly one `s0` segment. Validate unknown fields, dimensions (positive 32-multiples), duration, frame rate, seed, 1-9 refs, and false continuity; accept `single_reference` as the V1 compatibility alias while exposing `single_segment_r2v` as the canonical internal name.
- [x] Resolve the selected registry entry at creation time, calculate `workflowSha256` and a stable `planHash`, and snapshot workflow variant, adapter/version, mode, Sage settings, and non-secret config values. Keep `model` as a compatibility projection of `workflowId` and reject conflicts.
- [x] Make retries/recovery use the snapshot and allow local ComfyUI recovery without requiring the deleted active config; retain credential checks for remote/cloud providers.
- [x] Add red/green tests for strict validation, hash fields, no-secret snapshots, and recovery against changed defaults.

### Task 3: ComfyUI adapter execution and safe reference staging

**Files:**
- Create: `backend-node/src/services/videoProviders/referenceAssetStaging.js`
- Modify: `backend-node/src/services/videoProviders/comfyuiVideoProvider.js`
- Modify: `backend-node/src/director/comfyuiClient.js`
- Test: `backend-node/test/referenceAssetStaging.test.js`
- Test: `backend-node/test/comfyuiVideoProvider.test.js`

- [x] Stage only files under configured storage/artifact roots, hash contents, generate path-free safe names, copy to local ComfyUI input or upload through `/upload/image`, and return source/hash/filename/role/index metadata. Clean temporary files after terminal states with reference counting and warning-only cleanup failures.
- [x] Select the adapter from the workflow entry, validate/build the prompt through it, and use the snapshot/config base URL for submit, query, cancel, and recovery clients. Never fallback to an old workflow, non-Sage graph, or another provider.
- [x] Extend connection checks to require declared Sage and ref2va nodes/models and return capabilities without inference.
- [x] Add red/green tests for local/remote staging, traversal rejection, adapter prompt shape, URL selection, and fail-closed capability checks.

### Task 4: Capabilities API and client integration

**Files:**
- Modify: `backend-node/src/routes/videos.js`
- Modify: `backend-node/src/routes/index.js`
- Modify: `backend-node/src/services/videoProviders/index.js`
- Modify: `backend-node/src/api` or existing API module as applicable
- Test: `backend-node/test/videoCapabilitiesRoutes.test.js`

- [x] Add `GET /videos/capabilities` returning the active ComfyUI workflow, mode schema, H3/Sage capabilities, connection status, and no credentials.
- [x] Keep POST `/videos` and Director generation compatible while rejecting arbitrary workflow/provider overrides in V1.
- [x] Add route tests for the capability payload and fail-closed error response.

### Task 5: Director/video UI and configuration defaults

**Files:**
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue`
- Modify: `frontweb/src/components/AIConfigContent.vue`
- Modify: `frontweb/src/api/videos.js`
- Test: existing frontend unit/build checks

- [x] Replace model-name heuristics and continuity defaults with the capabilities response. Show the official Sage workflow and single-segment multi-reference mode, render 1-9 reference slots, and hide unimplemented continuity controls.
- [x] Send canonical workflow/mode fields while preserving other provider panels and existing candidate/review controls.
- [x] Update default ComfyUI model/config presentation and connection results with workflow hash, Sage/ref2va requirements, and inference-not-started status.

### Task 6: Full verification and host acceptance

**Files:**
- Modify: `docs/AI导演工作台-项目现状与进展.md`
- Modify: `docs/superpowers/specs/2026-08-27-h3-director-r2v-sage-workflow-design.md`
- Test: all backend tests under Node 22, frontend tests/build, host acceptance artifacts

- [x] Run focused red/green suites, then the complete backend test suite with `E:\AI\tools\node-v22.22.3-win-x64\node.exe` and frontend checks/build.
- [x] Run one local `864x480`, about 5 second, 1-3 reference image acceptance job when ComfyUI is available; verify audio/video streams, review status, and cleanup evidence.
- [x] Synchronize the design document with resolved recommendations, record compatibility and known runtime limitations, perform an independent code review, and report exact verification evidence.
