# Production Studio V2.1 Project Hub and Episode Import Center Implementation Plan

> **状态：不可执行，待重写。** 2026-09-08 已确认只支持 V2.1 当前任务包/结果协议、直接删除旧 Project/Drama/Film 入口，并将外部 AI 任务 ZIP/单文件任务 JSON作为剧集创建主入口。本计划中的 feature flag、旧路由、旧协议升级和双轨验收全部失效；仅可作为历史任务拆分参考，不能逐项照此执行。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 V2.1 项目中心、项目详情、剧集列表和五步单集制作包导入中心，并在不复制现有导入内核的前提下，把外部 JSON 安全投影为“剧集—场次—分镜—时段”草稿。

**Architecture:** 项目中心使用只读聚合服务组合现有 `dramas/episodes`、Phase 1 `production_stage_states`、导入溯源与任务进度，不把统计字段反写到项目表。导入沿用现有 `episodePackageService`、资产匹配、来源审计和哈希校验，在其前后增加 V2.1 协议适配与方案 B 结构仓库；预览无副作用，提交在同一 SQLite 事务中重新校验空白目标并写入全部草稿。旧 `/api/v1`、`FilmList.vue`、`DramaDetail.vue` 和三步导入弹窗继续保留，通过同一个 feature flag 与新入口双轨运行。

**Tech Stack:** Node.js 22.22.3、Express 4、SQLite/better-sqlite3、Vue 3、Pinia、Vue Router、Element Plus、Node `node:test`。

**Spec:** 架构母稿 `docs/superpowers/specs/2026-09-05-production-studio-v2-design.md` §§4、8.0、8.2.1、8.2.2、11、19；P0 权威附件 `docs/superpowers/specs/2026-09-08-production-studio-v2.1-state-gate-truth-table.md`、`docs/superpowers/specs/2026-09-08-production-studio-v2.1-scope-version-concurrency-invalidation.md`、`docs/superpowers/specs/2026-09-08-production-studio-v2.1-legacy-feature-migration-matrix.md`、`docs/superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md`；页面规格 `docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md` §§3、20、23；兼容基线 `docs/superpowers/specs/2026-09-02-single-episode-production-package-import-design.md`。

## Global Constraints

- 执行顺序：先完成并验收 Phase 0 与 `2026-09-08-production-studio-v2.1-phase-1.md`，再执行本计划；本计划完成后再扩展 Phase 3 分镜工作台。
- 执行前使用 `superpowers:using-git-worktrees` 建立隔离 worktree；不得在当前含未提交设计文档的 `main` 工作区直接实现。
- 所有 Node 命令使用 `C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe`；不得使用系统 Node 24 运行 `better-sqlite3` 测试。
- 保持纯 JavaScript，不引入 TypeScript、状态机库、ORM 或新 UI 框架。
- 新聚合接口挂载在 `/api/v2`；现有 `/api/v1/dramas`、`/api/v1/episodes/import-package*`、`/api/v1/episodes/:id/import-source` 行为保持兼容。
- 外部 JSON 只允许创建新剧集或填充服务端确认的空白剧集；非空目标的固定错误码为 `TARGET_NOT_BLANK`。
- 不支持合并、覆盖、追加、强制导入、忽略空白检查或三方合并；前后端均不得留下隐藏旁路。
- 预览必须无数据库写入；提交必须在事务内再次校验项目、目标剧集、文件哈希和资产决策。
- 外部资产匹配顺序固定为项目内 `source_key` 精确匹配 → 来源 id/hash 精确匹配 → 名称相似只报 `conflict`；名称永不触发自动复用。
- 导入只创建结构化草稿、关系和审计快照；不得创建图片、视频、音频、TTS、Provider 或外部计费任务。
- 项目 Look 只能由项目设置修改；制作包不得覆盖 `dramas.style_id`、Look 版本或批准状态。
- 外部包不得决定 Provider、模型、`request_duration_seconds` 或最终编译提示词；这些值由本地能力与 Prompt Compiler 决定。
- “场次”只表示叙事结构 `story_scenes`；现有 `scenes` 在新 UI 中固定称为“场景资产”。
- 一个分镜是一次视频生成单元，包含 1～N 个连续时段；单时段完全合法，15 秒不是默认值或必须填满的目标。
- 项目归档 ZIP 与单集 JSON 制作包保持两个入口、两种格式和两套文案，不得混用。
- 阶段摘要只聚合 `not_started/in_progress/ready_for_review/approved/stale`；blocker 和任务为独立计数，不保存项目级阶段状态。
- 项目/剧集编辑、集号调整、复制剧本和导入提交都必须携带 revision/version/fingerprint 前置条件；冲突返回 409，禁止 last-write-wins。
- 项目与剧集生命周期按迁移矩阵执行：本阶段迁移 P-01～P-04、E-01～E-05、I-01～I-03；P-05 的统一软删除/恢复/物理清理继续留到 Phase 5，V2 数据管理页只复用现有删除服务并明确其能力边界。
- 新页面复用 Phase 1 语义变量和 64/56/48px 布局规则，不复制 RunningHub 的品牌、图标或颜色值。
- `CHANGELOG.md` 只在本计划功能全部实现并通过验收后更新 `[未发布]`，不得记录计划或未完成能力。

---

## File Structure

### 新建

