# RunningHub Style System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy 39-style dual catalog with a 169-style backend-owned registry, unified image/video prompt compilation, immutable snapshots, project-only style inheritance, localized RunningHub previews, custom styles, and external AI JSON v2.

**Architecture:** A backend `StyleRegistryService` is the only style source and merges immutable system JSON with database-backed custom styles. Project-bound generation resolves one `style_id`, compiles provider-ready prompts through shared language/reference/capability services, persists a snapshot before provider submission, and exposes read-only compiled previews to the Vue UI. External AI JSON v2 imports only base prompts and can never override style.

**Tech Stack:** Node.js 22, CommonJS backend, Express 4, better-sqlite3, node:test, Vue 3 ESM, Element Plus, Vite 5, Sharp.

**Spec:** `docs/superpowers/specs/2026-09-08-runninghub-style-system-redesign-design.md`

## Global Constraints

- System catalog contains exactly 169 styles and every style has Chinese display copy plus a genuine English generation prompt.
- Project `style_id` is the sole style authority for every project asset, episode, storyboard, image, and video.
- No episode-, asset-, shot-, or request-level style override is accepted.
- External AI result protocol is version `2` only and uses `prompt_contract: "base_prompt"`; v1 is rejected.
- External imports never call image/video providers.
- Style recommendations never auto-switch providers or paid models.
- RunningHub previews are stored locally; runtime UI never hotlinks RunningHub.
- Provider submission is forbidden until compilation, capability validation, and immutable snapshot persistence succeed.
- Preserve unrelated working-tree changes and update root `CHANGELOG.md` for verified functional changes.

---

### Task 1: Canonical 169-style catalog and validation

**Files:**
- Create: `backend-node/src/catalog/stylePresets.v1.json`
- Create: `backend-node/src/schemas/styleSpec.js`
- Create: `backend-node/src/services/styleRegistryService.js`
- Create: `backend-node/scripts/build-runninghub-style-catalog.js`
- Test: `backend-node/test/styleRegistryService.test.js`
- Source: `业务整理/RunningHub真实风格提示词与模型映射.json`

**Interfaces:**
- Produces: `validateStyleSpec(value) -> { valid, errors }`
- Produces: `createStyleRegistryService({ db, catalogPath, previewManifestPath })`
- Produces: `listStyles(filters)`, `getStyle(id)`, `requireStyle(id)`

- [ ] **Step 1: Write the failing registry test**

```js
test('system catalog contains 169 valid bilingual styles', () => {
  const registry = createStyleRegistryService({ catalogPath: fixture });
  const styles = registry.listStyles({ includeDisabled: true });
  assert.equal(styles.length, 169);
  assert.equal(new Set(styles.map((s) => s.id)).size, 169);
  for (const style of styles) {
    assert.ok(style.descriptionZh.trim());
    assert.ok(style.promptZh.trim());
    assert.match(style.promptEn, /[A-Za-z]{4}/);
    assert.notEqual(style.promptEn.trim(), style.promptZh.trim());
  }
});
```

- [ ] **Step 2: Run `cd backend-node && node --test test/styleRegistryService.test.js` and verify failure because the registry does not exist.**
- [ ] **Step 3: Implement strict StyleSpec validation and deterministic catalog normalization.** English prompts use existing genuine English when present; otherwise the builder emits an English style instruction from English label/key and normalized English keyword groups, with a non-generic style-specific lead sentence.
- [ ] **Step 4: Generate `stylePresets.v1.json`, run the test, and verify 169/169 entries pass.**
- [ ] **Step 5: Commit `feat: add canonical 169-style registry`.**

### Task 2: RunningHub preview extraction and local manifest

**Files:**
- Create: `backend-node/scripts/fetch-runninghub-style-previews.js`
- Create: `backend-node/src/catalog/stylePreviewManifest.v1.json`
- Create: `frontweb/public/style-thumbs/runninghub/*.webp`
- Test: `backend-node/test/stylePreviewManifest.test.js`

**Interfaces:**
- Consumes: catalog `runningHubId`, `key`, `preview.localPath`
- Produces: manifest entries `{ runningHubId, styleId, sourceUrl, localPath, sha256, width, height, collectedAt, status }`

