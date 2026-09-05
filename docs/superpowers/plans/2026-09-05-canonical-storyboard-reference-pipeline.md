# Canonical Storyboard Reference Pipeline Implementation Plan

> Execute inline with Superpowers `executing-plans`, `systematic-debugging`, TDD, and verification-before-completion.

**Goal:** Make the character state shown in storyboard references identical to the state persisted by import and submitted to image generation, then prove all imported assets generate and render through real user clicks.

**Architecture:** The backend canonical slot resolver owns reference identity and order. Drama payloads expose persisted links; the Vue composable owns hydration, selected-variant lookup, and metadata-preserving saves. Image-generation adapters only translate canonical slots into transport-safe references.

**Tech Stack:** Node.js 22, Express, better-sqlite3, Vue 3, Node test runner, Vite, Chromium/extension.

---

### Task 1: Canonical image-generation references

**Files:**
- Modify: `backend-node/src/services/referenceSlotService.js`
- Modify: `backend-node/src/services/imageGenerationTargetService.js`
- Test: `backend-node/test/imageGenerationTargetService.test.js`

1. Add a failing test proving storyboard generation uses variant links, canonical ordering/metadata, and never the base character image.
2. Add a failing test proving an imported absolute external-result path becomes a fetchable content endpoint.
3. Run the focused test and confirm the new assertions fail for the legacy collector.
4. Expose raw local/remote image fields from slots and translate available canonical slots into transport references.
5. Re-run the focused tests and refactor only after green.

### Task 2: Persisted links in drama payloads

**Files:**
- Modify: `backend-node/src/services/dramaService.js`
- Test: `backend-node/test/dramaStoryboardVariantLinks.test.js`

1. Add a failing integration test for ordered `character_variant_links` including image and metadata fields.
2. Attach links in both single-drama and drama-list storyboard payload construction.
3. Run the focused test to green.

### Task 3: Frontend hydration and selected-state rendering

**Files:**
- Modify: `frontweb/src/composables/filmCreate/useCharacterVariants.js`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/test/useCharacterVariants.test.js`

1. Add failing pure behavior tests for payload hydration, metadata-preserving saves, selected-variant lookup, and no base-image fallback.
2. Implement hydrated link state, selected-variant resolution, and metadata-preserving link construction.
3. Hydrate during storyboard state sync and switch storyboard character thumbnails plus local Omni fallbacks to selected variants.
4. Run the focused frontend test to green.

### Task 4: Regression verification and review

1. Run relevant backend and frontend test files.
2. Run all frontend tests and build.
3. Run all backend tests; distinguish any unchanged baseline failures from regressions.
4. Inspect the full diff, run `git diff --check`, and verify each realistic wrong-source/wrong-state mutation is caught.
5. Commit only the planned files.

### Task 5: Live integration and user-flow acceptance

1. Merge the verified commit to `main` without disturbing unrelated working-tree changes.
2. Restart/reload backend, frontend, and unpacked extension as needed.
3. Clear only stale pre-acceptance image tasks if they block the queue.
4. In the real project page, continuously click generation for all characters, character states, props, and scenes.
5. Wait until the queue drains with every acceptance task completed; diagnose and repair any stall.
6. Reload the page and verify every corresponding image element loads (`complete` and non-zero natural size), including storyboard thumbnails using the selected state.
7. Report the commit, test evidence, live task counts, and rendered-asset evidence.