- `backend-node/migrations/37_story_scene_timed_segments.sql`：方案 B 的叙事场次、分镜关联、时段和时段引用表。
- `backend-node/src/services/storyStructureRepository.js`：方案 B 的唯一写入/读取边界及旧分镜单时段投影。
- `backend-node/src/services/projectHubService.js`：项目卡、项目详情、剧集行和阶段摘要的只读聚合模型。
- `backend-node/src/services/projectEpisodeCommandService.js`：项目编辑、剧集 CRUD/重排、复制剧本的 V2 乐观锁命令边界。
- `backend-node/src/services/episodePackageV21Adapter.js`：V2.1 JSON 解析、旧包升级、时间码闭合及引用校验。
- `backend-node/src/services/episodeImportWorkflowService.js`：V2 预览/提交编排，复用现有资产匹配和溯源服务。
- `backend-node/src/routes/v2/projects.js`：项目中心、项目详情、剧集列表与创建入口。
- `backend-node/src/routes/v2/episodeImports.js`：导入目标、预览、提交和来源查询入口。
- `backend-node/test/storyStructureRepository.test.js`
- `backend-node/test/projectHubService.test.js`
- `backend-node/test/projectHubRoutes.test.js`
- `backend-node/test/projectEpisodeCommandService.test.js`
- `backend-node/test/episodePackageV21Adapter.test.js`
- `backend-node/test/episodeImportWorkflowService.test.js`
- `backend-node/test/episodeImportV2Routes.test.js`
- `frontweb/src/api/projectHub.js`：V2 项目与导入 API。
- `frontweb/src/stores/projectHub.js`：项目/详情加载、路由竞态和导入刷新状态。
- `frontweb/src/utils/projectHub.js`：阶段摘要、继续制作路由和显示模型纯函数。
- `frontweb/src/utils/episodeImportWizard.js`：五步向导纯状态、问题分组和提交 payload。
- `frontweb/src/views/ProjectEntry.vue`：根路由 V1/V2 feature flag 兼容入口。
- `frontweb/src/views/ProjectDetailEntry.vue`：旧 `/drama/:id` 与新 `/projects/:projectId` 的兼容入口。
- `frontweb/src/views/projectHub/ProjectHub.vue`
- `frontweb/src/views/projectHub/ProjectDetail.vue`
- `frontweb/src/components/projectHub/ProjectSummaryCard.vue`
- `frontweb/src/components/projectHub/NewProjectWizard.vue`
- `frontweb/src/components/projectHub/ProjectOverviewTab.vue`
- `frontweb/src/components/projectHub/ProjectBibleTab.vue`
- `frontweb/src/components/projectHub/EpisodeTable.vue`
- `frontweb/src/components/projectHub/ProjectAssetsTab.vue`
- `frontweb/src/components/projectHub/ProjectDataTab.vue`
- `frontweb/src/components/projectHub/EpisodeImportWizard.vue`
- `frontweb/src/components/projectHub/EpisodeImportSourceDrawer.vue`
- `frontweb/src/components/projectHub/EpisodeBatchImportDialog.vue`
- `frontweb/src/components/projectHub/CopyScriptDialog.vue`
- `frontweb/src/components/projectHub/ExternalAiCollaborationDialog.vue`
- `frontweb/test/projectHubUtils.test.js`
- `frontweb/test/projectHubRoutes.test.js`
- `frontweb/test/projectHubStore.test.js`
- `frontweb/test/projectHubUi.test.js`
- `frontweb/test/episodeImportWizard.test.js`
- `frontweb/test/episodeImportV21Ui.test.js`

### 修改

- `backend-node/src/services/episodePackageService.js`：把落库阶段委托给结构仓库，并扩大空白判定范围。
- `backend-node/src/services/episodePackageSchema.js`：保留旧 1.x Schema，注册 V2.1 Schema。
- `backend-node/src/services/episodeImportProvenanceService.js`：来源详情增加协议升级与结构统计信息。
- `backend-node/src/routes/v2/index.js`：挂载 projects 与 episode-imports 路由。
- `backend-node/test/episodePackageService.test.js`：补方案 B、空白重检和零媒体任务回归。
- `backend-node/test/episodePackageRoutes.test.js`：证明旧 V1 入口继续可用。
- `frontweb/src/router/index.js`：挂载项目中心/详情并保留旧路由。
- `frontweb/src/styles/theme.css`：补项目中心语义变量和响应式 token。
- `frontweb/src/views/productionStudio/ProductionStudio.vue`：已导入剧集只增加“查看外部来源”，不得增加导入主按钮。
- `frontweb/test/filmEntryCompatibility.test.js`：扩展根路由和项目详情的双轨兼容验证。
- `CHANGELOG.md`：全部功能与验收完成后记录。

## Task 1: Scheme B story structure schema and compatibility repository

**Files:**

- Create: `backend-node/migrations/37_story_scene_timed_segments.sql`
- Create: `backend-node/src/services/storyStructureRepository.js`
- Create: `backend-node/test/storyStructureRepository.test.js`
- Modify: `backend-node/src/db/migrate.js` only if migrations are enumerated explicitly; otherwise no migration-runner change.

**Interfaces:**

- Produces: `getEpisodeStoryStructure(db, episodeId) -> { storyScenes, storyboards }`.
- Produces: `replaceBlankEpisodeStoryStructure(db, { episodeId, storyScenes, storyboards, now })`，调用方必须已在同一事务内确认空白。
- Produces: `projectLegacyStoryboard(row) -> { storySceneRefs, timedSegments }`，旧行固定投影为一个覆盖全计划时长的时段。
- Produces: `validateTimedSegments({ plannedDurationSeconds, timedSegments }) -> { ok, errors }`。

- [ ] **Step 1: Write failing migration and repository tests**

测试必须覆盖以下断言：

```js
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
assert.ok(tables.includes('story_scenes'));
assert.ok(tables.includes('storyboard_story_scenes'));
assert.ok(tables.includes('storyboard_timed_segments'));
assert.ok(tables.includes('timed_segment_references'));

assert.deepEqual(validateTimedSegments({
  plannedDurationSeconds: 7,
  timedSegments: [{ startMs: 0, endMs: 7000, action: '连续走入门厅' }],
}), { ok: true, errors: [] });

assert.equal(validateTimedSegments({
  plannedDurationSeconds: 7,
  timedSegments: [{ startMs: 0, endMs: 3000 }, { startMs: 3500, endMs: 7000 }],
}).errors[0].code, 'SEGMENT_TIMELINE_GAP');
```

另测相邻重叠、首段不是 0、尾段未闭合、零时段、跨分镜引用、跨项目场景资产引用，以及 `scene_id` 旧分镜被投影成一个时段和一个 `scene_asset` 引用。

- [ ] **Step 2: Run the focused test and verify the intended failure**

```powershell
Set-Location backend-node
& $node22 --test test/storyStructureRepository.test.js
```

Expected: FAIL because the migration and repository do not exist.

- [ ] **Step 3: Add the exact schema**

`37_story_scene_timed_segments.sql` 使用以下表和约束：

```sql
CREATE TABLE IF NOT EXISTS story_scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  source_key TEXT,
  scene_number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  location_text TEXT,
  time_text TEXT,
  interior_exterior TEXT,
  summary TEXT,
  raw_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (episode_id) REFERENCES episodes(id),
  UNIQUE (episode_id, source_key),
  UNIQUE (episode_id, scene_number)
);

CREATE TABLE IF NOT EXISTS storyboard_story_scenes (
  storyboard_id INTEGER NOT NULL,
  story_scene_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (storyboard_id, story_scene_id),
  UNIQUE (storyboard_id, sort_order),
  FOREIGN KEY (storyboard_id) REFERENCES storyboards(id),
  FOREIGN KEY (story_scene_id) REFERENCES story_scenes(id)
);

CREATE TABLE IF NOT EXISTS storyboard_timed_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storyboard_id INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK(end_ms > start_ms),
  action TEXT NOT NULL DEFAULT '',
  camera TEXT,
  dialogue_json TEXT,
  sound_json TEXT,
  raw_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (storyboard_id) REFERENCES storyboards(id),
  UNIQUE (storyboard_id, source_key),
  UNIQUE (storyboard_id, sort_order)
);

CREATE TABLE IF NOT EXISTS timed_segment_references (
  segment_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('scene_asset','character_variant','prop')),
  entity_id INTEGER NOT NULL,
  role TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (segment_id, entity_type, entity_id),
  UNIQUE (segment_id, sort_order),
  FOREIGN KEY (segment_id) REFERENCES storyboard_timed_segments(id)
);
```