- [ ] **Step 1: Write a failing test asserting all 169 manifest IDs exist, downloaded files remain inside `frontweb/public/style-thumbs/runninghub`, hashes match, and fallback status is explicit.**
- [ ] **Step 2: Run `cd backend-node && node --test test/stylePreviewManifest.test.js` and verify failure.**
- [ ] **Step 3: Implement safe HTTPS download, MIME/size validation, Sharp WebP conversion, SHA-256, and path-boundary checks.**
- [ ] **Step 4: Use the authenticated RunningHub page/API to capture preview URLs, execute the script, and retain a fallback entry for any unavailable preview without hotlinking at runtime.**
- [ ] **Step 5: Re-run the manifest test and commit `feat: localize style preview library`.**

### Task 3: Custom styles, style API, and database model

**Files:**
- Modify: `backend-node/src/db/migrate.js`
- Create: `backend-node/src/routes/styles.js`
- Modify: `backend-node/src/routes/index.js`
- Extend: `backend-node/src/services/styleRegistryService.js`
- Test: `backend-node/test/styleRoutes.test.js`
- Test: `backend-node/test/customStyleService.test.js`

**Interfaces:**
- Produces endpoints: `GET /styles`, `GET /styles/:id`, `POST /styles/custom`, `PUT /styles/custom/:id`, `DELETE /styles/custom/:id`
- Produces table: `custom_styles(id, version, spec_json, created_at, updated_at)`
- Produces project column: `dramas.style_id TEXT`

- [ ] **Step 1: Write failing API tests for system listing, detail, custom CRUD, version increment, and `CUSTOM_STYLE_IN_USE`.**
- [ ] **Step 2: Run the two focused backend test files and verify missing route/table failures.**
- [ ] **Step 3: Add tables/columns and implement routes with `{ error: { code, message, details } }` errors.**
- [ ] **Step 4: Run focused tests and verify pass.**
- [ ] **Step 5: Commit `feat: add style registry API and custom styles`.**

### Task 4: Project-only style authority

**Files:**
- Modify: `backend-node/src/services/dramaService.js`
- Modify: `backend-node/src/routes/drama.js`
- Modify: `frontweb/src/api/drama.js`
- Test: `backend-node/test/dramaProjectStyle.test.js`
- Replace tests: `frontweb/test/styleOptions.test.js`, `frontweb/test/stylePresetsBackendSync.test.js`

**Interfaces:**
- Consumes: `registry.requireStyle(styleId)`
- Produces project response field: `style_id`
- Produces error codes: `PROJECT_STYLE_REQUIRED`, `PROJECT_STYLE_OVERRIDE_FORBIDDEN`

- [ ] **Step 1: Write failing tests that create/update requires a valid `style_id` and generation cannot override it.**
- [ ] **Step 2: Run focused backend tests and verify failure against legacy `style`.**
- [ ] **Step 3: Change create/read/update to `style_id`, remove metadata prompt persistence, and make generation services resolve through project ownership.**
- [ ] **Step 4: Replace legacy front/back sync tests with API-contract tests and run them.**
- [ ] **Step 5: Commit `refactor: make project style the sole authority`.**

### Task 5: Language, reference, capability, and snapshot foundations

**Files:**
- Create: `backend-node/src/services/promptLanguageResolver.js`
- Create: `backend-node/src/services/referenceRegistry.js`
- Create: `backend-node/src/services/modelCapabilityValidator.js`
- Create: `backend-node/src/services/generationSnapshotService.js`
- Test: `backend-node/test/promptLanguageResolver.test.js`
- Test: `backend-node/test/referenceRegistry.test.js`
- Test: `backend-node/test/modelCapabilityValidator.test.js`
- Test: `backend-node/test/generationSnapshotService.test.js`

**Interfaces:**
- Produces: `resolvePromptLanguage({ modelConfig, style }) -> 'zh'|'en'|'mixed'`
- Produces: `createReferenceRegistry(items, language) -> { entries, promptLabels, providerImages }`
- Produces: `validateGenerationCapabilities(context) -> { status, errors, warnings }`
- Produces: `freezeGenerationSnapshot(db, input) -> persisted snapshot`

