# Production Studio V2.1 Personal Creator Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved personal-creator progressive-disclosure design to the unified V2.1 prototype, promote ChatGPT Web to a configurable default core image channel, and align all authoritative specifications and acceptance rules.

**Architecture:** Keep all new behavior deterministic and dependency-free in the unified UMD prototype model. The HTML renders user-facing language and reversible interactions from that model; existing product code is only evidence for migration feasibility. Internal Revision/Gate/Attempt semantics remain strict while default UI exposes natural creator language.

**Tech Stack:** HTML, CSS, browser JavaScript, CommonJS/UMD, Node.js built-in test runner, Markdown

**Spec:** `docs/superpowers/specs/2026-09-09-production-studio-v2.1-personal-creator-simplification-design.md`

## Global Constraints

- Modify specifications, prototype model, prototype HTML and prototype tests only; do not modify `frontweb/src`, `backend-node/src`, databases, browser extensions or real Provider state.
- ChatGPT Web is a Product Core first-class optional image channel and may be the global or project default; it is never the only channel or a blocking Product Core Gate.
- Resolution order is one-shot override → project default → global default → install default; every created task freezes resolved channel and runtime owner.
- An unavailable ChatGPT environment must not silently change the persisted default. Offer recovery or a one-shot API/ComfyUI fallback.
- Reuse the current product's environment-diagnostics, queue, attempt, recovery and rebind semantics as migration evidence; do not claim that V2.1 product code is implemented.
- Every ChatGPT result enters candidates first. V2.1 must not auto-select the first result or overwrite current media.
- The default Rail is Projects, Library, Tasks and Settings. Quick Create is under More Tools; Canvas is entered from stage-level Advanced Mode.
- User-facing project sections are Overview, Episodes, Project Materials and Project Settings. Episode stages are Script, Episode Materials, Storyboard and Final Cut.
- Keep the confirmed Phase 1–5 internal validation and Phase 6 single cutover. Do not add runtime V1/V2 feature flags, dual writes, old-route fallback or a long-lived compatibility API.
- Do not update `CHANGELOG.md`; no shipped product behavior changes in this plan.
- Preserve unrelated dirty-worktree changes and do not commit.

---

### Task 1: Establish failing personal-experience contract tests

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Consumes: existing route registry, AI settings, global task, source, episode-assets and Cut models.
- Produces: executable contracts for the new task route, navigation, terminology, source grouping, ChatGPT defaults/environment and implicit Picture Lock.

- [ ] **Step 1: Add failing navigation and terminology tests**

Add assertions equivalent to:

```js
const routes = model.buildPrototypeRouteRegistry();
assert.ok(routes.some(item => item.id === 'tasks'));
assert.deepEqual(model.getProductNavigationModel().map(item => item.id),
  ['projects', 'library', 'tasks', 'settings']);
assert.deepEqual(model.getProjectSectionNavigation('7').map(item => item.label),
  ['概览', '剧集', '项目素材', '项目设置']);
assert.deepEqual(model.getEpisodeStageNavigation('7', '1').map(item => item.label),
  ['剧本', '本集素材', '分镜', '成片']);
```

Assert that Quick Create and Canvas are reachable from auxiliary/stage entry models but absent from the default Rail.

- [ ] **Step 2: Add failing source and episode-material tests**

Assert `getEpisodeCreationSourceGroups()` exposes exactly three primary cards—`script-import`, `package-import`, `blank`—and puts AI script, novel split and source video in `more`. Assert external AI collaboration is a secondary action inside package import. Assert the default episode-material model exposes inherited counts plus only overrides, missing items, invalid references and blockers in its review list.

- [ ] **Step 3: Add failing ChatGPT default and environment tests**

Add table-driven tests for:

```js
resolveDefaultImageChannel({ oneShot:'api', projectDefault:'chatgpt_web', globalDefault:'comfyui', installDefault:'api' }).channel === 'api'
resolveDefaultImageChannel({ projectDefault:'chatgpt_web', globalDefault:'comfyui', installDefault:'api' }).channel === 'chatgpt_web'
resolveDefaultImageChannel({ globalDefault:'chatgpt_web', installDefault:'api' }).channel === 'chatgpt_web'
```

Assert ready, login-required and bridge-offline environment models; the latter two preserve `persistedDefault='chatgpt_web'`, expose recovery, and allow a one-shot fallback without persisting it. Assert setting ChatGPT as global/project default performs a zero-cost environment check.

- [ ] **Step 4: Add failing task-center and Cut-language tests**

