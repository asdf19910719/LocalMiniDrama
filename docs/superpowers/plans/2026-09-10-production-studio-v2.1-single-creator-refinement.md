# Production Studio V2.1 单人创作者收敛改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将统一可交互原型收敛为单人完成一集成片的工作流：移除项目设置投影、统一剧集创建、简化设定管理，并让分镜页始终可进入而只在媒体生成前校验。

**Architecture:** 原型仍以 `production-studio-v2.1-full-prototype-model.js` 作为唯一交互状态源，HTML 只根据模型渲染页面、Drawer、Modal 和本地演示状态。本轮不删除既有领域事实；新增的是更少的用户投影和更精确的“可导航”与“可生成”两类访问状态。原型测试先锁定新的投影合同，再更新渲染和事件处理。

**Tech Stack:** Node.js built-in test runner、CommonJS 状态模型、单文件 HTML/CSS/原生 JavaScript 原型、Markdown 规格。

**Spec:** `docs/superpowers/specs/2026-09-10-production-studio-v2.1-single-creator-refinement-design.md`

## Global Constraints

- 仅修改 `docs/research/` 与 `docs/superpowers/`、`docs/vnext/` 中的原型和文档；禁止修改 `src/`、`frontweb/`、`backend-node/`、真实 API、数据库或 Provider。
- 保留已有任务、候选、版本、包校验、快照和恢复领域语义；默认 UI 不展示多余技术术语。
- 允许进入分镜不等于允许提交图片或视频生成；所有会产生媒体或费用的动作仍需已确认剧本和有效素材快照。
- 删除只改变用户投影为“删除”；原型仍表达可恢复删除和引用保护，禁止模拟物理硬删除。
- 只暂存和提交本轮明确修改的文件，绝不夹带工作区已有未提交修改。
- 每个任务完成后运行其指定测试；最终运行完整原型测试和格式检查。

---

## 文件职责图

| 文件 | 本轮职责 |
|---|---|
| `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js` | 导航、页面模型、创建入口、外部 AI 向导、素材选择、非阻塞检查和媒体生成资格的唯一状态源。 |
| `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html` | 根据状态模型渲染项目概览、剧集、剧本、项目素材、本集设定、分镜提示，并绑定真实演示交互。 |
| `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs` | 对默认 UI 投影、导航、状态转换、入口保护和 HTML 标记做回归保护。 |
| `docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md` | 记录 UI 容器、页面状态、文案和可访问性规格。 |
| `docs/superpowers/specs/2026-09-08-production-studio-v2.1-page-review-decision-log.md` | 将旧页面裁决改为本轮最终决定，并标出被替换的过渡设计。 |
| `docs/vnext/production-studio-v2.1-design-review.md` | 将总体评审结论改为最新的单人工作流投影。 |

## Task 1: 收敛导航、路由投影与剧集状态模型

**Files:**

- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js: getProjectSectionNavigation, getEpisodeStageNavigation, buildProjectEpisodeRows, getProjectEpisodesModel`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs: navigation / episode-center test block near current tests 148–411`

**Interfaces:**

- Consumes: existing `getProjectSectionNavigation(projectId)`, `getEpisodeStageNavigation(projectId, episodeId)` and episode row `stages` projection.
- Produces: project navigation `['概览','剧集','项目素材']`; stage navigation `['剧本','设定','分镜','成片']`; each stage exposes `navigationAccess` separately from `mediaGenerationAccess`.

- [ ] **Step 1: Write a failing test for default navigation and independent generation access**

```js
test('单人创作者导航不再暴露项目设置，分镜可进入但未准备时不可生成媒体', () => {
  assert.deepEqual(
    model.getProjectSectionNavigation('7').map(item => item.label),
    ['概览', '剧集', '项目素材'],
  );
  assert.deepEqual(
    model.getEpisodeStageNavigation('7', '2').map(item => item.label),
    ['剧本', '设定', '分镜', '成片'],
  );
  const row = model.getProjectEpisodesModel('7').rows.find(item => item.episodeId === '2');
  assert.equal(row.stages.storyboard.navigationAccess, 'available');
  assert.equal(row.stages.storyboard.mediaGenerationAccess, 'blocked');
});
```

