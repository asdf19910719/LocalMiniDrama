# ComfyUI 同通道工作流切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一条 ComfyUI 视频通道可声明多个注册表工作流，生成面板可按次切换（如官方 ↔ 二采），H3 草稿/门禁按工作流绑定。

**Architecture:** 通道 `model` 列表即工作流白名单，`default_model` 为默认；`createVideoGeneration` 放宽显式 `workflow_id` 为成员校验；新增注册表目录端点驱动前端选项；`storyboard_h3_prompt_drafts` 增加 `workflow_id` 维度（NULL=通道默认的存量语义）。

**Tech Stack:** Node.js (Express + better-sqlite3 + node:test)、Vue 3 + Element Plus、Vite。

**Spec:** `docs/superpowers/specs/2026-09-04-comfyui-workflow-switching-design.md`

## Global Constraints

- 纯 JavaScript，无 TypeScript；无 ESLint。
- 后端测试：`cd backend-node && node --test test/*.test.js`；前端测试：`cd frontweb && node --test test/*.test.js`。
- 用户可见文案一律中文；错误码保持 `UPPER_SNAKE_CASE`。
- 不改快照语义：运行中任务不受通道/工作流切换影响。
- 非 ComfyUI 通道不允许显式工作流（保持 `VIDEO_WORKFLOW_NOT_ALLOWED`）。
- 注册表治理校验（`loadRegistry`/`validateWorkflowGovernance`）不改。

---

### Task 1: 工作流目录 helper 与 `GET /videos/workflows` 端点

**Files:**
- Create: `backend-node/src/director/workflowCatalog.js`
- Test: `backend-node/test/workflowCatalog.test.js`
- Modify: `backend-node/src/routes/videos.js`（新增 `workflows` handler）
- Modify: `backend-node/src/routes/index.js:117-120`（给 `videoRoutes` 传 `workflowRegistry`）与 `:360-370`（注册 `r.get('/videos/workflows', videos.workflows)`）

**Interfaces:**
- Produces: `listWorkflowCatalog(registry)` → `[{ id, status, variant, family, adapter, capabilities, experimental }]`（过滤 `invalid`；`configured` → `experimental: true`）；`isH3WorkflowEntry(workflow)` → `boolean`（`workflow?.adapter != null || workflow?.family === 'h3_director'`）。后续 Task 2/3/6 依赖这两个函数名。

- [ ] **Step 1: Write the failing test**

```js
// backend-node/test/workflowCatalog.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { listWorkflowCatalog, isH3WorkflowEntry } = require('../src/director/workflowCatalog');

const registry = {
  workflows: [
    { id: 'official', status: 'verified', variant: 'official_sage', family: 'h3_director', adapter: 'h3_director_r2v', capabilities: { modes: ['single_reference'] } },
    { id: 'ercai', status: 'configured', variant: 'ercai_v1', family: null, adapter: null, capabilities: null },
    { id: 'broken', status: 'invalid', variant: null, family: null, adapter: null, capabilities: null },
    { id: 'legacy', status: 'verified', variant: null, family: null, adapter: null, capabilities: { modes: ['x'] } },
  ],
};

describe('listWorkflowCatalog', () => {
  it('filters invalid entries and flags configured as experimental', () => {
    const catalog = listWorkflowCatalog(registry);
    assert.deepEqual(catalog.map((w) => w.id), ['official', 'ercai', 'legacy']);
    assert.equal(catalog.find((w) => w.id === 'ercai').experimental, true);
    assert.equal(catalog.find((w) => w.id === 'official').experimental, false);
  });
  it('returns empty array for missing registry', () => {
    assert.deepEqual(listWorkflowCatalog(null), []);
  });
});

describe('isH3WorkflowEntry', () => {
  it('is true for adapter or h3_director family', () => {
    assert.equal(isH3WorkflowEntry(registry.workflows[0]), true);
    assert.equal(isH3WorkflowEntry({ adapter: null, family: 'h3_director' }), true);
  });
  it('is false without adapter or family', () => {
    assert.equal(isH3WorkflowEntry(registry.workflows[1]), false);
    assert.equal(isH3WorkflowEntry(null), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-node && node --test test/workflowCatalog.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```js
// backend-node/src/director/workflowCatalog.js
'use strict';

// 注册表 → 可选工作流目录：过滤 invalid，configured 标记 experimental（需 allow_experimental 才能提交）。
function listWorkflowCatalog(registry) {
  const workflows = Array.isArray(registry?.workflows) ? registry.workflows : [];
  return workflows
    .filter((workflow) => workflow && workflow.status !== 'invalid')
    .map((workflow) => ({
      id: workflow.id,
      status: workflow.status,
      variant: workflow.variant || null,
      family: workflow.family || null,
      adapter: workflow.adapter || null,
      capabilities: workflow.capabilities || null,
      experimental: workflow.status === 'configured',
    }));
}

// H3 判定（注册表元数据驱动）：entry 有 adapter（走 H3 适配器）或 family=h3_director。
function isH3WorkflowEntry(workflow) {
  if (!workflow || typeof workflow !== 'object') return false;
  return workflow.adapter != null || workflow.family === 'h3_director';
}

module.exports = { listWorkflowCatalog, isH3WorkflowEntry };
```

路由接线：

```js
// backend-node/src/routes/videos.js —— routes(db, log, options) 内新增：
const { listWorkflowCatalog } = require('../director/workflowCatalog'); // 文件顶部

workflows: (req, res) => {
  try {
    const registry = options.workflowRegistry || null;
    response.success(res, { workflows: listWorkflowCatalog(registry) });
  } catch (error) {
    log.error('videos workflows', { error: error.message });
    response.internalError(res, error.message);
  }
},

