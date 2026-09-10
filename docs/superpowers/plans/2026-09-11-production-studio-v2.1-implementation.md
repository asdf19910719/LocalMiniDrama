# LocalMiniDrama Production Studio V2.1 产品代码实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（本文在单一会话内自主执行）配合 superpowers:test-driven-development 逐任务执行。步骤使用 checkbox（`- [ ]`）语法跟踪。

**Goal:** 把已通过评审的 V2.1 统一原型（行为合同）落成产品代码：后端 V2.1 领域模型与 API、前端 Production Studio 页面，完成六阶段交付与两条核心流程（业务主流程 / 外部 AI 制作包回流）的集成验收。

**Architecture:** 纯 JavaScript。后端在既有 Express + better-sqlite3（端口 5679）上新增 `backend-node/src/v21/` 领域模块（路由挂 `/api/v2`，Phase 1–5 不接管正式路由）；Phase 6 统一切换 canonical 路由并删除旧实现。前端在既有 Vite + Vue 3（端口 3013）新增 `frontweb/src/views/productionStudio/` 与 `frontweb/src/v21/`（API 客户端 + 可测 view-model），Phase 6 切换默认路由并删除旧页面。领域事实源新增表见 §2；既有表（dramas/episodes/storyboards/characters/scenes/props/image_generations/video_generations/director_*/async_tasks/external_ai_package_tasks/episode_imports）按复用处置接入。

**Tech Stack:** Node 22（内置 node --test）、Express 4、better-sqlite3、Vue 3 + Vue Router + Element Plus、Vite 5。无 TypeScript、无 monorepo 工具、无 V1/V2 运行期双轨。

**Spec:** 
- 架构母稿 `docs/superpowers/specs/2026-09-05-production-studio-v2-design.md` + 五份 P0 附件（同目录 2026-09-08-*）
- 最新裁决：`docs/superpowers/specs/2026-09-10-production-studio-v2.1-single-creator-refinement-design.md`、`...-storyboard-redesign-design.md`、`...-cut-redesign-design.md`、决策记录 §9/§10/§11
- 行为合同：`docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`（181 命令/模型函数）+ `.test.cjs`（~174 项锁定投影）
- 协议：`docs/superpowers/specs/schemas/episode-package-v2.1.schema.json`、`external-ai-result-v2.1.schema.json`、`shot-package-v2.1.schema.json`

## Global Constraints（每个任务隐含遵守）

1. 纯 JavaScript；不引入 TypeScript；不做 monorepo 工具化。
2. 不建 V1/V2 feature flag、双写、旧路由回退、旧 API 兼容层（Provider Adapter / 外部 AI 确定性 Adapter / 导入格式 Adapter 允许）。
3. Phase 1–5 只做内部开发、自动测试与影子验证，不接管正式路由；Phase 6 冻结→备份+journal→事务迁移并对账→统一切换→删除旧实现。
4. 原型即合同：项目内导航仅 `概览/剧集/项目素材`；单集阶段 `剧本/设定/分镜/成片`；剧集创建仅"新建剧集 + 导入/协作"；本集设定只投影引用对象（三 Tab，`assetId+stateId+mediaVersionId`）；分镜随时可进入、`mediaReadiness` 状态条 + 生成守卫；界面无归档/无目标时长/无工程术语。
5. 安全边界：媒体/费用动作必须绑定有效已确认剧本版本 + 本集素材快照；外部 AI 结果导入只写草稿、绝不自动确认剧本、绝不创建图片/视频/音频任务；删除一律回收站式可恢复，被引用资产删除前列影响。
6. 无 Key 可运行：未配置任何 Provider Key 时核心流程可用（`mock` 通道确定性生成），集成测试不依赖付费服务。
7. 每完成并验证一个任务，同一批变更更新 `CHANGELOG.md` `[未发布]`。
8. 每任务一条提交，只暂存该任务明确修改的文件；改造复用的提交信息写明"改了什么/为什么安全/哪些测试证明"。
9. 冲突码与 409：剧本 `REVISION_CONFLICT`、素材 `VERSION_CONFLICT`、分镜 `SHOT_REVISION_CONFLICT`、候选 `ADOPTION_CONFLICT`、外部导入 `PACKAGE_HASH_MISMATCH/TARGET_NOT_BLANK`、成片沿用 `expected_*` 契约。
10. 验证命令：`cd backend-node && node --test test/*.test.js`；`cd frontweb && node --test test/*.test.js`；`node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`；`cd frontweb && npm run build`。