- [ ] **Step 2: Run the focused test to prove the old projection fails**

Run: `node --test --test-name-pattern "单人创作者导航不再暴露项目设置" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: FAIL because the current tabs include `项目设置`, the asset label is `本集素材`, and unopened storyboard rows use `access: 'locked'`.

- [ ] **Step 3: Change the state-model projection without deleting legacy facts**

```js
function toStageAccess({ canNavigate = true, canGenerateMedia = false, reason = '' } = {}) {
  return {
    navigationAccess: canNavigate ? 'available' : 'unavailable',
    mediaGenerationAccess: canGenerateMedia ? 'available' : 'blocked',
    reason,
  };
}
```

Remove `project-bible` from `getProjectSectionNavigation()`, change the visible stage label to `设定`, and apply `toStageAccess()` to each episode stage. Preserve `status`, `label`, `reason`, import provenance, and nonempty-target protection. Keep `project-bible` only as a legacy route alias that redirects to `project-overview` with the same `projectId`.

- [ ] **Step 4: Run focused navigation and episode-center tests**

Run: `node --test --test-name-pattern "单人创作者导航不再暴露项目设置|剧集中心|剧集阶段导航" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: PASS, with no default navigation test depending on `项目设置`.

- [ ] **Step 5: Inspect changes and commit only this task’s files**

Run: `git diff -- docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: only navigation and stage-access projection changes plus their tests.

Run: `git add -- docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Run: `git commit -m "refactor: simplify prototype navigation projection"`

## Task 2: 将项目资料和画面风格收敛到概览

**Files:**

- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js: getProjectOverviewModel, getProjectLookEditorModel, getProjectBibleModel`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html: renderProjectOverview, style selector / Drawer / Modal event handlers`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs: project overview and project settings tests near current tests 1613–1946`

**Interfaces:**

- Consumes: project overview `sections.projectLook` and existing style preset data.
- Produces: `projectProfile` Drawer model on overview; `projectStyleSelector` Modal model with `presets`, `mine`, `custom`; `project-bible` redirects rather than renders a page.

- [ ] **Step 1: Write failing model and HTML tests for overview ownership**

```js
test('项目概览承载项目资料和风格选择，不再渲染项目设置工作台', () => {
  const overview = model.getProjectOverviewModel('7');
  assert.deepEqual(overview.projectProfile.editableFields.map(field => field.id), [
    'name', 'cover', 'aspect-ratio', 'genre', 'description',
  ]);
  assert.equal(overview.projectStyleSelector.presentation, 'modal');
  assert.deepEqual(overview.projectStyleSelector.tabs.map(tab => tab.id), ['presets', 'mine', 'custom']);
  assert.doesNotMatch(html, /项目资料、画面风格与外部 AI/);
});
```

- [ ] **Step 2: Run the focused test to verify the legacy model fails**

Run: `node --test --test-name-pattern "项目概览承载项目资料和风格选择" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: FAIL because default duration/output preference and `project-bible` content still exist.

- [ ] **Step 3: Add compact profile editing and a visual style-selection Modal**

Add `projectProfile` to the overview model with name, cover, aspect ratio, genre and description only. Remove `defaultEpisodeDuration`, `outputPreference`, production object summary, and permanent external-AI context from default projection.

```js
projectStyleSelector: {
  presentation: 'modal',
  tabs: [
    { id: 'presets', label: '预设风格' },
    { id: 'mine', label: '我的风格' },
    { id: 'custom', label: '自定义风格' },
  ],
  currentStyle,
  selectedStyle,
  applyRule: '只影响之后的新生成或明确刷新',
}
```