// backend-node/src/routes/index.js —— videos 装配处（约 117 行）加 workflowRegistry: directorRegistry，
// 路由表（约 361 行后）加：r.get('/videos/workflows', videos.workflows);
```

注意 `r.get('/videos/:id', ...)` 必须保持在 `/videos/workflows` 之后（Express 按注册顺序匹配，现有 capabilities 已在 :id 之前，照同样位置插入即可）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-node && node --test test/workflowCatalog.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/director/workflowCatalog.js backend-node/test/workflowCatalog.test.js backend-node/src/routes/videos.js backend-node/src/routes/index.js
git commit -m "feat: comfyui workflow catalog helper and /videos/workflows endpoint"
```

---

### Task 2: `getVideoCapabilities` 增加 `workflows[]`

**Files:**
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js:930-955`（`getVideoCapabilities`）
- Test: `backend-node/test/unifiedVideoCapabilitiesWorkflows.test.js`（新建）

**Interfaces:**
- Consumes: `listWorkflowCatalog`/`isH3WorkflowEntry`（Task 1）。
- Produces: capabilities 响应新增 `workflows: [{ id, status, variant, adapter, capabilities, default, h3, unavailableReason? }]`（前端 Task 6 依赖此形状）。

- [ ] **Step 1: Write the failing test**

复用 `unifiedVideoGenerationService.test.js` 的 `createTestDb`/`seedDefaultConfig` 建库方式（拷贝最小版），注册表用内存对象直接传入 `workflowRegistry`：

```js
// backend-node/test/unifiedVideoCapabilitiesWorkflows.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createUnifiedVideoGenerationService } = require('../src/services/unifiedVideoGenerationService');

const registry = {
  workflows: [
    { id: 'minimax_h3_director_r2v', status: 'verified', variant: 'official_sage', family: 'h3_director', adapter: 'h3_director_r2v', capabilities: { modes: ['single_reference'] } },
    { id: 'h3_ercai_u06', status: 'verified', variant: 'ercai_lightx2v', family: null, adapter: null, capabilities: { modes: ['multi_reference'] } },
  ],
};

function createService(modelList, defaultModel) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE ai_service_configs (id INTEGER PRIMARY KEY AUTOINCREMENT, service_type TEXT, provider TEXT, api_protocol TEXT, base_url TEXT, api_key TEXT, model TEXT, default_model TEXT, endpoint TEXT, query_endpoint TEXT, settings TEXT, is_default INTEGER, is_active INTEGER, deleted_at TEXT)`);
  db.prepare(`INSERT INTO ai_service_configs (service_type, provider, base_url, model, default_model, is_default, is_active) VALUES ('video', 'comfyui', 'http://127.0.0.1:8188', ?, ?, 1, 1)`)
    .run(JSON.stringify(modelList), defaultModel);
  const noop = () => {};
  return createUnifiedVideoGenerationService({
    db,
    log: { info: noop, warn: noop, error: noop },
    providerRegistry: { has: () => true, get: () => ({ submit: noop, query: noop, cancel: noop, recover: noop }) },
    workflowRegistry: registry,
  });
}

describe('getVideoCapabilities workflows', () => {
  it('lists every channel model entry with default and h3 flags', () => {
    const service = createService(['minimax_h3_director_r2v', 'h3_ercai_u06'], 'minimax_h3_director_r2v');
    const caps = service.getVideoCapabilities();
    assert.equal(caps.workflows.length, 2);
    const official = caps.workflows.find((w) => w.id === 'minimax_h3_director_r2v');
    const ercai = caps.workflows.find((w) => w.id === 'h3_ercai_u06');
    assert.equal(official.default, true);
    assert.equal(official.h3, true);
    assert.equal(ercai.default, false);
    assert.equal(ercai.h3, false);
  });
  it('marks registry-missing member unavailable without failing', () => {
    const service = createService(['minimax_h3_director_r2v', 'gone_workflow'], 'minimax_h3_director_r2v');
    const caps = service.getVideoCapabilities();
    const gone = caps.workflows.find((w) => w.id === 'gone_workflow');
    assert.equal(gone.status, 'unavailable');
    assert.ok(gone.unavailableReason);
  });
  it('keeps single-entry behavior unchanged', () => {
    const service = createService(['h3_ercai_u06'], 'h3_ercai_u06');
    const caps = service.getVideoCapabilities();
    assert.equal(caps.workflows.length, 1);
    assert.equal(caps.workflow.id, 'h3_ercai_u06');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-node && node --test test/unifiedVideoCapabilitiesWorkflows.test.js`
Expected: FAIL（`caps.workflows` 为 undefined）

- [ ] **Step 3: Write minimal implementation**

`getVideoCapabilities` 中，在现有默认 workflow 解析后追加（保持现有字段不变）：

```js
function getVideoCapabilities() {
  const resolved = resolveDefaultVideoConfig(db);
  const workflowId = resolved.model;
  const workflow = resolved.provider === 'comfyui' && workflowRegistry && workflowId
    ? selectWorkflow(workflowRegistry, workflowId, { allowExperimental: false })
    : null;
  const models = Array.isArray(resolved.config.model) ? resolved.config.model : [];
  const workflows = resolved.provider === 'comfyui'
    ? models.map((id) => {
      const entry = workflowRegistry
        ? (workflowRegistry.workflows || []).find((w) => w.id === id) : null;
      if (!entry) {
        return { id, status: 'unavailable', unavailableReason: 'WORKFLOW_NOT_FOUND', default: id === resolved.model, h3: false };
      }
      return {
        id: entry.id,
        status: entry.status,
        variant: entry.variant || null,
        adapter: entry.adapter || null,
        capabilities: entry.capabilities || null,
        default: entry.id === resolved.model,
        h3: isH3WorkflowEntry(entry),
      };
    })
    : [];
  // ……现有 capabilities 组装保持不变，返回对象新增 workflows
  return { /* 现有字段 */ workflows };
}
```