Assert `getTaskCenterModel({projectId:'7', focusTaskId:'task-shot-03-image'})` returns project-filtered groups and preserves credible progress rules. Assert the default Cut primary action is `开始合片`, failing Video Gate disables it, confirmation copy explains that current editing is fixed, and successful transition creates internal Picture Lock/Base Composite lineage while the default UI calls it a new final-cut version.

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```powershell
node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs
```

Expected: failures name the missing task route/models and old labels; existing tests continue to run.

### Task 2: Implement navigation, terminology and source grouping models

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Test: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Produces: `getProductNavigationModel()`, `getEpisodeStageNavigation(projectId, episodeId)`, `getAuxiliaryToolEntries(context)` and `getEpisodeCreationSourceGroups()`.

Use these exact presentation shapes:

```js
const PRODUCT_NAV = [
  { id:'projects', label:'项目', routeId:'projects' },
  { id:'library', label:'资产库', routeId:'library' },
  { id:'tasks', label:'任务', routeId:'tasks' },
  { id:'settings', label:'设置', routeId:'settings-ai' },
];

function getEpisodeCreationSourceGroups() {
  return {
    primary: [
      { id:'script-import', label:'导入或粘贴剧本' },
      { id:'package-import', label:'导入制作包', secondaryAction:'start-external-ai-collaboration' },
      { id:'blank', label:'空白创建' },
    ],
    more: ['ai-script', 'novel-split', 'source-video'],
  };
}
```

- [ ] **Step 1: Register the task page**

Add route `tasks` at `#/tasks` with scenarios `default`, `project-filtered`, `login-required`, `capture-recovery`, `empty` and `offline`. Update `formatPrototypeLocation`/parsing through the existing registry pattern.

- [ ] **Step 2: Add product and stage navigation models**

Return the exact default Rail sequence Projects, Library, Tasks, Settings. Keep Quick Create in a More Tools model and Canvas in stage-level Advanced Mode targets. Change project labels/order to Overview, Episodes, Project Materials, Project Settings and episode labels to Script, Episode Materials, Storyboard, Final Cut while keeping stable route IDs.

- [ ] **Step 3: Group the six source capabilities**

Keep all existing source IDs and safe creation flows, but add a presentation model with three primary cards and three More entries. Package import must expose secondary action `start-external-ai-collaboration`; it must not merge Episode Package and External AI Result schemas.

- [ ] **Step 4: Run the focused test**

Run the Task 1 command. Expected: navigation, terminology and grouping tests pass; ChatGPT/task/Cut tests remain red.

