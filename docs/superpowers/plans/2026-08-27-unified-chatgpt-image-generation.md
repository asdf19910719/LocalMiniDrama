# Unified ChatGPT Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make API and ChatGPT web generation selectable from every character, scene, prop, storyboard-main, storyboard-first, and storyboard-last image entry while sharing one task, queue, binding, and UI flow.

**Architecture:** Add a backend image-generation orchestration layer above the existing API image services and External Generation subsystem. Resource adapters own prompts/references/binding, executors own API or browser delivery, and a shared Vue composable plus split button/drawer/queue integrate every page without duplicating ChatGPT panels.

**Tech Stack:** Node.js 22, Express, better-sqlite3, Node test runner, Vue 3, Pinia, Element Plus, Vite, Chrome MV3 extension.

**Spec:** `docs/superpowers/specs/2026-08-27-unified-chatgpt-image-generation-design.md`

## Global Constraints

- Generation channels are exactly `api` and `chatgpt_web`.
- ChatGPT web concurrency is exactly 1.
- Target types are `character`, `scene`, `prop`, `storyboard_main`, `storyboard_first`, and `storyboard_last`.
- Existing API-provider routing and existing image/video bindings must remain backward compatible.
- ChatGPT results must enter `image_generations` and use the same authoritative binders as API results.
- FilmCreate must remove the fixed 300px external panel; FilmCreate and DramaCanvas must expose equivalent generation controls.
- Page load fetches one project summary; cards and storyboard rows may not list all external jobs independently.
- Do not report browser submission until the extension returns a real acknowledgement.

---

### Task 1: Persist unified image tasks, batches, and project default

**Files:**
- Modify: `backend-node/src/db/migrate.js`
- Create: `backend-node/src/services/imageGenerationTaskService.js`
- Create: `backend-node/test/imageGenerationTaskService.test.js`

**Interfaces:**
- Produces: `createTask(db, input)`, `getTask(db, id)`, `createBatch(db, input)`, `getSummary(db, dramaId)`, `transitionTask(db, id, next, patch)`, `getDefaultChannel(db, dramaId)`, `setDefaultChannel(db, dramaId, channel)`.
- Statuses: `draft|queued|preparing|submitted|generating|needs_review|completed|failed|cancelled`.

- [ ] **Step 1: Write migration and service tests**

```js
test('persists target identity and defaults a project channel', () => {
  svc.setDefaultChannel(db, 7, 'chatgpt_web')
  const task = svc.createTask(db, { dramaId: 7, targetType: 'character', targetId: 9 })
  assert.equal(task.generation_channel, 'chatgpt_web')
  assert.equal(task.status, 'draft')
})
```

- [ ] **Step 2: Run the focused test and verify schema/service failure**

Run: `cd backend-node && node --test test/imageGenerationTaskService.test.js`
Expected: FAIL because `imageGenerationTaskService` and tables do not exist.

- [ ] **Step 3: Add idempotent tables and transition validation**

Create `image_generation_tasks` and `image_generation_batches` with the fields specified by the design. Store `default_image_generation_channel` by merging `dramas.metadata`; reject unknown channels, targets, and illegal terminal-state transitions.

- [ ] **Step 4: Run focused and migration tests**

Run: `cd backend-node && node --test test/imageGenerationTaskService.test.js test/migrate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/db/migrate.js backend-node/src/services/imageGenerationTaskService.js backend-node/test/imageGenerationTaskService.test.js
git commit -m "feat: persist unified image generation tasks"
```

### Task 2: Build resource adapters and unified result binding

**Files:**
- Create: `backend-node/src/services/imageGenerationTargetService.js`
- Modify: `backend-node/src/services/storyboardFrameBinding.js`
- Modify: `backend-node/src/services/externalGenerationImportService.js`
- Create: `backend-node/test/imageGenerationTargetService.test.js`

**Interfaces:**
- Consumes: unified task target fields from Task 1.
- Produces: `resolveTarget(db, { dramaId, targetType, targetId })`, `buildGenerationInput(db, task)`, `bindResult(db, task, imageGenerationId)`.

- [ ] **Step 1: Write target-resolution and binding tests**