`invalid` 成员不在这里过滤（目录端点已过滤；capabilities 保留条目并靠 `status` 呈现，前端禁选）。文件顶部 `require('../director/workflowCatalog')` 解构 `isH3WorkflowEntry`。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-node && node --test test/unifiedVideoCapabilitiesWorkflows.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/unifiedVideoGenerationService.js backend-node/test/unifiedVideoCapabilitiesWorkflows.test.js
git commit -m "feat: expose channel workflow list in video capabilities"
```

---

### Task 3: 每次生成可选工作流 + H3 判定注册表化

**Files:**
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js:118-126`（`isH3VideoConfig`）、`:679-720`（`createVideoGeneration` 守卫与 H3 分支）
- Modify: `backend-node/src/services/videoProviders/comfyuiVideoProvider.js:208-214`（submit 的 H3 校验触发条件）
- Test: `backend-node/test/comfyuiWorkflowSwitching.test.js`（新建）

**Interfaces:**
- Consumes: `isH3WorkflowEntry`（Task 1）。
- Produces: `isH3VideoConfig(resolved, workflow)`（第二参可选，传入注册表 entry 时优先元数据判定）；`createVideoGeneration` 接受 `workflow_id ∈ config.model`（仅 comfyui）。

- [ ] **Step 1: Write the failing test**

```js
// backend-node/test/comfyuiWorkflowSwitching.test.js —— 头部复用 Task 2 的 createService 思路，
// 但 video_generations/async_tasks/dramas/storyboards 表按 unifiedVideoGenerationService.test.js 的
// createTestDb 拷贝（provider submit 用假实现记录收到的 context.snapshot.workflowId）。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// ……createTestDb（含 ai_service_configs/async_tasks/video_generations/dramas/storyboards 最小建表）……

function buildService(db, submitted) {
  return createUnifiedVideoGenerationService({
    db,
    log: { info() {}, warn() {}, error() {} },
    providerRegistry: {
      has: (name) => name === 'comfyui',
      get: () => ({
        async submit(context) { submitted.push(context); return { providerTaskId: 'p1', status: 'running', progress: 1 }; },
        async query() { return { providerTaskId: 'p1', status: 'running', progress: 1 }; },
        async cancel() { return { providerTaskId: 'p1', status: 'cancelled', progress: 100 }; },
      }),
    },
    workflowRegistry: registry, // 官方 + 二采两条 verified entry（二采无 adapter，official 有 adapter）
    schedule: (job) => job(),   // 同步调度便于断言
  });
}

describe('per-request workflow selection', () => {
  it('accepts workflow_id that is a channel model member and snapshots it', async () => {
    // 通道 model=['minimax_h3_director_r2v','h3_ercai_u06'], default=官方
    const submitted = [];
    const service = buildService(db, submitted);
    const created = await service.createVideoGeneration({
      prompt: 'p', duration: 5, workflow_id: 'h3_ercai_u06',
      reference_image_urls: ['http://x/1.png'],
    });
    const snapshot = JSON.parse(rawRow(created.id).config_snapshot);
    assert.equal(snapshot.workflowId, 'h3_ercai_u06');
    assert.equal(submitted[0].snapshot.workflowId, 'h3_ercai_u06');
  });
  it('rejects workflow_id outside the channel model list', async () => {
    await assert.rejects(
      () => service.createVideoGeneration({ prompt: 'p', duration: 5, workflow_id: 'not-registered' }),
      (error) => error.code === 'VIDEO_WORKFLOW_NOT_ALLOWED' || error.message === 'VIDEO_WORKFLOW_NOT_ALLOWED',
    );
  });
  it('still rejects explicit workflow on non-comfyui channels', async () => {
    // 通道 provider='volces'，model=['wan2.2'] 时 workflow_id='wan2.2' 之外值 → VIDEO_WORKFLOW_NOT_ALLOWED
  });
});

describe('isH3VideoConfig registry-driven', () => {
  it('uses workflow metadata first, then legacy name fallback', () => {
    assert.equal(isH3VideoConfig({ provider: 'comfyui', model: 'h3_ercai_u06' }, { adapter: null, family: null }), false);
    assert.equal(isH3VideoConfig({ provider: 'comfyui', model: 'anything' }, { adapter: 'h3_director_r2v', family: 'h3_director' }), true);
    assert.equal(isH3VideoConfig({ provider: 'comfyui', model: 'minimax_h3_director_r2v' }, null), true); // 名字回退
  });
  it('keeps legacy no-metadata entry h3-continuity-v1 recognized as H3', () => {
    // 旧注册表条目（无 adapter/family 元数据），靠模型名回退保持现状语义
    assert.equal(isH3VideoConfig({ provider: 'comfyui', model: 'h3-continuity-v1' }, { id: 'h3-continuity-v1', adapter: null, family: null }), true);
  });
});
```

（实现时把注释占位的建表/第二/第三个用例补全为真实代码——断言与错误码以上述为准。）

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-node && node --test test/comfyuiWorkflowSwitching.test.js`
Expected: FAIL（显式 workflow_id 仍被 `VIDEO_WORKFLOW_NOT_ALLOWED` 拒绝；isH3VideoConfig 不接受第二参）

- [ ] **Step 3: Write minimal implementation**

```js
// unifiedVideoGenerationService.js
// 注意:workflow 传入时仍保留旧名回退——h3-continuity-v1 是无元数据的历史条目,
// 只能靠模型名识别;h3 前缀命名的二采工作流不会命中任何回退条件。
function isH3VideoConfig(resolved, workflow = null) {
  const provider = String(resolved?.provider || resolved?.config?.provider || '').toLowerCase();
  const protocol = String(resolved?.protocol || resolved?.config?.api_protocol || '').toLowerCase();
  const model = String(resolved?.model || resolved?.config?.default_model || '').toLowerCase();
  const legacy = provider === 'comfyui' && (model === 'h3-continuity-v1' || model === 'minimax_h3_director_r2v' || model.includes('minimaxh3') || model.includes('minimax-h3'))
    || protocol === 'minimax_h3';
  if (workflow && typeof workflow === 'object') return isH3WorkflowEntry(workflow) || legacy;
  return legacy;
}

