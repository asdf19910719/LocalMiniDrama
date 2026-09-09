# Production Studio V2.1 Phase 0 Correctness Foundation Implementation Plan

> **状态：不可执行，待重写。** 2026-09-08 已确认 V2.1 不采用 V1/V2 双轨或旧实现兼容，并把一次性本地数据迁移纳入 Phase 1。本计划的阶段编号、事实源边界和删除时序已失效；仅可作为历史任务拆分参考。必须在权威规格书面复核通过后按六阶段方案重写，不能逐项照此执行。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不更换现有 UI 和执行系统的前提下，补齐 Look/H3 freshness、PromptStyleGate、统一 Provider 能力契约、统一引用预检，并证明候选→锚点→时间线链路可作为 V2.1 的可靠内核。

**Architecture:** Phase 0 只扩展现有风格、H3、引用、视频能力和 Director 服务，不创建第二套生成系统。新聚合契约通过 `/api/v2` 暴露，但底层继续调用现有 `styleRegistryService`、`referenceSlotService`、`unifiedVideoGenerationService` 和 Director 服务；所有修改先由 Node 内置测试驱动。

**Tech Stack:** Node.js 22.22.3、Express 4、SQLite/better-sqlite3、Vue 3 现有 API 客户端、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-09-05-production-studio-v2-design.md`；配套交互规格：`docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md`；P0 约束：`docs/superpowers/specs/2026-09-08-production-studio-v2.1-state-gate-truth-table.md`、`docs/superpowers/specs/2026-09-08-production-studio-v2.1-scope-version-concurrency-invalidation.md`

## Global Constraints

- 外部 JSON 只允许创建新剧集或填充服务端确认的空白剧集；非空剧集必须返回 `TARGET_NOT_BLANK`，不得在 Phase 0 引入合并、覆盖或追加旁路。
- 外部 JSON 导入只写结构化草稿，不得自动创建图片、视频或音频生成任务。

- 执行前使用 `superpowers:using-git-worktrees` 建立隔离 worktree；不得覆盖当前工作区的未提交改动。
- 所有 Node 命令使用 Node.js 22.22.3；不得用当前系统 Node 24 运行 `better-sqlite3` 测试。
- 全项目保持纯 JavaScript，不引入 TypeScript、状态机库或新 UI 框架。
- 现有 `/api/v1` 行为保持兼容；新聚合契约挂载在 `/api/v2`。
- Provider 能力由后端契约驱动；前端和调用方不得硬编码 RunningHub 的模型、价格、引用数量或分辨率。
- 项目内生成不得绕过项目 Look；人工编辑的 H3 最终文本不得被 freshness 检查静默覆盖。
- Look 解析顺序固定为 `Shot 特殊覆盖 > StoryScene 场次 Look > Project Look`，V2.1 不增加 Episode Look。Phase 0 尚无上两层持久化时，`ResolvedLook` 仍使用同一 shape，并将对应 version id 置空；不得另造项目专用 fingerprint 格式。
- 风格自动校验只检查最终提示词、负向词和提交快照；禁止在 Phase 0 增加图片视觉理解、视频抽帧或结果级 StyleConformanceGate。
- Phase 0 不实现语义自动选片；技术检测不得自动改变 adopted/approved 指针。
- Provider 最大时长不得作为分镜默认时长；能力契约必须能表达离散/范围时长、多时段和多场景支持。
- Phase 0 不新增钱包、账户、团队、发布或社区功能。
- 每个任务通过后再提交；功能全部验证后才更新根目录 `CHANGELOG.md` 的 `[未发布]`。

---

## File Structure

### 新建

- `backend-node/src/services/storyboardLookFingerprintService.js`：把项目当前 Look 解析为稳定快照和指纹。
- `backend-node/src/services/promptStyleGateService.js`：提交前逐字校验正向风格块、负向条款和快照一致性。
- `backend-node/src/services/providerCapabilityService.js`：把图片、视频、本地工具能力投影为统一契约。
- `backend-node/src/services/productionPreflightService.js`：组合 Look、引用槽位和 Provider 能力，返回 blocker/warning/降级项。
- `backend-node/src/routes/v2/index.js`：V2 聚合路由入口。
- `backend-node/src/routes/v2/providers.js`：Provider capability 查询。
- `backend-node/src/routes/v2/storyboards.js`：镜头 references/preflight 查询。
- `backend-node/test/h3DraftLookFreshness.test.js`
- `backend-node/test/promptStyleGateService.test.js`
- `backend-node/test/providerCapabilityContract.test.js`
- `backend-node/test/productionPreflightService.test.js`
- `backend-node/test/productionV2Routes.test.js`
- `backend-node/test/productionDirectorChain.test.js`

### 修改

- `backend-node/src/app.js`：挂载 `/api/v2`。
- `backend-node/src/routes/index.js`：通过只读 runtime sink 把已创建的 Provider/工作流/lifecycle 实例交给 V2 路由，禁止重复初始化恢复循环。
- `backend-node/src/services/h3PromptDraftService.js`：将 Look 指纹加入 H3 source fingerprint 和 freshness reason。
- `backend-node/src/services/imageGenerationTargetService.js`：在统一生图任务快照前执行 PromptStyleGate。
- `backend-node/src/services/unifiedVideoGenerationService.js`：在视频提交前执行 PromptStyleGate；H3 风格在正式结构内一次编译，不再套普通视频提示词外壳。
- `backend-node/src/services/referenceSlotService.js`：如需要，导出无副作用的槽位校验结果；保持现有调用兼容。
- `backend-node/src/director/candidateGroupService.js`：仅在端到端测试发现投影缺口时补齐 manifest，不新建候选表。
- `backend-node/src/director/continuityAnchorService.js`：仅补充可追溯字段或查询，不改变现有锚点语义。
- `CHANGELOG.md`：全部功能完成且验证后记录。

## Task 1: Look fingerprint enters H3 freshness

**Files:**

- Create: `backend-node/src/services/storyboardLookFingerprintService.js`
- Create: `backend-node/test/h3DraftLookFreshness.test.js`
- Modify: `backend-node/src/services/h3PromptDraftService.js`

**Interfaces:**

- Produces: `resolveStoryboardLookSnapshot(db, storyboardId) -> { projectLookVersionId, storySceneLookVersionId, shotOverrideVersionId, resolvedDefinition, positivePromptBlock, negativeTerms, fingerprint }`
- Changes: `computeSourceFingerprint(input)` accepts `lookFingerprint`.
- Changes: stored `generation_params` adds the immutable `resolvedLook` snapshot and `lookFingerprint`.
- Changes: `evaluateDraftFreshness()` may return reason `look` without changing manual `final_compiled_prompt`.

- [ ] **Step 1: Write the failing integration test**

Reuse the schema/fixture pattern from `backend-node/test/h3DraftGating.test.js`. Add a drama and episode between storyboard and `style_id`, plus two custom style rows. The essential assertion must be:

```js
test('project Look change marks the existing H3 draft stale without replacing manual text', async () => {
  const draft = await service.compileDraft(db, config, log, {
    storyboardId: 1,
    videoConfigId: '1',
  });
  service.saveDraftText(db, {
    draftId: draft.id,
    finalText: VALID_REF_PROMPT.replace('walks', 'slowly walks'),
    manuallyEdited: true,
  });

  db.prepare("UPDATE dramas SET style_id = 'custom:look-b' WHERE id = 1").run();
  const current = service.getDraftById(db, draft.id);
  const freshness = service.evaluateDraftFreshness(db, current);

  assert.deepEqual(freshness, { stale: true, reasons: ['look'] });
  assert.match(service.getDraftById(db, draft.id).final_compiled_prompt, /slowly walks/);
});
```

- [ ] **Step 2: Run the test and verify the intended failure**

Run:

```powershell
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe' --test test/h3DraftLookFreshness.test.js
```

Working directory: `backend-node`. Expected: FAIL because Look is not yet part of the draft fingerprint/freshness reasons.

- [ ] **Step 3: Implement the stable Look snapshot**

`storyboardLookFingerprintService.js` must query storyboard → episode → drama, resolve the canonical style with `createStyleRegistryService({ db }).requireStyle(style_id)`, and hash only stable business fields:

```js
const crypto = require('node:crypto');
const { createStyleRegistryService } = require('./styleRegistryService');