增加 episode、storyboard、story_scene、segment 查询索引。`entity_id` 是多态引用，仓库必须按 `entity_type` 在写入前显式验证归属，不能依赖 SQLite 外键猜测目标表。

- [ ] **Step 4: Implement the repository transaction boundary**

仓库只接受已规范化的 camelCase 结构；在任何 INSERT 前完成全量时间码和归属校验。`replaceBlankEpisodeStoryStructure` 按 `story_scenes → storyboards → storyboard_story_scenes → storyboard_timed_segments → timed_segment_references` 写入，并同步旧兼容字段：

- `storyboards.duration = plannedDurationSeconds`；
- `storyboards.scene_id = 第一个时段的第一个 scene_asset`，没有则为 `NULL`；
- 角色状态调用现有 `syncStoryboardVariantLinks`；
- 道具继续写 `storyboard_props`；
- 不写 Provider、模型和 request duration。

- [ ] **Step 5: Run focused and migration regression tests**

```powershell
& $node22 --test test/storyStructureRepository.test.js test/episodePackageMigration.test.js test/episodeStoryboardAvMapping.test.js
```

Expected: all PASS; existing storyboard rows remain readable.

- [ ] **Step 6: Commit**

```powershell
git add backend-node/migrations/37_story_scene_timed_segments.sql backend-node/src/services/storyStructureRepository.js backend-node/test/storyStructureRepository.test.js
git commit -m "feat: add story scene and timed segment structure"
```

## Task 2: V2.1 package adapter and deterministic legacy upgrade

**Files:**

- Create: `backend-node/src/services/episodePackageV21Adapter.js`
- Create: `backend-node/test/episodePackageV21Adapter.test.js`
- Modify: `backend-node/src/services/episodePackageSchema.js`
- Add fixture: `backend-node/test/fixtures/episodePackageV21.json`
- Add fixture: `backend-node/test/fixtures/episodePackageV21.schema.json`

**Interfaces:**

- Produces: `parseEpisodePackageV21(rawText) -> parsedObject`。
- Produces: `normalizeEpisodePackageV21(pkg) -> { package, upgradeReport }`。
- Produces: `validateEpisodePackageV21(pkg) -> { valid, errors, warnings }`。
- Normalized storyboard shape: `{ sourceKey, storyboardNumber, title, plannedDurationSeconds, storySceneRefs, timedSegments, characterRefs, propRefs, ...legacyFields }`。

- [ ] **Step 1: Write failing adapter contract tests**

```js
const normalized = normalizeEpisodePackageV21({
  schema: 'local-mini-drama.episode-package',
  version: '2.1',
  episode: { source_key: 'ep-1', episode_number: 1, title: '第一集', summary: '摘要' },
  story_scenes: [{ source_key: 'ss-1', scene_number: 1, title: '门厅' }],
  characters: [], scenes: [], props: [],
  storyboards: [{
    source_key: 'sb-1', storyboard_number: 1, title: '入场', duration_seconds: 7,
    story_scene_refs: ['ss-1'],
    timed_segments: [{ source_key: 'seg-1', start_seconds: 0, end_seconds: 7, action: '走入门厅', references: [] }],
  }],
});
assert.equal(normalized.package.storyboards[0].plannedDurationSeconds, 7);
assert.deepEqual(normalized.package.storyboards[0].timedSegments[0], {
  sourceKey: 'seg-1', startMs: 0, endMs: 7000, action: '走入门厅',
  camera: '', dialogue: [], sound: {}, references: [], raw: normalized.package.storyboards[0].timedSegments[0].raw,
});
```

旧 1.0/1.1 包测试必须证明：每个旧分镜生成一个 `legacy-default` 时段，范围为 `0..duration_seconds`，旧 `scene_ref/character_refs/prop_refs` 进入该时段引用，`upgradeReport` 明示 `LEGACY_SINGLE_SEGMENT_PROJECTION`，不得猜出多个时段。

- [ ] **Step 2: Run and verify missing-adapter failure**

```powershell
& $node22 --test test/episodePackageV21Adapter.test.js
```

Expected: FAIL with missing module or unsupported version 2.1.

- [ ] **Step 3: Register V2.1 schema without replacing legacy schemas**

V2.1 顶层必填：`schema/version/episode/story_scenes/storyboards`。每个分镜必填 `source_key/storyboard_number/title/duration_seconds/story_scene_refs/timed_segments`；每个时段必填稳定键、起止秒、动作和引用数组。Schema 禁止外部字段 `provider`、`model`、`request_duration_seconds`、`final_prompt`；出现时返回 `PACKAGE_EXECUTION_FIELD_FORBIDDEN`，不能静默保存为业务字段。

- [ ] **Step 4: Implement semantic validation**

固定错误码至少包括：

```text
PACKAGE_JSON_INVALID
PACKAGE_SCHEMA_UNSUPPORTED
PACKAGE_SOURCE_KEY_DUPLICATED
STORY_SCENE_REF_NOT_FOUND
SEGMENT_TIMELINE_EMPTY
SEGMENT_TIMELINE_START_INVALID
SEGMENT_TIMELINE_GAP
SEGMENT_TIMELINE_OVERLAP
SEGMENT_TIMELINE_END_INVALID
SEGMENT_ASSET_REF_NOT_FOUND
PACKAGE_EXECUTION_FIELD_FORBIDDEN
```

所有路径使用 JSON Pointer，例如 `/storyboards/0/timed_segments/1/start_seconds`。警告与错误保持数组顺序稳定，保证相同输入产生相同预览和哈希。

- [ ] **Step 5: Run adapter and legacy schema tests**

```powershell
& $node22 --test test/episodePackageV21Adapter.test.js test/episodePackageSchema.test.js test/episodePackageValidator.test.js
```

Expected: V2.1 and 1.x fixtures all PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend-node/src/services/episodePackageV21Adapter.js backend-node/src/services/episodePackageSchema.js backend-node/test/episodePackageV21Adapter.test.js backend-node/test/fixtures/episodePackageV21.json backend-node/test/fixtures/episodePackageV21.schema.json
git commit -m "feat: validate episode package v2.1 structure"
```

## Task 3: Atomic V2.1 import workflow and non-empty target guard

**Files:**

- Create: `backend-node/src/services/episodeImportWorkflowService.js`
- Create: `backend-node/test/episodeImportWorkflowService.test.js`
- Modify: `backend-node/src/services/episodePackageService.js`
- Modify: `backend-node/src/services/episodeImportProvenanceService.js`
- Modify: `backend-node/test/episodePackageService.test.js`

**Interfaces:**

- Produces: `inspectImportTarget(db, { projectId, episodeId }) -> { status, reasons, episode }`。
- Produces: `previewEpisodeImport(db, { projectId, targetEpisodeId, rawText, filename }) -> ImportPreview`。
- Produces: `commitEpisodeImport(db, { projectId, targetEpisodeId, rawText, filename, sourceSha256, decisions }) -> ImportResult`。
- `ImportPreview.target = { mode: 'create'|'fill', status: 'new_episode'|'blank'|'non_blank', reasons: [] }`。
- `ImportResult = { project_id, episode_id, source_sha256, stats, warnings, import_source }`。

- [ ] **Step 1: Write atomicity and zero-side-effect tests**

```js
const before = snapshotCounts(db, [
  'episodes', 'story_scenes', 'storyboards', 'storyboard_timed_segments',
  'image_generation_tasks', 'image_generations', 'video_generations', 'episode_imports',
]);
const preview = previewEpisodeImport(db, {
  projectId: 1, rawText: RAW_V21, filename: 'episode-1.json',
});
assert.equal(preview.target.status, 'new_episode');
assert.deepEqual(snapshotCounts(db, Object.keys(before)), before);