// createVideoGeneration 守卫替换：
const explicitWorkflowId = input.workflow_id || input.workflowId;
const isComfyui = String(resolved.provider).toLowerCase() === 'comfyui';
if (workflowRegistry && explicitWorkflowId) {
  const allowed = isComfyui
    ? (Array.isArray(resolved.config.model) && resolved.config.model.map(String).includes(String(explicitWorkflowId).trim()))
    : String(explicitWorkflowId).trim() === String(resolved.model).trim();
  if (!allowed) {
    const error = new Error('VIDEO_WORKFLOW_NOT_ALLOWED');
    error.code = 'VIDEO_WORKFLOW_NOT_ALLOWED';
    throw error;
  }
}
// H3 分支判定改为传入已选 workflow：
if (isH3VideoConfig(resolved, workflow)) { /* 草稿门禁，不变 */ }
```

`comfyuiVideoProvider.js` submit 内触发 H3 prompt 校验的条件替换为：

```js
const { isH3WorkflowEntry } = require('../../director/workflowCatalog');
// ……
// 旧条件 `selected.id === 'h3-continuity-v1' || model.includes('h3')` 的模糊匹配会让
// h3 前缀命名的二采工作流误触发 H3 提示词校验;改为元数据 + 精确旧 id。
const needsH3PromptCheck = isH3WorkflowEntry(selected) || selected.id === 'h3-continuity-v1';
if (needsH3PromptCheck && (context.videoGenerationId || context.promptFormat || context.input?.promptFormat)) { /* 现有 validateH3Prompt 调用不变 */ }
```

- [ ] **Step 4: Run tests**

Run: `cd backend-node && node --test test/comfyuiWorkflowSwitching.test.js test/unifiedVideoGenerationService.test.js test/comfyuiVideoProvider.test.js test/h3DraftGating.test.js`
Expected: 新测试 PASS，存量测试不回归

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/unifiedVideoGenerationService.js backend-node/src/services/videoProviders/comfyuiVideoProvider.js backend-node/test/comfyuiWorkflowSwitching.test.js
git commit -m "feat: per-generation comfyui workflow selection within channel model list"
```

---

### Task 4: H3 草稿按工作流绑定（迁移 + 服务 + 门禁 + 路由）

**Files:**
- Modify: `backend-node/src/db/migrate.js`（`storyboard_h3_prompt_drafts` 补 `workflow_id` 列与新索引）
- Modify: `backend-node/src/services/h3PromptDraftService.js`（compileDraft/getLatestDraft/evaluateDraftFreshness）
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`（`requireH3PromptDraft` 工作流一致性）
- Modify: `backend-node/src/routes/storyboards.js:1183-1237`（三个草稿端点透传 `workflow_id`）
- Test: `backend-node/test/h3DraftWorkflowBinding.test.js`（新建）

**Interfaces:**
- Produces:
  - `compileDraft(db, cfg, log, { storyboardId, videoConfigId, workflowId })`（workflowId 可选，缺省=通道 default_model）
  - `getLatestDraft(db, storyboardId, videoConfigId, workflowId)`（优先精确匹配；请求工作流=通道默认且无精确行时回退 NULL 存量行）
  - draft 行新增 `workflow_id` 列（NULL=通道默认语义）
  - 门禁：草稿 workflow ≠ 请求 workflow → `H3_DRAFT_CONFIG_MISMATCH`(409)
- Consumes: `resolveVideoRuntime(db, videoConfigId, { workflowId })`（已存在，无需改）。

- [ ] **Step 1: Write the failing test**

```js
// backend-node/test/h3DraftWorkflowBinding.test.js
// 建表：storyboard_h3_prompt_drafts（含 workflow_id 列）+ ai_service_configs + storyboards（含 universal_segment_text 等业务提示词列，按 h3PromptDraftService 现有测试的建表拷贝）。
// 注册表：official(带 adapter) + ercai(无 adapter)。通道 model=[两者]，default=official。

describe('h3 draft workflow binding', () => {
  it('compile stores workflow_id and getLatestDraft filters by workflow', async () => {
    const draftA = await drafts.compileDraft(db, {}, log, { storyboardId: 1, videoConfigId: 1, workflowId: 'minimax_h3_director_r2v' });
    assert.equal(draftA.workflow_id, 'minimax_h3_director_r2v');
    const draftB = await drafts.compileDraft(db, {}, log, { storyboardId: 1, videoConfigId: 1, workflowId: 'h3_ercai_u06' });
    assert.equal(draftB.workflow_id, 'h3_ercai_u06');
    assert.equal(drafts.getLatestDraft(db, 1, 1, 'h3_ercai_u06').id, draftB.id);
    assert.equal(drafts.getLatestDraft(db, 1, 1, 'minimax_h3_director_r2v').id, draftA.id);
  });
  it('falls back to legacy NULL rows when requesting the channel default workflow', async () => {
    db.prepare(`INSERT INTO storyboard_h3_prompt_drafts (storyboard_id, video_config_id, source_prompt, source_fingerprint, final_compiled_prompt, compiled_prompt_hash, status, workflow_id, created_at, updated_at) VALUES (1, 1, 's', 'f', 't', 'h', 'valid', NULL, ?, ?)`).run(now, now);
    const draft = drafts.getLatestDraft(db, 1, 1, 'minimax_h3_director_r2v');
    assert.ok(draft && draft.workflow_id == null);
    assert.equal(drafts.getLatestDraft(db, 1, 1, 'h3_ercai_u06') == null || drafts.getLatestDraft(db, 1, 1, 'h3_ercai_u06').workflow_id === 'h3_ercai_u06', true);
  });
  it('gate rejects a draft compiled for another workflow with H3_DRAFT_CONFIG_MISMATCH', async () => {
    // 通过 createVideoGeneration（H3 官方工作流）提交，携带 ercai 工作流编译的草稿 id → 409 H3_DRAFT_CONFIG_MISMATCH
  });
  it('freshness resolves runtime with the draft workflow', () => {
    // 通道 default 从 official 改为 ercai 后：workflow_id='official' 的草稿评估 reasons 含 'config'
  });
});
```

（实现时补全占位用例为真实代码：门禁用例构造 H3 配置 + 草稿 + createVideoGeneration 调用；freshness 用例直接改通道 default_model 后调 evaluateDraftFreshness。）

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-node && node --test test/h3DraftWorkflowBinding.test.js`
Expected: FAIL（compileDraft 不接受 workflowId / draft 无 workflow_id 列）