Render “编辑项目” as a compact overview Drawer. Render style selection as a central large Modal with a pinned current card and a visual grid for the selected tab. A custom style’s fields live in the same Modal. Applying a style changes only the simulated current-style pointer and shows that existing media was preserved.

- [ ] **Step 4: Run overview and style regression tests**

Run: `node --test --test-name-pattern "项目概览|项目画面风格|项目设置" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: PASS with overview-owned interactions and no visible settings workbench.

- [ ] **Step 5: Manually inspect the overview**

Run: `Start-Process 'http://127.0.0.1:8765/production-studio-v2.1-full-prototype.html#/project-overview?projectId=7'`

Expected: Hero has “编辑项目”; style action opens a central selector; no project-settings tab appears.

- [ ] **Step 6: Commit the isolated task changes**

Run: `git add -- docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Run: `git commit -m "feat: move prototype project controls to overview"`

## Task 3: 合并普通剧集创建并建立独立外部 AI 向导

**Files:**

- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js: buildEpisodeCreationSources, getEpisodeCreationSourceGroups, getEpisodeCreationSourceTarget, getEpisodeCreationFlow, getProjectEpisodesModel, getExternalAiCollaborationTaskModel`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html: renderProjectEpisodes and creation/import event handlers`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs: episode creation/external AI tests near current tests 234–379 and 2434`

**Interfaces:**

- Consumes: `getEpisodeTargetSelectorModel()` and existing five-step package-import validation model.
- Produces: `getEpisodeCreationEntryModel(projectId)` with `newEpisode` and `importOrCollaborate`; `getExternalAiWizardModel(projectId, state)` with eight explicit steps; the same `package_id` and `assets_digest` validation in the return JSON path.

- [ ] **Step 1: Write a failing test for unified script creation and persisted external collaboration**

```js
test('新建剧集直达空白剧本，外部 AI 通过独立可恢复向导回流草稿', () => {
  const entry = model.getEpisodeCreationEntryModel('7');
  assert.equal(entry.primary.id, 'new-episode');
  assert.deepEqual(entry.secondary.items.map(item => item.id), [
    'package-import', 'external-ai', 'novel-split', 'source-video',
  ]);
  const page = model.getProjectEpisodesModel('7');
  assert.deepEqual(page.creationEntry, entry);
  assert.equal(model.getEpisodeCreationSourceTarget('blank', { projectShellCreated: true }).routeId, 'studio-script');
  const wizard = model.getExternalAiWizardModel('7', { step: 'compiled-context' });
  assert.equal(wizard.context.editableFields.length, 1);
  assert.equal(wizard.context.editableFields[0].id, 'task-note');
  assert.equal(wizard.importResult.writesApprovedScript, false);
});
```

- [ ] **Step 2: Run the focused test to prove the old six-card source picker fails**

Run: `node --test --test-name-pattern "新建剧集直达空白剧本" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: FAIL because the current first screen contains “我有剧本 / 让 AI 帮我写 / 我有制作包” cards and no standalone wizard model.

- [ ] **Step 3: Implement the two-level entry and eight-step external AI flow**

```js
creationEntry: {
  primary: { id: 'new-episode', label: '新建剧集', target: { routeId: 'studio-script' } },
  secondary: {
    label: '导入 / 协作',
    items: [
      { id: 'package-import', label: '导入制作包' },
      { id: 'external-ai', label: '外部 AI 制作' },
      { id: 'novel-split', label: '小说/长文本拆集' },
      { id: 'source-video', label: '从已有视频开始剪辑' },
    ],
  },
}
```

Keep the target selector and reject nonempty episode targets. Create an external-AI Page route with the exact progression `target → compiled-context → task-note → package-preview → waiting-result → result-file → import-preview → imported-draft`. The compiled context is read-only; `task-note` is the only editable field. Package creation exposes “下载任务包”和“复制任务说明”; returned JSON reuses the five-step package preview and produces only a draft.

Persist the waiting task in both episode list and task center. No handler may create image/video/audio tasks during package creation or JSON import.