assert.throws(() => commitEpisodeImport(db, {
  projectId: 1, targetEpisodeId: nonBlankEpisodeId,
  rawText: RAW_V21, filename: 'episode-1.json', sourceSha256: preview.source_sha256, decisions: [],
}), error => error.code === 'TARGET_NOT_BLANK' && error.status === 409);
```

增加“预览时空白、提交前被另一写入填充”的测试，证明事务内重检拒绝且结构、资产、溯源、媒体任务计数全部不变。

资产匹配测试必须证明：同项目同 `source_key` 可精确复用；没有 source key 时只有来源 id/hash 精确一致可复用；仅名称相同返回 `conflict` 并要求 decisions；跨项目 source key 不复用。提交时 decision 绑定候选实体 id、版本 fingerprint 与预览 source hash，任一变化返回 409 并零写入。

- [ ] **Step 2: Expand blank detection**

`inspectImportTarget` 在以下任一事实存在时返回 `non_blank`：

- `episodes.script_content` 或 `episodes.description` 非空；
- `story_scenes` 有未删除行；
- `storyboards` 有未删除行；
- 该集分镜已有图片、视频、H3 草稿、候选或时间线关联；
- `episode_imports` 已有成功记录。

返回稳定 reason code，不返回只供机器解析的中文句子：`SCRIPT_PRESENT`、`SUMMARY_PRESENT`、`STORY_SCENES_PRESENT`、`STORYBOARDS_PRESENT`、`MEDIA_PRESENT`、`IMPORT_HISTORY_PRESENT`。

- [ ] **Step 3: Run tests and verify the existing service cannot persist V2.1**

```powershell
& $node22 --test test/episodeImportWorkflowService.test.js test/episodePackageService.test.js
```

Expected: FAIL until the workflow delegates V2.1 writes to `storyStructureRepository`.

- [ ] **Step 4: Implement preview and commit orchestration**

预览顺序固定为：解析 → Schema → 旧包升级 → 语义校验 → 目标检查 → 资产匹配 → 统计/问题分组。提交重新执行同一管线，校验 `sha256(rawText) === sourceSha256`，然后在一个事务内：

1. 重检目标；
2. 创建新剧集或锁定空白剧集；
3. 按 `source_key → source id/hash → 名称冲突` 规则执行用户确认的角色/状态/场景资产/道具创建或精确复用；
4. 写剧本、叙事场次、分镜、时段和引用；
5. 写 `episode_imports.raw_json/normalized_json/match_decisions/import_report`；
6. 初始化 Phase 1 阶段状态为 `in_progress`，对象 revision 为 `draft`，不批准任何阶段；
7. 返回来源摘要。

任一步失败必须整体回滚。保持 `image_generation_tasks/image_generations/video_generations` 零新增。

- [ ] **Step 5: Preserve V1 behavior through a compatibility adapter**

现有 `previewPackageImport/importEpisodePackage` 保持导出签名，内部调用新 workflow；V1 路由的 response shape 不变。V1 旧包仍可导入，但落库后具有单时段方案 B 结构。

- [ ] **Step 6: Run focused and full import regression tests**

```powershell
& $node22 --test test/episodeImportWorkflowService.test.js test/episodePackageService.test.js test/episodePackageRoutes.test.js test/episodePackageProjection.test.js test/episodePackageAvRoundtrip.test.js test/episodeImportProvenanceService.test.js
```

Expected: all PASS; new and legacy endpoints create identical normalized structure for equivalent one-segment input.

- [ ] **Step 7: Commit**

```powershell
git add backend-node/src/services/episodeImportWorkflowService.js backend-node/src/services/episodePackageService.js backend-node/src/services/episodeImportProvenanceService.js backend-node/test/episodeImportWorkflowService.test.js backend-node/test/episodePackageService.test.js
git commit -m "feat: import episode packages into timed story structure"
```

## Task 4: Project Hub aggregate read model and V2 routes

**Files:**

- Create: `backend-node/src/services/projectHubService.js`
- Create: `backend-node/src/services/projectEpisodeCommandService.js`
- Create: `backend-node/src/routes/v2/projects.js`
- Create: `backend-node/src/routes/v2/episodeImports.js`
- Create: `backend-node/test/projectHubService.test.js`
- Create: `backend-node/test/projectHubRoutes.test.js`
- Create: `backend-node/test/projectEpisodeCommandService.test.js`
- Create: `backend-node/test/episodeImportV2Routes.test.js`
- Modify: `backend-node/src/routes/v2/index.js`

**Interfaces:**

- Produces: `listProjectHub(db, query) -> { items, total, page, pageSize }`。
- Produces: `getProjectHub(db, projectId) -> ProjectHubDetail|null`。
- Produces: `listProjectEpisodes(db, projectId) -> EpisodeHubRow[]`。
- Produces: `updateProject(db, { projectId, expectedFingerprint, patch })`。
- Produces: `createEpisode(db, { projectId, expectedProjectFingerprint, episodeNumber, title })`、`updateEpisode(db, { episodeId, expectedRevision, patch })`、`softDeleteEpisode(db, { episodeId, expectedRevision })`、`reorderEpisodes(db, { projectId, expectedProjectFingerprint, episodeRevisions })`。
- Produces: `copyScriptToEpisode(db, { sourceEpisodeId, targetEpisodeId, expectedTargetRevision })`，只创建目标 ScriptRevision 草稿。
- Consumes Phase 1: `listStages(db, episodeId)`。
- Consumes Task 3: `inspectImportTarget/previewEpisodeImport/commitEpisodeImport`。

- [ ] **Step 1: Write read-model contract tests**

项目卡最小 shape：

```js
assert.deepEqual(Object.keys(card).sort(), [
  'activeTaskCount', 'blockerCount', 'cover', 'episodeCount', 'id',
  'lastWorkedAt', 'recentEpisode', 'stageSummary', 'status', 'style', 'title', 'updatedAt',
].sort());
assert.deepEqual(card.recentEpisode, {
  id: 10, episodeNumber: 2, title: '第二集', currentStage: 'storyboard',
  continuePath: '/projects/1/episodes/10/storyboard',
});
```

阶段摘要固定含 `script/assets/storyboard/cut`，主状态只使用 `not_started/in_progress/ready_for_review/approved/stale`；每项另含 `blockerCount` 和任务聚合。无阶段行时按当前数据投影 `not_started` 或 `in_progress`，不得凭媒体数量推断批准，也不得把 blocker/任务折叠进主状态。

- [ ] **Step 2: Write optimistic-lock lifecycle tests**

覆盖项目编辑、单集新建/编辑/软删除、批量章节导入、集号重排以及从另一集复制剧本。每次更新必须使用当前 fingerprint/revision；两个窗口提交同一旧值时第二次返回 409 且数据库保持第一次结果。批量导入与重排遇到任一重复集号或非法条目时整体回滚。复制剧本只产生目标 `episode_script_revisions.status='draft'`，不复制批准、资产、分镜或媒体。

- [ ] **Step 3: Write route tests**

```text
GET  /api/v2/projects
POST /api/v2/projects
PATCH /api/v2/projects/:projectId
GET  /api/v2/projects/:projectId
GET  /api/v2/projects/:projectId/episodes
POST /api/v2/projects/:projectId/episodes
POST /api/v2/projects/:projectId/episodes/batch
POST /api/v2/projects/:projectId/episodes/reorder
PATCH /api/v2/episodes/:episodeId
DELETE /api/v2/episodes/:episodeId
POST /api/v2/episodes/:episodeId/copy-script
GET  /api/v2/projects/:projectId/episode-import-targets
POST /api/v2/projects/:projectId/episode-imports/preview
POST /api/v2/projects/:projectId/episode-imports/commit
GET  /api/v2/episodes/:episodeId/import-source
```

覆盖分页、关键词、项目/剧集 optimistic-lock 409、集号冲突 409、无项目 404、剧集跨项目 404、非空 409、hash mismatch 409、10MB 文本上限 413、未知 V2 路由 JSON 404。路由不得返回 API key、配置密钥或本地绝对存储路径。

- [ ] **Step 4: Run tests and verify missing services/routes**

```powershell
& $node22 --test test/projectHubService.test.js test/projectEpisodeCommandService.test.js test/projectHubRoutes.test.js test/episodeImportV2Routes.test.js
```

Expected: FAIL because the V2 project/import routes do not exist.

- [ ] **Step 5: Implement query-efficient aggregation**

项目列表不得为每张卡加载完整 storyboards/assets。使用批量查询取得项目、剧集、最近阶段状态、活动任务数、blocker 数和导入摘要；项目详情才加载每集四阶段状态与来源摘要。项目列表 20 条时查询数必须保持常数级，并在测试中用 DB wrapper 断言不超过 12 次 `prepare` 调用。

- [ ] **Step 6: Implement project and episode command transactions**

创建命令沿用现有实体表；更新、软删除、批量导入、重排和复制剧本全部封装在 `projectEpisodeCommandService` 事务中。响应返回新的 revision/fingerprint 和可安全刷新的 current snapshot。删除仅设置现有 `deleted_at` 并更新 locator；不在本阶段物理删除文件或不可变 revision。示例项目、项目 ZIP、小说/章节解析和 External AI task 继续调用现有服务，不复制算法或审计表。

- [ ] **Step 7: Implement project creation modes**

`POST /api/v2/projects` 接受：

```js
{
  title, description, style_id, aspect_ratio,
  start_mode: 'blank' | 'idea' | 'script' | 'episode_package',
  idea_text: '', script_text: '',
}
```

`blank` 只建项目；`idea/script` 建项目和一集草稿；`episode_package` 只建项目壳并返回 `next_action: 'open_episode_import'`。本计划不把“已有视频”伪装为已接入：新建向导将其显示为进入现有媒体库的独立入口，不向创建 API 发送 `existing_video`。错误时项目与首集一起回滚。

- [ ] **Step 8: Mount routes and run V1/V2 regression**

```powershell
& $node22 --test test/projectHubService.test.js test/projectEpisodeCommandService.test.js test/projectHubRoutes.test.js test/episodeImportV2Routes.test.js test/productionV2Routes.test.js test/episodePackageRoutes.test.js test/dramaPackageRoundtrip.test.js
```

Expected: all PASS; V1 endpoints remain routable.

- [ ] **Step 9: Commit**

```powershell
git add backend-node/src/services/projectHubService.js backend-node/src/services/projectEpisodeCommandService.js backend-node/src/routes/v2/projects.js backend-node/src/routes/v2/episodeImports.js backend-node/src/routes/v2/index.js backend-node/test/projectHubService.test.js backend-node/test/projectEpisodeCommandService.test.js backend-node/test/projectHubRoutes.test.js backend-node/test/episodeImportV2Routes.test.js
git commit -m "feat: expose project hub and episode import api"
```

## Task 5: Frontend API, store, route compatibility and pure view models

**Files:**

- Create: `frontweb/src/api/projectHub.js`
- Create: `frontweb/src/stores/projectHub.js`
- Create: `frontweb/src/utils/projectHub.js`
- Create: `frontweb/src/utils/episodeImportWizard.js`
- Create: `frontweb/src/views/ProjectEntry.vue`
- Create: `frontweb/src/views/ProjectDetailEntry.vue`
- Create: `frontweb/test/projectHubUtils.test.js`
- Create: `frontweb/test/projectHubRoutes.test.js`
- Create: `frontweb/test/projectHubStore.test.js`
- Modify: `frontweb/src/router/index.js`
- Modify: `frontweb/test/filmEntryCompatibility.test.js`

**Interfaces:**

- Produces store actions: `loadProjects`, `loadProject`, `loadEpisodes`, `createProject`, `updateProject`, `createEpisode`, `updateEpisode`, `softDeleteEpisode`, `batchImportEpisodes`, `reorderEpisodes`, `copyScript`, `refreshAfterImport`。
- Produces: `continueProductionPath(project)`, `summarizeStageStates(stages)`, `episodePrimaryAction(episode)`。
- Produces: `IMPORT_STEPS = ['target','script','assets','storyboards','confirm']`。
- Produces: `createImportWizardState()` and `canAdvanceImportStep(state)`。

- [ ] **Step 1: Write failing route and pure-function tests**

```js
assert.equal(continueProductionPath({
  id: 1, recentEpisode: { id: 10, currentStage: 'assets' },
}), '/projects/1/episodes/10/assets');
assert.equal(episodePrimaryAction({ blank: true }), '编辑或导入');
assert.deepEqual(IMPORT_STEPS, ['target', 'script', 'assets', 'storyboards', 'confirm']);
```

路由源码断言必须包括 `/projects/:projectId` 和 Phase 1 的 `/projects/:projectId/episodes/:episodeId/:stage`。旧 `/drama/:id`、`/film/:id` 与根路由仍存在。

- [ ] **Step 2: Run and verify missing modules/routes**

```powershell
Set-Location frontweb
& $node22 --test test/projectHubUtils.test.js test/projectHubRoutes.test.js test/projectHubStore.test.js test/filmEntryCompatibility.test.js
```

Expected: FAIL until V2 project entry and utilities exist.

- [ ] **Step 3: Implement API and stale-response protection**

所有 Project Hub 命令使用 Phase 1 `requestV2` 并从已加载 snapshot 传入 required revision/fingerprint；示例项目、ZIP 和 External AI 协作可继续通过既有 API 模块调用原服务。Store 对列表和详情分别维护递增 `loadSerial`；从项目 A 快速切换到 B 时，A 的迟到响应不得覆盖 B。导入成功后只刷新当前项目和剧集，不清空用户的列表筛选。409 时保留本地编辑值并展示“刷新当前版本/取消”，不得静默重放命令。

- [ ] **Step 4: Implement feature-flag entries**

根路由加载 `ProjectEntry.vue`：`VITE_PRODUCTION_STUDIO_V2 === '1'` 显示新 Project Hub，否则动态加载原 `FilmList.vue`。`/drama/:id` 加载 `ProjectDetailEntry.vue`：flag off 显示原 `DramaDetail.vue`，flag on replace 到 `/projects/:id?tab=episodes`。直接访问 `/projects/:projectId` 始终可用，不依赖 flag。

- [ ] **Step 5: Run unit tests and both builds**

```powershell
& $node22 --test test/projectHubUtils.test.js test/projectHubRoutes.test.js test/projectHubStore.test.js test/filmEntryCompatibility.test.js
& $npm22 run build
$env:VITE_PRODUCTION_STUDIO_V2='1'
& $npm22 run build
Remove-Item Env:VITE_PRODUCTION_STUDIO_V2
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontweb/src/api/projectHub.js frontweb/src/stores/projectHub.js frontweb/src/utils/projectHub.js frontweb/src/utils/episodeImportWizard.js frontweb/src/views/ProjectEntry.vue frontweb/src/views/ProjectDetailEntry.vue frontweb/src/router/index.js frontweb/test/projectHubUtils.test.js frontweb/test/projectHubRoutes.test.js frontweb/test/projectHubStore.test.js frontweb/test/filmEntryCompatibility.test.js
git commit -m "feat: add project hub routes and client state"
```

## Task 6: Project Hub list and new-project entry flow

**Files:**

- Create: `frontweb/src/views/projectHub/ProjectHub.vue`
- Create: `frontweb/src/components/projectHub/ProjectSummaryCard.vue`
- Create: `frontweb/src/components/projectHub/NewProjectWizard.vue`
- Create: `frontweb/test/projectHubUi.test.js`
- Modify: `frontweb/src/styles/theme.css`

**Interfaces:**

- Consumes Task 5 store and view-model helpers.
- Emits `created({ projectId, nextAction })` from `NewProjectWizard`.

- [ ] **Step 1: Write source-contract and render-model tests**

测试要求可见文本和动作均存在：`新建项目`、`示例项目`、`导入项目归档`、`继续剧本`、`继续设定`、`继续分镜`、`继续短片`、`项目详情`、`阻塞项`、`运行任务`。项目卡不得用“已完成分镜数量”冒充阶段批准状态；必须能同时显示 `已确认`、`阻塞 1`、`失败任务 1`。

新建向导入口固定显示：空白项目、从想法开始、导入剧本、已有视频、剧集制作包。已有视频按钮跳转 `/media-library?next=create-project-from-video` 并显示“将在媒体库选择来源视频”，不能提交未实现的后端模式。

- [ ] **Step 2: Run and verify missing-component failure**

```powershell
& $node22 --test test/projectHubUi.test.js
```

Expected: FAIL because the V2 hub components do not exist.

- [ ] **Step 3: Implement project list states**

页面包括搜索、状态筛选、最近工作排序、分页和卡片网格。必须实现：首次加载骨架、空项目、无搜索结果、加载失败重试、项目无剧集、项目有 blocker、项目有运行任务。主动作优先继续最近剧集；无剧集时进入项目详情的剧集空状态。

- [ ] **Step 4: Implement new project wizard**

向导验证标题、项目 Look、画幅和 start mode。`episode_package` 成功建壳后导航到 `/projects/:id?tab=episodes&import=1`；`idea/script` 成功后进入首集 script；`blank` 进入项目概览。`示例项目` 复用 `dramaAPI.getExamples/importExample`，失败不得遗留项目壳；`导入项目归档` 继续调用现有 ZIP 导入 API，明确只接受 `.zip`，导入后必须可再次导出并对账。

- [ ] **Step 5: Add semantic tokens and responsive behavior**

补 `--project-card-bg`、`--project-card-border`、`--project-stage-not-started/in-progress/review/approved/stale` 与独立 `--project-gate-blocker/--project-task-running/--project-task-failed`。1280px 不出现页面级横向滚动；窄屏卡片改为单列，阶段摘要可以换行但不能隐藏状态文本。

- [ ] **Step 6: Run tests and both builds**

```powershell
& $node22 --test test/projectHubUi.test.js test/projectHubStore.test.js test/projectLifecycleContracts.test.js
& $npm22 run build
$env:VITE_PRODUCTION_STUDIO_V2='1'
& $npm22 run build
Remove-Item Env:VITE_PRODUCTION_STUDIO_V2
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add frontweb/src/views/projectHub/ProjectHub.vue frontweb/src/components/projectHub/ProjectSummaryCard.vue frontweb/src/components/projectHub/NewProjectWizard.vue frontweb/src/styles/theme.css frontweb/test/projectHubUi.test.js
git commit -m "feat: add project hub dashboard and creation flow"
```

## Task 7: Project detail tabs, episode list and import provenance

**Files:**

- Create: `frontweb/src/views/projectHub/ProjectDetail.vue`
- Create: `frontweb/src/components/projectHub/ProjectOverviewTab.vue`
- Create: `frontweb/src/components/projectHub/ProjectBibleTab.vue`
- Create: `frontweb/src/components/projectHub/EpisodeTable.vue`
- Create: `frontweb/src/components/projectHub/ProjectAssetsTab.vue`
- Create: `frontweb/src/components/projectHub/ProjectDataTab.vue`
- Create: `frontweb/src/components/projectHub/EpisodeImportSourceDrawer.vue`
- Create: `frontweb/src/components/projectHub/EpisodeBatchImportDialog.vue`
- Create: `frontweb/src/components/projectHub/CopyScriptDialog.vue`
- Create: `frontweb/src/components/projectHub/ExternalAiCollaborationDialog.vue`
- Modify: `frontweb/test/projectHubUi.test.js`
- Modify: `frontweb/src/views/productionStudio/ProductionStudio.vue`

**Interfaces:**

- Project detail tabs: `overview | bible | episodes | assets | data`，URL query `tab` 是唯一可分享状态。
- `EpisodeTable` emits `continue`, `import`, `view-source`, `create`, `edit`, `soft-delete`, `reorder`, `copy-script`, `external-ai`。
- `EpisodeImportSourceDrawer` consumes V2 `GET /episodes/:episodeId/import-source`。

- [ ] **Step 1: Write tab and episode action tests**

断言每个剧集行可见：集号、标题、目标时长、来源、上次工作位置、剧本/设定/分镜/短片四阶段状态、独立 blocker/任务计数。外部导入显示 `外部来源 2.1`；空白集主动作是 `编辑或导入`；非空集不显示导入覆盖按钮。另测新建、编辑、软删除、集号重排、小说/章节批量导入预览、复制剧本和 External AI 协作入口。

- [ ] **Step 2: Run and verify failure**

```powershell
& $node22 --test test/projectHubUi.test.js test/episodeImportSourceUi.test.js
```

Expected: FAIL until detail and source components exist.

- [ ] **Step 3: Implement the five responsibility tabs**

- 概览：最近工作、四阶段汇总、活动任务、blocker 和继续制作；
- 项目圣经：标题、梗概、类型、Look、画幅，通过 V2 命令 API 以 fingerprint 乐观锁写入；
- 剧集：剧集表、新建/编辑/软删除、集号重排、小说/章节批量导入、复制剧本、External AI 协作和五步制作包导入；
- 资产：只读汇总角色/场景资产/道具及批准状态，编辑跳到 Assets Stage；
- 数据管理：现有项目 ZIP 导出、导入来源清单和删除入口；删除继续使用既有二次确认与生命周期服务，并明确“完整软删除/恢复/物理清理将在 Phase 5 统一迁移”，本阶段不伪装已完成 A-P05。

小说/章节批量导入先复用现有解析结果做只读预览，显示集号、标题、空内容和冲突；提交通过 Task 4 的单事务命令，部分非法则整体拒绝。复制剧本必须选择空白或明确目标集，只创建目标 ScriptRevision 草稿。External AI 协作复用现有 context/task/download 服务，任务冻结资产摘要 hash，结果仍进入同一五步导入和 `TARGET_NOT_BLANK` 检查。

- [ ] **Step 4: Implement provenance drawer**

抽屉四个区块：元数据、原始 JSON、规范化 JSON、导入报告。显示文件名、SHA-256、协议、导入时间、升级报告和结构统计；下载文件名经过现有 `sanitizeSourceFilename` 规则。解析警告可见，但不得在浏览器控制台输出原文。

- [ ] **Step 5: Add Studio compact source entry**

只有当前剧集存在 `import_source` 时，Studio header 显示 `查看外部来源`；点击复用同一 drawer。源码测试必须断言 Studio 不包含 `导入外部 JSON`、`强制覆盖`、`智能合并`。

- [ ] **Step 6: Run tests and build**

```powershell
& $node22 --test test/projectHubUi.test.js test/episodeImportSourceUi.test.js test/productionStudioShell.test.js test/dramaDetailDeletionContracts.test.js
& $npm22 run build
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add frontweb/src/views/projectHub/ProjectDetail.vue frontweb/src/components/projectHub frontweb/src/views/productionStudio/ProductionStudio.vue frontweb/test/projectHubUi.test.js
git commit -m "feat: add project detail and episode management center"
```

## Task 8: Five-step episode package import wizard

**Files:**

- Create: `frontweb/src/components/projectHub/EpisodeImportWizard.vue`
- Create: `frontweb/test/episodeImportWizard.test.js`
- Create: `frontweb/test/episodeImportV21Ui.test.js`
- Modify: `frontweb/src/views/projectHub/ProjectDetail.vue`
- Modify: `frontweb/src/stores/projectHub.js`

**Interfaces:**

- Consumes Task 4 V2 import routes.
- Consumes Task 5 `IMPORT_STEPS/createImportWizardState/canAdvanceImportStep`。
- Emits `imported({ projectId, episodeId })` only after commit succeeds.

- [ ] **Step 1: Write wizard state-machine tests**

```js
const state = createImportWizardState();
assert.equal(state.step, 'target');
assert.equal(canAdvanceImportStep(state), false);