function resolveStoryboardLookSnapshot(db, storyboardId) {
  const row = db.prepare(`SELECT d.style_id
    FROM storyboards s
    JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
    JOIN dramas d ON d.id = e.drama_id AND d.deleted_at IS NULL
    WHERE s.id = ? AND s.deleted_at IS NULL`).get(Number(storyboardId));
  if (!row?.style_id) {
    return {
      projectLookVersionId: null,
      storySceneLookVersionId: null,
      shotOverrideVersionId: null,
      resolvedDefinition: null,
      positivePromptBlock: '',
      negativeTerms: [],
      fingerprint: '',
    };
  }
  const style = createStyleRegistryService({ db }).requireStyle(row.style_id);
  const canonical = JSON.stringify({
    id: style.id,
    version: Number(style.version) || 1,
    promptZh: style.promptZh || '',
    promptEn: style.promptEn || '',
    negativePrompt: style.negativePrompt || '',
  });
  return {
    // Phase 1 建立 look_profile_versions 后写真实 id；Phase 0 不伪造版本主键。
    projectLookVersionId: null,
    storySceneLookVersionId: null,
    shotOverrideVersionId: null,
    resolvedDefinition: JSON.parse(canonical),
    positivePromptBlock: style.promptZh || style.promptEn || '',
    negativeTerms: String(style.negativePrompt || '').split(/[,，]/).map(x => x.trim()).filter(Boolean),
    fingerprint: crypto.createHash('sha256').update(canonical).digest('hex'),
  };
}