- [ ] **Step 4: Run creation, package-import and external-AI regression tests**

Run: `node --test --test-name-pattern "剧集.*创建|外部 AI|制作包" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: PASS; target protection and `package_id/assets_digest` matching remain covered.

- [ ] **Step 5: Manually exercise the core branch in the prototype**

Run: `Start-Process 'http://127.0.0.1:8765/production-studio-v2.1-full-prototype.html#/project-episodes?projectId=7'`

Expected: “新建剧集” enters a blank script; “导入 / 协作 → 外部 AI 制作” reaches the wizard, can create a waiting task, and then reaches JSON import preview.

- [ ] **Step 6: Commit the isolated task changes**

Run: `git add -- docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Run: `git commit -m "feat: streamline episode creation prototype"`

## Task 4: 将剧本页变为草稿优先的创作入口

**Files:**

- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js: getScriptStageModel, syncScriptPageDerived, script revision helpers`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html: script page renderer and script action handlers`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs: script tests near current tests 426–595`

**Interfaces:**

- Consumes: existing scene-level draft, save state, approval check, AI candidate and revision data.
- Produces: blank-start options `paste-import`, `ai-draft`, `manual-write`; contextual `aiAssistant`; `revisionHistory.presentation === 'drawer'`; main action labels “确认剧本 / 确认修改”.

- [ ] **Step 1: Write a failing test for blank-script starts and contextual revision tools**

```js
test('剧本草稿在确认前可结构化，AI和历史均按上下文渐进出现', () => {
  const blank = model.getScriptStageModel('7', '3', 'blocked');
  assert.deepEqual(blank.emptyStart.actions.map(item => item.id), [
    'paste-import', 'ai-draft', 'manual-write',
  ]);
  assert.equal(blank.stageNavigation[1].label, '设定');
  const active = model.getScriptStageModel('7', '1', 'stale');
  assert.equal(active.aiAssistant.presentation, 'menu');
  assert.equal(active.revisionHistory.presentation, 'drawer');
  assert.equal(active.primaryAction.label, '检查并确认');
});
```

- [ ] **Step 2: Run the focused test to verify the current UI fails**

Run: `node --test --test-name-pattern "剧本草稿在确认前可结构化" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: FAIL because the current page uses `本集素材`, exposes all AI actions together, and renders revisions as persistent panel content.

- [ ] **Step 3: Update script model and render behavior**

```js
emptyStart: {
  actions: [
    { id: 'paste-import', label: '粘贴或导入剧本' },
    { id: 'ai-draft', label: 'AI 生成草稿' },
    { id: 'manual-write', label: '直接开始写' },
  ],
},
revisionHistory: { presentation: 'drawer', actionLabel: '历史版本' },
```

Only add `emptyStart` for truly blank drafts. Pasting/importing opens a compact import panel, AI opens an AI prompt Modal, and manual writing focuses the editor. All paths modify the same draft and use existing scene parsing helpers before confirmation.

Render the four stage labels in centered `studio-steps`. Move historical revisions behind “历史版本” Drawer. Show comparison only if `approvedRevisionId` exists and the current draft differs; use a Modal. Use “确认剧本” for initial approval and “确认修改” thereafter. Keep `checkScriptDraftForApproval()` and `approveScriptDraft()` as the only route to media generation availability.

- [ ] **Step 4: Run script state and HTML regression tests**

Run: `node --test --test-name-pattern "剧本|版本比较|AI 改写|确认检查" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: PASS; empty scripts stay unconfirmable, AI still applies through candidate comparison, and history recovery still creates a new draft.

- [ ] **Step 5: Commit the isolated task changes**

Run: `git add -- docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Run: `git commit -m "feat: focus script prototype on draft creation"`

## Task 5: 简化项目素材并重建本集设定卡片与 Drawer

**Files:**

- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js: getProjectAssetsModel, asset detail builders, getEpisodeAssetsStageModel, episode asset decision helpers`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html: project-assets renderer, asset detail Drawer, studio-assets renderer`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs: project-assets tests near current tests 1968–2337 and episode-assets tests near 607–702`

**Interfaces:**

- Consumes: canonical project asset records, asset states, candidates and episode selection references.
- Produces: compact project card projection; `getEpisodeAssetsStageModel(projectId, episodeId)` with role/scene/prop tabs and referenced-only cards; shared `getAssetDetailDrawerModel(assetId, { projectId, episodeId })` with a small default surface and a generation Modal.

- [ ] **Step 1: Write a failing test for simplified cards and episode-scoped settings**

```js
test('项目素材卡只显示创作必要信息，本集设定只列当前剧本引用对象', () => {
  const assets = model.getProjectAssetsModel('7');
  const linxia = assets.items.find(item => item.id === 'character-linxia');
  assert.equal('taskStatus' in linxia, false);
  assert.equal('usage' in linxia, false);
  assert.equal(linxia.warning, '');

  const setting = model.getEpisodeAssetsStageModel('7', '1');
  assert.equal(setting.featureName, '本集设定');
  assert.deepEqual(setting.tabs.map(tab => tab.label), ['角色', '场景', '道具']);
  assert.ok(setting.cards.every(card => card.referencedByEpisode === true));
  const drawer = model.getAssetDetailDrawerModel('character-linxia', { projectId: '7', episodeId: '1' });
  assert.deepEqual(drawer.sections.map(section => section.id), [
    'summary', 'states', 'current-and-candidates', 'description', 'generation', 'episode-use',
  ]);
});
```

- [ ] **Step 2: Run the focused test to verify the existing cards fail**

Run: `node --test --test-name-pattern "项目素材卡只显示创作必要信息" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: FAIL because current cards expose candidate count, usage count, side-view warning, and the episode page only renders differences/blockers.

- [ ] **Step 3: Project canonical assets into simple cards and episode-specific setting references**

For project cards retain only `id`, `type`, `name`, `subtitle`, `description`, `imageTone`, `statePreviews`, `mediaState`, and a genuine blocking `issue`. Move candidate count, usage position, source, history and technical properties into Drawer sections. Do not treat absent side view as an issue.

For episode settings, derive cards from the current script’s required role/scene/prop IDs. Keep `assetId + stateId + mediaVersionId` per card and render roles/scenes/props as tabbed grid. A missing usable media reference uses only a compact alert badge. Do not duplicate canonical profile or candidate history into episode data.

Build a shared Drawer with `summary`, `states`, `current-and-candidates`, `description`, `generation`, `episode-use`. Put hash, revisions, full prompt, provider fields, task timeline and broader usage under collapsed technical details. “生成新图” opens a central Modal; candidate selection changes the episode tuple only when opened from 本集设定.

- [ ] **Step 4: Replace archive UI with protected user-facing deletion**

Add test assertions that default asset menus contain `删除` and not `归档`. When an item is referenced, deletion must list impact and provide “保留并取消 / 选择替代素材 / 移入回收站”, never a hard-delete action.

Run: `node --test --test-name-pattern "项目素材|本集设定|人物音色|场景详情|道具详情" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: PASS; candidate generation, upload, state selection and voice actions remain reachable through the simplified Drawer.

- [ ] **Step 5: Manually inspect both asset surfaces**

Run: `Start-Process 'http://127.0.0.1:8765/production-studio-v2.1-full-prototype.html#/project-assets?projectId=7'`

Expected: card grid is scan-friendly and does not show low-value counts; `#/studio-assets?projectId=7&episodeId=1` shows only episode references in three tabs.

- [ ] **Step 6: Commit the isolated task changes**

Run: `git add -- docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Run: `git commit -m "feat: simplify prototype asset setting workflow"`

## Task 6: 实现可进入分镜、受控提交媒体的非阻塞检查

**Files:**

- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js: getEpisodeAssetsStageModel, syncEpisodeAssetsDerived, transition/decision helpers, storyboard generation guard`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html: studio-assets action handler, storyboard renderer and generation controls`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs: episode-assets, storyboard generation and stage-navigation tests`