state.file = { name: 'ep1.json', size: 1024 };
state.preview = validPreview;
assert.equal(canAdvanceImportStep(state), true);

state.preview.target = { status: 'non_blank', reasons: ['SCRIPT_PRESENT'] };
assert.equal(canAdvanceImportStep(state), false);
```

覆盖预览过期、目标变化重新预览、资产冲突未决、时间码错误、提交中禁止关闭、提交 409 后保留文件与预览、成功后清空敏感原文状态。

- [ ] **Step 2: Write source-contract tests for five visible steps**

五步标题固定为：

```text
文件与目标
剧本与场次
资产匹配
分镜与时段
确认导入
```

源码必须包含 `TARGET_NOT_BLANK` 映射和三个动作：`选择空白剧集`、`创建新剧集`、`取消`；不得包含 `覆盖`、`合并`、`追加`、`忽略检查` 作为可执行按钮。

- [ ] **Step 3: Run and verify current three-step dialog is insufficient**

```powershell
& $node22 --test test/episodeImportWizard.test.js test/episodeImportV21Ui.test.js
```

Expected: FAIL because the current dialog has three steps and no story-scene/timed-segment view.

- [ ] **Step 4: Implement Step 1 and Step 2**

Step 1 支持 `.json`、UTF-8、最大 10MB；目标只允许创建新剧集或从服务端空白列表选择。选文件或换目标立即重新预览。Step 2 显示剧集标题、集号、梗概、剧本文本和 `story_scenes[]`，场次卡显示 source key、序号、地点、时间和摘要；这里只读，不提供局部修改后绕过 Schema 的能力。

- [ ] **Step 5: Implement Step 3 and Step 4**

Step 3 对角色/状态、场景资产、道具逐项显示 `create/reuse/conflict` 及匹配证据：`source_key` 或来源 id/hash 精确匹配才可预选 `reuse`；仅同名必须保持 `conflict` 并由用户明确决定，且不允许覆盖项目 Look。Step 4 按分镜显示计划时长、关联场次、1～N 时段、连续时间码和逐时段引用；单时段不显示警告，多时段缺口/重叠显示后端错误路径。不得在导入页选择 Provider 或显示 request duration。

- [ ] **Step 6: Implement final confirmation and race-safe commit**

Step 5 汇总新建/复用数量、剧集目标、分镜与时段数、警告及以下明确声明：`仅导入结构化草稿，不生成图片、视频或音频`。提交 payload 使用最后一次预览返回的 `source_sha256` 和 decisions。若服务端返回 `TARGET_NOT_BLANK`，停留向导并回到目标区提示，不重试覆盖；若 hash mismatch，要求重新预览。

- [ ] **Step 7: Run frontend and backend import slices**

```powershell
& $node22 --test test/episodeImportWizard.test.js test/episodeImportV21Ui.test.js test/episodePackageImportTarget.test.js test/episodePackageMatch.test.js test/episodeImportSourceUi.test.js
Set-Location ..\backend-node
& $node22 --test test/episodeImportWorkflowService.test.js test/episodeImportV2Routes.test.js test/episodePackageRoutes.test.js
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```powershell
git add frontweb/src/components/projectHub/EpisodeImportWizard.vue frontweb/src/views/projectHub/ProjectDetail.vue frontweb/src/stores/projectHub.js frontweb/test/episodeImportWizard.test.js frontweb/test/episodeImportV21Ui.test.js
git commit -m "feat: add five-step safe episode import wizard"
```

