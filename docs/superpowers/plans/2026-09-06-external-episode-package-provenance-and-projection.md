# External Episode Package Provenance and Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make externally imported episodes traceable from the project and production UIs, eliminate silent field loss across the package contract, and conservatively repair recoverable historical imports.

**Architecture:** Add a version-aware canonical package normalizer and projection report beside the existing import service, persist report/provenance metadata with the import transaction, and expose only compact provenance in drama reads while lazily loading raw JSON through a dedicated endpoint. Extend the canonical asset persistence and editors instead of masking missing database values in Vue, then run an idempotent backfill over audit snapshots for fields that can be recovered without inference.

**Tech Stack:** Node.js CommonJS, Express, better-sqlite3, Node.js built-in test runner, Vue 3 Composition API, Element Plus, Axios, Vite.

**Spec:** `docs/superpowers/specs/2026-09-06-external-episode-package-provenance-and-projection-design.md`

## Global Constraints

- Support package versions `1.0` and `1.1`; reject unknown versions.
- Do not infer `role`, `personality`, or prop `type` from prose.
- Do not overwrite reused assets or non-empty historical fields.
- Do not claim or store a browser-inaccessible absolute source path.
- Render source JSON as text, never `v-html`.
- Preserve the current three-step preview, blank-target rule, transaction atomicity, and asset-match decisions.
- Keep unrelated dirty-worktree changes out of every commit; `backend-node/src/routes/scenes.js` already has unrelated user edits and should not be modified for this feature.
- Update only the root `CHANGELOG.md` after implementation and verification.

---

### Task 1: Versioned contract and deterministic normalization

**Files:**
- Create: `backend-node/src/services/episodePackageProjection.js`
- Modify: `backend-node/src/services/episodePackageSchema.js`
- Modify: `backend-node/test/episodePackageSchema.test.js`
- Create: `backend-node/test/episodePackageProjection.test.js`

**Interfaces:**
- Produces: `normalizePackageForProjection(pkg) -> { normalizedPackage, report }`.
- Produces: `buildProjectionReport(pkg, options) -> report` and `PACKAGE_PROJECTION_REGISTRY`.
- Produces: `SUPPORTED_PACKAGE_VERSIONS = ['1.0', '1.1']` from `episodePackageSchema.js`.
- Report shape: `{ version: 1, created: [], reused: [], derived_fields: [], missing_fields: [], audit_only_fields: [], warnings: [], projection: { status } }`.

- [ ] **Step 1: Write schema failures for version 1.1 and unsupported versions**

Add tests proving `1.1` accepts `characters[].role/personality` and `props[].type`, while `2.0` returns an error at `version`; prove `1.1` rejects missing values and `1.0` remains compatible.

```js
const pkg = examplePackage();
pkg.version = '1.1';
pkg.characters[0].role = 'main';
pkg.characters[0].personality = '冷静、警惕';
pkg.props[0].type = '关键道具';
assert.equal(validatePackageStructure(pkg).ok, true);
delete pkg.characters[0].personality;
assert.ok(validatePackageStructure(pkg).errors.some((e) => e.path === 'characters[0].personality'));
```

- [ ] **Step 2: Run the focused schema test and confirm RED**

Run: `cd backend-node; node --test test/episodePackageSchema.test.js`

Expected: FAIL because only version `1.0` and no new fields are recognized.

- [ ] **Step 3: Add projection normalizer failures**

Test a legacy character with no top-level image fields and one default variant. Assert the normalizer copies `appearance`, `image_prompt`, and `negative_prompt`, records `default_variant_fallback`, leaves `role/personality` null, and emits missing-field warnings. Test unknown extra paths enter `audit_only_fields` and normalization is deterministic.

```js
const { normalizedPackage, report } = normalizePackageForProjection(pkg);
assert.equal(normalizedPackage.characters[0].appearance, '默认状态外貌');
assert.equal(normalizedPackage.characters[0].role, null);
assert.ok(report.derived_fields.some((x) => x.target === 'characters[0].appearance'));
assert.ok(report.missing_fields.some((x) => x.path === 'characters[0].personality'));
```

