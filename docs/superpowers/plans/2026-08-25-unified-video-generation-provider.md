# Unified Video Generation Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every video-generation entry use the single default video AI configuration, including local ComfyUI, with one Chinese candidate UI and one task/result model.

**Architecture:** Add a strict default-config resolver and Provider adapter boundary used by `/videos` and Director. Store every new candidate as a `video_generations` row; Director tables retain review/QC/selection relationships. Reuse one Vue panel in normal and canvas layouts.

**Tech Stack:** Node.js 22, Express, better-sqlite3, Vue 3, Element Plus, Vite, Node test runner, ComfyUI HTTP API.

**Spec:** `docs/superpowers/specs/2026-08-25-unified-video-generation-provider-design.md`

## Global Constraints

- Every entry uses exactly one active default `service_type=video` configuration; no per-request Provider switching or fallback.
- A requested model must belong to that default configuration.
- Normal and canvas modes have identical generation capabilities/data and Chinese copy; only layout differs.
- Resolution is numeric. ComfyUI H3 defaults to `1280×704`, steps by 32, and rejects non-positive/non-32-aligned dimensions.
- Automatic tests never start inference. Final smoke verification is one short, one-candidate `864×480` task.
- Preserve user changes and all historical Director/video records.

---

### Task 1: Strict Default Video Configuration

**Files:**
- Create: `backend-node/src/services/videoConfigResolver.js`
- Modify: `backend-node/src/services/videoClient.js`
- Modify: `backend-node/src/routes/videos.js`
- Test: `backend-node/test/videoConfigResolver.test.js`

**Interfaces:** Produces `resolveDefaultVideoConfig(db, { requestedModel }) -> { config, model, provider, protocol }` and codes `VIDEO_CONFIG_MISSING`, `VIDEO_CONFIG_AMBIGUOUS`, `VIDEO_MODEL_NOT_ALLOWED`.

- [ ] **Step 1: Write failing tests**

```js
test('requires one active default', () => {
  assert.throws(() => resolveDefaultVideoConfig(db), /VIDEO_CONFIG_MISSING/);
  seed(db, { is_default: 1 }); seed(db, { is_default: 1 });
  assert.throws(() => resolveDefaultVideoConfig(db), /VIDEO_CONFIG_AMBIGUOUS/);
});
test('model cannot select another config', () => {
  seed(db, { is_default: 1, model: ['default-model'] });
  seed(db, { is_default: 0, model: ['other-model'] });
  assert.throws(() => resolveDefaultVideoConfig(db, { requestedModel: 'other-model' }), /VIDEO_MODEL_NOT_ALLOWED/);
});
```

- [ ] **Step 2: Verify red** — Run `cd backend-node && node --test test/videoConfigResolver.test.js`; expect missing module/failing assertions.
- [ ] **Step 3: Implement resolver** — Filter active defaults, require length one, validate the requested model against only that config, and return normalized routing identity.
- [ ] **Step 4: Remove `body.provider || 'chatfire'` and model-based cross-config lookup; persist only the resolved Provider.**
- [ ] **Step 5: Verify green** — Run `cd backend-node && node --test test/videoConfigResolver.test.js test/videoResumePoll.test.js`.
- [ ] **Step 6: Commit** — `git commit -am "refactor: enforce default video provider routing"` after adding new files.

### Task 2: Provider Snapshot and Schema

**Files:**
- Modify: `backend-node/src/db/migrate.js`
- Create: `backend-node/src/services/videoGenerationSnapshot.js`
- Test: `backend-node/test/videoGenerationSnapshot.test.js`

**Interfaces:** Produces `buildVideoConfigSnapshot(resolved)` without secrets and columns `config_id`, `config_snapshot`, `protocol`, `width`, `height`, `frame_rate`, `negative_prompt`, `continuity_mode`, `anchor_id`, `candidate_group_id`.

- [ ] **Step 1: Write failing redaction/idempotency test**

```js
const snapshot = buildVideoConfigSnapshot({
  config: { id: 7, api_key: 'secret', settings: { width: 1280, height: 704 } },
  provider: 'comfyui', protocol: 'comfyui', model: 'h3-continuity-v1',
});
assert.equal(snapshot.configId, 7);
assert.equal(snapshot.api_key, undefined);
assert.equal(snapshot.settings.height, 704);
```

- [ ] **Step 2: Verify red** — Run `cd backend-node && node --test test/videoGenerationSnapshot.test.js`.
- [ ] **Step 3: Add every column through `ensureColumns()` and implement a whitelist snapshot builder that excludes API keys.**
- [ ] **Step 4: Run migration twice in the test and assert old rows remain readable with null snapshot fields.**
- [ ] **Step 5: Verify green and commit** — Run the focused test; commit as `feat: persist video provider snapshots`.