**Interfaces:**

- Consumes: script approval state, episode asset selection and snapshot lifecycle.
- Produces: `storyboardEntry` with `allowed: true` for all valid episode pages; `mediaReadiness` with `checking|ready|needs-attention|snapshot-failed|script-unapproved`; generation controls derive `disabled` and `recoveryTarget` from `mediaReadiness`.

- [ ] **Step 1: Write a failing test for immediate navigation and guarded generation**

```js
test('本集设定不完整时仍能进入分镜，但受影响镜头不能提交媒体任务', () => {
  const page = model.getEpisodeAssetsStageModel('7', '1', 'blocked');
  assert.equal(page.storyboardEntry.allowed, true);
  assert.equal(page.storyboardEntry.target.routeId, 'studio-storyboard');
  assert.equal(page.mediaReadiness.status, 'needs-attention');
  const guard = model.getStoryboardMediaGenerationGuard('7', '1', 'shot-03', 'needs-attention');
  assert.equal(guard.enabled, false);
  assert.equal(guard.recoveryTarget.routeId, 'studio-assets');
});
```

- [ ] **Step 2: Run the focused test to prove old Gate behavior fails**

Run: `node --test --test-name-pattern "本集设定不完整时仍能进入分镜" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: FAIL because the old blocked state withholds the entering action or keeps storyboard locked.

- [ ] **Step 3: Split navigation from preparation and wire visible state strips**

```js
function getStoryboardMediaGenerationGuard(projectId, episodeId, shotId, readiness) {
  const enabled = readiness === 'ready';
  return {
    enabled,
    recoveryTarget: enabled ? null : {
      routeId: 'studio-assets',
      params: { projectId: String(projectId), episodeId: String(episodeId), shotId: String(shotId) },
    },
  };
}
```

On 本集设定, “进入分镜” calls `navigate('studio-storyboard', params)` immediately and sets demo preparation state to `checking`. In the storyboard header, render one compact strip with exactly one recovery action:

```js
{ checking: '正在准备素材…', ready: '本集设定已准备好',
  'needs-attention': '有 2 项可稍后处理',
  'snapshot-failed': '素材准备未完成：重试' }
```

Disable only image/video generation controls requiring invalid references. Preserve storyboard viewing, scene and shot editing, imported structure inspection, and normal route navigation.

- [ ] **Step 4: Run episode-setting and storyboard-generation regression tests**

Run: `node --test --test-name-pattern "本集设定|本集素材|分镜.*生成|视频.*预检|阶段导航" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: PASS; navigation is always allowed while invalid input, stale reference, loading snapshot and paid generation remain safely blocked.

- [ ] **Step 5: Manually execute the blocked-to-storyboard path**

Run: `Start-Process 'http://127.0.0.1:8765/production-studio-v2.1-full-prototype.html#/studio-assets?projectId=7&episodeId=1&scenario=blocked'`

Expected: clicking “进入分镜” navigates immediately. The destination allows storyboard inspection but marks the affected image/video action disabled and offers one “去处理” recovery action.

- [ ] **Step 6: Commit the isolated task changes**