- [ ] **Step 4: Run projection tests and confirm RED**

Run: `cd backend-node; node --test test/episodePackageProjection.test.js`

Expected: FAIL because `episodePackageProjection.js` does not exist.

- [ ] **Step 5: Implement version-aware schema and normalizer**

Export both supported versions, update the generated draft-07 schema and fallback validator, and add the new fields. Implement a pure deep-copy normalizer: select the unique default variant or first variant; copy only missing base image fields; record missing non-inferable fields; inventory unknown properties against the projection registry.

```js
function normalizePackageForProjection(pkg) {
  const normalizedPackage = JSON.parse(JSON.stringify(pkg));
  const report = createProjectionReport();
  normalizedPackage.characters.forEach((character, index) => {
    const variant = character.variants.find((item) => item.is_default) || character.variants[0];
    for (const field of ['appearance', 'image_prompt', 'negative_prompt']) {
      if (!nonEmpty(character[field]) && nonEmpty(variant?.[field])) {
        character[field] = variant[field];
        report.derived_fields.push({ source: `characters[${index}].variants[${character.variants.indexOf(variant)}].${field}`, target: `characters[${index}].${field}`, rule: 'default_variant_fallback' });
      }
    }
  });
  return { normalizedPackage, report };
}
```

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `cd backend-node; node --test test/episodePackageSchema.test.js test/episodePackageProjection.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the contract unit**

```bash
git add backend-node/src/services/episodePackageSchema.js backend-node/src/services/episodePackageProjection.js backend-node/test/episodePackageSchema.test.js backend-node/test/episodePackageProjection.test.js
git commit -m "feat: normalize external episode package fields"
```

### Task 2: Database columns and provenance repository

**Files:**
- Modify: `backend-node/src/db/migrate.js`
- Create: `backend-node/migrations/35_episode_import_provenance.sql`
- Create: `backend-node/src/services/episodeImportProvenanceService.js`
- Modify: `backend-node/test/episodePackageMigration.test.js`
- Create: `backend-node/test/episodeImportProvenanceService.test.js`

**Interfaces:**
- Produces: `getEpisodeImportSummary(db, episodeId) -> summary | null`.
- Produces: `getEpisodeImportSource(db, episodeId) -> source | null`.
- Produces: `sanitizeSourceFilename(value) -> basename`.
- Consumes: `episode_imports.import_report`, `scenes.description`.

- [ ] **Step 1: Write migration failures**

Assert `runMigrationsAndEnsure()` creates `scenes.description`, `episode_imports.import_report`, and index `idx_episode_imports_episode_time`.

```js
assert.ok(cols('scenes').includes('description'));
assert.ok(cols('episode_imports').includes('import_report'));
assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_episode_imports_episode_time'").get());
```

- [ ] **Step 2: Run migration test and confirm RED**

Run: `cd backend-node; node --test test/episodePackageMigration.test.js`

Expected: FAIL on the missing columns/index.

- [ ] **Step 3: Write provenance service failures**

Use an in-memory `episode_imports` table to assert newest-record selection, exact `raw_json_text`, parsed helper objects, parse warnings for damaged helper JSON, and filename sanitization for `..\\folder/control.json`.

```js
const source = getEpisodeImportSource(db, 7);
assert.equal(source.raw_json_text, rawText);
assert.deepEqual(source.match_decisions, { characters: {} });
assert.equal(sanitizeSourceFilename('..\\folder\\source.json'), 'source.json');
```

- [ ] **Step 4: Implement additive migration and provenance service**

Add columns through both SQL migration documentation and `ensureColumns`, create the lookup index, and implement loss-tolerant JSON parsing. Never resolve or read `source_filename` as a filesystem path.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `cd backend-node; node --test test/episodePackageMigration.test.js test/episodeImportProvenanceService.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the persistence unit**

```bash
git add backend-node/migrations/35_episode_import_provenance.sql backend-node/src/db/migrate.js backend-node/src/services/episodeImportProvenanceService.js backend-node/test/episodePackageMigration.test.js backend-node/test/episodeImportProvenanceService.test.js
git commit -m "feat: persist episode import provenance reports"
```