## Task 9: End-to-end acceptance, evidence and changelog

**Files:**

- Create: `docs/research/_artifacts/localminidrama-project-hub-import-v2.1-acceptance/README.md`
- Create screenshots in the same directory.
- Modify: `CHANGELOG.md`

**Interfaces:** None; this is the release evidence gate.

- [ ] **Step 1: Run all backend tests**

```powershell
Set-Location backend-node
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe' --test test/*.test.js
```

Expected: exit 0 and zero failed tests.

- [ ] **Step 2: Run all frontend tests and both builds**

```powershell
Set-Location ..\frontweb
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe' --test test/*.test.js
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\npm.cmd' run build
$env:VITE_PRODUCTION_STUDIO_V2='1'
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\npm.cmd' run build
Remove-Item Env:VITE_PRODUCTION_STUDIO_V2
```

Expected: tests and both builds PASS.

- [ ] **Step 3: Execute local UI acceptance without paid generation**

验证以下完整路径：

1. V2 flag off 时根路由和 `/drama/:id` 仍显示旧页面；
2. flag on 时根路由显示 Project Hub，旧详情链接进入新项目详情；
3. 项目卡显示真实四阶段摘要、任务和 blocker；
4. 项目详情五个 tab 可刷新、前进后退和深链；
5. 新建空白项目、想法项目、剧本项目成功；
6. 制作包模式先建项目壳再打开导入向导；
7. V2.1 单时段包预览和导入成功；
8. V2.1 多时段、多场景资产包预览和导入成功；
9. 旧 1.x 包明确显示单时段升级报告并成功导入；
10. 选择非空剧集立即阻断，只提供选择空白、新建、取消；
11. 预览后目标被写入时，提交返回 `TARGET_NOT_BLANK` 且零部分写入；
12. 导入后图片、视频、音频任务计数不增加；
13. 剧集列表与 Studio 均可只读查看来源；
14. 同 source key/hash 可精确复用，仅同名资产必须人工决策；
15. 项目编辑、剧集增删改/重排、复制剧本和批量章节导入在并发冲突时返回 409 且不丢数据；
16. 示例项目失败零残留，成功项目可 ZIP 再导出；
17. External AI task 的资产摘要 hash 与导入来源可追溯；
18. 1280×720 深/浅主题无页面级横向溢出。