Run: `git add -- docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Run: `git commit -m "feat: allow storyboard navigation before asset readiness"`

## Task 7: 同步规格、决策记录和最终回归证据

**Files:**

- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md: project overview, episode center, script, project assets, episode settings, storyboard sections`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-page-review-decision-log.md: project settings, episode creation, script, assets, stage-entry decisions`
- Modify: `docs/vnext/production-studio-v2.1-design-review.md: current recommendation and page approval table`
- Modify: `docs/superpowers/plans/2026-09-10-production-studio-v2.1-single-creator-refinement.md: check off completed tasks and record exact commands/results`

**Interfaces:**

- Consumes: implementation behavior from Tasks 1–6 and the approved design spec.
- Produces: all user-facing specifications agree on `概览 / 剧集 / 项目素材`, `剧本 / 设定 / 分镜 / 成片`, two-level episode creation, external AI wizard, and nonblocking storyboard entry.

- [ ] **Step 1: Add failing consistency assertions to the prototype test file**

```js
test('统一原型默认投影不再保留被替换的单人工作流入口', () => {
  assert.equal(model.getProjectSectionNavigation('7').some(item => item.label === '项目设置'), false);
  assert.equal(model.getProjectEpisodesModel('7').managementActions.some(item => item.id === 'set-duration'), false);
  assert.doesNotMatch(html, /进入分镜前检查/);
  assert.match(html, /本集设定/);
  assert.match(html, /导入 \/ 协作/);
});
```

- [ ] **Step 2: Run the consistency test and remove remaining default-view legacy copy**

Run: `node --test --test-name-pattern "统一原型默认投影不再保留" docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: PASS. Technical details and historical documentation may mention legacy internal names only where they are explicitly marked as migration context; default UI must not.

- [ ] **Step 3: Update interaction specification and decision log with final contracts**

Record these exact decisions:

1. Project profile and style selection live in overview; `项目设置` is retired from default navigation.
2. A new episode enters the same blank script draft; package/external AI remain protocol-specific import flows.
3. A script is structured and editable before confirmation; confirmation approves downstream use.
4. Episode setting is a referenced-object projection, not a second asset database.
5. The storyboard page is always navigable; paid media submission requires a valid preparation snapshot.
6. User-facing deletion is recoverable and reference-aware; default archive affordances are removed.

Update each UI state table for default, empty, loading, processing, success, error and disabled states. Add exact storyboard media-generation behavior to the spec.

- [ ] **Step 4: Run full prototype tests and static format checks**

Run: `node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Expected: PASS with no skipped new tests.

Run: `git diff --check`

Expected: no trailing whitespace or malformed patch output.

- [ ] **Step 5: Perform final prototype smoke walkthrough**

Run: `Start-Process 'http://127.0.0.1:8765/production-studio-v2.1-full-prototype.html#/projects'`

Expected walkthrough:

1. Open a project; edit profile and choose a style from overview.
2. Open episodes; create a blank episode and enter script.
3. Use an empty-script start action; create scene structure, save and confirm.
4. Open 本集设定; select a role state and candidate image.
5. With a remaining missing reference, enter storyboard; verify generation is guarded but editing works.
6. Start external AI task from 导入 / 协作; verify JSON result returns only a draft.

- [ ] **Step 6: Commit documentation and regression evidence**

Run: `git add -- docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md docs/superpowers/specs/2026-09-08-production-studio-v2.1-page-review-decision-log.md docs/vnext/production-studio-v2.1-design-review.md docs/superpowers/plans/2026-09-10-production-studio-v2.1-single-creator-refinement.md docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

Run: `git commit -m "docs: record single creator prototype refinement"`

## Plan Self-Review

| Spec requirement | Implementing task |
|---|---|
| Remove project settings UI; overview owns profile and style | Tasks 1–2 |
| Eliminate duration/output preference and simplify episode menus | Tasks 1 and 3 |
| Unified blank-script creation and retained package protocol | Task 3 |
| External AI page wizard and JSON return safety | Task 3 |
| Draft structure before confirmation, contextual AI/history | Task 4 |
| Compact project assets and referenced-only episode settings | Task 5 |
| Nonblocking storyboard entry with guarded media submission | Task 6 |
| State, copy, decision and test synchronization | Task 7 |

The plan contains no incomplete placeholders. Function names introduced in the tasks are exercised by the same or a later task: `toStageAccess`, `getEpisodeCreationEntryModel`, `getExternalAiWizardModel`, `getAssetDetailDrawerModel`, and `getStoryboardMediaGenerationGuard`. Every behavior is covered by a failing-first test, focused regression command, and final full-suite smoke walkthrough.