### Task 3: ComfyUI Video Provider Adapter

**Files:**
- Create: `backend-node/src/services/videoProviders/comfyuiVideoProvider.js`
- Create: `backend-node/src/services/videoProviders/index.js`
- Modify: `backend-node/src/routes/index.js`
- Modify: `backend-node/src/director/directorGenerationPolicy.js`
- Test: `backend-node/test/comfyuiVideoProvider.test.js`
- Test: `backend-node/test/directorGenerationPolicy.test.js`

**Interfaces:** Adapter methods are `submit(context)`, `query(context)`, `cancel(context)`, `recover(context)`, `testConnection(context)`, returning normalized `{ providerTaskId, status, progress, output }`.

- [ ] **Step 1: Write failing adapter tests**

```js
test('submits configured workflow and numeric dimensions', async () => {
  const result = await provider.submit(ctx({ width: 1280, height: 704 }));
  assert.equal(fake.calls[0].workflowId, 'h3-continuity-v1');
  assert.equal(result.status, 'running');
});
test('rejects invalid H3 dimensions', async () => {
  await assert.rejects(() => provider.submit(ctx({ width: 1280, height: 720 })), /32 的倍数/);
});
```

- [ ] **Step 2: Verify red** — Run both focused tests.
- [ ] **Step 3: Implement adapter by delegating to the existing workflow registry, ComfyUI client, GPU mutex and prompt builder; do not duplicate HTTP code.**
- [ ] **Step 4: Implement non-inference connection checks for `/system_stats`, queue, workflow/SHA, models/nodes and VRAM.**
- [ ] **Step 5: Verify green** — Run `node --test test/comfyuiVideoProvider.test.js test/directorGenerationPolicy.test.js test/comfyuiClient.test.js`.
- [ ] **Step 6: Commit** — `feat: add ComfyUI video provider adapter`.

### Task 4: Unified Video Task Lifecycle

**Files:**
- Create: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/src/services/videoService.js`
- Modify: `backend-node/src/routes/videos.js`
- Modify: `backend-node/src/routes/index.js`
- Modify: `frontweb/src/api/videos.js`
- Test: `backend-node/test/unifiedVideoGenerationService.test.js`
- Test: `backend-node/test/videoResumePoll.test.js`

**Interfaces:** Produces `createVideoGeneration(input)`, `cancelVideoGeneration(id)`, `retryVideoGeneration(id)`, `recoverVideoGenerations()` and routes `POST /videos`, `/videos/:id/cancel`, `/videos/:id/retry`.

- [ ] **Step 1: Write failing lifecycle tests covering snapshot isolation, normalized statuses, local cancellation, ignored late cloud results, original-task polling and retry by original snapshot.**

```js
const created = await service.create(input);
makeOtherConfigDefault(db);
await service.retry(created.id);
assert.equal(fakeProvider.lastContext.snapshot.configId, created.config_id);
```

- [ ] **Step 2: Verify red** — Run `node --test test/unifiedVideoGenerationService.test.js`.
- [ ] **Step 3: Implement states `waiting`, `queued`, `running`, `review`, `selected`, `failed`, `cancelled`, `interrupted`; map legacy `processing/completed` on read without rewriting history.**
- [ ] **Step 4: Replace direct routing in `processVideoGeneration`; retain old response fields and add routing snapshot, progress and structured errors.**
- [ ] **Step 5: Verify green** — Run lifecycle and resume-poll tests.
- [ ] **Step 6: Commit** — `feat: unify video task lifecycle`.

### Task 5: Director Uses Unified Video Tasks

**Files:**
- Modify: `backend-node/src/routes/director.js`
- Modify: `backend-node/src/director/candidateGroupService.js`
- Modify: `backend-node/src/director/directorJobRunner.js`
- Modify: `backend-node/src/db/migrate.js`
- Test: `backend-node/test/directorGenerationRoutes.test.js`
- Test: `backend-node/test/candidateGroupService.test.js`

**Interfaces:** New candidates reference `video_generation_id`; legacy `job_id/artifact_id` remain readable.

- [ ] **Step 1: Write failing tests asserting cloud and ComfyUI defaults both create `video_generations`, incoming workflow/provider cannot override default, and selection updates the storyboard video.**
- [ ] **Step 2: Verify red** — Run both focused tests.
- [ ] **Step 3: Add the idempotent candidate link column; create one unified video task per candidate instead of directly calling `runner.enqueue()`.**
- [ ] **Step 4: Delegate new cancel/retry/select operations to the unified service while retaining the legacy path for old groups.**
- [ ] **Step 5: Verify green** — Run Director generation, candidate, runner and route suites.
- [ ] **Step 6: Commit** — `refactor: route Director candidates through video service`.

### Task 6: Manage ComfyUI in AI Configuration

**Files:**
- Modify: `backend-node/src/services/aiConfigService.js`
- Modify: `backend-node/src/routes/aiConfig.js`
- Modify: `frontweb/src/components/AIConfigContent.vue`
- Test: `backend-node/test/aiConfigComfyuiVideo.test.js`
- Test: `frontweb/test/aiConfigVideoProvider.test.js`

**Interfaces:** Supports `provider=comfyui`, empty API key, workflow model, numeric settings and `{ ok, provider, checks, message }` connection results.

- [ ] **Step 1: Write failing tests asserting empty API key, default URL `http://127.0.0.1:8188`, workflow selection and numeric `1280/704` serialization.**
- [ ] **Step 2: Verify red** — Run both focused backend/frontend tests.
- [ ] **Step 3: Implement the ComfyUI option, hide API-key requirement, add workflow and numeric width/height fields with step 32, and remove invalid H3 text presets.**
- [ ] **Step 4: Connect the non-inference test and render individual Chinese checks.**
- [ ] **Step 5: Verify green and commit** — `feat: manage ComfyUI in video API settings`.

