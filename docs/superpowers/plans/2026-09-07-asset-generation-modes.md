# Asset Generation Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every character base asset, character state asset, and scene its own persisted image-generation mode, with optional state identity references and auditable ChatGPT/API task snapshots.

**Architecture:** A small backend `assetGenerationModes` module owns allowed/default modes and mode-specific prompt rules. Asset rows store the next default choice, while `image_generation_tasks` stores an immutable execution snapshot. Existing character, state, and scene services dispatch to their existing single/multi-view generators; the Vue project page and `CharacterVariantStudio` expose per-asset selectors without adding a new route.

**Tech Stack:** Node.js 22-compatible CommonJS, Express, SQLite/better-sqlite3, Vue 3 Composition API, Element Plus, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-asset-generation-modes-design.md`

## Global Constraints

- Pure JavaScript only; do not introduce TypeScript or new runtime dependencies.
- Supported character modes are exactly `SINGLE` and `TURNAROUND`.
- Supported scene modes are exactly `NORMAL` and `QUAD_GRID`.
- Character defaults remain `TURNAROUND`; state defaults remain `SINGLE`; scene defaults remain `NORMAL`.
- Identity references are optional and missing base images never block state generation.
- Existing `ImageGenerateSplitButton` remains responsible for channel selection.
- Functional changes must be recorded in root `CHANGELOG.md` under `[未发布]` after verification.

---

### Task 1: Persist and validate asset modes

**Files:**
- Create: `backend-node/src/services/assetGenerationModes.js`
- Modify: `backend-node/src/db/migrate.js`
- Modify: `backend-node/src/services/characterVariantsService.js`
- Modify: `backend-node/src/services/characterLibraryService.js`
- Modify: `backend-node/src/services/sceneService.js`
- Test: `backend-node/test/assetGenerationModes.test.js`
- Test: `backend-node/test/characterVariantsService.test.js`

**Interfaces:**
- Produces `normalizeAssetMode(targetType, value)`, `defaultAssetMode(targetType)`, `allowedAssetModes(targetType)`, and `buildModePrompt(targetType, mode, prompt)`.
- Produces persisted fields `asset_mode` and `use_identity_reference` on returned asset rows.

- [ ] **Step 1: Write failing mode protocol and persistence tests**

Create tests that assert character defaults to `TURNAROUND`, variant defaults to `SINGLE`, scene defaults to `NORMAL`, legal values normalize to uppercase, invalid values throw, variant create/update accepts `asset_mode` and `use_identity_reference`, and `TURNAROUND` adds a multi-view layout instruction.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test --test-isolation=none test/assetGenerationModes.test.js test/characterVariantsService.test.js`

Expected: failure because `assetGenerationModes.js` and the new columns/whitelist fields do not exist.

- [ ] **Step 3: Implement the minimal protocol and migrations**

Add the seven columns from the spec with SQLite defaults. Implement strict target-specific validation and append only the selected mode template. Add `asset_mode` and `use_identity_reference` to character/scene update handling and the variant create/update whitelist.

- [ ] **Step 4: Run targeted tests and confirm GREEN**

Run: `node --test --test-isolation=none test/assetGenerationModes.test.js test/characterVariantsService.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/assetGenerationModes.js backend-node/src/db/migrate.js backend-node/src/services/characterVariantsService.js backend-node/src/services/characterLibraryService.js backend-node/src/services/sceneService.js backend-node/test/assetGenerationModes.test.js backend-node/test/characterVariantsService.test.js
git commit -m "feat: persist asset generation modes"
```

### Task 2: Dispatch API generation by persisted mode

**Files:**
- Modify: `backend-node/src/routes/characters.js`
- Modify: `backend-node/src/routes/scenes.js`
- Modify: `backend-node/src/services/characterVariantsService.js`
- Test: `backend-node/test/assetGenerationRoutes.test.js`
- Test: `backend-node/test/characterVariantImage.test.js`

**Interfaces:**
- Character routes consume `body.asset_mode`; scene routes consume `body.asset_mode` with legacy `use_quad_grid` only as a fallback.
- `generateVariantImage(..., options)` consumes `options.assetMode` and `options.useIdentityReference`.