- [ ] **Step 3: Write minimal implementation**

```js
// migrate.js —— ensureAllColumns 内、草稿表 CREATE 之后追加：
ensureColumns(database, 'storyboard_h3_prompt_drafts', [
  { name: 'workflow_id', type: 'TEXT' },
]);
try {
  database.exec('CREATE INDEX IF NOT EXISTS idx_h3_draft_lookup_wf ON storyboard_h3_prompt_drafts(storyboard_id, video_config_id, workflow_id, updated_at DESC)');
} catch (_) {}

// h3PromptDraftService.js
async function compileDraft(db, cfg, log, { storyboardId, videoConfigId, workflowId } = {}) {
  // ……现状不变，直到 runtime 解析：
  const runtime = resolveVideoRuntime(db, videoConfigId, { workflowId });
  const workflowIdValue = runtime.workflow?.id || runtime.model || null;
  // INSERT 列加 workflow_id（值 workflowIdValue）；保留最新 10 条的 DELETE 条件加 AND workflow_id IS ?（两处 ? 都传 workflowIdValue）
}

function getLatestDraft(db, storyboardId, videoConfigId, workflowId = null) {
  // 现有两个分支的 SQL 各加一档：先按 (storyboard, config, workflow_id = ?) 精确查；
  // 无行且 workflowId 等于通道 default_model → 再按 workflow_id IS NULL 查（存量兼容）。
  // 通道 default_model 需查 ai_service_configs（同 resolveVideoRuntime 的行读取）。
}

function evaluateDraftFreshness(db, draft) {
  // ……runtime = resolveVideoRuntime(db, draft.video_config_id, { workflowId: draft.workflow_id ?? null })
  // 其余不变（configSnapshot/workflowSha 已随 runtime 感知工作流）。
}
```

`requireH3PromptDraft`（unifiedVideoGenerationService）在 `H3_DRAFT_CONFIG_MISMATCH` 检查后追加：

```js
// 草稿工作流一致性：NULL 存量行按通道默认工作流解释（与 getLatestDraft 回退口径一致）。
const channelDefaultWorkflow = String(resolved.model || '').trim();
const draftWorkflow = String(draft.workflow_id ?? channelDefaultWorkflow).trim();
const requestWorkflow = String(workflow?.id || resolved.model || '').trim();
if (draftWorkflow !== requestWorkflow) {
  throw new VideoLifecycleError(
    'H3_DRAFT_CONFIG_MISMATCH',
    '提示词草稿属于其他工作流，请用当前工作流重新生成 H3 提示词',
    409,
    { draft_workflow_id: draft.workflow_id ?? null, workflow_id: requestWorkflow },
  );
}
```

`requireH3PromptDraft` 签名增加 `workflow` 参数，调用处 `requireH3PromptDraft(input, resolved, storyboardId, workflow)`。

`storyboards.js` 三个端点：

```js
// GET：const workflowId = req.query.workflow_id；getLatestDraft(db, id, videoConfigId, workflowId)
// POST compile：body.workflow_id 透传 compileDraft({..., workflowId: body.workflow_id})
// PUT save：不变（draft_id 已定位行）
```

- [ ] **Step 4: Run tests**

Run: `cd backend-node && node --test test/h3DraftWorkflowBinding.test.js test/h3PromptDraftService.test.js test/h3DraftGating.test.js test/storyboardsH3PromptDrafts.test.js 2>/dev/null || cd backend-node && node --test test/h3DraftWorkflowBinding.test.js test/h3PromptDraftService.test.js test/h3DraftGating.test.js`
Expected: 新测试 PASS，存量不回归（若 storyboards 草稿路由测试文件名不同，以 `ls test | grep -i draft` 实际为准）

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/db/migrate.js backend-node/src/services/h3PromptDraftService.js backend-node/src/services/unifiedVideoGenerationService.js backend-node/src/routes/storyboards.js backend-node/test/h3DraftWorkflowBinding.test.js
git commit -m "feat: bind h3 prompt drafts to workflow and gate mismatches"
```

---

### Task 5: aiConfig 测试连接支持指定工作流

**Files:**
- Modify: `backend-node/src/routes/aiConfig.js:117-141`（`testConnection` comfyui 分支）
- Test: `backend-node/test/aiConfigComfyuiVideo.test.js`（扩展）

**Interfaces:**
- Produces: 测试连接 body 可带 `workflow`（string），优先于 `model[0]` 作为被校验工作流。

- [ ] **Step 1: Write the failing test**（在 `aiConfigComfyuiVideo.test.js` 追加用例）

```js
it('tests the explicitly provided workflow instead of model[0]', async () => {
  const calls = [];
  const route = aiConfigRoutes(db, log, cfg, { providerRegistry: { get: () => ({ async testConnection(context) { calls.push(context.model); return { output: {} }; } }) } });
  await route.testConnection(makeReqRes({ base_url: 'http://127.0.0.1:8188', provider: 'comfyui', model: ['minimax_h3_director_r2v'], workflow: 'h3_ercai_u06' }));
  assert.equal(calls[0], 'h3_ercai_u06');
});
```

（`makeReqRes` 按该测试文件现有 helper 风格构造 req/res。）

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-node && node --test test/aiConfigComfyuiVideo.test.js`
Expected: 新用例 FAIL（收到 `minimax_h3_director_r2v`）