### Task 3: Complete importer field projection and report persistence

**Files:**
- Modify: `backend-node/src/services/episodePackageService.js`
- Modify: `backend-node/test/episodePackageService.test.js`
- Modify: `backend-node/test/episodePackageAvRoundtrip.test.js`

**Interfaces:**
- Consumes: `normalizePackageForProjection(pkg)` and its report.
- Produces: preview response `import_report` and import result `import_report`.
- Persists: the normalized package and final report in `episode_imports`.

- [ ] **Step 1: Extend in-memory schemas and write failing legacy projection test**

Add `role`, `personality`, `scenes.description`, and `episode_imports.import_report` to the test database. Import a legacy-shaped package and assert base character fallback, independent scene fields, prop type when present, episode source key, and storyboard notes.

```js
assert.equal(character.appearance, '默认状态外貌');
assert.equal(character.polished_prompt, '默认状态图片提示词');
assert.equal(scene.description, '独立场景描述');
assert.equal(scene.prompt, '纯图片提示词');
assert.equal(JSON.parse(storyboard.production_metadata).import_notes, '镜头备注');
```

- [ ] **Step 2: Write failing report/reuse tests**

Assert preview exposes derived/missing fields, final import persists the report, and reuse decisions list ignored external fields without changing the reused row.

- [ ] **Step 3: Run focused service tests and confirm RED**

Run: `cd backend-node; node --test test/episodePackageService.test.js test/episodePackageAvRoundtrip.test.js`

Expected: FAIL on missing projections and report.

- [ ] **Step 4: Integrate canonical normalization before preview matching**

Replace the action/dialogue-only deep copy with the new normalizer, then render action/dialogue on the normalized copy. Ensure preview and import use identical normalized bytes for a given raw package.

- [ ] **Step 5: Complete asset and episode mapping**

Map character `role/personality`, scene `description/state`, prop `type`, episode `source_key`, and storyboard notes. Continue using canonical storyboard repository calls for AV data.

```js
const metadata = { ...(storyboard.production_metadata || {}) };
if (item.notes != null) metadata.import_notes = item.notes;
```

- [ ] **Step 6: Persist and return the report inside the transaction**

Merge final create/reuse target IDs into the preview report, set `projection.status='verified'`, sanitize the source filename, and insert `import_report` with the audit snapshot.

- [ ] **Step 7: Expand projection verification**

Compare every registry field marked `persisted` or `derived` through the normal read projections. Skip content equality for reused assets but verify final association IDs. Throw `PACKAGE_PROJECTION_MISMATCH` before commit on divergence.

- [ ] **Step 8: Run focused tests and confirm GREEN**

Run: `cd backend-node; node --test test/episodePackageService.test.js test/episodePackageAvRoundtrip.test.js`

Expected: PASS.

- [ ] **Step 9: Commit the importer unit**

```bash
git add backend-node/src/services/episodePackageService.js backend-node/test/episodePackageService.test.js backend-node/test/episodePackageAvRoundtrip.test.js
git commit -m "fix: preserve external package asset fields"
```

### Task 4: Historical import backfill

**Files:**
- Create: `backend-node/src/services/episodeImportBackfillService.js`
- Modify: `backend-node/src/db/migrate.js`
- Create: `backend-node/test/episodeImportBackfillService.test.js`

**Interfaces:**
- Produces: `backfillEpisodeImportProjections(db, log) -> { processed, updated, skipped, errors }`.
- Consumes: `normalizePackageForProjection`, `episode_imports.raw_json`, match decisions, and source keys.

- [ ] **Step 1: Write failing conservative-backfill tests**

Create one imported episode with legacy concatenated scene prompt and empty character base fields. Assert recovery of default-variant fields, scene description/prompt split, audio/production profile, notes, and report. Add cases proving non-empty fields and reused assets are untouched.

- [ ] **Step 2: Add idempotency and per-record rollback tests**

Run backfill twice and compare table snapshots. Insert a malformed second record and prove the valid record commits while the malformed record makes no partial changes and appears in `errors`.