- [ ] **Step 1: Write failing route and state-generation tests**

Cover character `SINGLE`/`TURNAROUND` dispatch, scene `NORMAL`/`QUAD_GRID` dispatch, invalid-mode 400 responses, variant `TURNAROUND` prompt structure, and disabled/missing identity reference behavior.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test --test-isolation=none test/assetGenerationRoutes.test.js test/characterVariantImage.test.js`

- [ ] **Step 3: Implement mode dispatch**

Resolve request mode from explicit body, persisted asset row, then type default. Route existing generators accordingly. In state generation, compile the selected mode before style, and attach the base character image only when the resolved identity flag is true and an image exists.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `node --test --test-isolation=none test/assetGenerationRoutes.test.js test/characterVariantImage.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/routes/characters.js backend-node/src/routes/scenes.js backend-node/src/services/characterVariantsService.js backend-node/test/assetGenerationRoutes.test.js backend-node/test/characterVariantImage.test.js
git commit -m "feat: dispatch asset generation by mode"
```

### Task 3: Snapshot mode, negative prompt, style, and real references

**Files:**
- Modify: `backend-node/src/services/imageGenerationTaskService.js`
- Modify: `backend-node/src/services/imageGenerationTargetService.js`
- Modify: `backend-node/src/routes/imageGenerationTasks.js`
- Test: `backend-node/test/imageGenerationTaskService.test.js`
- Test: `backend-node/test/imageGenerationTargetService.test.js`

**Interfaces:**
- `buildGenerationInput(db, task)` returns `{ target, prompt, negativePrompt, references, frameType, assetMode, styleSnapshot }`.
- `createTask()` consumes `assetMode`, `negativePromptSnapshot`, and `styleSnapshot`.

- [ ] **Step 1: Write failing snapshot tests**

Assert that the task row stores resolved mode, negative prompt, JSON style snapshot, and references; verify a state with identity disabled has no `character_identity` reference, while an enabled state with a base image has exactly one.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test --test-isolation=none test/imageGenerationTaskService.test.js test/imageGenerationTargetService.test.js`

- [ ] **Step 3: Implement trusted backend resolution and persistence**

Read asset mode and identity preference from the resolved database row unless an explicit validated mode is supplied. Build mode-specific prompts on the backend, resolve project style metadata into a JSON snapshot, and pass all snapshots into task creation.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `node --test --test-isolation=none test/imageGenerationTaskService.test.js test/imageGenerationTargetService.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/imageGenerationTaskService.js backend-node/src/services/imageGenerationTargetService.js backend-node/src/routes/imageGenerationTasks.js backend-node/test/imageGenerationTaskService.test.js backend-node/test/imageGenerationTargetService.test.js
git commit -m "feat: audit asset generation inputs"
```

### Task 4: Make ChatGPT execution reference-aware

**Files:**
- Modify: `frontweb/src/utils/imageGenerationPrompt.js`
- Modify: `frontweb/src/stores/imageGenerationStore.js`
- Test: `frontweb/test/imageGenerationPrompt.test.js`
- Test: `frontweb/test/imageGenerationStore.test.js`

**Interfaces:**
- `buildChatGPTImageGenerationPrompt(prompt, targetType, options)` consumes `options.hasIdentityReference` and `options.negativePrompt`.
- Store builds the execution wrapper from the task's persisted reference manifest and negative-prompt snapshot.

- [ ] **Step 1: Write failing execution-wrapper tests**

Assert that identity copy appears only when the task manifest actually contains `character_identity`, and that a non-empty negative snapshot is appended as a clearly labeled prohibited-content block.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test test/imageGenerationPrompt.test.js test/imageGenerationStore.test.js`

- [ ] **Step 3: Implement reference-aware wrapping**

Keep the audited business prompt unchanged, but derive transport instructions from the persisted task manifest. Never infer an attachment from `target_type` alone.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `node --test test/imageGenerationPrompt.test.js test/imageGenerationStore.test.js`

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/utils/imageGenerationPrompt.js frontweb/src/stores/imageGenerationStore.js frontweb/test/imageGenerationPrompt.test.js frontweb/test/imageGenerationStore.test.js
git commit -m "fix: align ChatGPT asset generation inputs"
```