### Task 7: Shared Chinese Video Generation Panel

**Files:**
- Create: `frontweb/src/components/video/VideoGenerationPanel.vue`
- Create: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `frontweb/src/components/dramaCanvas/DirectorShotPanel.vue`
- Modify: `frontweb/src/views/DramaCanvas.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/src/views/FreeCreate.vue`
- Modify: `frontweb/src/composables/useCanvasWorkflowRunner.js`
- Test: `frontweb/test/videoGenerationPanel.test.js`
- Test: `frontweb/test/directorPersistence.test.js`

**Interfaces:** Props `{ storyboardId, storyboard, displayMode: 'drawer'|'sidebar' }`; emits `selected`, `anchor-created`, `close`; all calls use `videosAPI`.

- [ ] **Step 1: Write failing component-model tests**

```js
assert.equal(resolveStoryboardVideoPrompt(sb), sb.universal_segment_text);
assert.deepEqual(listVideoActions('drawer'), listVideoActions('sidebar'));
assert.equal(hasEnglishGenerationActions(source), false);
```

- [ ] **Step 2: Verify red** — Run `cd frontweb && node --test test/videoGenerationPanel.test.js`.
- [ ] **Step 3: Implement shared state and UI: config status, prompt, negative prompt, numeric dimensions, duration, FPS, Seed, candidates, continuity, anchors, queue, cancel/retry, preview, QC, selection and history.**
- [ ] **Step 4: Mount the component as a normal-mode drawer and canvas sidebar; keep all other entries on `/videos`.**
- [ ] **Step 5: Translate AI Director, modes, generation actions, continuity labels, QC and GPU states to approved Chinese copy.**
- [ ] **Step 6: Verify green/build** — Run focused tests then `npm run build`.
- [ ] **Step 7: Commit** — `feat: share Chinese video generation panel`.

### Task 8: Migration, Documentation and Acceptance

**Files:**
- Create: `backend-node/scripts/backupAndMigrateUnifiedVideo.js`
- Modify: `docs/AI导演V1-实际使用说明.md`
- Modify: `docs/快速开始.md`
- Modify: `docs/research/director-production-governance.md`
- Modify: `E:/project/AIStory/docs/AI导演工作台-项目现状与进展.md`
- Test: `backend-node/test/unifiedVideoMigration.test.js`

**Interfaces:** Migration creates a timestamped SQLite backup, applies idempotent changes and reports linked/unknown historical rows without inventing provenance.

- [ ] **Step 1: Write failing migration test with old video/Director rows; run twice and assert no deletion, stable links and `historical_unknown` where routing is unprovable.**
- [ ] **Step 2: Verify red, implement the backup/migration script, then verify green.**
- [ ] **Step 3: Update usage, quick-start, governance and progress documents; record local image Provider work and deferred benchmark/audio stability items.**
- [ ] **Step 4: Run complete automation** — `cd backend-node && node --test test/*.test.js`; then `cd ../frontweb && node --test test/*.test.js && npm run build`.
- [ ] **Step 5: Browser acceptance** — Verify desktop/mobile normal and canvas modes, identical data/actions, Chinese copy, numeric fields, default-config switching, no overflow/errors/duplicate submission.
- [ ] **Step 6: After explicit approval, run one short one-candidate `864×480` local smoke task; do not run cloud, `1280×704`, long audio or remaining benchmark.**
- [ ] **Step 7: Commit** — `docs: complete unified video provider rollout`.