- [ ] **Step 3: Run backfill tests and confirm RED**

Run: `cd backend-node; node --test test/episodeImportBackfillService.test.js`

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement per-record transactional backfill**

Select audit rows in stable ID order. For create decisions only, locate targets by episode/drama association plus `source_key`; fill blanks; split a scene prompt only on exact equality with the legacy concatenation algorithm; merge notes without replacing production metadata.

- [ ] **Step 5: Invoke backfill after additive schema ensure**

Call the service after all required columns/tables exist. Catch and log per-record errors in the backfill service; do not suppress structural migration failures.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `cd backend-node; node --test test/episodeImportBackfillService.test.js test/episodePackageMigration.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the repair unit**

```bash
git add backend-node/src/services/episodeImportBackfillService.js backend-node/src/db/migrate.js backend-node/test/episodeImportBackfillService.test.js backend-node/test/episodePackageMigration.test.js
git commit -m "fix: backfill recoverable imported episode fields"
```

### Task 5: Provenance API and compact drama summaries

**Files:**
- Modify: `backend-node/src/services/dramaService.js`
- Modify: `backend-node/src/routes/episodePackage.js`
- Modify: `backend-node/test/episodePackageRoutes.test.js`
- Create: `backend-node/test/dramaImportSourceProjection.test.js`

**Interfaces:**
- Consumes: `getEpisodeImportSummary` and `getEpisodeImportSource`.
- Produces: episode property `import_source` and route `GET /episodes/:episodeId/import-source` under `/api/v1`.

- [ ] **Step 1: Write route and drama projection failures**

Assert imported episodes receive summary metadata without raw JSON, normal episodes receive null, detail returns exact raw text, and missing records return `404 IMPORT_SOURCE_NOT_FOUND`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `cd backend-node; node --test test/episodePackageRoutes.test.js test/dramaImportSourceProjection.test.js`

Expected: FAIL because no read route or episode summary exists.

- [ ] **Step 3: Attach summaries without N+1 raw payloads**

Load only metadata columns for all episode IDs in one query, choose the latest row per episode, and set `ep.import_source`. Do not select `raw_json` or `normalized_json` in the drama detail query.

- [ ] **Step 4: Add the source-detail route**

Validate a positive episode ID, return the provenance service response, and use structured `response.error(res, 404, 'IMPORT_SOURCE_NOT_FOUND', '该分集没有外部导入来源')` when absent.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `cd backend-node; node --test test/episodePackageRoutes.test.js test/dramaImportSourceProjection.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the API unit**

```bash
git add backend-node/src/services/dramaService.js backend-node/src/routes/episodePackage.js backend-node/test/episodePackageRoutes.test.js backend-node/test/dramaImportSourceProjection.test.js
git commit -m "feat: expose episode import provenance"
```

### Task 6: Shared source dialog and dual entry points

**Files:**
- Modify: `frontweb/src/api/episodePackage.js`
- Create: `frontweb/src/components/EpisodeImportSourceDialog.vue`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Create: `frontweb/test/episodeImportSourceUi.test.js`

**Interfaces:**
- Produces: `episodePackageAPI.getImportSource(episodeId)`.
- Produces: `<EpisodeImportSourceDialog v-model episode-id episode-label />`.
- Consumes: `episode.import_source` summaries.

- [ ] **Step 1: Write failing static UI contract tests**

Read the Vue sources and assert the API path, shared dialog usage in both views, `@click.stop` on the project-card action, lazy loading on open, three tabs, and no `v-html`.

```js
assert.match(apiSource, /episodes\/\$\{episodeId\}\/import-source/);
assert.match(dramaSource, /@click\.stop="openImportSource\(ep\)"/);
assert.match(dialogSource, /name="raw"/);
assert.doesNotMatch(dialogSource, /v-html/);
```

- [ ] **Step 2: Run the UI test and confirm RED**

Run: `cd frontweb; node --test test/episodeImportSourceUi.test.js`

Expected: FAIL because the component and API method do not exist.

- [ ] **Step 3: Implement the lazy source dialog**