### Task 5: Add per-asset controls to the project page and state studio

**Files:**
- Create: `frontweb/src/constants/assetGenerationModes.js`
- Create: `frontweb/src/components/imageGeneration/AssetGenerationModeSelect.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/src/components/CharacterVariantStudio.vue`
- Modify: `frontweb/src/composables/filmCreate/useCharacters.js`
- Modify: `frontweb/src/composables/filmCreate/useCharacterVariants.js`
- Modify: `frontweb/src/composables/filmCreate/useScenes.js`
- Modify: `frontweb/src/api/characters.js`
- Test: `frontweb/test/assetGenerationModes.test.js`
- Test: `frontweb/test/characterVariantStudio.test.js`
- Test: `frontweb/test/filmCreateAssetGenerationModes.test.js`

**Interfaces:**
- `AssetGenerationModeSelect` accepts `modelValue`, `targetType`, `size`, and `disabled`, and emits `update:modelValue` plus `change`.
- Composables expose save functions that optimistically update and roll back on API failure.
- Generation functions pass the current resolved asset mode.

- [ ] **Step 1: Write failing UI/source-contract tests**

Assert target-specific labels/defaults, selector presence on role/state/scene cards, absence of `sceneUseQuadGrid`, identity switch behavior, and mode propagation into both API and ChatGPT task creation.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test test/assetGenerationModes.test.js test/characterVariantStudio.test.js test/filmCreateAssetGenerationModes.test.js`

- [ ] **Step 3: Implement selectors and optimistic persistence**

Add the compact mode selector beside every existing split generate button. Reuse the existing state drawer and add its mode selector plus independent identity switch. Remove the scene-wide checkbox and read each scene's `asset_mode` for generation.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `node --test test/assetGenerationModes.test.js test/characterVariantStudio.test.js test/filmCreateAssetGenerationModes.test.js`

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/constants/assetGenerationModes.js frontweb/src/components/imageGeneration/AssetGenerationModeSelect.vue frontweb/src/views/FilmCreate.vue frontweb/src/components/CharacterVariantStudio.vue frontweb/src/composables/filmCreate/useCharacters.js frontweb/src/composables/filmCreate/useCharacterVariants.js frontweb/src/composables/filmCreate/useScenes.js frontweb/src/api/characters.js frontweb/test/assetGenerationModes.test.js frontweb/test/characterVariantStudio.test.js frontweb/test/filmCreateAssetGenerationModes.test.js
git commit -m "feat: add per-asset image mode controls"
```

### Task 6: Documentation, regression verification, and review

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-09-07-asset-generation-modes.md`

**Interfaces:**
- No new runtime interface; this task verifies all earlier interfaces together.

- [ ] **Step 1: Add the verified user-visible changelog entry**

Under `[未发布]`, record per-asset role/state/scene modes, optional identity references, and unified task snapshots. Do not include future RunningHub-only modes.

- [ ] **Step 2: Run backend targeted regressions**

Run all test files changed or directly related to asset modes with `--test-isolation=none`. The project-wide backend runner is also attempted; on Node 24, record the known better-sqlite3 cleanup assertion separately from test assertion failures.

- [ ] **Step 3: Run complete frontend tests and production build**

Run: `node --test test/*.test.js`

Run: `npm run build`

- [ ] **Step 4: Check diff hygiene and conduct code review**

Run: `git diff --check`

Review validation boundaries, defaults, route compatibility, identity reference behavior, and unrelated-file exclusion. Fix every actionable finding and repeat affected tests.

- [ ] **Step 5: Mark plan checkboxes complete and commit**

```bash
git add CHANGELOG.md docs/superpowers/plans/2026-09-07-asset-generation-modes.md
git commit -m "docs: record asset generation mode support"
```
