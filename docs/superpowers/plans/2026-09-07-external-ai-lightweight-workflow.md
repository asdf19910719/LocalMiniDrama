# External AI Lightweight Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the lightweight two-stage external-AI workflow: new-session context, project-generated task ZIP, strict incremental result import, and episode provenance display.

**Architecture:** A focused task-bundle service projects current project state into public context and a private asset snapshot. A strict result-contract module validates external output and adapts it to the existing episode-package import transaction. Routes and a small Vue dialog expose context copy, task generation/download, and existing import preview.

**Tech Stack:** Node.js 22, Express, SQLite/better-sqlite3, adm-zip, Vue 3, Element Plus, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-external-ai-lightweight-workflow-design.md`

## Global Constraints

- New workflow protocol is `local-mini-drama.external-ai-result` version `1`; no new compatibility behavior for 1.0/1.1 packages.
- Existing assets are immutable through this import flow: reuse or create only.
- New characters require personality and appearance plus all production fields listed in the spec.
- Continue using the existing episode-package preview and atomic persistence after strict adaptation.
- Preserve unrelated dirty-worktree changes and update root `CHANGELOG.md` only with verified behavior.

---

### Task 1: Task bundle projection and persistence

**Files:**
- Create: `backend-node/src/services/externalAiTaskBundleService.js`
- Modify: `backend-node/src/db/migrate.js`
- Test: `backend-node/test/externalAiTaskBundleService.test.js`

**Interfaces:**
- Produces: `buildConversationContext(db, dramaId, options) -> { filename, markdown }`
- Produces: `createTaskBundle(db, dramaId, options) -> task descriptor`
- Produces: `getTaskBundle(db, packageId) -> task descriptor|null`
- Produces: `buildTaskZip(task) -> Buffer`

- [ ] **Step 1: Write failing service tests**

Create an in-memory database fixture covering drama metadata, two episodes, characters and variants, scenes, props, and `external_ai_package_tasks`. Assert that conversation Markdown contains continuity notes, prior summaries, the latest prior script and complete character facts; assert task generation assigns stable missing keys, persists a unique `package_id`, emits a deterministic assets digest, and creates a ZIP with exactly the three specified files.

- [ ] **Step 2: Run the service test and verify RED**

Run: `C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe --test test/externalAiTaskBundleService.test.js`

Expected: FAIL because `externalAiTaskBundleService` does not exist.

- [ ] **Step 3: Implement persistence and projection**

Add `external_ai_package_tasks` in `ensureAllColumns()`. Implement canonical JSON hashing, stable-key assignment without overwriting existing keys, public asset projection, private ID snapshot, Markdown construction, task insertion, retrieval, and ZIP generation with UTF-8 files.

- [ ] **Step 4: Run the service test and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

### Task 2: Strict incremental result contract and adapter

**Files:**
- Create: `backend-node/src/services/externalAiResultContract.js`
- Create: `backend-node/src/services/externalAiResultAdapter.js`
- Test: `backend-node/test/externalAiResultContract.test.js`
- Test: `backend-node/test/externalAiResultAdapter.test.js`

**Interfaces:**
- Produces: `EXTERNAL_AI_RESULT_SCHEMA`
- Produces: `validateExternalAiResult(value) -> { ok, errors }`
- Produces: `adaptExternalAiResult(db, result, task) -> { package, warnings, assetDigestStatus }`

- [ ] **Step 1: Write failing contract tests**

Assert acceptance of one existing-reference storyboard and rejection of unknown properties, missing new-character personality/appearance, duplicate `local_ref`, invalid primitives, non-contiguous storyboard numbers, and unresolved references.

- [ ] **Step 2: Verify contract tests fail because modules are missing**

Run both new test files with Node 22 and confirm RED.

- [ ] **Step 3: Implement the strict validator**

Build the exported JSON Schema and a deterministic path-based runtime validator from the same field definitions. Reject unknown fields at every result-owned object level and validate cross references separately in the adapter.

- [ ] **Step 4: Implement and test adaptation**

Load existing assets through the task snapshot, verify current project ownership, expand reused assets from the database, map new `local_ref` values to namespaced `source_key` values, attach new variants to existing characters, and produce a current complete episode package with `complete_av_v1` production data.

- [ ] **Step 5: Run both tests and verify GREEN**

Run both files with Node 22. Expected: all tests pass.

### Task 3: HTTP routes and import integration

**Files:**
- Modify: `backend-node/src/routes/episodePackage.js`
- Modify: `backend-node/src/services/episodePackageService.js`
- Modify: `backend-node/src/services/episodeImportProvenanceService.js`
- Modify: `backend-node/src/db/migrate.js`
- Test: `backend-node/test/episodePackageRoutes.test.js`
- Test: `backend-node/test/episodePackageService.test.js`
- Test: `backend-node/test/episodeImportProvenanceService.test.js`

**Interfaces:**
- Adds: `GET /dramas/:dramaId/external-ai/context`
- Adds: `POST /dramas/:dramaId/external-ai/tasks`
- Adds: `GET /external-ai/tasks/:packageId/download`
- Extends: existing preview/import requests transparently recognize the new schema.

- [ ] **Step 1: Add failing route and integration tests**

Assert context response, task creation, ZIP headers/content, wrong-project and missing-task errors, successful incremental preview/import, reused asset immutability, stale digest warning, deleted-reference rejection, and provenance task fields.

- [ ] **Step 2: Run targeted tests and verify RED**

Use Node 22 for the three affected test files. Confirm failures are missing routes/integration behavior.

- [ ] **Step 3: Add route handlers and protocol dispatch**

Add handlers before parameterized routes. In preview/import, parse the top-level schema, load the task, adapt the result, then pass the generated complete package to existing validation/matching/import logic while preserving the original result text for provenance.

- [ ] **Step 4: Persist task provenance atomically**

Extend `episode_imports` with `task_package_id`, `task_created_at`, and `task_assets_digest`. Store original external result as `raw_json`; store the adapted complete package as `normalized_json`; mark the task imported in the same import transaction.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Use Node 22. Expected: all affected tests pass.

### Task 4: External AI collaboration UI

**Files:**
- Create: `frontweb/src/components/ExternalAiCollaborationDialog.vue`
- Create: `frontweb/src/utils/externalAiPackage.js`
- Modify: `frontweb/src/api/episodePackage.js`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Modify: `frontweb/src/components/EpisodeImportSourceDialog.vue`
- Modify: `frontweb/src/components/EpisodePackageImportDialog.vue`
- Test: `frontweb/test/externalAiPackage.test.js`
- Test: `frontweb/test/externalAiCollaborationUi.test.js`
- Test: `frontweb/test/episodeImportSourceUi.test.js`

**Interfaces:**
- Adds API methods `getConversationContext`, `createExternalAiTask`, and `downloadExternalAiTask`.
- Adds dialog events `import-result` and standard `v-model` visibility.

- [ ] **Step 1: Write failing utility and UI contract tests**

Assert safe task filenames and blob download behavior at the utility boundary. Assert the Drama Detail entry, context-copy action, target-episode task generation, ZIP download, import handoff, and task provenance labels exist in rendered-source contracts used by this repository.

- [ ] **Step 2: Run frontend targeted tests and verify RED**

Run: `node --test test/externalAiPackage.test.js test/externalAiCollaborationUi.test.js test/episodeImportSourceUi.test.js`

- [ ] **Step 3: Implement API, dialog, and page integration**

Use one dialog with two concise sections: optional new-session context, then required task generation. Keep the existing import dialog as the result preview/import surface, opening it from the collaboration dialog. Add task metadata to the source dialog.

- [ ] **Step 4: Run frontend targeted tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

### Task 5: Public documentation, changelog, and full verification

**Files:**
- Modify: `docs/单集制作包导入/上游AI生成提示词模板.md`
- Replace: `docs/单集制作包导入/制作包schema.json`
- Replace: `docs/单集制作包导入/制作包示例.json`
- Create: `docs/单集制作包导入/外部AI协作流程.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Documents the two-stage user workflow and the exact current result contract.

- [ ] **Step 1: Generate docs from the implemented contract**

Export the runtime schema verbatim to `制作包schema.json`, update the example to a valid incremental result, and rewrite the prompt template around `package_id`, existing references, and `new_assets`.

- [ ] **Step 2: Add the user workflow guide**

Document same-session and new-session sequences, field purposes, required/optional fields, reuse/create rules, and source-file path limitations imposed by browsers.

- [ ] **Step 3: Run focused backend and frontend suites**

Run all episode-package/external-AI backend tests with Node 22, and all frontend tests with the available Node runtime.

- [ ] **Step 4: Run full backend tests and frontend build**

Run `node --test test/*.test.js` under Node 22 in `backend-node`; run `node --test test/*.test.js` and `npm run build` in `frontweb`.

- [ ] **Step 5: Update the root changelog and review the diff**

Record only verified user-visible results under `[未发布]`. Confirm `git diff --check`, inspect the scoped diff, and ensure unrelated dirty files are not staged.