Fetch only when visible and `episodeId` is set. Render metadata with Element Plus descriptions, raw and normalized text in readonly code blocks/textareas, and report sections for created/reused/derived/missing/audit-only/warnings. Add retry, copy text, copy hash, and Blob download with sanitized filename.

- [ ] **Step 4: Add the project-card primary entry**

Show an informational “外部 JSON” tag only when `ep.import_source`; add “查看来源” to the footer with `@click.stop`; preserve card click navigation and deletion behavior.

- [ ] **Step 5: Add the production-header secondary entry**

Compute the current episode from `selectedEpisodeId`, render a compact clickable tag beside the selector, and open the same shared dialog.

- [ ] **Step 6: Run UI test and build**

Run: `cd frontweb; node --test test/episodeImportSourceUi.test.js; npm run build`

Expected: PASS and Vite build exits 0.

- [ ] **Step 7: Commit the UI provenance unit**

```bash
git add frontweb/src/api/episodePackage.js frontweb/src/components/EpisodeImportSourceDialog.vue frontweb/src/views/DramaDetail.vue frontweb/src/views/FilmCreate.vue frontweb/test/episodeImportSourceUi.test.js
git commit -m "feat: show external JSON provenance for episodes"
```

### Task 7: Complete asset editing surfaces

**Files:**
- Modify: `backend-node/src/services/sceneService.js`
- Modify: `backend-node/src/services/characterLibraryService.js`
- Create: `backend-node/test/sceneImportFields.test.js`
- Create: `backend-node/test/characterImportFields.test.js`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Create: `frontweb/test/dramaAssetImportFieldsUi.test.js`

**Interfaces:**
- Scene update accepts explicit `state`, `description`, `atmosphere`, `prompt`, and `negative_prompt`.
- Character update accepts explicit `voice_style`, `polished_prompt`, `negative_prompt`, and nullable `role` without defaulting it.
- Existing prop update already accepts `type`, `description`, `prompt`, and `negative_prompt`.

- [ ] **Step 1: Write failing backend update tests**

Assert scene reads/updates all imported fields and character updates voice/prompt/negative values in new focused test files. Do not modify the existing untracked `sceneRoutes.test.js`, which belongs to unrelated work.

- [ ] **Step 2: Write failing project-editor source tests**

Assert the role form uses null/empty “未指定” rather than `minor`, and collapsible generation fields contain character voice/prompt/negative, scene state/atmosphere/negative, and prop negative prompt.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `cd backend-node; node --test test/sceneImportFields.test.js test/characterImportFields.test.js; cd ../frontweb; node --test test/dramaAssetImportFieldsUi.test.js`

Expected: FAIL on the missing fields.

- [ ] **Step 4: Extend backend update/read mappings**

Use `!== undefined` for nullable fields so the UI can intentionally clear them. Include `state/description/negative_prompt` in both scene list/detail projections and `voice_style` in character update.

- [ ] **Step 5: Extend the existing edit dialogs**

Keep core identity fields visible, place generation-specific fields inside `el-collapse`, include them in save payloads, and set `role: item.role ?? null`.

- [ ] **Step 6: Run focused tests and build**

Run: `cd backend-node; node --test test/sceneImportFields.test.js test/characterImportFields.test.js; cd ../frontweb; node --test test/dramaAssetImportFieldsUi.test.js; npm run build`

Expected: PASS.

- [ ] **Step 7: Commit only owned hunks/files**

Stage `backend-node/src/services/sceneService.js`, `characterLibraryService.js`, the new tests, and `DramaDetail.vue`. Do not stage the unrelated modified `backend-node/src/routes/scenes.js` or untracked `backend-node/test/sceneRoutes.test.js`.

```bash
git add backend-node/src/services/sceneService.js backend-node/src/services/characterLibraryService.js backend-node/test/sceneImportFields.test.js backend-node/test/characterImportFields.test.js frontweb/src/views/DramaDetail.vue frontweb/test/dramaAssetImportFieldsUi.test.js
git commit -m "feat: edit imported asset metadata"
```

### Task 8: Upstream AI documents and fixtures