验收 README 必须逐项映射 `A-P01～A-P04`、`A-E01～A-E05`、`A-I01～A-I03`、`A-A05` 和 `A-ST01/A-ST05`。`A-P05`、恢复与物理清理明确记为 Phase 5 未验收，不得用现有删除弹窗替代。

- [ ] **Step 4: Capture exact acceptance screenshots**

```text
01-project-hub.png
02-project-card-blocked.png
03-project-detail-overview.png
04-project-detail-episodes.png
05-import-target.png
06-import-story-scenes.png
07-import-assets.png
08-import-timed-segments.png
09-import-confirm.png
10-import-target-not-blank.png
11-import-source-drawer.png
12-project-hub-light.png
```

README 记录 URL、viewport、可见状态、SHA-256 和证据边界；不得捕获 API key、绝对用户路径或未脱敏的远端凭据。

- [ ] **Step 5: Verify database invariants directly**

对验收数据库执行只读查询，记录：每个已导入分镜至少一个时段；首段 0、尾段等于计划时长、相邻无缝；引用实体属于同一项目；非空拒绝用例各表计数不变；所有媒体任务计数保持不变。

- [ ] **Step 6: Run diff and sensitive-data checks**

```powershell
Set-Location ..
git diff --check
rg -n "sk-[A-Za-z0-9]|api_key\s*[:=]\s*['\"][^'\"]+|Bearer\s+[A-Za-z0-9]" docs/research/_artifacts/localminidrama-project-hub-import-v2.1-acceptance backend-node/src frontweb/src
```