module.exports = { resolveStoryboardLookSnapshot };
```

- [ ] **Step 4: Extend compile and freshness paths**

In `h3PromptDraftService.js`, resolve the Look once per compile, pass `lookFingerprint` into `computeSourceFingerprint`, and persist the complete `resolvedLook` object plus `lookFingerprint` in `generation_params`. Phase 0 尚未建立 `look_profile_versions`，因此三个 version id 都为 `null`，但 `resolvedDefinition` 与 prompt 字段必须完整保存；Phase 1 回填真实 Project Look version id 时不得改变对象 shape 或 fingerprint 算法。Freshness evaluation 必须重新解析 Look；stored fingerprint 不同时追加 `look`，并将 `lookFingerprint` 纳入最终整体 fingerprint 重算。

Do not include labels, timestamps or UI-only fields in the hash. Do not modify `source_prompt`, `final_compiled_prompt` or `manually_edited` during evaluation.

- [ ] **Step 5: Run focused and existing H3 tests**

```powershell
& $node22 --test test/h3DraftLookFreshness.test.js test/h3DraftGating.test.js test/h3PromptDraftService.test.js test/h3DraftMigration.test.js
```

Expected: all tests PASS and the new test reports reason `look` only.

- [ ] **Step 6: Commit**

```powershell
git add backend-node/src/services/storyboardLookFingerprintService.js backend-node/src/services/h3PromptDraftService.js backend-node/test/h3DraftLookFreshness.test.js
git commit -m "fix: invalidate H3 drafts when project look changes"
```

## Task 1B: PromptStyleGate for image, video, Omni, and H3

**Files:**

- Create: `backend-node/src/services/promptStyleGateService.js`
- Create: `backend-node/test/promptStyleGateService.test.js`
- Modify: `backend-node/src/services/imageGenerationTargetService.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/src/services/h3PromptCompiler.js`

**Contract:**

`validatePromptStyle({ style, language, finalPrompt, negativePrompt, submittedPrompt, submittedNegativePrompt, compilerType }) -> { ok, styleId, styleVersion, language, checks, errors }`。

- [ ] **Step 1: Write failing contract and integration tests**

覆盖完整风格块只出现一次、负向条款完整、H3 正式结构内注入、缺失/重复阻断、快照与提交请求不一致阻断。测试使用确定性字符串，不调用图片理解、视频抽帧、VLM 或真实 Provider。

- [ ] **Step 2: Run the focused tests and verify failure**

```powershell
& $node22 --test test/promptStyleGateService.test.js
```

Expected: FAIL because the gate service does not exist and H3 still uses an outer generic style compilation.

- [ ] **Step 3: Implement the pure PromptStyleGate**

以 `selectStylePrompt(style, language)` 为权威正向块，要求在最终提示词中完整出现且只出现一次；逐项验证 `style.keywords.negative`；错误返回具体条款和 `STYLE_PROMPT_MISSING | STYLE_PROMPT_DUPLICATED | STYLE_NEGATIVE_INCOMPLETE | STYLE_SNAPSHOT_MISMATCH`。纯函数不得访问媒体结果。

- [ ] **Step 4: Integrate before snapshots and Provider calls**

图片、普通视频和 Omni 在编译完成后调用同一门禁。H3 编译器接收解析后的 StyleSpec 并在 H3 正式结构中完成一次确定性注入；删除“完成 H3 后再交给普通视频编译器包裹”的路径。门禁结果写入现有 generation style snapshot 的 capability/sections 扩展，不新建结果质量表。

- [ ] **Step 5: Run focused and regression tests**

```powershell
& $node22 --test test/promptStyleGateService.test.js test/promptCompilers.test.js test/imageGenerationTaskRoutes.test.js test/h3PromptCompiler.test.js test/h3DraftGating.test.js test/unifiedVideoGenerationService.test.js
```

Expected: all PASS; the submitted prompt equals the frozen prompt byte-for-byte.

- [ ] **Step 6: Commit**

```powershell
git add backend-node/src/services/promptStyleGateService.js backend-node/src/services/imageGenerationTargetService.js backend-node/src/services/unifiedVideoGenerationService.js backend-node/src/services/h3PromptCompiler.js backend-node/test/promptStyleGateService.test.js
git commit -m "fix: validate project style before generation submission"
```

## Task 2: Unified Provider capability contract

**Files:**

- Create: `backend-node/src/services/providerCapabilityService.js`
- Create: `backend-node/src/routes/v2/providers.js`
- Create: `backend-node/test/providerCapabilityContract.test.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js` only if a read-only capability getter is not injectable.

**Interfaces:**

- Produces: `createProviderCapabilityService({ db, videoLifecycle, imageCapabilityResolver, toolResolvers })`.
- Produces: `listCapabilities({ mediaType, provider, model }) -> { schemaVersion: 1, generatedAt, items }`.
- Item shape: `{ provider, model, mediaType, execution, inputs, references, segmentation, output, cost }`.

- [ ] **Step 1: Write contract tests before the service**

```js
test('normalizes video capabilities without inventing unsupported fields', () => {
  const service = createProviderCapabilityService({
    db,
    videoLifecycle: { getVideoCapabilities: () => ({
      provider: 'comfyui', model: 'minimax_h3_director_r2v',
      capabilities: { minReferences: 1, maxReferences: 9, supportsAudio: true },
    }) },
    imageCapabilityResolver: () => [],
  });
  const result = service.listCapabilities({ mediaType: 'video' });
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.items[0].references, {
    min: 1, max: 9, roles: [], supportsFirstFrame: false,
    supportsLastFrame: false, supportsAudio: true,
  });
  assert.equal(result.items[0].cost.known, false);
  assert.deepEqual(result.items[0].segmentation, {
    supportsTimedSegments: false, maxTimedSegments: null,
    supportsMultiScene: false, maxSceneAssets: null,
  });
});