**Files:**
- Modify: `docs/单集制作包导入/上游AI生成提示词模板.md`
- Modify: `docs/单集制作包导入/制作包schema.json`
- Modify: `docs/单集制作包导入/制作包示例.json`
- Modify: `backend-node/test/episodePackageSchema.test.js`

**Interfaces:**
- Documentation emits package version `1.1` with character role/personality and prop type.
- `制作包schema.json` remains deeply equal to exported `packageJsonSchema`.

- [ ] **Step 1: Update coverage assertions first**

Add `characters[0].role`, `characters[0].personality`, and `props[0].type` to the documented example coverage list, then run the schema test to prove the existing example fails coverage.

- [ ] **Step 2: Update schema JSON, example, and prompt template**

Set the example and prompt output to `1.1`; explain allowed roles, required personality, prop type, legacy fallback behavior, and that top-level character image fields remain required even when a variant repeats them.

- [ ] **Step 3: Run documentation contract tests**

Run: `cd backend-node; node --test test/episodePackageSchema.test.js`

Expected: PASS with deep schema equality.

- [ ] **Step 4: Commit the upstream contract docs**

```bash
git add docs/单集制作包导入/上游AI生成提示词模板.md docs/单集制作包导入/制作包schema.json docs/单集制作包导入/制作包示例.json backend-node/test/episodePackageSchema.test.js
git commit -m "docs: publish episode package contract 1.1"
```

### Task 9: Full verification, live repair acceptance, and changelog

**Files:**
- Modify: `CHANGELOG.md`
- Modify only if verification reveals a feature regression: files already owned by Tasks 1-8.

**Interfaces:**
- Produces: verified feature and `[未发布]` changelog entries.

- [ ] **Step 1: Run complete backend tests**

Run: `cd backend-node; node --test test/*.test.js`

Expected: all tests pass with exit code 0.

- [ ] **Step 2: Run complete frontend tests**

Run: `cd frontweb; node --test test/*.test.js`

Expected: all tests pass with exit code 0.

- [ ] **Step 3: Run production frontend build**

Run: `cd frontweb; npm run build`

Expected: exit code 0 and generated assets in `frontweb/dist`.

- [ ] **Step 4: Restart or wait for development services and verify APIs**

Verify `/api/v1/dramas/5` exposes `import_source` for the imported episode and `/api/v1/episodes/<id>/import-source` returns the exact source filename/hash/raw text. Confirm no full path is reported.

- [ ] **Step 5: Perform browser acceptance on project 5**

Open `/drama/5`; verify the card tag and dialog, raw/normalized/report tabs, copy/download controls, character appearance restored from its default variant, blank personality remains blank/“未指定”, and scenes show state and description separately. Open the episode production page and verify the compact header entry follows episode selection.

- [ ] **Step 6: Update the root changelog after evidence is green**

Under `[未发布]` add user-visible entries:

```markdown
### 新增
- **外部制作包来源追溯**：外部 JSON 导入的分集可在项目卡片和制作页查看原始数据、规范化数据、文件哈希及导入匹配报告

### 修复
- **外部制作包字段完整性**：修复旧包人物外貌、场景状态与描述、道具类型等字段未正确投影的问题，并以保守回填恢复未被手工修改的历史导入数据
```

Merge these bullets into existing `新增`/`修复` headings rather than creating duplicates.

- [ ] **Step 7: Re-run targeted smoke tests after changelog-only edit**

Run: `cd backend-node; node --test test/episodePackage*.test.js test/episodeImport*.test.js; cd ../frontweb; node --test test/episodeImportSourceUi.test.js test/dramaAssetImportFieldsUi.test.js`

Expected: PASS.

- [ ] **Step 8: Commit changelog and any verified final corrections**

Stage only the new changelog hunks with `git add -p CHANGELOG.md`, then commit:

```bash
git commit -m "docs: record external package provenance fixes"
```

- [ ] **Step 9: Inspect final scope**

Run: `git status --short` and `git log --oneline -10`.

Expected: pre-existing unrelated modifications remain unstaged; all feature files are committed; no test/build claim is made without the recorded command results.
