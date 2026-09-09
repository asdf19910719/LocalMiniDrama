# Production Studio V2.1 Remaining Pages Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every remaining unified-prototype placeholder with a reviewable interaction model, close the Cut and delivery gate contradictions, and update the full-design review against the current V2.1 authority set.

**Architecture:** Keep the prototype dependency-free. The UMD model owns deterministic page state, scenarios, gates, capabilities and transitions; the unified HTML owns view rendering and reversible prototype interactions. Human-facing decisions live in the page review log, while machine acceptance remains in model tests and the E2E matrix.

**Tech Stack:** HTML, CSS, browser JavaScript, CommonJS/UMD, Node.js built-in test runner, Markdown

**Spec:** `docs/superpowers/specs/2026-09-05-production-studio-v2-design.md`

## Global Constraints

- Modify design artifacts and prototypes only; do not modify `frontweb/src`, backend product code, databases, or real Provider state.
- V2.1 replaces the legacy implementation at Phase 6 after Phase 1–5 internal validation; do not introduce runtime V1/V2 feature flags, dual writes, old-route fallback, or compatibility UI.
- Every registered page must expose a default view plus its registered abnormal/recovery scenarios; every visible action must navigate, mutate prototype state, or open a reviewable drawer.
- Script approval, episode asset snapshot, Video Gate, Picture Lock, Post Revision and Delivery Revision remain distinct facts.
- Quick Create and Canvas reuse canonical Job/Candidate/Asset/Command semantics and are optional auxiliary tools, not a second production system or a gate in the four-stage flow.
- Complete 2D/3D professional tools and video repaint remain outside V2.1; their existing entry points explain the boundary and route to Canvas context rather than promise separate products.
- Do not update `CHANGELOG.md`; these are unshipped specifications and prototype changes.
- Preserve unrelated working-tree changes and do not commit.

---

### Task 1: Establish failing coverage and gate tests

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Consumes: the 17-route registry and current Cut model.
- Produces: executable expectations for nine remaining page models, real task progress semantics, Cut locking, and 52-item coverage.

- [x] **Step 1: Add failing model tests**

Add tests that call `getScriptStageModel`, `getEpisodeAssetsStageModel`, `getAiSettingsModel`, `getGlobalTaskModel`, `getProjectCreateModel`, `getProjectImportModel`, `getGeneralSettingsModel`, `getLibraryModel`, `getQuickCreateModel`, and `getCanvasModel`. Assert literal user outcomes: approval does not auto-refresh downstream; asset confirmation creates an immutable snapshot; credentials are masked; task progress is null unless provider-reported; project archive import is transactional; library references pin versions; Quick Create uses canonical jobs; Canvas commands match the standard workspace.

- [x] **Step 2: Add Cut and coverage tests**

Assert that the default Cut state with `6/9` adopted cannot Picture Lock, a waiting encode check cannot export, a base composite artifact always survives optional upscale, and `buildFeatureCoverageIndex()` returns 52 unique stable IDs mapped to registered routes.

- [x] **Step 3: Run the focused test and verify RED**

Run:

```powershell
node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs
```

Expected: failures name missing model functions, empty coverage, and incorrect Cut gates.