- [ ] **Step 3: Write minimal implementation**

```js
const model = Array.isArray(body.model) ? body.model[0] : body.model;
const workflow = String(body.workflow || '').trim() || model;
const result = await providerRegistry.get('comfyui').testConnection({
  base_url: body.base_url,
  model: workflow,
  config: { settings },
  input: { width: settings.width, height: settings.height },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-node && node --test test/aiConfigComfyuiVideo.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/routes/aiConfig.js backend-node/test/aiConfigComfyuiVideo.test.js
git commit -m "feat: comfyui connection test accepts explicit workflow"
```

---

### Task 6: 前端 — 生成面板工作流下拉 + 草稿/判定带工作流

**Files:**
- Modify: `frontweb/src/api/h3Draft.js`（三方法可选 workflowId）
- Modify: `frontweb/src/api/videos.js`（新增 `workflowCatalog()`）
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue:377-379`（wrapper 透传第三参）
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`（workflowOptions/onWorkflowChange/loadH3Draft/compileH3Draft/isH3Config）
- Modify: `frontweb/src/utils/videoModeCompatibility.js`（`isH3ComfyUiConfig(cfg, workflowMeta?)`）
- Test: `frontweb/test/videoModeCompatibility.test.js`（扩展）、`frontweb/test/videoGenerationPanel.test.js`（扩展）

**Interfaces:**
- Consumes: capabilities `workflows[]`（Task 2 形状：`{id,status,variant,adapter,capabilities,default,h3,unavailableReason?}`）、草稿端点 `workflow_id`（Task 4）。
- Produces:
  - `isH3ComfyUiConfig(cfg, workflowMeta)`：workflowMeta 非空时用 `workflowMeta.h3`（回退 adapter/family），否则旧名匹配。
  - panel：`workflowOptions` computed、`onWorkflowChange(id)`、H3 草稿调用带 `form.workflowId`。

- [ ] **Step 1: Write the failing tests**

`videoModeCompatibility.test.js` 追加：

```js
it('prefers workflow metadata over name matching', () => {
  assert.equal(isH3ComfyUiConfig({ provider: 'comfyui', default_model: 'h3_ercai_u06' }, { h3: false }), false);
  assert.equal(isH3ComfyUiConfig({ provider: 'comfyui', default_model: 'whatever' }, { h3: true }), true);
  assert.equal(isH3ComfyUiConfig({ provider: 'comfyui', default_model: 'minimax_h3_director_r2v' }), true); // 回退
});
```

`videoGenerationPanel.test.js` 追加（沿用该文件现有 panel 组装方式）：

```js
it('exposes workflow options and reloads the h3 draft when switching workflows', async () => {
  // capabilities 返回 workflows: [官方(default,h3:true), 二采(h3:false)]
  // 断言 panel.workflowOptions 长度 2、默认 form.workflowId=官方 id；
  // 切换 onWorkflowChange('h3_ercai_u06') 后 getH3Draft 收到第三参 'h3_ercai_u06'；
  // buildVideoCandidateRequest 输出 structured.workflowId === 'h3_ercai_u06'。
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontweb && node --test test/videoModeCompatibility.test.js test/videoGenerationPanel.test.js`
Expected: 新用例 FAIL

- [ ] **Step 3: Write minimal implementation**

```js
// videoModeCompatibility.js
export function isH3ComfyUiConfig(cfg, workflowMeta = null) {
  if (workflowMeta && typeof workflowMeta === 'object') {
    if (typeof workflowMeta.h3 === 'boolean') return workflowMeta.h3
    if (workflowMeta.adapter || workflowMeta.family === 'h3_director') return true
    if (workflowMeta.id || workflowMeta.status) return false // 有元数据但非 H3
  }
  const provider = String(cfg?.provider || '').trim().toLowerCase()
  const model = videoModelNameFromConfig(cfg).toLowerCase()
  return provider === 'comfyui' && (model === 'h3-continuity-v1' || model.includes('minimaxh3') || model.includes('minimax-h3'))
}

// h3Draft.js
getDraft(storyboardId, videoConfigId, workflowId) {
  const params = { video_config_id: videoConfigId }
  if (workflowId) params.workflow_id = workflowId
  return request.get(`/storyboards/${storyboardId}/h3-prompt-draft`, { params })
},
compileDraft(storyboardId, videoConfigId, workflowId) {
  const body = { video_config_id: videoConfigId }
  if (workflowId) body.workflow_id = workflowId
  return request.post(`/storyboards/${storyboardId}/h3-prompt-draft/compile`, body)
},

// videos.js
workflowCatalog() { return request.get('/videos/workflows') },

// useVideoGenerationPanel.js
const workflowOptions = computed(() => {
  const list = Array.isArray(capabilities.value?.workflows) ? capabilities.value.workflows : []
  return list
    .filter((w) => w.status !== 'unavailable' && w.status !== 'invalid')
    .map((w) => ({
      value: w.id,
      label: w.variant ? `${w.id}（${w.variant}）` : w.id,
      default: Boolean(w.default),
      h3: Boolean(w.h3),
    }))
})
const workflowMeta = computed(() => {
  const list = Array.isArray(capabilities.value?.workflows) ? capabilities.value.workflows : []
  return list.find((w) => w.id === form.workflowId) || null
})
// isH3Config 改为：isH3ComfyUiConfig(defaultConfig.value, workflowMeta.value || capabilities.value?.workflow || null)
function onWorkflowChange(workflowId) {
  form.workflowId = trimmed(workflowId)
  void loadH3Draft() // 切工作流即按新工作流取草稿（内部 requestVersion 防竞态）
}
// loadH3Draft/compileH3Draft 调用改传第三参 trimmed(form.workflowId)
// 导出增加：workflowOptions, onWorkflowChange
```