test('filters by media type and never returns api keys', () => {
  const json = JSON.stringify(service.listCapabilities({ mediaType: 'image' }));
  assert.doesNotMatch(json, /api[_-]?key|secret|bearer/i);
});
```

- [ ] **Step 2: Run and see the missing-module failure**

```powershell
& $node22 --test test/providerCapabilityContract.test.js
```

Expected: FAIL with `Cannot find module '../src/services/providerCapabilityService'`.

- [ ] **Step 3: Implement the normalizer**

The service must produce this exact minimum shape for every item:

```js
{
  provider: 'comfyui',
  model: 'minimax_h3_director_r2v',
  mediaType: 'video',
  execution: { kind: 'local', remoteChargePossible: false },
  inputs: { prompt: true, negativePrompt: false, width: true, height: true, duration: true },
  references: {
    min: 1, max: 9, roles: [],
    supportsFirstFrame: false, supportsLastFrame: false, supportsAudio: true,
  },
  segmentation: {
    supportsTimedSegments: false, maxTimedSegments: null,
    supportsMultiScene: false, maxSceneAssets: null,
  },
  output: { mimeTypes: ['video/mp4'], aspectRatios: [], resolutions: [], durations: [] },
  cost: { known: false, currency: null, unitAmount: null, unit: null },
}
```

Unknown values stay empty/false/null. Duration must preserve whether it is an enum or range; no consumer may treat the maximum as the default. `execution.kind` is `local | remote | external_web`; only remote/external paths set `remoteChargePossible: true`. Never infer a price or segmentation support from RunningHub or model names.

- [ ] **Step 4: Add the read-only route handler**

`routes/v2/providers.js` exports a factory whose `list` handler accepts optional `media_type`, `provider`, `model`; invalid `media_type` returns `BAD_REQUEST`. Success uses the existing `response.success()` envelope.

- [ ] **Step 5: Run focused regression tests**

```powershell
& $node22 --test test/providerCapabilityContract.test.js test/videoCapabilitiesService.test.js test/videoCapabilitiesRoutes.test.js test/imageGenerationSettings.test.js
```

Expected: all PASS; existing `/api/v1/videos/capabilities` remains unchanged.

- [ ] **Step 6: Commit**

```powershell
git add backend-node/src/services/providerCapabilityService.js backend-node/src/routes/v2/providers.js backend-node/test/providerCapabilityContract.test.js
git commit -m "feat: expose unified provider capability contract"
```

## Task 3: Reference manifest and generation-envelope preflight

**Files:**

- Create: `backend-node/src/services/productionPreflightService.js`
- Create: `backend-node/src/routes/v2/storyboards.js`
- Create: `backend-node/test/productionPreflightService.test.js`
- Modify: `backend-node/src/services/referenceSlotService.js` only to export an existing pure projection needed by the new service.

**Interfaces:**

- Consumes: `providerCapabilityService.listCapabilities()` from Task 2.
- Consumes: `resolveStoryboardSlots(db, storyboardId, { maxSlots })`.
- Produces: `preflightStoryboard({ storyboardId, provider, model, mediaType })`.
- Result shape: `{ ready, blockers, warnings, providerCapability, compiledReferenceSnapshot, generationEnvelope, estimatedTasks, estimatedCost, estimatedGpuSeconds }`.

Phase 0 尚不迁移方案 B 数据表：现有 storyboard 按“一个覆盖全时长的时段 + 原 `scene_id` 一个场景资产”投影。`generationEnvelope` 仍须返回计划时长、合法请求时长以及多时段/多场景能力，供 Phase 3 接入真实 `timed_segments`；不得把 Provider 最大时长当作现有分镜默认值。

- [ ] **Step 1: Write the failing behavior tests**

Cover all three cases with exact codes:

```js
assert.deepEqual(result.blockers.map(x => x.code), ['MISSING_REFERENCE_IMAGE']);
assert.equal(result.ready, false);
```

```js
assert.deepEqual(result.blockers.map(x => x.code), ['REFERENCE_COUNT_OVERFLOW']);
assert.equal(result.blockers[0].details.max, 2);
```

```js
assert.equal(result.ready, true);
assert.equal(result.compiledReferenceSnapshot[0].role, 'character_identity');
assert.equal(result.estimatedTasks, 1);
assert.equal(result.estimatedCost, null);
```

- [ ] **Step 2: Run the test and verify failure**

```powershell
& $node22 --test test/productionPreflightService.test.js
```

Expected: FAIL because `productionPreflightService` does not exist.

- [ ] **Step 3: Implement deterministic blocker ordering**

Blockers must be returned in this stable order so UI/tests do not depend on SQL order:

```js
const BLOCKER_ORDER = [
  'STORYBOARD_NOT_FOUND',
  'PROJECT_LOOK_REQUIRED',
  'PROVIDER_CAPABILITY_NOT_FOUND',
  'REFERENCE_COUNT_UNDERFLOW',
  'REFERENCE_COUNT_OVERFLOW',
  'MISSING_REFERENCE_IMAGE',
  'UNSUPPORTED_REQUIRED_REFERENCE',
];
```

The compiled snapshot contains business role, entity ids/version ids, local/remote URL and slot index, but never API credentials. It is a preview only; existing generation submission still owns immutable task snapshots.

- [ ] **Step 4: Implement GET references and POST preflight handlers**

Routes:

```text
GET  /storyboards/:id/references
POST /storyboards/:id/preflight
```

Request body: `{ provider, model, media_type }`. Invalid id/body returns 400, missing storyboard returns 404, unsupported required reference returns `ready:false` with HTTP 200 because this is a valid preflight result.

- [ ] **Step 5: Run reference and preflight tests**

```powershell
& $node22 --test test/productionPreflightService.test.js test/referenceSlotService.test.js test/universalBundleSlots.test.js test/preparedVideoGenerationService.test.js
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend-node/src/services/productionPreflightService.js backend-node/src/routes/v2/storyboards.js backend-node/test/productionPreflightService.test.js
git commit -m "feat: add storyboard reference preflight"
```

## Task 4: Mount the V2 aggregation router

**Files:**

- Create: `backend-node/src/routes/v2/index.js`
- Create: `backend-node/test/productionV2Routes.test.js`
- Modify: `backend-node/src/app.js`

**Interfaces:**

- Consumes: provider and storyboard factories from Tasks 2–3.
- Produces: `/api/v2/providers/capabilities`, `/api/v2/storyboards/:id/references`, `/api/v2/storyboards/:id/preflight`.

- [ ] **Step 1: Write the routing integration test**

Create an in-memory app fixture and assert:

```js
const response = await fetch(`${baseUrl}/api/v2/providers/capabilities?media_type=video`);
const payload = await response.json();
assert.equal(response.status, 200);
assert.equal(payload.success, true);
assert.equal(payload.data.schemaVersion, 1);
```

Also assert an unknown `/api/v2/not-real` returns JSON 404, and an existing `/api/v1/videos/capabilities` request remains routable.

- [ ] **Step 2: Run and verify 404/failure before mounting**

```powershell
& $node22 --test test/productionV2Routes.test.js
```

Expected: FAIL because `/api/v2` is not mounted.

- [ ] **Step 3: Build the dependency-injected router**

`routes/v2/index.js` exports `setupV2Router({ db, config, log, videoLifecycle, providerRegistry, workflowRegistry, imageCapabilityResolver })`. Register specific paths before `/:id` paths and append a JSON 404 handler scoped to V2.

Extend the existing `setupRouter` signature to `setupRouter(cfg, db, log, runtimeSink = null)`. Immediately after the existing `unifiedVideoGenerationService` and `preparedVideoGenerationService` are created, call the sink exactly once:

```js
runtimeSink?.({
  videoLifecycle: unifiedVideoGenerationService,
  providerRegistry: videoProviderRegistry,
  workflowRegistry: directorRegistry,
});
```

This callback only exposes instances; it does not start recovery or create another mutex. In `app.js`, construct/mount both routers before the frontend catch-all:

```js
const apiRuntime = {};
const v1Router = setupRouter(config, db, log, (runtime) => Object.assign(apiRuntime, runtime));
app.use('/api/v1', v1Router);
app.use('/api/v2', setupV2Router({ db, config, log, ...apiRuntime }));
```

Do not instantiate a second video lifecycle, recovery loop, Director registry or GPU mutex for V2.

- [ ] **Step 4: Run API error and route regression tests**

```powershell
& $node22 --test test/productionV2Routes.test.js test/appErrorHandling.test.js test/videoCapabilitiesRoutes.test.js
```

Expected: all PASS and V2 errors use `{ success:false, error:{ code,message }, timestamp }`.

- [ ] **Step 5: Commit**

```powershell
git add backend-node/src/app.js backend-node/src/routes/index.js backend-node/src/routes/v2/index.js backend-node/test/productionV2Routes.test.js
git commit -m "feat: mount production studio v2 api"
```

## Task 5: Prove candidate → anchor → timeline continuity

**Files:**

- Create: `backend-node/test/productionDirectorChain.test.js`
- Modify only if the red test proves a real gap:
  - `backend-node/src/director/candidateGroupService.js`
  - `backend-node/src/director/continuityAnchorService.js`
  - `backend-node/src/director/timelineService.js`

**Interfaces:**

- Consumes existing `createVideoCandidateGroup`, `selectCandidate`, `createContinuityAnchor`, `createTimeline`.
- Produces no parallel domain service; this task establishes the compatibility contract for later UI.

- [ ] **Step 1: Write one end-to-end persistence test**

The test must:

1. create storyboard 1 and two playable `video_generations`;
2. create a candidate group;
3. select one candidate and assert the storyboard current video projection changes while both candidates remain;
4. create a ready Director artifact for that selected result;
5. derive a continuity anchor from frame 24 and assert source artifact/hash and parameters persist;
6. create a timeline using the selected artifact;
7. reopen all rows from SQLite and assert ids link in the same direction.

Core assertions:

```js
assert.equal(selected.candidates.length, 2);
assert.equal(db.prepare('SELECT video_url FROM storyboards WHERE id = 1').pluck().get(), selectedUrl);
assert.equal(anchor.source_artifact_id, selectedArtifactId);
assert.equal(JSON.parse(timeline.manifest_json).clips[0].artifactId, selectedArtifactId);
```

- [ ] **Step 2: Run the chain test**

```powershell
& $node22 --test test/productionDirectorChain.test.js
```

If it passes without production changes, keep the test-only commit. If it fails, record the exact missing persisted link in the test name before changing services.

- [ ] **Step 3: Make the smallest compatibility fix if required**

Allowed changes are limited to adding stable identifiers to existing `manifest_json`/`parameters_json` or returning existing ids. Do not add `production_candidates`, `production_anchors` or a second timeline table.

- [ ] **Step 4: Run the complete Director regression slice**

```powershell
& $node22 --test test/productionDirectorChain.test.js test/candidateGroupService.test.js test/continuityAnchorService.test.js test/timelineService.test.js test/directorArtifactLifecycle.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend-node/test/productionDirectorChain.test.js backend-node/src/director/candidateGroupService.js backend-node/src/director/continuityAnchorService.js backend-node/src/director/timelineService.js
git commit -m "test: lock production candidate continuity chain"
```

Only add production files that actually changed.

## Task 6: Full Phase 0 verification and changelog

**Files:**

- Modify: `CHANGELOG.md`

**Interfaces:** None; this is the release gate for Phase 1.

- [ ] **Step 1: Run all backend tests with Node 22.22.3**

```powershell
Set-Location backend-node
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe' --test test/*.test.js
```

Expected: exit 0, zero failed tests.

- [ ] **Step 2: Run all frontend tests and build even though Phase 0 is backend-heavy**

```powershell
Set-Location ..\frontweb
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe' --test test/*.test.js
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\npm.cmd' run build
```

Expected: tests and Vite build exit 0.

- [ ] **Step 3: Run schema and whitespace checks**

```powershell
Set-Location ..
git diff --check
rg -n "api[_-]?key|secret|bearer" backend-node/test/providerCapabilityContract.test.js
```

Expected: `git diff --check` exit 0; the secret scan only finds negative test patterns, not credential values.

- [ ] **Step 4: Update `[未发布]` only after verification**

Add user-visible entries under the existing categories:

```markdown
- H3 草稿会在项目画风版本变化后明确标记为过期，并保留人工编辑内容。
- 图片、普通视频、Omni 与 H3 在提交前校验项目风格完整性和请求快照一致性，不执行结果级风格分析。
- 新增统一的图片/视频 Provider 能力与分镜引用预检接口，可在创建任务前说明阻塞和降级原因。
- 锁定视频候选、连续性锚点与 Director 时间线的可追溯链路，为 Production Studio V2.1 提供兼容基础。
```

- [ ] **Step 5: Commit the verified Phase 0 result**

```powershell
git add CHANGELOG.md
git commit -m "docs: record production studio phase zero foundation"
```

## Self-review results

- Spec coverage: Phase 0 的 Look/H3 freshness、PromptStyleGate、Reference Registry、Provider capability、候选→锚点→时间线、Node 22 与旧系统复用均有对应任务。
- Deliberate exclusions: Stage/Approval 表、Studio Shell、Script Gate、任务抽屉和 feature flag 属于 Phase 1；不在本计划提前创建。
- Type consistency: `ResolvedLook(projectLookVersionId/storySceneLookVersionId/shotOverrideVersionId/resolvedDefinition/positivePromptBlock/negativeTerms/fingerprint)`、PromptStyleGate result、capability item、preflight result 和 V2 路由命名在所有任务中一致。
- No new execution truth: 图片/视频任务、候选、锚点和时间线继续使用现有表和服务。