### Task 3: Implement ChatGPT defaults and environment preflight models

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html`
- Test: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Produces: `resolveDefaultImageChannel(settings)`, `getImageChannelSettingsModel(scope, scenarioId)`, `getChatGptEnvironmentModel(scenarioId)` and prototype transitions `set-global-default`, `set-project-default`, `use-one-shot-fallback`, `retry-environment`.

Implement the resolver as a pure function returning both value and provenance:

```js
function resolveDefaultImageChannel({ oneShot, projectDefault, globalDefault, installDefault = 'api' } = {}) {
  const valid = new Set(['chatgpt_web', 'api', 'comfyui']);
  for (const [source, value] of [['one-shot', oneShot], ['project', projectDefault], ['global', globalDefault], ['install', installDefault]]) {
    if (valid.has(value)) return { channel:value, source };
  }
  return { channel:'api', source:'install' };
}
```

Environment models use one contract:

```js
{
  channel: 'chatgpt_web',
  readiness: 'ready' | 'needs_action' | 'unavailable',
  persistedDefault: 'chatgpt_web',
  checks: [{ id, label, status:'passed'|'failed', recoveryAction }],
  canSubmit: boolean,
  oneShotFallbacks: ['api', 'comfyui'],
  changesPersistedDefault: false,
  generationCost: 0,
}
```

- [ ] **Step 1: Implement deterministic channel resolution**

Accept only `chatgpt_web`, `api` and `comfyui`. Resolve one-shot → project → global → install and return both channel and source scope. Invalid configured values fall through to the next valid scope; created task examples copy the resolved value into an immutable task snapshot.

- [ ] **Step 2: Model environment checks**

Expose channel enabled, browser executable/Profile, Bridge, login/session and result-capture checks. `ready` may submit; `login-required` and `bridge-offline` may not submit, preserve defaults and expose one recovery action plus one one-shot fallback. Explicitly state zero generation cost.

- [ ] **Step 3: Update AI configuration UI**

Add global-default radio/select controls and per-project override preview. ChatGPT card shows “可设为默认”, environment summary and “检测环境”. The default change interaction first displays check results and then saves the chosen default; unavailable state allows “仍保存为默认并稍后修复” only when the user explicitly confirms, otherwise cancel.

- [ ] **Step 4: Update asset/storyboard generation controls**

Primary buttons read `使用 ChatGPT 生成` when resolved default is ChatGPT. Split menu offers API/ComfyUI and explicit set-as-project/global-default actions. Environment failure opens recovery/fallback UI; fallback is tagged “仅本次”. Generated results remain candidates.

- [ ] **Step 5: Run the focused test**

Expected: default/environment tests and existing candidate-history tests pass.

### Task 4: Add the unified task page and project-scoped entry

**Files:** same model, HTML and test files as Task 3.

**Interfaces:**
- Produces: `getTaskCenterModel(filters, scenarioId)` and `renderTaskCenter(...)`.
- Consumes: `getGlobalTaskModel`, credible progress semantics and stable task IDs.

The model must preserve this creator-facing/technical split:

```js
{
  filters: { projectId:null, episodeId:null, type:null, channel:null, focusTaskId:null },
  groups: [
    { id:'in-progress', label:'进行中', tasks:[] },
    { id:'needs-action', label:'需要处理', tasks:[] },
    { id:'completed', label:'已完成', tasks:[] },
  ],
  task: {
    id:'task-shot-03-image', title:'镜头 03 · 图片候选', creatorStatus:'等待网页结果',
    elapsed:'1分08秒', estimate:'历史通常 1–3 分钟', primaryAction:'打开网页会话',
    technical: { lifecycle:'waiting_external', attemptId:'attempt-7', fingerprint:'sha256:…', providerStatus:'submitted' },
  },
}
```

- [ ] **Step 1: Build task-center grouping and filters**

Groups are In Progress, Needs Attention and Completed. Filters are project, episode, type and channel. Rows expose creator-facing status, elapsed/historical time and one primary action; raw lifecycle, attempt, fingerprint and Provider diagnostics stay in Technical Details.

- [ ] **Step 2: Render the global task page**

Add full-page route rendering, filter chips, focused task highlight and environment recovery states. Capability-derived actions only: recover capture/rebind for ChatGPT, cancel where supported, retry from frozen input, no fake pause/reorder.

- [ ] **Step 3: Connect project task summaries**

Project overview task blockers navigate to `#/tasks?project=7&focus=...`; task filters must survive refresh. Remove the old product-facing global task-only drawer as the primary entry, but retain a compact drawer/technical detail opened from the page.

- [ ] **Step 4: Run the focused test**

Expected: task-center tests and existing credible-progress tests pass.

### Task 5: Simplify Project Settings, Episode Materials and default terminology

**Files:** same model, HTML and test files as Task 3.

**Interfaces:**
- Modifies: `getProjectBibleModel`, `getEpisodeAssetsStageModel`, their renderers and shared route labels.

The default Episode Materials result must be delta-first:

```js
{
  inheritedSummary: { ready:6, total:7, collapsed:true },
  reviewItems: [
    { kind:'version-difference', targetId:'linxia-hotel', action:'比较并选择' },
    { kind:'missing-required-voice', targetId:'manager-voice', action:'配置音色' },
  ],
  fullInheritedListEntry: { label:'查看全部继承素材', secondary:true },
  snapshot: { immutable:true, hiddenFromDefaultCopy:true },
}
```

- [ ] **Step 1: Move external AI actions into a collaboration card**

Project Settings header no longer has the sole primary action “生成外部 AI 上下文”. Render a card with “生成协作上下文/更新协作上下文” and “创建本集协作任务”; preserve existing flow targets and zero-cost context generation.

- [ ] **Step 2: Make Episode Materials delta-first**

Show inherited-ready counts as one collapsed summary. The default review list contains only new objects, project-default differences, missing media, conditional voice blockers and invalid references. “查看全部继承素材” is secondary; editing/generation routes to exact Project Material objects.

- [ ] **Step 3: Replace internal terminology in default surfaces**

Use 草稿/已确认剧本, 需要更新, 生成前检查, 候选, 当前使用, 固定当前剪辑, 成片版本 and 技术详情. Preserve internal IDs and place Revision/Gate/hash/fingerprint in technical drawers only.

- [ ] **Step 4: Run the focused test**