```js
test('binds an external storyboard last result without replacing the main image', () => {
  const bound = targets.bindResult(db, task('storyboard_last', 22), imageId)
  assert.equal(bound.last_frame_image_id, imageId)
  assert.equal(db.prepare('SELECT frame_type FROM image_generations WHERE id=?').get(imageId).frame_type, 'storyboard_last')
  assert.equal(bound.first_frame_image_id, originalFirstId)
})
```

Cover all six target types, cross-drama rejection, prompt priority, deterministic references, and old-image history behavior.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd backend-node && node --test test/imageGenerationTargetService.test.js`
Expected: FAIL because the adapter/binder does not exist.

- [ ] **Step 3: Implement target adapters and route external rebind through them**

Use existing character/scene/prop fields, `storyboardFrameBinding`, and existing scene history conventions. External import creates candidates only; selection calls `bindResult` with the unified task.

- [ ] **Step 4: Run target and external hardening tests**

Run: `cd backend-node && node --test test/imageGenerationTargetService.test.js test/externalGenerationHardening.test.js test/externalGenerationRecovery.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/imageGenerationTargetService.js backend-node/src/services/storyboardFrameBinding.js backend-node/src/services/externalGenerationImportService.js backend-node/test/imageGenerationTargetService.test.js
git commit -m "feat: unify image target binding"
```

### Task 3: Add orchestration API and API executor

**Files:**
- Create: `backend-node/src/services/imageGenerationOrchestrator.js`
- Create: `backend-node/src/routes/imageGenerationTasks.js`
- Modify: `backend-node/src/routes/index.js`
- Create: `backend-node/test/imageGenerationTaskRoutes.test.js`

**Interfaces:**
- Consumes: Task 1 persistence and Task 2 adapters.
- Produces HTTP endpoints defined in the spec and `submitTask(db, log, taskId)`.
- API executor delegates to existing character, scene, prop, or storyboard image services and records the resulting `image_generation_id`.

- [ ] **Step 1: Write route contract tests**

```js
test('creates an API task and exposes one drama summary', async () => {
  const created = await post('/image-generation-tasks', request)
  assert.equal(created.generation_channel, 'api')
  const summary = await get('/dramas/3/image-generation-summary')
  assert.equal(summary.total, 1)
})
```

- [ ] **Step 2: Run route tests and verify 404/module failure**

Run: `cd backend-node && node --test test/imageGenerationTaskRoutes.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement create/get/summary/default-channel endpoints and API dispatch**

Keep existing endpoints working; the new orchestrator is an additive path until all callers migrate.

- [ ] **Step 4: Run focused routes plus existing image routes**

Run: `cd backend-node && node --test test/imageGenerationTaskRoutes.test.js test/imageRoutes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/imageGenerationOrchestrator.js backend-node/src/routes/imageGenerationTasks.js backend-node/src/routes/index.js backend-node/test/imageGenerationTaskRoutes.test.js
git commit -m "feat: add unified image generation API"
```

### Task 4: Connect ChatGPT jobs, real acknowledgements, and candidate selection

**Files:**
- Modify: `backend-node/src/services/externalGenerationService.js`
- Modify: `backend-node/src/routes/externalGeneration.js`
- Modify: `frontweb/src/components/dramaCanvas/ExternalWebGenerationPanel.vue` (temporary compatibility only)
- Modify: `browser-extension/src/workbench-content.js`
- Modify: `browser-extension/src/background.js`
- Create: `backend-node/test/imageGenerationChatgptExecutor.test.js`
- Modify: `browser-extension/test/workbenchBridge.test.js`

**Interfaces:**
- Consumes: a unified task with `generation_channel=chatgpt_web`.
- Produces: linked External Job, acknowledged `submitted` transition, candidate imports, and unified `select-result` binding.

- [ ] **Step 1: Add failing tests for no-ACK, linked job, idempotent resume, and candidate selection**

```js
test('does not mark submitted before browser acknowledgement', async () => {
  await assert.rejects(() => executor.send(taskId, bridgeWithoutAck))
  assert.equal(tasks.getTask(db, taskId).status, 'preparing')
})
```

- [ ] **Step 2: Run backend and extension tests to verify failure**

Run: `cd backend-node && node --test test/imageGenerationChatgptExecutor.test.js`
Run: `cd browser-extension && node --test test/workbenchBridge.test.js`
Expected: FAIL on missing unified linkage/ACK semantics.

- [ ] **Step 3: Implement linked jobs and acknowledged submission**

Add `image_generation_task_id` linkage to External Job, require a correlated extension response, preserve submitted attempts across reload, and send imported candidates to the unified selector.