### Task 2: Implement Script and episode Assets stage models and pages

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html`
- Test: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Produces: `getScriptStageModel(projectId, episodeId, scenarioId)`, `getEpisodeAssetsStageModel(projectId, episodeId, scenarioId)`, `renderScriptStage(...)`, and `renderEpisodeAssetsStage(...)`.

- [x] **Step 1: Implement Script state and transitions**

Expose story-scene navigation, dirty/saving/saved/save-failed states, 800 ms autosave description, `Ctrl/Cmd+S`, local browser recovery copy, revision history/diff/409 conflict, AI draft and novel result review, asset extraction diff, explicit approval, and downstream stale impact. Approval creates a ScriptRevision only; refresh decisions stay in the Assets stage.

- [x] **Step 2: Implement episode Assets snapshot workflow**

Expose required character states, scenes, props and conditional voices; project current versus episode selection; missing-candidate recovery; continue-old/refresh choices; Look change diff; batch preflight; and explicit Asset Gate confirmation that records immutable IDs, versions and hashes before entering Storyboard.

- [x] **Step 3: Wire all visible controls and scenarios**

Use drawers for AI/diff/history/conflict and candidate selection, URL scenarios for blocked/stale/save failures, and direct Studio-step navigation. No button may terminate without visible feedback.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 command and require zero failures.

### Task 3: Implement AI configuration and canonical global task center

**Files:** same model, HTML and test files as Task 2.

**Interfaces:**
- Produces: `getAiSettingsModel(scenarioId)` and `getGlobalTaskModel(focusTaskId)`.

- [x] **Step 1: Implement Provider configuration**

Model configuration layers, masked secrets, connection tests, model-role mapping, capability matrices, import/export conflict resolution, ChatGPT web session/attempt/rebind, and exact recovery actions for expired credentials and failed connections.

- [x] **Step 2: Replace fixed task percentages**

Show provider-reported percentage only when available. Otherwise show lifecycle stage, elapsed time, historical duration range and an explicitly labelled estimate. Pause/cancel/resume/reorder actions appear only when the task capability allows them.

- [x] **Step 3: Wire Provider and task actions, then run focused tests**

Every Provider card, capability, credential, mapping, import/export, connection test and task action opens a concrete drawer or changes prototype state. Run the Task 1 command and require zero failures.

### Task 4: Implement project creation, archive import, and general settings

**Files:** same model, HTML and test files as Task 2.

**Interfaces:**
- Produces: `getProjectCreateModel(scenarioId)`, `getProjectImportModel(scenarioId)`, and `getGeneralSettingsModel(scenarioId)`.

- [x] **Step 1: Implement minimal project shell creation**

Collect name, aspect ratio, default episode duration and output location; create the shell explicitly; then reuse the six episode sources. Cancel after shell creation keeps a visible empty project and offers continue/delete-from-menu, rather than silently deleting it.

- [x] **Step 2: Implement full project archive import**

Separate project ZIP from Episode Package. Preview manifest version, counts, media availability, required disk space, destination and name conflict; import only as a new project by default. Replacement is a separate high-risk restore action. Validation or commit failure leaves zero new project writes and retains an import report.

- [x] **Step 3: Implement general settings**

Expose workspace/media/output directories, defaults, storage reachability, relocation entry, save conflicts and recovery without duplicating Advanced Data Tools.

- [x] **Step 4: Wire actions and run focused tests**

Run the Task 1 command and require zero failures.

### Task 5: Implement library, Quick Create, and Canvas auxiliary tools

**Files:** same model, HTML and test files as Task 2.

**Interfaces:**
- Produces: `getLibraryModel(scenarioId)`, `getQuickCreateModel(scenarioId)`, and `getCanvasModel(scenarioId)`.

- [x] **Step 1: Implement the personal asset library**

Reuse project asset object/candidate semantics. Provide search/filter, provenance/license/path, fixed-version reference versus project copy, publish-to-library, update conflict, offline relocation and referenced-delete protection.

- [x] **Step 2: Implement Quick Create as a canonical-job shortcut**

Provide image/video Recipes, generation envelope and confirmation, task progress, candidate result, and explicit destinations: download, personal library, project asset, shot candidate or Cut timeline. Closing an unarchived result asks for a destination or discard confirmation.

- [x] **Step 3: Implement Canvas as a shared-command projection**

Restore project/episode/stage/focus context; show nodes, relationships, selection, batch actions and impact paths. Layout changes are local view state; object changes call the same named commands as standard pages. Unsaved route changes offer save/discard/cancel.

- [x] **Step 4: Wire actions and run focused tests**

Run the Task 1 command and require zero failures.

### Task 6: Correct Cut gates and post/delivery lineage

**Files:** same model, HTML and test files as Task 2.

**Interfaces:**
- Modifies: `getCutStageModel(...)`, `renderCutStage(...)`, and Cut command handling.

- [x] **Step 1: Make Picture Lock obey Video Gate**

With 6/9 adopted, one running and one failed task, Picture Lock stays disabled and opens a blocker explanation. The picture-lock scenario uses a fully adopted fixture and creates an immutable Timeline revision.

- [x] **Step 2: Make delivery obey encoding validation**

Export remains disabled while any required delivery check is waiting or failed. A successful scenario derives a Delivery Revision from exact Picture/Post revisions.

- [x] **Step 3: Persist the base composite and upscale decision**

The post chain creates `base-composite` before optional upscale. Skip, success and failure-fallback are explicit Post Revision decisions; a failed upscale never deletes or replaces the base composite.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 command and require zero failures.

### Task 7: Complete 52/52 traceability and correct the review report

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-page-review-decision-log.md`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md`
- Modify: `docs/superpowers/specs/2026-09-05-production-studio-v2-design.md`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-legacy-feature-migration-matrix.md`
- Modify: `docs/vnext/production-studio-v2.1-design-review.md`

**Interfaces:**
- Produces: `buildFeatureCoverageIndex()` with 52 unique feature IDs and a corrected, dated review conclusion.

- [x] **Step 1: Map all 52 features**

Each migration-matrix capability maps to a registered route plus a default/scenario/overlay target and one or more E2E IDs. Coverage UI distinguishes prototype-complete from product-code-not-developed.

- [x] **Step 2: Record every adopted page decision**

Move the remaining queue entries to confirmed sections with rationale, interaction boundary, abnormal states and separate prototype/product-code status. Update architecture/UI/E2E/migration wording without creating a second changelog.

- [x] **Step 3: Correct the full-design review**

Replace stale 7/17 and 10-placeholder counts with the verified result; mark external AI, Script and episode Assets seams as prototyped; record fixed Cut gates and base composite lineage; reject the report's Big Bang blocker because it conflicts with the later user-approved Phase 1–5 internal/Phase 6 cutover authority; keep backup/journal/transaction rollback as the cutover safety mechanism. Keep Quick Create and Canvas as confirmed optional V2.1 auxiliary tools, while excluding separate full 2D/3D and video repaint products.

- [x] **Step 4: Verify the complete artifact set**

Run all three prototype test files, parse the unified inline script, inspect every registered default route in the browser, check relative links, and run `git diff --check`. Report exact counts and any remaining product-code gaps.