Expected: episode-material and terminology tests pass without weakening immutable snapshot assertions.

### Task 6: Make “Start Composite” the natural Picture Lock interaction

**Files:** same model, HTML and test files as Task 3.

**Interfaces:**
- Modifies: `getCutStageModel`, Cut rendering and Picture Lock transition copy.

Keep the user action and internal facts distinct:

```js
{
  primaryAction: { id:'start-composite', label:'开始合片', enabled:false, blockers:[] },
  confirmation: '开始后将固定当前剪辑；之后修改镜头会产生新版本。',
  internalCommit: ['timeline-revision', 'picture-lock', 'base-composite'],
  successLanding: { label:'成片版本正在生成', technicalDetailsAvailable:true },
}
```

- [ ] **Step 1: Rename the primary operation**

Replace default “Picture Lock/锁定画面” CTA with “开始合片”. Keep the existing 6/9 adopted and encode-validation blockers. Technical detail may show Picture Lock.

- [ ] **Step 2: Add confirmation and success landing**

Confirmation says starting will fix the current edit and later visual changes create a new version. Success creates internal Picture Lock and Base Composite, then lands on Final Cut version progress. Skipping upscale remains allowed; base MP4 export depends on base composite and encode validation, not upscale.

- [ ] **Step 3: Run the focused test**

Expected: all Cut-language, Gate and base-composite tests pass.

### Task 7: Align the authoritative design and acceptance set

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-production-studio-v2-design.md`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-page-review-decision-log.md`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-interaction-flow-contracts.md`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-legacy-feature-migration-matrix.md`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md`
- Modify: `docs/vnext/production-studio-v2.1-design-review.md`

**Interfaces:**
- Consumes: the approved personal-creator spec and verified prototype semantics.
- Produces: one non-contradictory authority set with Product Core/Platform P0 separation.

- [ ] **Step 1: Record replacement decisions**

Add stable decisions for navigation, naming, source grouping, delta-first Episode Materials, implicit Picture Lock, Quick/Canvas entry demotion, Product Core/Platform P0 and ChatGPT default/environment/task-center behavior. Mark superseded decisions as replaced rather than silently editing history.

- [ ] **Step 2: Update architecture and UI contracts**

Use creator language for visible UI while retaining internal domain names. Add task route and filter contracts, ChatGPT resolution/preflight/fallback rules, environment checks and no-auto-current rule. Keep the Phase 6 cutover language unchanged.

- [ ] **Step 3: Update migration and E2E mappings**

Keep 52 legacy capability IDs unique while remapping task-center UI where needed. Preserve 78 unique E2E IDs; expand existing A-G01/A-G03/A-J01 and Product Core journeys instead of inventing duplicate acceptance rows. Ensure Quick/Canvas remain retained but are not Rail entries or Product Core blockers.

- [ ] **Step 4: Correct the design review conclusion**

Record that the personal-creator critique is adopted for progressive disclosure, but its runtime dual-track recommendation remains rejected. Promote ChatGPT Web from non-essential to configurable-default Product Core channel and distinguish existing reusable implementation from new V2.1 UI completion.

### Task 8: Complete prototype and documentation verification

**Files:**
- Modify if needed: the model, HTML, test and seven documentation files listed above.

**Interfaces:**
- Produces: evidence for route, scenario, feature and E2E counts plus browser-visible acceptance.

- [ ] **Step 1: Run all prototype tests**

```powershell
node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs docs/research/localminidrama-product-baseline/production-studio-v2.1-project-hub-prototype.test.cjs docs/research/localminidrama-product-baseline/production-studio-v2.1-prototype.test.cjs
```

Require zero failures and report the exact test count.

- [ ] **Step 2: Parse the inline browser script and count contracts**

Use Node `vm.Script` to syntax-check the unified inline script. Assert 18 registered routes including Tasks, 52 unique capability mappings, zero unknown mapped routes and 78 unique E2E rows.

- [ ] **Step 3: Browser-inspect every default route and high-risk scenario**

Inspect all 18 default routes plus ChatGPT ready/login-required/bridge-offline, project-filtered tasks, grouped source picker, delta-first Episode Materials and Start Composite blocked/success cases. Each view must have an H1, no review placeholder, no console error and a visible recovery/success landing where applicable.

- [ ] **Step 4: Check documentation integrity**

Check all relative links in the modified authority set, scan for stale 17-route/default-Rail/six-flat-source/visible-Picture-Lock statements, and run `git diff --check`. Do not update CHANGELOG and do not commit.