- [ ] **Step 1: Write focused failing tests for language precedence, stable reference order, reference limit/real-person blocking, and snapshot-before-submit invariants.**
- [ ] **Step 2: Run all four focused tests and verify failures.**
- [ ] **Step 3: Implement the four isolated services without provider calls.**
- [ ] **Step 4: Run focused tests and existing video/image snapshot tests.**
- [ ] **Step 5: Commit `feat: add generation compilation foundations`.**

### Task 6: Unified image prompt compiler and integrations

**Files:**
- Create: `backend-node/src/services/imagePromptCompiler.js`
- Modify: `backend-node/src/services/characterLibraryService.js`
- Modify: `backend-node/src/services/characterGenerationService.js`
- Modify: `backend-node/src/services/sceneService.js`
- Modify: `backend-node/src/services/propService.js`
- Modify: `backend-node/src/services/propImageGenerationService.js`
- Modify: `backend-node/src/services/framePromptService.js`
- Modify: `backend-node/src/services/imageService.js`
- Test: `backend-node/test/imagePromptCompiler.test.js`
- Update: `backend-node/test/assetGenerationModes.test.js`

**Interfaces:**
- Produces: `compileImagePrompt({ targetType, mode, basePrompt, negativePrompt, style, language, references }) -> { finalPrompt, negativePrompt, sections }`

- [ ] **Step 1: Write golden failing tests for character turnaround/single, variant, scene normal/multi-view/panorama/top-down, prop, and storyboard frame.**
- [ ] **Step 2: Run focused tests and verify legacy builders fail the new snapshots.**
- [ ] **Step 3: Implement the compiler with style-first sections, per-mode templates, negative merging, and duplicate-style detection.**
- [ ] **Step 4: Route all asset image entry points through the compiler and snapshot service; run focused plus existing asset tests.**
- [ ] **Step 5: Commit `feat: unify image style compilation`.**

### Task 7: Unified video prompt compiler and integrations

**Files:**
- Create: `backend-node/src/services/videoPromptCompiler.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/src/services/h3PromptCompiler.js`
- Modify: `backend-node/src/services/h3PromptDraftService.js`
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Test: `backend-node/test/videoPromptCompiler.test.js`
- Update: `backend-node/test/videoGenerationSnapshot.test.js`

**Interfaces:**
- Produces: `compileVideoPrompt({ storyboard, basePrompt, style, language, references, audio, duration }) -> { finalPrompt, negativePrompt, sections }`

- [ ] **Step 1: Write failing golden tests for plain video, multi-reference, first/last frame, Omni, H3, timecodes, Chinese dialogue, and real-person validation.**
- [ ] **Step 2: Run focused tests and verify `. Style:` output fails.**
- [ ] **Step 3: Implement style-first video compilation and remove `appendStyle` from provider-bound paths.**
- [ ] **Step 4: Make H3 consume the same resolved style/reference context before its specialized serialization; run video/H3 tests.**
- [ ] **Step 5: Commit `feat: unify video style compilation`.**

### Task 8: External AI JSON v2 and import-only base prompts

**Files:**
- Modify: `backend-node/src/services/externalAiResultContract.js`
- Modify: `backend-node/src/services/externalAiResultAdapter.js`
- Modify: `backend-node/src/services/externalAiTaskBundleService.js`
- Modify: `docs/单集制作包导入/制作包schema.json`
- Modify: `docs/单集制作包导入/制作包示例.json`
- Modify: `docs/单集制作包导入/README.md`
- Modify: `docs/单集制作包导入/上游AI生成提示词模板.md`
- Update: `backend-node/test/externalAiResultContract.test.js`
- Update: `backend-node/test/externalAiResultAdapter.test.js`
- Update: `backend-node/test/externalAiTaskBundleService.test.js`

**Interfaces:**
- Consumes/produces protocol constants: `version: '2'`, `prompt_contract: 'base_prompt'`
- Produces asset fields: `base_image_prompt`, storyboard field `base_video_prompt`