- [ ] **Step 4: Run all External Generation and extension tests**

Run: `cd backend-node && node --test test/externalGeneration*.test.js test/imageGenerationChatgptExecutor.test.js`
Run: `cd browser-extension && node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/externalGenerationService.js backend-node/src/routes/externalGeneration.js frontweb/src/components/dramaCanvas/ExternalWebGenerationPanel.vue browser-extension/src browser-extension/test backend-node/test/imageGenerationChatgptExecutor.test.js
git commit -m "feat: orchestrate acknowledged ChatGPT image tasks"
```

### Task 5: Implement persisted serial batch queue

**Files:**
- Create: `backend-node/src/services/imageGenerationQueueService.js`
- Modify: `backend-node/src/services/imageGenerationOrchestrator.js`
- Modify: `backend-node/src/routes/imageGenerationTasks.js`
- Create: `backend-node/test/imageGenerationQueueService.test.js`

**Interfaces:**
- Produces: `createBatch`, `runNext`, `pauseBatch`, `resumeBatch`, `skipTask`, `retryTask`, `cancelTask`.
- Invariant: at most one `chatgpt_web` task per batch is submitted/generating.

- [ ] **Step 1: Write queue-state tests**

Test 20 ordered tasks, concurrency 1, pause/resume, multi-candidate continuation, failure continuation, and restart recovery.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd backend-node && node --test test/imageGenerationQueueService.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement transactionally claimed queue items and counters**

Only `queued` items are claimable. `needs_review`, `completed`, `failed`, and `cancelled` advance the queue. Retrying a submitted task resumes capture unless `regenerate=true` explicitly creates a new attempt.

- [ ] **Step 4: Run queue and orchestration tests**

Run: `cd backend-node && node --test test/imageGenerationQueueService.test.js test/imageGenerationTaskRoutes.test.js test/imageGenerationChatgptExecutor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/imageGenerationQueueService.js backend-node/src/services/imageGenerationOrchestrator.js backend-node/src/routes/imageGenerationTasks.js backend-node/test/imageGenerationQueueService.test.js
git commit -m "feat: add serial ChatGPT image queue"
```

### Task 6: Add shared frontend API, state, split button, drawer, and queue

**Files:**
- Create: `frontweb/src/api/imageGenerationTasks.js`
- Create: `frontweb/src/composables/useImageGeneration.js`
- Create: `frontweb/src/stores/imageGenerationStore.js`
- Create: `frontweb/src/components/imageGeneration/ImageGenerateSplitButton.vue`
- Create: `frontweb/src/components/imageGeneration/ImageGenerationDrawer.vue`
- Create: `frontweb/src/components/imageGeneration/ImageGenerationQueue.vue`
- Create: `frontweb/test/imageGenerationUi.test.js`

**Interfaces:**
- `ImageGenerateSplitButton` emits `generate(channel)` and displays `ChatGPT 生成` or `默认模型生成`.
- `useImageGeneration.open({ dramaId, targetType, targetId, channel })` creates/opens a task.
- Store loads one summary per drama and updates entities from selection responses.

- [ ] **Step 1: Write API/component source-contract tests**

```js
assert.match(buttonSource, /ChatGPT 生成/)
assert.match(composableSource, /image-generation-summary/)
assert.doesNotMatch(drawerSource, /External Web Image|Prepare Job/)
```

- [ ] **Step 2: Run frontend tests and verify missing modules**