`VideoGenerationPanel.vue` 模板在 H3/参数区上方加（仅多工作流时显示）：

```vue
<el-form-item v-if="workflowOptions.length > 1" label="工作流">
  <el-select :model-value="form.workflowId" style="width: 100%" @change="onWorkflowChange">
    <el-option v-for="w in workflowOptions" :key="w.value" :label="w.label" :value="w.value" />
  </el-select>
</el-form-item>
```

- [ ] **Step 4: Run tests**

Run: `cd frontweb && node --test test/videoModeCompatibility.test.js test/videoGenerationPanel.test.js test/videoGenerationPanelRestore.test.js`
Expected: PASS（存量不回归）

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/api/h3Draft.js frontweb/src/api/videos.js frontweb/src/components/video/VideoGenerationPanel.vue frontweb/src/composables/useVideoGenerationPanel.js frontweb/src/utils/videoModeCompatibility.js frontweb/test/videoModeCompatibility.test.js frontweb/test/videoGenerationPanel.test.js
git commit -m "feat: workflow selector in video panel with per-workflow h3 drafts"
```

---

### Task 7: 前端 — AI 配置页 ComfyUI 工作流目录多选

**Files:**
- Modify: `frontweb/src/utils/aiConfigVideoProvider.js`（新增目录派生 helper）
- Modify: `frontweb/src/components/AIConfigContent.vue:1420`（comfyui 预置 models 不再作为唯一来源）、`:573-586`（comfyui 工作流选择区）
- Test: `frontweb/test/aiConfigVideoProvider.test.js`（扩展）

**Interfaces:**
- Consumes: `videosAPI.workflowCatalog()`（Task 6）。
- Produces:
  - `comfyuiWorkflowOptionsFromCatalog(catalog)` → `[{ value, label, disabled }]`（`configured` 标注"（实验）"，`invalid` 不返回）。
  - `normalizeComfyuiModelSelection(selected, defaultModel)` → `{ model: [...], default_model }`（default 不在选中集合时取第一个）。

- [ ] **Step 1: Write the failing tests**（`aiConfigVideoProvider.test.js` 追加）

```js
it('derives workflow options from the backend catalog', () => {
  const options = comfyuiWorkflowOptionsFromCatalog({ workflows: [
    { id: 'minimax_h3_director_r2v', status: 'verified', variant: 'official_sage' },
    { id: 'h3_ercai_u06', status: 'configured', variant: 'ercai_lightx2v' },
    { id: 'broken', status: 'invalid' },
  ] })
  assert.equal(options.length, 2)
  assert.equal(options[0].label, 'minimax_h3_director_r2v（official_sage）')
  assert.match(options[1].label, /实验/)
})
it('keeps default_model inside the selected model list', () => {
  assert.deepEqual(normalizeComfyuiModelSelection(['a', 'b'], 'c'), { model: ['a', 'b'], default_model: 'a' })
  assert.deepEqual(normalizeComfyuiModelSelection(['a', 'b'], 'b'), { model: ['a', 'b'], default_model: 'b' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontweb && node --test test/aiConfigVideoProvider.test.js`
Expected: 新用例 FAIL（函数不存在）

- [ ] **Step 3: Write minimal implementation**

```js
// aiConfigVideoProvider.js 追加
export function comfyuiWorkflowOptionsFromCatalog(catalog) {
  const workflows = Array.isArray(catalog?.workflows) ? catalog.workflows : []
  return workflows
    .filter((w) => w && w.status && w.status !== 'invalid' && w.status !== 'unavailable')
    .map((w) => ({
      value: w.id,
      label: w.variant ? `${w.id}（${w.variant}${w.status === 'configured' ? '，实验' : ''}）` : `${w.id}${w.status === 'configured' ? '（实验）' : ''}`,
      disabled: false,
    }))
}

export function normalizeComfyuiModelSelection(selected, defaultModel) {
  const model = (Array.isArray(selected) ? selected : [selected]).map((x) => String(x || '').trim()).filter(Boolean)
  const fallback = model[0] || ''
  const normalizedDefault = model.includes(String(defaultModel || '')) ? String(defaultModel) : fallback
  return { model, default_model: normalizedDefault }
}
```

`AIConfigContent.vue`：

1. provider 预置第 1420 行保留 `models: ['minimax_h3_director_r2v']` 作为目录接口失败时的兜底。
2. 打开编辑对话框（comfyui video）或 provider 切到 comfyui 时调用 `videosAPI.workflowCatalog()` 存入 `comfyuiWorkflowCatalog` ref；目录为空时回退 `availableModels`。
3. comfyui 表单区（573-586 行附近）：`default_model` 单选下拉改为「工作流多选 `form.modelSelection`（el-select multiple）+ 默认工作流下拉（选项=已选集合）」；保存 payload 时 `model: normalizeComfyuiModelSelection(form.modelSelection, form.default_model).model`、`default_model` 同理；编辑回填 `form.modelSelection = row.model`。
4. 测试连接按钮把当前 `form.default_model` 作为 `workflow` 传给 `/ai-configs/test-connection`。

- [ ] **Step 4: Run tests**

Run: `cd frontweb && node --test test/aiConfigVideoProvider.test.js && npm run build`
Expected: PASS + 构建成功

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/utils/aiConfigVideoProvider.js frontweb/src/components/AIConfigContent.vue frontweb/test/aiConfigVideoProvider.test.js
git commit -m "feat: comfyui channel workflow selection from backend catalog"
```

---

### Task 8: registerComfyWorkflow 辅助脚本

**Files:**
- Create: `backend-node/scripts/registerComfyWorkflow.js`
- Test: `backend-node/test/registerComfyWorkflow.test.js`

**Interfaces:**
- Produces: `buildRegistryEntry(workflow, { id, family, adapter, variant })` → entry 对象（status `'configured'`、`workflowSha256: 'sha256:<hex>'`、requiredNodes=全部 class_type、modelFiles/customNodes 空数组骨架、provenance/runtimeLock 占位字段按治理校验要求的字段名生成、附 `_hints` 说明数组）；CLI：`node scripts/registerComfyWorkflow.js <api.json> --id <id> [--family] [--adapter] [--variant]`（stdout 输出 entry JSON）。

- [ ] **Step 1: Write the failing test**

```js
// backend-node/test/registerComfyWorkflow.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRegistryEntry } = require('../scripts/registerComfyWorkflow');

const workflow = { prompt: { '1': { class_type: 'UNETLoader', inputs: {} }, '2': { class_type: 'MiniMaxH3Director', inputs: {} } } };

describe('buildRegistryEntry', () => {
  it('builds a configured entry with sha, nodes and governance placeholders', () => {
    const entry = buildRegistryEntry(workflow, { id: 'h3_ercai_u06', family: 'h3_director' });
    assert.equal(entry.id, 'h3_ercai_u06');
    assert.equal(entry.status, 'configured');
    assert.match(entry.workflowSha256, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(entry.requiredNodes.sort(), ['MiniMaxH3Director', 'UNETLoader'].sort());
    assert.equal(entry.family, 'h3_director');
    assert.ok(entry.provenance && entry.runtimeLock);
    assert.ok(Array.isArray(entry._hints) && entry._hints.length > 0);
  });
  it('throws for non-api-format workflow', () => {
    assert.throws(() => buildRegistryEntry({ nodes: {} }, { id: 'x' }), /API/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-node && node --test test/registerComfyWorkflow.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```js
// backend-node/scripts/registerComfyWorkflow.js
'use strict';
const crypto = require('node:crypto');

// 从 ComfyUI API 格式工作流生成 director-workflows.json 的 entry 骨架。
// 输出 status='configured'（实验门禁），SHA/节点清单自动推导；provenance/runtimeLock
// 为必填占位，需人工补齐后才能改 'verified'。
function buildRegistryEntry(workflow, { id, family = null, adapter = null, variant = null } = {}) {
  if (!workflow || typeof workflow !== 'object' || !workflow.prompt || typeof workflow.prompt !== 'object') {
    throw new Error('workflow must be ComfyUI API format with a prompt object');
  }
  if (!String(id || '').trim()) throw new Error('id is required');
  const classTypes = [...new Set(Object.values(workflow.prompt).map((n) => n && n.class_type).filter(Boolean))];
  const sha256 = `sha256:${crypto.createHash('sha256').update(JSON.stringify(workflow)).digest('hex')}`;
  const entry = {
    id: String(id).trim(),
    status: 'configured',
    workflowPath: `workflows/${String(id).trim()}.json`, // 提示：把 API JSON 复制到该路径
    workflowSha256: sha256, // 注意：loadRegistry 校验的是文件内容哈希，落盘后请用文件实际哈希
    ...(family ? { family } : {}), ...(adapter ? { adapter } : {}), ...(variant ? { variant } : {}),
    requiredNodes: classTypes,
    modelFiles: [], // 待补：如 diffusion_models/xxx.safetensors 的文件名
    customNodes: [], // 待补：非 ComfyUI 内置节点的包名
    inputSchema: { common: ['prompt', 'negativePrompt', 'width', 'height', 'durationSeconds', 'frameRate', 'seed'] },
    provenance: { provider: 'TODO', modelFamily: 'TODO', source: 'TODO', license: { status: 'review_required', evidence: 'TODO' } },
    runtimeLock: { comfyUIVersion: 'TODO', models: [], customNodes: [] },
    _hints: [
      '把工作流 JSON 复制到 configs/workflows/ 并核对 workflowSha256（loadRegistry 按文件内容校验）',
      '补齐 provenance/runtimeLock（治理校验必填），verified 还需 verifiedEvidence 文件',
      'modelFiles 填 ComfyUI 模型目录中的必需模型文件名，customNodes 填自定义节点包名',
      '工作流加入通道：AI 配置 → ComfyUI 通道 → 工作流列表勾选，可设为默认',
    ],
  };
  return entry;
}

function main() {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) { console.error('usage: node scripts/registerComfyWorkflow.js <api.json> --id <id> [--family f] [--adapter a] [--variant v]'); process.exit(1); }
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) flags[String(rest[i]).replace(/^--/, '')] = rest[i + 1];
  const workflow = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  console.log(JSON.stringify(buildRegistryEntry(workflow, flags), null, 2));
}
if (require.main === module) main();
module.exports = { buildRegistryEntry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-node && node --test test/registerComfyWorkflow.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend-node/scripts/registerComfyWorkflow.js backend-node/test/registerComfyWorkflow.test.js
git commit -m "feat: registerComfyWorkflow helper script for new workflow entries"
```

---

### Task 9: 全量验证

**Files:** 无新增（只运行验证）。

- [ ] **Step 1: 后端全量测试**

Run: `cd backend-node && node --test test/*.test.js`
Expected: 全部 PASS（关注新增 5 个文件 + 存量 draft/gating/capabilities/provider 套件）

- [ ] **Step 2: 前端全量测试 + 构建**

Run: `cd frontweb && node --test test/*.test.js && npm run build`
Expected: 全部 PASS + 构建成功

- [ ] **Step 3: 冒烟检查（不启动 ComfyUI）**

Run: `cd backend-node && node -e "const {loadRegistry}=require('./src/director/workflowRegistry'); const r=loadRegistry('./configs/director-workflows.json'); console.log(r.workflows.map(w=>w.id+':'+w.status).join(', '))"`
Expected: 现有两条工作流正常加载（本任务不新增注册表条目）

- [ ] **Step 4: 更新任务清单并汇报**

汇报内容包含：现状分析结论、设计决策（方案 A）、实现清单、测试结果、二采工作流接入步骤摘要。