- [ ] **Step 1: Replace fixtures with v2 and add failing rejection tests for v1, style fields, final prompts, and old `image_prompt`.**
- [ ] **Step 2: Run focused external AI tests and verify contract failures.**
- [ ] **Step 3: Implement v2 strict schema, style-pollution lint, task ZIP read-only style context, and base-prompt database projection.**
- [ ] **Step 4: Verify preview/import never creates generation tasks and transaction rollback remains intact.**
- [ ] **Step 5: Regenerate docs/schema/example, run all external AI tests, and commit `feat: upgrade external AI import to base-prompt v2`.**

### Task 9: Visual-first style picker and persistent project summary

**Files:**
- Create: `frontweb/src/api/styles.js`
- Rewrite: `frontweb/src/components/StylePickerButton.vue`
- Create: `frontweb/src/components/StyleDetailDrawer.vue`
- Create: `frontweb/src/components/ProjectStyleSummary.vue`
- Modify: `frontweb/src/views/FilmList.vue`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Test: `frontweb/test/styleRegistryUi.test.js`
- Update: `frontweb/test/externalAiCollaborationUi.test.js`

**Interfaces:**
- Consumes: `GET /styles` and `GET /styles/:id`
- Emits from picker: `update:modelValue(styleId)` only

- [ ] **Step 1: Write failing source-level UI tests for API ownership, four-column cards, filters/search, selected state, detail drawer, and no local override controls.**
- [ ] **Step 2: Run focused frontend tests and verify failure.**
- [ ] **Step 3: Implement lazy-loaded/virtualized card grid, RunningHub local thumbnails, Chinese default details, advanced bilingual prompts, and custom style actions.**
- [ ] **Step 4: Add persistent summary to settings/storyboard/free canvas and read-only style to external import preview; run focused tests.**
- [ ] **Step 5: Commit `feat: add visual project style workspace`.**

### Task 10: FreeCreate and compiled prompt presentation

**Files:**
- Modify: `frontweb/src/views/FreeCreate.vue`
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue`
- Modify: `frontweb/src/components/imageGeneration/ImageGenerationDrawer.vue`
- Modify: `frontweb/src/stores/imageGenerationStore.js`
- Test: `frontweb/test/freeCreateStyle.test.js`
- Update: `frontweb/test/videoGenerationPanel.test.js`

**Interfaces:**
- Project-bound free task: project `style_id` read-only
- Standalone free task: required registry `style_id`
- History display: snapshot language, style/version, references, final prompt, validation stage

- [ ] **Step 1: Write failing tests for bound/standalone rules and read-only compiled prompt history.**
- [ ] **Step 2: Run focused tests and verify arbitrary style text remains a failure.**
- [ ] **Step 3: Replace free-text style input with registry selection and expose snapshot detail panels.**
- [ ] **Step 4: Run focused frontend tests and build.**
- [ ] **Step 5: Commit `feat: enforce registry styles in free generation`.**

### Task 11: Remove legacy paths, full verification, and documentation

**Files:**
- Delete after reference scan: `frontweb/src/constants/styleOptions.js`
- Delete after reference scan: `backend-node/src/constants/generationStylePresets.js`
- Delete after reference scan: `backend-node/src/utils/dramaStyleMerge.js`
- Modify: `业务整理/RunningHub与当前项目风格模块全链路分析.md`
- Modify: `业务整理/README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- No remaining runtime reference to legacy `dramas.style`, `style_prompt_zh`, `style_prompt_en`, `appendStyle`, or external result version `1`.

- [ ] **Step 1: Run `rg -n "generationStylePresets|stylePromptMetadataForSave|dramaStyleMerge|style_prompt_zh|style_prompt_en|appendStyle|external-ai-result.*version.*1" backend-node/src frontweb/src` and classify every remaining match.**
- [ ] **Step 2: Remove obsolete files/branches and update surviving imports; run focused regression tests.**
- [ ] **Step 3: Run full backend tests: `cd backend-node && node --test test/*.test.js`.**
- [ ] **Step 4: Run full frontend tests and build: `cd frontweb && node --test test/*.test.js && npm run build`.**
- [ ] **Step 5: Verify catalog/preview counts, `git diff --check`, UI smoke paths, and update business docs plus `[未发布]` CHANGELOG with verified results only.**
- [ ] **Step 6: Commit `feat: complete unified RunningHub style system`.**