Expected: diff check exit 0; sensitive scan finds no credential value.

- [ ] **Step 7: Update `[未发布]` only with verified behavior**

在“新增/优化/文档与工程”记录：V2 项目中心与项目详情、真实阶段摘要、五步制作包导入、方案 B 持久化、非空事务阻断、来源追溯、V1 双轨兼容和验收证据。明确导入不触发媒体生成；不要宣称 Phase 3 分镜编辑工作台或 Phase 4 成片链路已完成。

- [ ] **Step 8: Commit acceptance evidence**

```powershell
git add CHANGELOG.md docs/research/_artifacts/localminidrama-project-hub-import-v2.1-acceptance
git commit -m "docs: record project hub and import acceptance"
```

## Self-review results

- Spec coverage: P-01～P-04、E-01～E-05、I-01～I-03，以及项目卡、最近工作、项目详情五 tab、剧集四阶段状态、统一导入入口、五步向导、V2.1 场次/时段、旧包单时段升级、来源查看和深浅主题验收均有独立任务；P-05 明确延后到 Phase 5。
- Safety boundary: `TARGET_NOT_BLANK` 同时覆盖预览提示与事务内重检；计划中没有合并、覆盖、追加或忽略检查入口。
- Existing capability reuse: 现有资产匹配、`episodePackageService`、`episodeImportProvenanceService`、V1 routes、项目 ZIP 和 Phase 1 stage service 均保留；没有第二套导入审计或生成系统。
- Product truthfulness: 项目阶段状态来自批准状态而不是媒体数量；导入页不伪造 Provider 能力；“已有视频”明确进入现有媒体库而非提交不存在的创建模式。
- Type consistency: `projectId/episodeId/sourceSha256/expectedFingerprint/expectedRevision` 在服务层使用 camelCase，HTTP body 保持 `project_id/target_episode_id/source_sha256/expected_fingerprint/expected_revision`；五步 key 与组件测试一致。
- Scope boundary: 本计划提供 Phase 3 所需的结构仓库和导入投影，但不实现分镜编辑器、Provider 生成面板、候选选片、时间线或 Delivery。
- Placeholder scan: 计划不包含未决占位标记、模糊错误处理或未命名测试；每个任务都有失败测试、实现边界、验证命令和提交范围。
- Explicit gap: “已有视频开始项目”在本计划中只进入现有媒体库，不建立项目级源视频绑定；正式绑定、解析和反推制作结构需要单独的 source-media 规格，不混入单集 JSON 导入事务。