## 复用处置总表（任务级明细在各任务标注）

| 对象 | 处置 | 理由 |
|---|---|---|
| dramas/episodes/storyboards/characters/scenes/props 表体系 | 直接复用 | 既有本地事实源，V2.1 通过新表补充版本/快照层，字段语义一致 |
| `ensureColumns()` + migrations/*.sql 启动迁移 | 直接复用 | 机制满足"启动自动迁移"；新增 36 号迁移承载 V2.1 表 |
| episodePackageService/Validator/Schema/Projection（五步导入、TARGET_NOT_BLANK、事务重检） | 直接复用 | 协议 2.1 已实现并有 15+ 测试；按 EXT-201 挂到向导 |
| externalAiTaskBundleService / externalAiResultContract / externalAiResultAdapter / episodeImportProvenanceService | 直接复用 | 制作包/结果校验/来源审计契约与 V2.1 一致 |
| 风格系统（styleRegistryService、项目 style_id、generation_style_snapshots） | 直接复用 | "画面风格"=既有项目风格版本行为；只影响之后的新生成已满足 |
| H3 全链路（h3PromptDraftService/h3PromptCompiler/SemanticValidator/技能包） | 改造复用 | 保留编译/校验/stale 核心；补"分镜页一等公民"投影与来源 fingerprint 变化→stale 触发 |
| referenceSlotService/referenceRegistry（@图片N 槽位） | 直接复用 | 分镜图/H3/视频三处共用的槽位解析 |
| director_candidate_groups/candidates/artifacts（候选三表） | 改造复用 | 作为视频候选唯一事实源；补 adopted 指针与"用于本镜"唯一采用语义 |
| videoMergeService/video_merges（整集合片+混音） | 改造复用 | 混音后端保留；外层包成"成片版本 vN + 可恢复任务" |
| taskService/async_tasks（可恢复任务） | 直接复用 | 进度/取消/重试机制满足任务中心 |
| imageGenerationOrchestrator/多通道生图 | 改造复用 | 通道解析保留；新增 `mock` 确定性通道满足无 Key 运行与测试 |
| projectDeletionService / projectDeletionRoutes（项目删除生命周期） | 改造复用 | 回收站式软删除核心保留；补剧集级删除与影响清单 |
| DramaService（项目 CRUD/ZIP 导出导入） | 改造复用 | 列表/新建接入 V2.1 投影；ZIP 导入导出独立页保留 |
| script_content 单字段剧本 | 改造复用 | 一次性迁移进 `episode_script_revisions`；运行期只写 revision |
| FilmCreate.vue / DramaDetail.vue / FilmList.vue / DramaCanvas.vue | 重新实现（Phase 6 删除） | 单页长流程/旧信息架构与 V2.1 页面契约冲突；其内嵌能力由新页面+既有后端承载 |
| VideoGenerationPanel 的 H3 区与候选逻辑 | 改造复用 | 状态机/轮询逻辑迁入新分镜页 composables |

## 交付面与文件结构

```text
backend-node/src/v21/
  db.js                        # v21 迁移注册（36 号 SQL）
  stage/                       # T1.2 production_stage_states 状态机 + events + 409
  backup/                      # T1.3 backupService + migrationJournal（migration-state.json）
  projects/                    # T2.1 项目列表/新建/概览聚合 API
  episodes/                    # T2.2 剧集中心 API（新建/筛选/重命名/集序/回收站删除）
  script/                      # T3.1 剧本 revision/自动保存/确认/场次结构
  assets/                      # T3.2 项目素材 V2.1 API + T3.3 本集设定引用与快照
  storyboard/                  # T4.x 场次-分镜-时段、引用、图片、H3、视频、守卫
  cut/                         # T5.x 审片/合成/成片版本/导出
  wizard/                      # T2.4 外部 AI 向导 8 步
  migration/                   # T6.2 一次性正式迁移器（对账+恢复）
  mockProvider.js              # T1.5 确定性 mock 生成通道
backend-node/migrations/36_v21_domain.sql
frontweb/src/v21/              # api/*.js + viewmodel/*.js（node --test 可测）
frontweb/src/views/productionStudio/
  ProjectsView.vue ProjectNewView.vue ProjectOverviewView.vue
  ProjectEpisodesView.vue ProjectAssetsView.vue ExternalAiWizardView.vue
  EpisodePackageImportView.vue NovelImportView.vue SourceVideoView.vue
  studio/StudioShell.vue ScriptStage.vue AssetsStage.vue StoryboardStage.vue CutStage.vue
  TasksView.vue LibraryView.vue SettingsEntry.vue
frontweb/test/v21-*.test.js    # 源合同 + view-model 测试
backend-node/test/v21-*.test.js
```

---

# Phase 1：领域模型、数据库与迁移基础

### Task 1.0：实施分支与计划落档
- [x] 从 `codex/v2-1-personal-prototype` 拉出 `codex/v2-1-implementation`；本计划提交至 `docs/superpowers/plans/`。

### Task 1.1：V2.1 领域表与应用 schema 版本
**Files:** Create `backend-node/migrations/36_v21_domain.sql`、`backend-node/src/v21/db.js`；Test `backend-node/test/v21DomainSchema.test.js`
**复用处置：** 改造复用（在既有 migrations 机制上追加，新表为 V2.1 强制事实源的最小必要集）。
- 新表：`app_meta(key,value)`；`production_stage_states`（唯一键 episode_id+stage）；`production_stage_events`；`episode_script_revisions`（draft/approved/superseded + expected 并发列）；`story_scenes`；`storyboard_segments`；`episode_asset_selections`（assetId+stateId+mediaVersionId）；`episode_asset_set_snapshots`（items_json+fingerprint+status）；`episode_cut_versions`；`gate_waivers`；`project_style_events`（画面风格版本事件，供"只影响之后的新生成"审计）。`app_meta` 写 `app_schema_version=2.1.0`。
- 先失败测试：36 号迁移在空库执行后上述表存在、唯一约束生效（重复 stage 写入抛错）、`app_meta` 读回 `2.1.0`。
- 验证：`cd backend-node && node --test test/v21DomainSchema.test.js`。

### Task 1.2：阶段状态机服务（状态真值表）
**Files:** Create `backend-node/src/v21/stage/stageStateService.js`；Test `backend-node/test/v21StageState.test.js`
**复用处置：** 重新实现（既有代码无阶段状态机；真值表为准）。
- 转换表（not_started→in_progress→ready_for_review→approved→stale→…）+ 每次转换写 `production_stage_events`；所有 mutation 支持 `expected_revision`，不匹配返回 409 `REVISION_CONFLICT`；任务失败不覆盖 approved（仅 badge 数据）。
- 测试覆盖真值表 §3 全部行 + 409 路径。
- 验证：`node --test test/v21StageState.test.js`。

### Task 1.3：备份与迁移 journal
**Files:** Create `backend-node/src/v21/backup/backupService.js`、`backend-node/src/v21/backup/migrationJournal.js`；Test `backend-node/test/v21BackupJournal.test.js`
**复用处置：** 重新实现（无既有实现；Platform P0）。
- backupService：SQLite 主库备份（checkpoint WAL）+ `manifest.json` + 文件 hash 清单，落 `data/backups/v2.1/<migration-id>/`。
- migrationJournal：`migration-state.json` 原子写（temp+rename），状态机 `PRECHECK→BACKED_UP→MIGRATING→VERIFYING→COMMITTED/FAILED`，保存 migration id/PID/时间/备份目录/DB-WAL-SHM hash；发现 MIGRATING/VERIFYING 拒绝重跑；COMMITTED 且版本 2.1.0 时幂等退出。
- 测试在临时目录 + fixture 库执行（不触真实数据）。
- 验证：`node --test test/v21BackupJournal.test.js`。

### Task 1.4：mock 生成通道（无 Key 可运行）
**Files:** Create `backend-node/src/v21/mockProvider.js`；Test `backend-node/test/v21MockProvider.test.js`
**复用处置：** 改造复用（对齐既有 Provider 任务契约：queued→running→succeeded、进度、取消、重试、费用快照字段）。
- 确定性输出：图片生成写入真实 PNG（sharp 生成纯色/渐变占位），视频生成产出真实 MP4（ffmpeg 存在则 concat 彩条，否则延迟占位并在能力层声明），异步任务走 async_tasks；请求契约字段与真实 Provider 相同（鉴权头占位、超时、取消、幂等键）。
- 测试：提交→轮询→完成→产物文件存在且可解码；取消进入 cancel-requested。
- 验证：`node --test test/v21MockProvider.test.js`。

### Task 1.5：Phase 1 门禁
- 全量测试（后端+前端+原型回归）+ `git diff --check`；启动后端冒烟 `/health` 返回且 36 号迁移幂等重跑；进展文档 + CHANGELOG + 提交。

# Phase 2：项目/剧集/导入

### Task 2.1：V2.1 项目 API（列表/新建/概览聚合）
**Files:** Create `backend-node/src/v21/projects/projectService.js`、`backend-node/src/v21/projects/projectRoutes.js`；Test `backend-node/test/v21Projects.test.js`
**复用处置：** 改造复用（dramaService 的 CRUD/软删除保留为底层；V2.1 投影按原型 PROJECTS/PERSONAL/NAV-201 口径）。
- 列表卡：上次工作（ResumePosition）、当前阶段、健康摘要（生成中/待处理/需要更新计数）；`q/status/sort` 查询参数；新建（名称/画幅/题材，**无时长字段**，元数据写 aspect_ratio/genre）；概览聚合：Hero（封面/名称/题材/画幅/集数/最近编辑）、下一步（ResumePosition 精确恢复）、待处理（≤5 条，带 target）、素材一行聚合（对象数+缺可用形象数）、风格摘要。
- 测试：创建→列表→概览聚合字段断言；无时长字段投影断言；软删除项目从列表消失。
- 验证：`node --test test/v21Projects.test.js`。

### Task 2.2：V2.1 剧集中心 API
**Files:** Create `backend-node/src/v21/episodes/episodeCenterService.js`、`.../episodeCenterRoutes.js`；Test `backend-node/test/v21EpisodeCenter.test.js`
**复用处置：** 改造复用（episodes 表 + storyboard 阶段推导；删除复用 projectDeletionService 软删除模式补剧集级）。
- 新建剧集（集号+可选标题→空白草稿，直达剧本）；筛选 `全部/需要处理/制作中/已完成`；搜索 280ms 语义（服务端只做过滤）；行内重命名/调整集序（冲突 409）/删除（回收站+影响清单：剧本/分镜/媒体/空间计数）/恢复；查看导入来源（episode_imports 只读）。
- 阶段投影：四阶段状态由 production_stage_states + 内容存在性派生；分镜未齐显示"分镜 · 需处理 N 镜"。
- 测试：新建→筛选→重命名→集序冲突 409→删除（进入回收站）→恢复；非空校验（TARGET_NOT_BLANK 的数据基础 isEpisodeBlank）。
- 验证：`node --test test/v21EpisodeCenter.test.js`。

### Task 2.3：导入/协作四流程接入
**Files:** Create `backend-node/src/v21/episodes/importEntryService.js`；Modify（仅挂路由）`backend-node/src/v21/...`；Test `backend-node/test/v21ImportEntry.test.js`
**复用处置：** 直接复用（episodePackageService 五步导入 + novelImportService 拆集）+ 改造复用（已有视频登记：登记媒体/hash/路径进 assets，进入短片时间线）。
- 四流程统一经 EpisodeTargetSelector 语义（创建下一可用集号 / 填充空白集；非空集 TARGET_NOT_BLANK 且事务内重检）。
- 测试：制作包导入创建新集（复用既有 service 测试夹具）；非空集提交被拒；导入零媒体任务断言（async_tasks 无新增生成任务）。
- 验证：`node --test test/v21ImportEntry.test.js`。

### Task 2.4：外部 AI 向导后端（8 步）
**Files:** Create `backend-node/src/v21/wizard/externalAiWizardService.js`、`.../externalAiWizardRoutes.js`；Test `backend-node/test/v21ExternalAiWizard.test.js`
**复用处置：** 直接复用（externalAiTaskBundleService 建包、externalAiResultContract 校验、externalAiResultAdapter 适配、episodePackageService 五步导入、episodeImportProvenanceService 审计）。
- 步骤：target（create_next/fill_blank）→ compiled-context（自动汇总只读）→ task-note（唯一可编辑，写入任务记录）→ package（package_id/assets_digest/下载 ZIP+单文件 JSON）→ waiting（持久化到剧集行+任务中心）→ result-file（校验 schema/package_id/project_id/episode_id/assets_digest/context_version/asset-mapping/nonempty-target，错误逐项返回）→ import-preview（五步）→ imported-draft（事务写入草稿；`writesApprovedScript=false`、`createsMediaTasks=false`）。
- 测试：合法夹具全绿；篡改 package_id 拒绝；导入后剧本为草稿、无媒体任务、审计四类证据可读；幂等（同 source_sha256+package_id+target 不重复建集）。
- 验证：`node --test test/v21ExternalAiWizard.test.js`。

### Task 2.5：Phase 2 门禁
- 全量测试 + 后端启动冒烟（/api/v2 列表/新建/剧集中心真实 HTTP 调用）；进展 + CHANGELOG + 提交。

# Phase 3：剧本与素材

### Task 3.1：剧本阶段（revision/自动保存/场次结构/确认）
**Files:** Create `backend-node/src/v21/script/scriptService.js`、`.../scriptRoutes.js`、`.../sceneParser.js`；Test `backend-node/test/v21Script.test.js`
**复用处置：** 改造复用（既有剧本 AI 生成链路 chat completion + novelImportService 解析器抽场次；一次性迁移 episodes.script_content → 首个 draft revision）。
- 草稿自动保存（expected_revision；409 `REVISION_CONFLICT`）；场次结构化解析（标题/内外景/地点/时间/正文/角色），草稿保存即解析并可编辑；AI 候选（无 Key 时 mock：返回确定性改写候选）→ diff → 应用；确认剧本/确认修改 → approved revision + 下游 stage 置 stale（按真值表）+ 预计素材变化（后台解析：新增/变化/删除候选/人工锁定）；历史版本抽屉数据（只读、复制为新草稿）。
- 测试：保存→409→场次解析→AI 候选应用→确认（stale 传播）→历史→复制恢复；无 Key mock 路径。
- 验证：`node --test test/v21Script.test.js`。

### Task 3.2：项目素材 V2.1 API（卡片/详情/候选/当前图/删除保护）
**Files:** Create `backend-node/src/v21/assets/assetQueryService.js`、`.../assetRoutes.js`；Test `backend-node/test/v21Assets.test.js`
**复用处置：** 改造复用（characters/scenes/props + character_variants + imageGenerationOrchestrator 多通道 + mock 通道 + image_generations 历史 = 候选；"点击候选即当前图"复用 imageGenerationResultSelection 语义并补撤销）。
- 列表卡（当前图/名称/类型/一句话描述/状态缩略/真实阻塞）；创建素材（两步最低字段，创建不调用 AI）；详情（摘要/状态切换/当前形象与候选/简短资料/生成上传/技术详情折叠）；生成（通道含 mock，费用快照）/上传（进候选）；点击候选→当前图+5 秒撤销窗口（后端记录 prev 指针）；删除：未引用可删（回收站）、被引用列影响（分镜/剧集/任务清单）并要求先替换或解除引用。
- 测试：创建→生成（mock）→候选→设为当前→撤销→删除保护（被分镜引用时列出影响）。
- 验证：`node --test test/v21Assets.test.js`。

### Task 3.3：本集设定（引用投影 + mediaReadiness + 进入分镜快照）
**Files:** Create `backend-node/src/v21/assets/episodeAssetsService.js`、`.../episodeAssetsRoutes.js`；Test `backend-node/test/v21EpisodeAssets.test.js`
**复用处置：** 改造复用（episode_characters/scene 关联解析"本集引用"；快照按状态真值表 §5）。
- 引用投影：从 approved 剧本场次解析角色/场景/道具三 Tab（assetId+stateId+mediaVersionId 指针）；`resolveEpisodeMediaReadiness`（checking/ready/needs-attention/snapshot-failed/script-unapproved）；本集选择更新；进入分镜 = 立即可进 + 后台事务快照（校验必需项→写 episode_asset_set_snapshots 含 version/hash/fingerprint→失败零部分写入）；快照失败后分镜可进、生成禁用。
- 测试：缺图对象→needs-attention+受影响镜头守卫；补图后→ready；快照事务失败→零部分写入；剧本未确认→script-unapproved 禁正式生成。
- 验证：`node --test test/v21EpisodeAssets.test.js`。

### Task 3.4：Phase 3 门禁（同前格式）

# Phase 4：分镜与生成

### Task 4.1：场次-分镜-时段结构
**Files:** Create `backend-node/src/v21/storyboard/storyboardStructureService.js`、`.../storyboardRoutes.js`；Test `backend-node/test/v21StoryboardStructure.test.js`
**复用处置：** 改造复用（storyboards 表 = 分镜行；新增 storyboard_segments 承载时码/画面/对白/声音/资产引用；引用绑定复用 referenceRegistry+storyboard_character_variants/storyboard_props）。
- 从 approved 剧本创建分镜结构（场次→镜头，场次引用绑定结构性不可移除）；镜头 CRUD/插入/删除/复制/编号（expected_revision→`SHOT_REVISION_CONFLICT`）；时段 CRUD：编辑/拆分/合并/上移/下移，时码连续闭合+总时长校验；引用管理（三组增删、@图片N 槽位 via referenceSlotService）；素材预览数据（版本/最新版本/可换绑/出现时段）。
- 测试：结构创建→时段拆分/合并闭合校验→引用增删→换绑→409。
- 验证：`node --test test/v21StoryboardStructure.test.js`。

### Task 4.2：分镜图（提示词两态 + 生成/上传 + 设为当前 + 失效传播）
**Files:** Create `backend-node/src/v21/storyboard/storyboardImageService.js`；Test `backend-node/test/v21StoryboardImage.test.js`
**复用处置：** 改造复用（imagePromptCompiler + 项目风格编译 + imageGenerationOrchestrator/mock）。
- 图片提示词自动拼装（时段画面描述+引用素材+项目风格）/手工覆盖/恢复自动；生成分镜图（确认抽屉契约：完整提示词/数量/费用）/上传进候选；设为当前→唯一 current 指针→H3 草稿标 stale（`引用已变化/分镜图已变化`）→旧视频标"基于旧分镜图"退出完成计数；历史保留。
- 测试：自动拼装→手工覆盖不被覆盖→生成（mock）→设为当前→H3 stale→改回恢复。
- 验证：`node --test test/v21StoryboardImage.test.js`。

### Task 4.3：H3 一等公民（生成/编辑/校验/门禁）
**Files:** Create `backend-node/src/v21/storyboard/h3DraftFacade.js`；Test `backend-node/test/v21StoryboardH3.test.js`
**复用处置：** 直接复用（h3PromptDraftService/h3PromptCompiler/h3PromptSemanticValidator/结构校验已有完整实现与测试）；改造点：来源 fingerprint 变化→stale 事件、四类校验结果投影、不覆盖人工文本。
- 测试：生成→编辑→保存并校验→来源变化标 stale→dirty/stale/invalid 阻断提交→人工文本保留。
- 验证：`node --test test/v21StoryboardH3.test.js`。

### Task 4.4：镜头视频生成（联合守卫/费用确认/数量/候选/采用）
**Files:** Create `backend-node/src/v21/storyboard/videoGenerationService.js`；Test `backend-node/test/v21StoryboardVideo.test.js`
**复用处置：** 改造复用（unifiedVideoGenerationService + videoGenerations + director_candidate_groups/candidates + mock 通道 + frame_prompts 首尾帧衔接）。
- `getStoryboardMediaGenerationGuard`（readiness 非 ready → 禁用+唯一"去处理"恢复入口）；联合检查四行（引用/能力/生成描述(H3)/同镜活动任务）；费用确认（输出时长单一字段、预计耗时单行、数量 1–3 费用乘算，越界拒绝）；提交 N 并行任务（取消/重试逐任务）；成功只追加候选；候选先载入播放器（preview）才可"用于本镜"；adopted 指针唯一 + 撤销（`ADOPTION_CONFLICT`）；生成历史（含失败按原输入重试）。
- 测试：守卫禁用→补素材后可提交→mock 生成→候选追加→preview→采用→撤销→数量 4 拒绝→取消 cancel-requested→失败重试新 attempt。
- 验证：`node --test test/v21StoryboardVideo.test.js`。

### Task 4.5：Phase 4 门禁（同前格式）

# Phase 5：成片与交付

### Task 5.1：审片模型 + 合成门禁
**Files:** Create `backend-node/src/v21/cut/cutReviewService.js`；Test `backend-node/test/v21CutReview.test.js`
**复用处置：** 重新实现（读取层：分镜 adopted 候选只读消费 + 状态着色 + 连播清单；门禁按 CUT-002）。
- shots 投影（completed/generating/failed/missing/stale + sourceLabel）；`gate.canCompose`（全部用于本镜或有效豁免（gate_waivers）、无基于旧分镜图未确认、无运行中任务）+ blockers 分组文案（与原型 syncCutDerived 一致）。
- 验证：`node --test test/v21CutReview.test.js`。

### Task 5.2：整集合成（可恢复任务 + 成片版本 + 导出）
**Files:** Create `backend-node/src/v21/cut/episodeComposeService.js`、`.../cutRoutes.js`；Test `backend-node/test/v21Compose.test.js`
**复用处置：** 改造复用（videoMergeService 混音合片核心 + async_tasks + video_merges 历史保留）。
- 合成任务：设置（bgm/narrationTts/subtitleBurn/upscale）→任务化（进度/取消 cancel-requested/失败按原设置重试，中间结果保留）→产出 `episode_cut_versions` vN（镜头候选快照+设置+产物路径+时长）；导出 MP4（复制/流拷贝到导出目录+记录 hash）与 SRT（从对白时段生成）；声音策略：保留原声+TTS/BGM 混音不覆盖原声。
- 测试：门禁禁用→合成（mock 媒体）→版本 v1→改设置重合成 v2→历史保留→取消→失败重试→导出 MP4+SRT→导出 hash 记录。
- 验证：`node --test test/v21Compose.test.js`。

### Task 5.3：Phase 5 门禁（同前格式）

# Phase 6：正式迁移与切换

### Task 6.1：前端 Production Studio（分阶段随 Phase 2–5 影子交付，此处统一切换）
**Files:** `frontweb/src/views/productionStudio/**`、`frontweb/src/v21/**`、`frontweb/src/router/index.js` 改造；Tests `frontweb/test/v21-*.test.js`
**复用处置：** 重新实现（页面壳与信息架构按原型合同）；改造复用（风格选择器、VideoGenerationPanel H3/候选逻辑、ExternalAiCollaborationDialog 数据流迁入向导页）。
- 全局 Rail：项目/资产库/任务/设置；项目内 概览/剧集/项目素材；单集 Studio Shell 阶段导航 剧本/设定/分镜/成片 居中；每页按原型默认投影实现（view-model 进 `frontweb/src/v21/viewmodel/` 供 node --test）。
- 页面清单与验收锚点：ProjectsView（卡片/搜索/筛选/URL）、ProjectNewView（名称/画幅/题材，无时长）、ProjectOverviewView（Hero+编辑资料窄抽屉+风格中央弹窗三页签+素材聚合行）、ProjectEpisodesView（新建剧集+导入/协作菜单+状态筛选+行内菜单含回收站删除）、ProjectAssetsView、studio/ScriptStage（三起点/场次结构/自动保存/确认/历史抽屉）、studio/AssetsStage（三 Tab 引用卡+共享抽屉+进入分镜）、studio/StoryboardStage（五区）、studio/CutStage（单屏审片+合片）、ExternalAiWizardView（8 步独立页）、EpisodePackageImportView（五步）、TasksView、LibraryView（P1 最小闭环）、SettingsEntry。
- 测试：每页 view-model 测试 + 关键源合同测试（无时长字段/无归档/无工程术语/守卫禁用文案）。

### Task 6.2：canonical 切换与旧实现删除
- router 默认 `/` → `/projects`；删除 `FilmList.vue`、`DramaDetail.vue`、`FilmCreate.vue`、`DramaCanvas.vue` 及旧路由；`project-bible` 别名重定向概览；下线旧写 API（drama/storyboard 旧接口停挂）；全量测试+构建+冒烟。
- 测试：静态检查旧视图文件不存在；构建产物路由可达；原型测试不回归。

### Task 6.3：一次性正式迁移演练与执行
**Files:** `backend-node/src/v21/migration/`（migrator.js + reconcile.js）；Test `backend-node/test/v21Migrator.test.js`
- 演练：fixture/副本库（构造含旧数据的 DB：episodes.script_content、storyboards、image/video 历史）→ 冻结预检（活动任务/锁）→ 备份+journal → 事务迁移（script→revision、storyboard 单时段、当前图/视频→候选+adopted、旧 merge→历史 artifact）→ 对账（计数/引用/hash）→ COMMITTED；失败注入→回滚+恢复备份。
- 执行：在真实 `backend-node/data/` 上先复制演练通过后执行正式迁移（启动时 journal 感知）。
- 验证：`node --test test/v21Migrator.test.js`；真实库迁移后冒烟。

---

# 最终集成验收（Phase 6 后）

- **A 集成测试**：`backend-node/test/v21Integration.e2e.test.js` 起真实 app（内存端口）覆盖：项目创建→剧集生命周期→剧本确认→设定快照→分镜生成（mock Provider，契约断言：字段/重试/取消）→合成导出→外部 AI 回流；异常路径：保存失败恢复、导入冲突回滚、任务失败重试、快照失败后分镜进入与生成禁用；复用模块（五步导入/H3/候选/合并/任务）与新链路贯通断言。
- **B GUI 黑盒走查**：browser-use 驱动真实界面执行剧本一（10 步）与剧本二（9 步），逐步记录 操作→预期→实际→判定；产出判定表。无浏览器工具时降级 API 级并标注。
- **C 收尾**：原型全套件通过；CHANGELOG 完整；`docs/vnext/v2.1-integration-acceptance-report.md`（两条剧本判定表/缺陷清单/复用台账/遗留风险/78 项 E2E 覆盖对照）。

## Self-Review 结论
- 覆盖：任务书六阶段与两条剧本均有对应任务；E2E 矩阵中不在两条剧本内的项（高级画布、自由创作、高级数据工具、Look Probe、局部重拍等）在验收报告中按"覆盖对照"如实标注（部分为 P2/后置，符合评审报告"自由创作和高级画布可在核心四阶段稳定后实现"）。
- 类型一致性：服务与 API 命名在 §交付面 固定，任务内引用一致。
- 无占位符。