Run: `cd frontweb && node --test test/imageGenerationUi.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement shared UI and project-level singletons**

Drawer renders draft/preparing/submitted/generating/review/failed states in Chinese. Queue renders progress and recovery actions. Do not expose Job hashes.

- [ ] **Step 4: Run focused tests and Vite build**

Run: `cd frontweb && node --test test/imageGenerationUi.test.js && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/api/imageGenerationTasks.js frontweb/src/composables/useImageGeneration.js frontweb/src/stores/imageGenerationStore.js frontweb/src/components/imageGeneration frontweb/test/imageGenerationUi.test.js
git commit -m "feat: add shared image generation controls"
```

### Task 7: Integrate character, scene, and prop entry points

**Files:**
- Modify: `frontweb/src/composables/filmCreate/useCharacters.js`
- Modify: `frontweb/src/composables/filmCreate/useScenes.js`
- Modify: `frontweb/src/composables/filmCreate/useProps.js`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Modify: `frontweb/src/components/dramaCanvas/CanvasAssetPanel.vue`
- Modify: `frontweb/src/composables/useCanvasAssetGenerate.js`
- Modify: `frontweb/test/imageGenerationUi.test.js`

**Interfaces:**
- Consumes the Task 6 split button/composable.
- Every resource passes an explicit target type/id; API remains the default fallback for legacy callers.

- [ ] **Step 1: Extend tests to enumerate all character/scene/prop entry files**

Assert each entry uses the shared control or unified API and no new per-card External Job listing is introduced.

- [ ] **Step 2: Run test and verify incomplete coverage**

Run: `cd frontweb && node --test test/imageGenerationUi.test.js`
Expected: FAIL listing unmigrated entry points.

- [ ] **Step 3: Migrate all asset calls and refresh handlers**

On selection response update the resource in the film store immediately, then retain existing full-refresh fallback.

- [ ] **Step 4: Run frontend tests and build**

Run: `cd frontweb && node --test test/*.test.js && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/composables/filmCreate frontweb/src/views/DramaDetail.vue frontweb/src/components/dramaCanvas/CanvasAssetPanel.vue frontweb/src/composables/useCanvasAssetGenerate.js frontweb/test/imageGenerationUi.test.js
git commit -m "feat: enable ChatGPT for asset images"
```

### Task 8: Integrate storyboard main/first/last in FilmCreate and DramaCanvas

**Files:**
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/src/views/DramaCanvas.vue`
- Modify: `frontweb/src/composables/useCanvasEpisodeGenerate.js`
- Modify: `frontweb/test/filmCreateExternalGeneration.test.js`
- Modify: `frontweb/test/imageGenerationUi.test.js`

**Interfaces:**
- Main uses `storyboard_main`; frame slots use `storyboard_first`/`storyboard_last`.
- Existing professional frame prompt and layout-lock inputs remain authoritative.

- [ ] **Step 1: Write failing layout and target tests**

Assert FilmCreate no longer renders `ExternalWebGenerationPanel` or `.film-create-external-generation`, all three targets are present, and DramaCanvas exposes the same shared control.

- [ ] **Step 2: Run tests and verify current fixed panel fails expectations**

Run: `cd frontweb && node --test test/filmCreateExternalGeneration.test.js test/imageGenerationUi.test.js`
Expected: FAIL.

- [ ] **Step 3: Replace the fixed panel and migrate single-shot calls**

Keep native upload, history, grid, frame prompt, and layout-lock behavior. After candidate selection reload the single storyboard media and authoritative bindings.

- [ ] **Step 4: Run frontend suite and build**

Run: `cd frontweb && node --test test/*.test.js && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/views/FilmCreate.vue frontweb/src/views/DramaCanvas.vue frontweb/src/composables/useCanvasEpisodeGenerate.js frontweb/test
git commit -m "feat: unify storyboard image generation UI"
```

### Task 9: Migrate batch and one-click workflows

**Files:**
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/src/composables/useCanvasEpisodeGenerate.js`
- Modify: `frontweb/src/api/characters.js`
- Modify: `frontweb/src/api/scenes.js`
- Modify: `frontweb/src/api/props.js`
- Create: `frontweb/test/imageGenerationBatch.test.js`

**Interfaces:**
- Batch creation sends target IDs once to `/image-generation-batches`.
- API batches preserve existing concurrency behavior; ChatGPT batches use backend serial execution.

- [ ] **Step 1: Write failing batch source and API-contract tests**

Cover asset batches, storyboard batches, one-click pipeline, repair-missing pipeline, pause/resume, and accurate review/failure counts.

- [ ] **Step 2: Run test and verify legacy loops fail**

Run: `cd frontweb && node --test test/imageGenerationBatch.test.js`
Expected: FAIL because callers loop legacy endpoints.

- [ ] **Step 3: Route batch workflows through unified batch creation**

Select the project default channel at batch creation. Do not load all reference bytes in advance. Show the shared queue instead of legacy per-loop ChatGPT progress.

- [ ] **Step 4: Run frontend suite and build**

Run: `cd frontweb && node --test test/*.test.js && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/views/FilmCreate.vue frontweb/src/composables/useCanvasEpisodeGenerate.js frontweb/src/api frontweb/test/imageGenerationBatch.test.js
git commit -m "feat: unify image batch workflows"
```

### Task 10: Full regression, performance assertions, and documentation cleanup

**Files:**
- Modify: `frontweb/test/imageGenerationUi.test.js`
- Modify: `backend-node/test/imageGenerationTaskRoutes.test.js`
- Modify: `docs/统一ChatGPT图片生成设计.md` only if implementation changes an approved interface
- Delete: `frontweb/src/components/dramaCanvas/ExternalWebGenerationPanel.vue` after all imports are gone

**Interfaces:**
- Produces the final verified feature with no legacy fixed panel or N-per-card job queries.

- [ ] **Step 1: Add regression assertions**

Assert one summary request per drama, no `restoreLatestJob` calls from cards, no byte-array reference hydration, correct first/last bindings, legacy API endpoints still work, and no obsolete panel import remains.

- [ ] **Step 2: Rebuild native SQLite dependency for the repository Node version**

Run: `cd backend-node && npm rebuild better-sqlite3`
Expected: exit 0 and the native module loads under the Node version required by `package.json`.

- [ ] **Step 3: Run complete verification**

Run: `cd backend-node && npm test`
Run: `cd frontweb && node --test test/*.test.js && npm run build`
Run: `cd browser-extension && node --test test/*.test.js`
Expected: all tests pass and Vite build succeeds.

- [ ] **Step 4: Inspect final diff and runtime contracts**

Run: `git diff --check && rg -n "ExternalWebGenerationPanel|film-create-external-generation|hydrateReferences|restoreLatestJob" frontweb/src`
Expected: `git diff --check` succeeds; the search returns no production usage of obsolete per-card external flow.

- [ ] **Step 5: Commit**

```bash
git add backend-node frontweb browser-extension docs/统一ChatGPT图片生成设计.md
git commit -m "test: verify unified ChatGPT image generation"
```

## 实施进度同步（2026-08-28）

已完成并提交：

- 统一图片任务、批次、项目默认通道、六类资源适配和结果绑定。
- 统一任务/摘要/默认设置/批次 API。
- 持久化串行批量队列。
- ChatGPT 扩展跨 tab 自动绑定、会话身份校验、真实 ACK 和结果导入链路。
- 共享前端图片生成入口，以及发送前的 `prepare -> fill -> upload -> send -> acknowledge` 流程。
- 参考图 URL 在扩展后台转换为真实字节文件，并补充 localhost host permission。
- 项目级默认生图方式已在制作页和剧集管理页提供可见控件，支持持久化 `api` / `chatgpt_web`。
- ChatGPT 桥接失败会保留 `preparing` 任务、显示错误原因，并支持“重试发送”；等待 ACK 时明确显示等待状态。
- 已 ACK 的任务会自动轮询并展开 External Job 候选；浏览器观察器中断时可恢复捕获而不重复提交。

本轮修复已提交到主分支：`ecd8a76 fix: expose ChatGPT image channel and retry errors`。

验证记录：主分支在 Node 22.22.3 下后端全量 303/303 通过；扩展全量 39/39 通过；前端全量 61/61 通过；前端生产构建通过。使用默认 Node 24 跑后端会因 `better-sqlite3` Node 22 ABI 不匹配失败，必须使用计划指定的 Node 22。

本轮补齐：API 配置页统一管理 ChatGPT Web 通道启用状态、Chrome 可执行文件和 Profile；剧集页仅选择项目默认通道。`run_dev.ps1` / `run_dev.bat` 会在后端健康后读取该配置并自动启动 Chrome for Testing 与扩展。FilmCreate、DramaDetail 和 DramaCanvas 页面都会从 `active_task_id` 恢复统一图片任务，优先接回 `submitted` / `generating` 任务。

真实用户验收已完成一轮：登录的 Playwright Chromium profile 通过扩展自动填充、参考图上传、真实点击发送、候选捕获、原图导入和统一结果绑定；任务最终为 `completed`。后续若 profile 登录态失效，从现有 `preparing` 或 `ready_to_send` 任务重试即可。

用户侧自动化边界：安装并启用扩展、完成一次 ChatGPT 登录后，tab 查找、扩展注入、会话绑定、提示词填充、参考图上传、提交和 ACK 都是自动的。只有安装/登录、权限、Cloudflare/VPN 或网络不可用时需要人工介入。
