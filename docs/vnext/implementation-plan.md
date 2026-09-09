# LocalMiniDrama VNext Technical Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐，同一会话分任务执行）或 `superpowers:executing-plans`（独立会话按检查点执行）。

**Goal:** 在不停止现有产品、不丢失 Provider/本地能力且不进行 Big Bang Rewrite 的前提下，将 Current Architecture 渐进演进为 VNext 模块化单体，并让每一阶段可独立验收和回滚。

**Architecture:** 采用 Strangler Fig、Branch by Abstraction 与 Expand–Migrate–Contract。Legacy 页面、`/api/v1`、旧任务和旧 Provider 通过 Adapter 共存；新 Studio 使用 `/api/v2`、Application Command/Query、canonical Job/Attempt/Candidate 与版本化数据模型。每次只迁一个领域、Job kind 或 Provider。

**Tech Stack:** Vue 3、Vue Router、Pinia、Element Plus、Vite、Node.js 22、Express 4、better-sqlite3、Node built-in test runner、Electron、FFmpeg、现有 Provider SDK/HTTP clients。

**Spec:** `docs/vnext/product-spec.md`、`domain-model.md`、`state-model.md`、`target-architecture.md`、`migration-architecture.md`、`migration-map.md`。

**Global Constraints:** 默认 flags 下 Legacy 必须始终可运行；新 schema 先 additive；不改现有业务 ID；不把运行中的 Job 转移执行器；不删除旧接口直到 exit gate；每个 TASK 使用 Red → Green → Refactor → 全量相关回归 → checkpoint；功能变更完成并验证时按仓库规则更新根 `CHANGELOG.md`。

## 1. 执行与验收规则

### 1.1 任务执行模板

每个 TASK 在真正实施时严格执行：

1. 为当前行为或目标契约添加一个会失败的测试；
2. 运行该测试并确认因目标能力缺失而失败；
3. 实现最小变更；
4. 运行定向测试；
5. 运行所属 FEATURE 回归和仓库全量基线；
6. 记录 schema/contract/flag/rollback 证据；
7. 单独提交，提交中不得夹带下一 TASK。

基础命令：

```bash
cd backend-node && node --test test/*.test.js
cd frontweb && node --test test/*.test.js
cd frontweb && npm run build
cd browser-extension && node --test test/*.test.js
cd external-bridge && node --test test/*.test.js
```

PowerShell 环境逐条执行；不得因某个子项目无改动就跳过最终阶段回归。

### 1.2 阶段检查点

| Checkpoint | 包含 EPIC | 可独立验收结果 | Rollback point |
|---|---|---|---|
| CP0 | E0 | 安全默认、测试基线、ledger、flags | 回切构建 + 升级前 DB 备份 |
| CP1 | E1 | v2 只读契约与兼容投影 | 不挂 v2；v1 原样工作 |
| CP2 | E2 | 只读 VNext Shell | `vnext.shell=off` |
| CP3 | E3 | Script Revision/Gate | `vnext.script=off`；旧 current projection 可读 |
| CP4 | E4 | Setup/Asset authority | `vnext.setup=off`；write-through 保旧 UI |
| CP5 | E5 | Shot Package/Capability | `vnext.storyboard=off` |
| CP6 | E6 | Canonical Job/Candidate/Provider 按类型接管 | 按 job kind/provider flag 回切，在途任务原 owner 收尾 |
| CP7 | E7 | Picture Lock/Delivery | `vnext.film=off`；旧 merge 入口保留 |
| CP8 | E8 | 高级能力按需接入、Legacy 受控退出 | 每模块独立 revert；DDL contract 前完整备份 |

## EPIC E0 — 保护现状与建立迁移控制面（M0 / CP0）

### FEATURE E0-F1 — 安全与可重复基线

#### TASK E0-F1-T1 — 固化跨子项目回归基线

- **affected files:** 新增 `scripts/test-all.js`、`test/fixtures/README.md`、`docs/vnext/_evidence/baseline.md`；修改根 `package.json`（如不存在则仅创建编排脚本所需 package metadata）。
- **dependencies:** 无；先确认当前 Node 22 与四个子项目依赖可用。
- **acceptance criteria:** 一条根命令按固定顺序运行 backend、frontend、extension、bridge tests 和 frontend build；报告每套通过/失败数量与耗时；失败时非零退出。
- **tests:** 对编排器添加 `test/testAllScript.test.js`；执行五条基础命令和根编排命令，结果与当前基线一致。
- **migration risks:** 环境相关 live tests 或本地 native ABI 造成假失败；必须区分 hermetic baseline 与显式 opt-in live smoke，不能隐藏失败。
- **rollback:** 删除根编排入口即可，各子项目原命令不变。

#### TASK E0-F1-T2 — 建立脱敏历史数据库与包样本

- **affected files:** 新增 `backend-node/test/fixtures/migrations/*.db.fixture`、`backend-node/test/fixtures/migrations/manifests/*.json`、`backend-node/test/migrationFixtures.test.js`；复用 `backend-node/test/fixtures/episodePackageV11.json`。
- **dependencies:** E0-F1-T1；需要从全新库、旧版本库和当前真实结构的副本生成脱敏样本。
- **acceptance criteria:** 至少覆盖 fresh、pre-image-task、pre-director、current 四种 schema；fixture manifest 记录 schema objects、row counts、文件 hash，不含 API key、真实用户文本或绝对路径。
- **tests:** `cd backend-node && node --test test/migrationFixtures.test.js`；验证 fixtures 可只读打开、manifest 匹配、secret scanner 无命中。
- **migration risks:** 直接复制用户 DB 会泄露凭证/内容；必须脚本化脱敏并校验，不把真实 `data/` 检入。
- **rollback:** fixtures 只用于测试，可移除，不触碰用户数据库。

#### TASK E0-F1-T3 — 收紧本地监听、CORS、TLS 与凭证输出

- **affected files:** `backend-node/src/server.js`、`backend-node/src/app.js`、`backend-node/src/routes/aiConfig.js`、`backend-node/src/services/aiConfigService.js`、`backend-node/src/services/ttsService.js`、`backend-node/src/logger.js`、`backend-node/src/config/index.js`、`backend-node/configs/config.yaml`；新增/修改对应 `backend-node/test/*Security*.test.js`。
- **dependencies:** E0-F1-T1；需保留显式远程开发配置。
- **acceptance criteria:** 默认 host 为 `127.0.0.1`；远程监听要求明确配置；API 默认返回 masked secret；日志 redaction；不再全局设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`；单 Provider 测试 transport 才能放宽证书。
- **tests:** 新增 server default、CORS、secret response/log、TLS scope tests；运行 `appErrorHandling.test.js`、`aiConfig*.test.js` 与 backend 全量。
- **migration risks:** 现有局域网用户和自签名 Provider 可能受影响；提供显式、可诊断配置而不是静默兼容。
- **rollback:** 恢复旧构建；配置文件保留兼容字段但不再默认启用，DB 无变化。

### FEATURE E0-F2 — Migration Ledger 与 Feature Flags

#### TASK E0-F2-T1 — 引入 ledger runner 并 baseline 旧 schema

- **affected files:** 新增 `backend-node/src/db/vnextMigrationRunner.js`、`backend-node/src/db/schemaFingerprint.js`、`backend-node/migrations-vnext/000_bootstrap.sql`、`backend-node/test/vnextMigrationRunner.test.js`；修改 `backend-node/src/db/migrate.js`、`backend-node/src/app.js`。
- **dependencies:** E0-F1-T2。
- **acceptance criteria:** `schema_migrations` 保存 version/name/checksum/applied_at/app_version/duration；既有 01–35 和 ensure 结果只 baseline 一次；新迁移逐个事务执行；checksum 漂移阻止 readiness；重复启动无 DDL diff。
- **tests:** 对四类 fixture 执行 migrate 两次；模拟中断、重复版本、checksum 变化、SQL 失败；运行全部 migration 与 package tests。
- **migration risks:** 两个名为 20 的现有 migration、当前“错误字符串即忽略”行为和 ensure 补列可能导致误判；baseline 以实际 schema fingerprint 为准，不能假设文件名唯一。
- **rollback:** 在首次写入前自动备份 DB；关闭新 runner bootstrap，旧 runner 仍存在；不删除 `schema_migrations` 也不影响旧版。

#### TASK E0-F2-T2 — 加入升级备份与 readiness 门禁

- **affected files:** 新增 `backend-node/src/db/upgradeBackupService.js`、`backend-node/src/runtime/readiness.js`、`backend-node/test/upgradeBackupService.test.js`；修改 `backend-node/src/app.js`、`backend-node/src/server.js`、`backend-node/src/services/storageLayout.js`。
- **dependencies:** E0-F2-T1。
- **acceptance criteria:** 有待执行 migration 时先生成 DB 备份与 manifest；migration/reconcile 完成前 readiness=false；失败时 HTTP 不宣告 ready；保留数量和磁盘不足有清晰错误。
- **tests:** 模拟备份成功、权限失败、空间不足、迁移失败、再次启动；验证 `/health` liveness 与 `/ready` readiness。
- **migration risks:** 大 DB 启动时间、WAL 一致性和 Electron 强杀；使用 SQLite backup API/checkpoint，不复制活跃 WAL 的不一致组合。
- **rollback:** 回切 app bootstrap；升级前备份是恢复点，新增备份文件可保留。

#### TASK E0-F2-T3 — 建立版本化 Feature Flag Service

- **affected files:** 新增 `backend-node/src/runtime/featureFlags.js`、`backend-node/src/routes/v2/featureFlags.js`、`frontweb/src/vnext/application/featureFlags.js`、`backend-node/test/featureFlags.test.js`、`frontweb/test/vnextFeatureFlags.test.js`；修改 `backend-node/src/app.js`、`frontweb/src/router/index.js`。
- **dependencies:** E0-F2-T1。
- **acceptance criteria:** 所有 VNext flags 默认 off；支持安装级与项目/剧集覆盖；数据 authority flag 只可由后端迁移流程修改；诊断返回脱敏 flag snapshot；未知 flag fail closed。
- **tests:** backend flag precedence/validation tests；frontend route guard tests；默认配置下原路由快照不变。
- **migration risks:** flags 漂移造成同项目双写；authority flag 与 UI flag 分离并记录版本。
- **rollback:** 删除/禁用 flags 配置后全部回默认 off，Legacy 流程继续。

## EPIC E1 — 契约、Application Ports 与只读 Adapter（M1 / CP1）

### FEATURE E1-F1 — API v2 Contract Foundation

#### TASK E1-F1-T1 — 统一 v2 envelope、验证与错误字典

- **affected files:** 新增 `backend-node/src/routes/v2/index.js`、`backend-node/src/vnext/contracts/envelope.js`、`backend-node/src/vnext/contracts/errors.js`、`backend-node/src/vnext/contracts/validate.js`、`backend-node/test/v2Contract.test.js`；修改 `backend-node/src/app.js`、`backend-node/src/logger.js`。
- **dependencies:** CP0。
- **acceptance criteria:** `/api/v2/health` 返回 schemaVersion/requestId；validation、not found、conflict、capability、internal errors 形状稳定；v1 响应完全不变。
- **tests:** `v2Contract.test.js` 覆盖 success/error/invalid JSON/413/404/requestId；重跑 `appErrorHandling.test.js`。
- **migration risks:** 全局 middleware 意外改变 v1；v2 router 内部封装，错误 mapper 按 route namespace 生效。
- **rollback:** 停止挂载 `/api/v2`，无数据变化。

#### TASK E1-F1-T2 — 定义 Command/Query 与 canonical projections

- **affected files:** 新增 `backend-node/src/vnext/application/ports.js`、`backend-node/src/vnext/contracts/studioProjection.js`、`jobProjection.js`、`capabilitySnapshot.js`、`backend-node/test/vnextProjectionContracts.test.js`；新增 `frontweb/src/vnext/contracts/*.js` 与 `frontweb/test/vnextContracts.test.js`。
- **dependencies:** E1-F1-T1；以 `docs/vnext/domain-model.md` 和 `state-model.md` 为唯一语义来源。
- **acceptance criteria:** Studio、Job、Capability DTO 均带 schemaVersion；未知 enum/字段策略明确；前后端使用同一 fixture corpus；不把 Legacy raw row 暴露给 VNext component。
- **tests:** 后端 producer contract + 前端 consumer contract 对同一 JSON fixture 通过；故意缺字段/未知状态返回可诊断错误。
- **migration risks:** 没有 TypeScript 时契约易漂移；用 runtime schema + fixtures 保证，而不是只写 JSDoc。
- **rollback:** projections 尚为只读，可移除 v2 endpoints。

### FEATURE E1-F2 — Legacy Compatibility Adapters

#### TASK E1-F2-T1 — 建立 Project/Studio Legacy Read Adapter

- **affected files:** 新增 `backend-node/src/vnext/adapters/legacy/legacyProjectReadAdapter.js`、`legacyStudioProjectionAdapter.js`、`backend-node/src/routes/v2/studio.js`、`backend-node/test/legacyStudioProjectionAdapter.test.js`；复用 `dramaService.js`、`episodeGenerationProgressService.js`。
- **dependencies:** E1-F1-T2。
- **acceptance criteria:** 现有 drama/episode/storyboard 生成等价 StudioProjection；缺失/部分数据映射 Empty/Partial/Error 而不是伪 Ready；不写数据库。
- **tests:** fresh/partial/full/deleted fixtures；与 `/api/v1/dramas/:id` 关键字段做 semantic diff。
- **migration risks:** current JSON 字段与表关系冲突；projection 输出 conflict diagnostics，不静默选一边。
- **rollback:** 停用只读 endpoint。

#### TASK E1-F2-T2 — 建立 Legacy Job Projection Adapter

- **affected files:** 新增 `backend-node/src/vnext/adapters/legacy/legacyJobAdapter.js`、`backend-node/src/routes/v2/jobs.js`、`backend-node/test/legacyJobAdapter.test.js`；读取 `taskService.js`、`imageGenerationTaskService.js`、`unifiedVideoGenerationService.js`、`directorJobService.js`、`externalGenerationService.js`、`videoUpscaleRepository.js`。
- **dependencies:** E1-F1-T2。
- **acceptance criteria:** 六类任务统一投影为 canonical 状态并保留 rawStatus/sourceRuntime；未知状态为 UNKNOWN；启动 orphan 不被 adapter 改写；列表排序与项目/剧集过滤稳定。
- **tests:** 每类状态 fixture、cancel_requested、retry、partial batch、missing result；现有所有 lifecycle tests 继续通过。
- **migration risks:** 相似状态名字语义不同；按 source runtime 显式 mapping，不用全局字符串替换。
- **rollback:** 关闭 v2 jobs route，旧 store 与表不受影响。

#### TASK E1-F2-T3 — 从路由组合根抽出 Runtime Bootstrap

- **affected files:** 新增 `backend-node/src/runtime/bootstrap.js`、`backend-node/src/runtime/shutdown.js`、`backend-node/test/runtimeBootstrap.test.js`；修改 `backend-node/src/routes/index.js`、`backend-node/src/app.js`、`backend-node/src/server.js`。
- **dependencies:** E1-F1-T1、E1-F2-T2。
- **acceptance criteria:** router construction 不再启动 timer/recovery；video/upscale/director recovery 各自注册 start/stop；重复 createApp 不产生重复 timer；现有 service wiring 行为等价。
- **tests:** fake timers/spy 验证一次启动和 shutdown；运行 video recovery、upscale、director 全套测试。
- **migration risks:** 隐式 setImmediate/setInterval 被漏搬导致恢复停止；先写 characterization tests，再逐个 runtime 移动。
- **rollback:** 单提交回退到 `routes/index.js` 原 wiring，数据库无变化。

## EPIC E2 — VNext Shell 与只读工作台（M2 / CP2）

### FEATURE E2-F1 — App/Studio Shell

#### TASK E2-F1-T1 — 新增隔离的 VNext 路由与 App Shell

- **affected files:** 新增 `frontweb/src/vnext/app/VNextAppShell.vue`、`frontweb/src/vnext/app/routes.js`、`frontweb/src/vnext/pages/ProjectsPage.vue`、`ProjectDetailPage.vue`、`frontweb/test/vnextRouting.test.js`；修改 `frontweb/src/router/index.js`、`frontweb/src/App.vue`。
- **dependencies:** CP1、E0-F2-T3。
- **acceptance criteria:** `/vnext/projects` 与 `/vnext/projects/:projectId` 支持刷新/深链/返回；旧路由与 title 不变；flag off 时不显示新入口且直接访问得到明确回退。
- **tests:** route resolution、flag guard、not found、back-link tests；frontend 全量 + build。
- **migration risks:** 两套 shell CSS/全局事件冲突；VNext 样式作用域化，不改 Legacy DOM 结构。
- **rollback:** `vnext.shell=off` 或移除新增 route records。

#### TASK E2-F1-T2 — 实现只读 StudioShell 与四阶段状态

- **affected files:** 新增 `frontweb/src/vnext/app/StudioShell.vue`、`frontweb/src/vnext/pages/{Script,Setup,Storyboard,Film}StagePage.vue`、`frontweb/src/vnext/application/studioQueries.js`、`frontweb/test/vnextStudioShell.test.js`。
- **dependencies:** E2-F1-T1、E1-F2-T1。
- **acceptance criteria:** 项目、剧集、阶段、Gate 摘要、任务入口在稳定 shell 中显示；Default/Loading/Empty/Partial/Error/Disabled 都可复现；此任务不提供 mutation。
- **tests:** projection fixtures 驱动九态；route switching 不重复请求；刷新恢复选中剧集。
- **migration risks:** 把“有旧数据”误判为已批准；inferred 与 approved 明确区分。
- **rollback:** shell flag off；纯只读无数据回滚。

### FEATURE E2-F2 — Tasks 与 Settings 只读接线

#### TASK E2-F2-T1 — 建立全局 Job Observer 与诊断入口

- **affected files:** 新增 `frontweb/src/vnext/application/jobObserver.js`、`frontweb/src/vnext/features/tasks/TaskCenterDrawer.vue`、`frontweb/src/vnext/features/tasks/JobRow.vue`、`frontweb/test/vnextJobObserver.test.js`。
- **dependencies:** E2-F1-T1、E1-F2-T2。
- **acceptance criteria:** 页面切换不停止观察；同一 Job 只有一个 poller 和一个终态通知；网络超时显示 disconnected，不改 Job 为 failed；Legacy raw status 可展开诊断。
- **tests:** fake timer 重连、卸载/重挂、duplicate notification、timeout、UNKNOWN status；旧 task store tests 继续通过。
- **migration risks:** 新旧 poller 同时打接口；VNext 只观察 v2，旧页面未挂载时其 store 不启动。
- **rollback:** shell flag off 停止 observer，旧任务运行不受影响。

## EPIC E3 — Script Revision、Gate 与 Invalidation（M3 / CP3）

### FEATURE E3-F1 — Script 数据与政策

#### TASK E3-F1-T1 — 增加 ScriptRevision/StoryScene/Approval/Invalidation schema

- **affected files:** 新增 `backend-node/migrations-vnext/010_script_revision.sql`、`backend-node/src/vnext/domain/script/*.js`、`backend-node/src/vnext/repositories/scriptRepository.js`、`backend-node/test/scriptDomain.test.js`、`scriptMigration.test.js`。
- **dependencies:** CP2、ledger runner。
- **acceptance criteria:** revision 不可变；draft 与 approved 分离；StoryScene 顺序可稳定重建；Approval 记录 actor/time/hash；Invalidation 只追加并可 resolve；外键/索引明确。
- **tests:** domain invariants、fresh/history migration、transaction rollback、duplicate approval/idempotency。
- **migration risks:** 从旧文本推导 scene 不可靠；revision 0 标为 `inferred` 并保留 raw source，不自动标用户批准。
- **rollback:** script flag off；新增表保留只读，原表无删除/改名。

#### TASK E3-F1-T2 — 实现 Script Commands 与 Legacy current projection

- **affected files:** 新增 `backend-node/src/vnext/application/scriptService.js`、`gateService.js`、`backend-node/src/routes/v2/script.js`、`backend-node/src/vnext/adapters/legacy/scriptWriteThroughAdapter.js`、`backend-node/test/scriptService.test.js`。
- **dependencies:** E3-F1-T1。
- **acceptance criteria:** saveDraft、approveRevision、reopen 均有 optimistic version；批准后在同一事务中更新兼容 current projection；上游变化产生精确 stale scope，不删除镜头/媒体。
- **tests:** concurrent save conflict、approval idempotency、write-through rollback、invalidation truth table、v1 read-after-v2-write。
- **migration risks:** 旧 UI 可同时写 current 字段；项目级 authority switch 必须保证同一时刻只有一个写入口。
- **rollback:** script flag off，旧 UI 继续读取最后 approved projection；新 revision 保留。

### FEATURE E3-F2 — Script Workspace

#### TASK E3-F2-T1 — 交付 Script Page 的草稿、批准与失效反馈

- **affected files:** 新增 `frontweb/src/vnext/features/script/ScriptWorkspace.vue`、`ScriptEditor.vue`、`RevisionBar.vue`、`ApprovalPanel.vue`、`InvalidationBanner.vue`、`frontweb/src/vnext/application/scriptCommands.js`、`frontweb/test/vnextScriptFlow.test.js`。
- **dependencies:** E3-F1-T2、E2-F1-T2。
- **acceptance criteria:** autosave/explicit save 状态清楚；保存不等于批准；批准前显示影响范围；冲突不覆盖他人/另一窗口版本；Default/Hover/Selected/Disabled/Loading/Empty/Processing/Success/Error 齐备。
- **tests:** dirty guard、save debounce、approval flow、409 conflict、retry、keyboard/focus、route leave；frontend build。
- **migration risks:** 巨型 FilmCreate 的脚本字段语义遗漏；对旧项目做 projection parity，不搬 DOM 代码。
- **rollback:** `vnext.script=off` 回旧 FilmCreate；已批准内容可见。

## EPIC E4 — Setup 与资产权威（M4 / CP4）

### FEATURE E4-F1 — Asset Model 与 Merge

#### TASK E4-F1-T1 — 建立现有 Character/Scene/Prop 的 Asset Adapter

- **affected files:** 新增 `backend-node/src/vnext/adapters/assets/{character,location,prop}AssetAdapter.js`、`backend-node/src/vnext/contracts/assetIdentity.js`、`backend-node/test/assetIdentityAdapters.test.js`；复用现有对应 services/libraries。
- **dependencies:** CP3。
- **acceptance criteria:** 三类实体保留各自 ID/字段并投影统一 identity shell；variant/current image/library provenance 可追踪；Scene 资产与 StoryScene 类型不可混淆。
- **tests:** 各类型 full/partial/deleted/library-linked fixtures；现有 character/scene/prop/library tests 全量。
- **migration risks:** 过度抽象丢失类型字段；共享生命周期，不合并专属 schema。
- **rollback:** adapter 只读阶段可停用，现有服务不变。

#### TASK E4-F1-T2 — 增加 MergeDecision、VoiceProfile、StyleBinding 与媒体选择权威

- **affected files:** 新增 `backend-node/migrations-vnext/020_asset_setup.sql`、`backend-node/src/vnext/domain/assets/*.js`、`backend-node/src/vnext/application/assetSetupService.js`、`backend-node/test/assetSetupService.test.js`。
- **dependencies:** E4-F1-T1。
- **acceptance criteria:** extraction 只生成 merge preview；新增/匹配/合并/忽略有 decision/provenance；候选选择后才更新 current media；Voice/Style scope 明确；旧字段在迁移期 write-through。
- **tests:** merge decision truth table、undo-before-commit、duplicate source、candidate select transaction、legacy read-after-write。
- **migration risks:** 错误合并实体和不可逆引用重定向；提交前强制 preview，合并使用 alias/provenance 而非物理删除。
- **rollback:** setup flag off；write-through 后旧 UI 可见；decision 表保留并支持补偿。

### FEATURE E4-F2 — Setup UI 与 Asset Center

#### TASK E4-F2-T1 — 交付 Setup Workspace 和 Merge Preview

- **affected files:** 新增 `frontweb/src/vnext/features/setup/SetupWorkspace.vue`、`AssetList.vue`、`AssetInspector.vue`、`MergePreviewDialog.vue`、`VariantEditor.vue`、`frontweb/test/vnextSetupFlow.test.js`。
- **dependencies:** E4-F1-T2、E2-F1-T2。
- **acceptance criteria:** Character/Location/Prop 分类、选择、Inspector、variant、voice/style、merge preview 可用；批量提取支持 partial success；关闭 Inspector 不丢任务。
- **tests:** selection、inline edit、merge preview、partial batch、stale asset、nine states、keyboard/focus；build。
- **migration risks:** 重复实现现有资产生成；生成动作必须调用共享 Generation command adapter。
- **rollback:** `vnext.setup=off`，旧资产区继续工作。

#### TASK E4-F2-T2 — 修复并迁移 Asset Center 契约

- **affected files:** `backend-node/src/services/assetService.js`、`backend-node/src/routes/assets.js`、`frontweb/src/views/MediaLibrary.vue`；新增 `backend-node/test/assetRoutesContract.test.js`、`frontweb/src/vnext/features/assets/AssetCenterPage.vue`、`frontweb/test/vnextAssetCenter.test.js`。
- **dependencies:** E4-F1-T2；先以测试复现当前不存在列/上传入库/搜索问题。
- **acceptance criteria:** update 字段与真实 schema 一致；上传产生 DB + file 记录；搜索/筛选可用；删除经过引用检查/tombstone；Legacy MediaLibrary 不再确定性报错。
- **tests:** API contract、upload/search/update/delete/reference、file missing；frontend Legacy + VNext UI tests。
- **migration risks:** 这是对已知 BROKEN 行为的修复但可能影响历史异常数据；先宽容读、严格写并提供诊断。
- **rollback:** route 可切回旧实现；新增 artifact 元数据不删除旧 asset rows。

## EPIC E5 — Shot Package 与 Capability 驱动分镜（M5 / CP5）

### FEATURE E5-F1 — ShotRevision 与 ReferenceBinding

#### TASK E5-F1-T1 — 扩展 ShotRevision/ReferenceBinding schema 和 backfill

- **affected files:** 新增 `backend-node/migrations-vnext/030_shot_revision.sql`、`backend-node/src/vnext/domain/shots/*.js`、`backend-node/src/vnext/repositories/shotRepository.js`、`backend-node/test/shotMigration.test.js`。
- **dependencies:** CP4。
- **acceptance criteria:** `storyboards.id` 保持 Shot identity；revision 保存 AV、prompt、duration、framing 与 dependency hash；reference 保存 entity/variant/artifact/role/order；旧 JSON/关系表只做 backfill 来源并生成 diff。
- **tests:** full/partial storyboard fixtures、round-trip、ordering、foreign keys、conflicting legacy sources、rerun idempotency。
- **migration risks:** 多重角色关联权威冲突；diff 未归零时不切 authority，不静默覆盖。
- **rollback:** storyboard flag off；新表附加，旧宽表完整。

#### TASK E5-F1-T2 — 实现 Shot Commands、Gate 与 v1 write-through

- **affected files:** 新增 `backend-node/src/vnext/application/shotService.js`、`backend-node/src/routes/v2/shots.js`、`backend-node/src/vnext/adapters/legacy/shotWriteThroughAdapter.js`、`backend-node/test/shotService.test.js`。
- **dependencies:** E5-F1-T1、E3-F1-T2、E4-F1-T2。
- **acceptance criteria:** update/create revision、bind reference、approve shot package 有版本冲突保护；Gate 校验 approved script/setup、reference 可用和 capability；批准后兼容旧 storyboards 读取。
- **tests:** stale dependency、missing reference、unsupported capability、concurrent edit、v1-v2 parity、transaction rollback。
- **migration risks:** write-through 遗漏某个宽表字段破坏旧视频生成；用 golden Shot Package 做逐字段 diff。
- **rollback:** `vnext.storyboard=off`；旧页面读取最近批准 projection。

### FEATURE E5-F2 — Capability Contract 与 Storyboard UI

#### TASK E5-F2-T1 — 统一 Provider Capability Snapshot

- **affected files:** 新增 `backend-node/src/vnext/providers/providerPort.js`、`capabilityService.js`、`backend-node/src/vnext/adapters/legacy/legacyProviderAdapter.js`、`backend-node/src/routes/v2/capabilities.js`、`backend-node/test/providerCapabilityContract.test.js`。
- **dependencies:** E1-F1-T2；读取现有 video capabilities/workflows、model validator、AI config。
- **acceptance criteria:** 文本/图像/视频/TTS/本地工具的能力可查询；参数 schema、reference、duration/size、async/cost availability 有版本；配置缺失是 Disabled/Unavailable，不是 500。
- **tests:** 所有已配置 provider fixture 的 schema validation；现有 `videoCapabilities*.test.js`、workflow tests。
- **migration risks:** 静态能力与动态账户/地区限制不同；snapshot 记录来源和获取时间，提交时再次 validate。
- **rollback:** VNext capability endpoint 停用，旧配置页面不变。

#### TASK E5-F2-T2 — 交付 Storyboard Workspace 与参数驱动 UI

- **affected files:** 新增 `frontweb/src/vnext/features/storyboard/StoryboardWorkspace.vue`、`ShotList.vue`、`ShotCard.vue`、`ShotInspector.vue`、`ReferenceBindingEditor.vue`、`ProviderParameterBar.vue`、`frontweb/test/vnextStoryboardFlow.test.js`。
- **dependencies:** E5-F1-T2、E5-F2-T1。
- **acceptance criteria:** 单选/多选、inline edit、Inspector、reference DnD + 非拖拽路径、批量操作范围明确；参数按 capability 显隐/禁用；invalid/stale 不能误提交；不复制 VideoGenerationPanel 的协议逻辑。
- **tests:** selection、multi-selection、drag/drop keyboard fallback、capability combinations、stale reference、partial batch preview、nine states、build。
- **migration risks:** `FilmCreate.vue` 大量隐含行为未覆盖；按 user flow 切片并保留 Legacy 跳转，不做一次性替换。
- **rollback:** `vnext.storyboard=off`。

## EPIC E6 — Canonical Job、Candidate 与 Provider 渐进迁移（M6 / CP6）

### FEATURE E6-F1 — Durable Job Runtime

#### TASK E6-F1-T1 — 增加 Job/Attempt/Batch/Artifact schema 与状态机

- **affected files:** 新增 `backend-node/migrations-vnext/040_generation_runtime.sql`、`backend-node/src/vnext/domain/jobs/*.js`、`backend-node/src/vnext/repositories/jobRepository.js`、`artifactRepository.js`、`backend-node/test/jobStateMachine.test.js`、`jobMigration.test.js`。
- **dependencies:** CP5。
- **acceptance criteria:** canonical 状态、不变量、attempt history、batch partial success、lease/checkpoint/idempotency、artifact hash/commit state 可持久化；旧历史不伪造为新 row。
- **tests:** 全状态迁移、invalid transition、lease expiry、idempotent submit、retry creates attempt、partial aggregation、transaction rollback。
- **migration risks:** 状态过度统一丢失 Provider 细节；raw status/event 保留在 Attempt diagnostics。
- **rollback:** job-kind flags off；新增表不影响旧 runtime。

#### TASK E6-F1-T2 — 实现 Runtime Scheduler、Reconcile 与 Artifact Commit

- **affected files:** 新增 `backend-node/src/vnext/runtime/jobRuntime.js`、`jobReconciler.js`、`artifactCommitService.js`、`backend-node/test/jobRuntime.test.js`、`artifactCommitService.test.js`；修改 `backend-node/src/runtime/bootstrap.js`。
- **dependencies:** E6-F1-T1、E0-F2-T2。
- **acceptance criteria:** queue/lease/heartbeat/checkpoint/retry/cancel/restart 恢复完整；stage→probe/hash→DB journal→atomic commit；runtime shutdown 不把 Job 标失败。
- **tests:** fake worker、进程重启模拟、lease takeover、cancel race、crash at each artifact step、disk full、missing temp、reconcile。
- **migration risks:** 单进程并发和 SQLite lock；限制 lease transaction，保留 busy timeout，先小并发上线。
- **rollback:** 停止新 scheduler；在途新 Job 先 drain 或由同版本 runtime 收尾，不能交给 Legacy 猜测执行。

### FEATURE E6-F2 — Candidate 与前端任务中心

#### TASK E6-F2-T1 — 建立 Candidate/Selection Application Service

- **affected files:** 新增 `backend-node/src/vnext/domain/candidates/*.js`、`backend-node/src/vnext/application/candidateService.js`、`backend-node/src/routes/v2/candidates.js`、`backend-node/test/candidateService.test.js`。
- **dependencies:** E6-F1-T2、E4-F1-T2。
- **acceptance criteria:** result 先形成 immutable Candidate/Artifact；select 是显式事务并记录 previous/current；失败或 partial batch 不覆盖选中结果；Legacy current field write-through 可配置。
- **tests:** select/reselect/concurrent select、missing artifact、partial batch、legacy projection parity、audit trail。
- **migration risks:** Director/image/video 现有“selected”语义不同；按 source adapter 保留原选择记录并明确映射。
- **rollback:** 关闭对应 job-kind authority；write-through 保旧 UI。

#### TASK E6-F2-T2 — 将 VNext Task Center 切到 canonical + legacy 联合投影

- **affected files:** `frontweb/src/vnext/application/jobObserver.js`、`frontweb/src/vnext/features/tasks/*`、`backend-node/src/routes/v2/jobs.js`；新增 `frontweb/test/vnextTaskCenterMixedRuntime.test.js`、`backend-node/test/mixedJobProjection.test.js`。
- **dependencies:** E6-F1-T2、E1-F2-T2。
- **acceptance criteria:** 新旧 Job 在一张列表中可辨 source runtime；支持 retry/cancel 的仅显示可用动作；在途 Job 创建后切 flag 仍由原 owner 完成；通知一次。
- **tests:** mixed list、filter、poll/reconnect、owner routing、unsupported actions、timeout、UNKNOWN、partial success。
- **migration risks:** 同一业务任务被两个 adapter 重复展示；使用 stable source key/dedup mapping。
- **rollback:** Task Center 回只读 Legacy projection；新 Job runtime 必须先 drain。

### FEATURE E6-F3 — 按 Job Kind 与 Provider 迁移

#### TASK E6-F3-T1 — 迁移图像 Task/Batch 到 canonical runtime

- **affected files:** `backend-node/src/services/imageGenerationOrchestrator.js`、`imageGenerationQueueService.js`、`imageGenerationTaskService.js`、`imageGenerationResultSelection.js`、`backend-node/src/routes/imageGenerationTasks.js`；新增 `backend-node/src/vnext/jobHandlers/imageGenerationHandler.js`、`backend-node/test/vnextImageJobMigration.test.js`；调整前端 image generation adapter/tests。
- **dependencies:** E6-F1-T2、E6-F2-T1。
- **acceptance criteria:** 按 flag 新建 canonical image jobs；旧 batch/task 仍可读/完成；批量取消/重试/partial success/候选选择完整；外部生成通道暂由 adapter 处理。
- **tests:** 复用全部 imageGeneration tests，新增 dual-runtime ownership、restart、batch partial、selection parity、duplicate submit。
- **migration risks:** 前端 store 当前充当 queue executor；先把 owner 切到后端，再停止 store timer，避免双执行。
- **rollback:** `vnext.jobs.image=off`；在途 canonical image jobs drain，新提交回旧 runtime。

#### TASK E6-F3-T2 — 迁移统一视频生命周期到 canonical runtime

- **affected files:** `backend-node/src/services/unifiedVideoGenerationService.js`、`preparedVideoGenerationService.js`、`videoService.js`、`backend-node/src/routes/videos.js`；新增 `backend-node/src/vnext/jobHandlers/videoGenerationHandler.js`、`backend-node/test/vnextVideoJobMigration.test.js`。
- **dependencies:** E6-F1-T2、E5-F1-T2。
- **acceptance criteria:** 保留 snapshot、prepared request、poll/resume/cancel/retry/candidate；canonical Job 包装而非重写 provider logic；所有 video mode 结果等价。
- **tests:** 运行全部 video lifecycle/capability/workflow/provider tests；新增 owner、reconcile、candidate mapping、legacy v1 parity。
- **migration risks:** 4,000+ 行 `videoClient.js` 隐含兼容；本任务只包 runtime，不抽 provider 分支。
- **rollback:** `vnext.jobs.video=off`，在途任务由创建时 owner 收尾。

#### TASK E6-F3-T3 — 逐 Provider 抽离原生 Adapter

- **affected files:** 新增 `backend-node/src/vnext/providers/{openaiCompatible,volc,dashscope,gemini,kling,jimeng,xai,vidu,sora,agnes,minimaxH3}/*.js` 与各自 contract tests；渐进修改 `imageClient.js`、`videoClient.js`、`videoProviders/index.js`。
- **dependencies:** E5-F2-T1、E6-F3-T1/T2；每个 provider 独立子任务和独立提交。
- **acceptance criteria:** 每个 provider 实现 capability/validate/submit/poll/cancel/result/error；fixture parity 通过后才开该 provider flag；未迁 provider 继续 Legacy adapter。
- **tests:** 每 Provider 离线 golden request/response/error/reconcile contract；可选 live smoke 需显式凭证；原有 provider tests 全部保留。
- **migration risks:** 地区、模型版本、签名和兼容 API 差异；迁移单位按 protocol family，不因名称相似合并；绝不一次删完整 client。
- **rollback:** `vnext.provider.<id>=off` 单独回切；删除旧分支前至少跨一个稳定发布窗口。

#### TASK E6-F3-T4 — 接入 TTS、Merge、Upscale、Director 与 External Job Adapters

- **affected files:** 新增 `backend-node/src/vnext/jobHandlers/{tts,videoMerge,videoUpscale,director,externalWeb}Handler.js`；适配 `ttsService.js`、`videoMergeService.js`、`services/videoUpscale/*`、`director/*`、`externalGeneration*Service.js`；新增各 handler contract tests。
- **dependencies:** E6-F1-T2；按 tts → merge → upscale → director → external 顺序拆成独立提交。
- **acceptance criteria:** 每类保留原 checkpoint/recovery/cancel 能力；本地进程 stderr/exit 可诊断；Director/External 保持 experimental flag；核心路径不依赖扩展/bridge。
- **tests:** 原 audio/merge/upscale/director/external 全套 + handler owner/restart/artifact tests。
- **migration risks:** 一次迁五类不可验收；执行时必须将此计划项再拆成五个 provider-kind TASK，逐个 flag 上线。
- **rollback:** 每 kind 独立 flag；在途任务原 owner 收尾。

## EPIC E7 — Film、Picture Lock 与 Delivery（M7 / CP7）

### FEATURE E7-F1 — Timeline 与锁定

#### TASK E7-F1-T1 — 增加 TimelineRevision/PictureLock/Delivery schema 与政策

- **affected files:** 新增 `backend-node/migrations-vnext/050_film_delivery.sql`、`backend-node/src/vnext/domain/film/*.js`、`backend-node/src/vnext/repositories/deliveryRepository.js`、`backend-node/test/filmDomain.test.js`、`filmMigration.test.js`。
- **dependencies:** CP6。
- **acceptance criteria:** timeline revision immutable；PictureLock 固定 ShotRevision/Candidate/Artifact/order/dependency hash；修改以 supersede 表达；Delivery 保存步骤、manifest 和 provenance。
- **tests:** lock prerequisites、immutable lock、supersede、stale candidate、delivery retry、legacy merge import、migration idempotency。
- **migration risks:** 把旧 director timeline 误当用户锁定；旧数据只标 inferred timeline，不推导 picture lock。
- **rollback:** film flag off；新表保留，旧 merge/video 表不变。

#### TASK E7-F1-T2 — 实现 Film/Delivery Commands 与 LocalTool pipeline

- **affected files:** 新增 `backend-node/src/vnext/application/filmDeliveryService.js`、`backend-node/src/routes/v2/film.js`、`backend-node/src/vnext/localTools/ffmpegAdapter.js`、`backend-node/test/filmDeliveryService.test.js`；复用 merge/audio/post-process/upscale services。
- **dependencies:** E7-F1-T1、E6-F3-T4。
- **acceptance criteria:** create timeline、lock、unlock-by-supersede、create/retry delivery；FFmpeg/audio/subtitle/watermark/upscale 各 step 可 checkpoint；输出 manifest 可复现；失败不损坏已选候选。
- **tests:** pipeline happy path、step failure/retry/cancel、missing binary、disk full、source changed、manifest hash、旧 merge parity。
- **migration risks:** FFmpeg 命令行为和平台路径差异；优先包装现有服务并在 Windows/Electron 做 smoke，不重写滤镜链。
- **rollback:** `vnext.film=off`，旧 merge/audio/upscale route 保留；已产出文件可作为普通 artifact 读取。

### FEATURE E7-F2 — Film Workspace

#### TASK E7-F2-T1 — 交付候选审核、Picture Lock 与 Delivery UI

- **affected files:** 新增 `frontweb/src/vnext/features/film/FilmWorkspace.vue`、`CandidateReviewGrid.vue`、`TimelineStrip.vue`、`PictureLockBar.vue`、`DeliveryDrawer.vue`、`frontweb/test/vnextFilmFlow.test.js`。
- **dependencies:** E7-F1-T2、E6-F2-T2。
- **acceptance criteria:** 候选比较/选择、缺片诊断、锁定前检查、交付参数/进度/失败恢复/结果打开完整；Processing 与 Success 分开；partial delivery 指明成功/失败步骤。
- **tests:** selection、lock conflict、stale source、delivery processing/retry/cancel、route refresh、nine states、keyboard/focus、build。
- **migration risks:** 交付 Drawer 承担过多剪辑功能；P0 只做审核、顺序、锁定和参数化交付，不复制专业 NLE。
- **rollback:** `vnext.film=off`。

## EPIC E8 — P2 接入与 Legacy 受控收缩（M8 / CP8）

### FEATURE E8-F1 — 共享 Canvas 与高级 Adapter

#### TASK E8-F1-T1 — 让 Canvas 复用 Standard Workspace Commands/Queries

- **affected files:** `frontweb/src/views/DramaCanvas.vue`、`frontweb/src/composables/useCanvas*.js`、`frontweb/src/utils/dramaCanvasAdapter.js`、`frontweb/src/components/dramaCanvas/*`；新增 `frontweb/test/canvasCommandParity.test.js`。
- **dependencies:** CP7；Canvas 仍为 P2，需单独价值确认。
- **acceptance criteria:** 同一角色/Shot/选择/生成操作在标准页与 Canvas 产生同一 command/result；Canvas 只拥有布局、框选、组和视图状态；metadata schema 有版本。
- **tests:** command parity、multi-selection、layout round-trip、stale projection、旧 canvas URLs；frontend build。
- **migration risks:** 现有 Canvas 隐含第二套 CRUD；逐 action 切换，未迁 action 保留 Legacy adapter。
- **rollback:** Canvas command flag 逐 action 关闭。

#### TASK E8-F1-T2 — 按价值接入 Director/H3/ExternalWeb/OpenClaw

- **affected files:** 复用 `backend-node/src/director/*`、`h3*Service.js`、`externalGeneration*Service.js`、`browser-extension/src/*`；新增 `backend-node/src/vnext/extensions/*`、版本化协议 schema 和对应 tests/docs。
- **dependencies:** E6/E7 完成；每种 extension 单独立项。
- **acceptance criteria:** extension 只能通过公开 Shot/Job/Candidate/Artifact ports；未配置时核心 flow 不受影响；协议版本、能力探测、失败恢复清楚；OpenClaw 文档由真实契约生成。
- **tests:** 现有 director/H3/external/extension tests + extension boundary/contract；可选 live acceptance 独立标记。
- **migration risks:** 第三方 DOM、实验 workflow、文档漂移；保持实验 flag，不能阻塞 P0/P1。
- **rollback:** 禁用单 extension；核心数据可继续读取其已生成 artifact。

### FEATURE E8-F2 — Legacy Exit 与 Contract Migration

#### TASK E8-F2-T1 — 删除已证明无调用的 UI/Stub/重复 runtime

- **affected files:** 候选包括 `frontweb/src/views/FreeCreate.vue`、`frontweb/src/components/imageGeneration/ImageGenerationQueue.vue`、`backend-node/src/routes/stub.js`、已经退出的 store/runtime 分支；更新 router、imports、tests、`CHANGELOG.md`。
- **dependencies:** 对应 exit gate、连续稳定发布窗口、使用/引用扫描和 rollback 演练。
- **acceptance criteria:** `rg` 静态引用为零，运行诊断无兼容命中；功能矩阵不减少；构建与全部回归通过；每个模块独立删除提交。
- **tests:** route 404/redirect、build、全量 tests、桌面 smoke、能力矩阵核对。
- **migration risks:** 动态 import、外部书签、扩展调用无法由静态扫描发现；结合 runtime compatibility logs 和发布窗口判断。
- **rollback:** revert 单模块提交；route redirect 保留至少一个版本。

#### TASK E8-F2-T2 — 退出 Legacy Provider 分支与 `ensureAllColumns()`

- **affected files:** `backend-node/src/services/imageClient.js`、`videoClient.js`、`backend-node/src/db/migrate.js`、旧 migration fallback、相关 tests；新增 final compatibility report。
- **dependencies:** 所有受支持 Provider 原生迁移；所有受支持安装已 ledger baseline；CP8 前置备份。
- **acceptance criteria:** 逐 Provider 删除旧分支后 contract/live smoke 无差异；ledger 覆盖 fresh/history/current；启动不再执行 schema repair DDL；旧数据库仍可一次性升级。
- **tests:** 每 Provider 全套、四类 DB fixture、upgrade interruption、double-run、Electron packaged smoke、全量 tests。
- **migration risks:** 这是高风险 Contract step；不得把多个 Provider 或 migration fallback 放在同一提交；发现未覆盖安装即停止删除。
- **rollback:** 代码 revert；若仅停止 fallback 且未做 destructive DDL，可直接回切。任何列/表删除必须使用前向恢复迁移和完整备份。

#### TASK E8-F2-T3 — 评审并执行旧列/表的 Contract Migration

- **affected files:** 新增 `backend-node/migrations-vnext/9xx_contract_*.sql`、`backend-node/test/contractMigration.test.js`、`docs/vnext/_evidence/legacy-exit-*.md`；按实际结论修改 repository/adapters。
- **dependencies:** E8-F2-T1/T2；每个表/列单独 RFC、备份、遥测和稳定窗口。
- **acceptance criteria:** 没有生产代码、扩展、包 reader 或受支持旧版本依赖；数据已导出/校验；migration 支持中断恢复；文件 manifest 无孤儿增加。
- **tests:** old→pre-contract→contract→current upgrade、package import、project export、旧版本只读兼容说明、恢复演练。
- **migration risks:** SQLite table rebuild、外键、索引和用户增量写入使逆向回滚危险；优先长期保留廉价旧列，不为了整洁强删。
- **rollback:** destructive migration 前强制停止写入并备份 DB + file manifest；失败恢复备份；成功后出现问题用新的前向 restore migration，不用 `git checkout` 假装回滚数据。

## 2. 关键依赖路径

```text
E0 Baseline/Ledger/Flags
  └─ E1 Contracts/Adapters
       └─ E2 Read-only Shell
            ├─ E3 Script/Gate
            │    └─ E4 Setup/Assets
            │         └─ E5 Shot/Capability
            │              └─ E6 Job/Candidate/Provider
            │                   └─ E7 Film/Delivery
            └──────────────────────────└─ E8 P2/Cleanup
```

Provider 抽离可在 E5 Capability contract 完成后与 E6 runtime 并行，但单个 Provider 切流必须等待 canonical video/image handler 稳定。E8 的任何删除都不能与 P0/P1 新能力同批执行。

## 3. 推荐发布切片

| Release slice | 内容 | 默认 flags | 可见用户价值 |
|---|---|---|---|
| R0 | E0–E1 | 全 off | 安全、迁移可靠性、诊断；无工作流变化 |
| R1 | E2–E3 | shell/script 对内部项目 on | 稳定工作台、脚本版本与批准 |
| R2 | E4 | setup 对内部项目 on | 资产权威、合并预览、一致性 |
| R3 | E5 | storyboard 内部 on | Shot Package、能力驱动参数 |
| R4 | E6 image/video | 按 kind/provider 灰度 | 可恢复任务、候选与统一任务中心 |
| R5 | E7 | film 灰度 | Picture Lock 与可追踪交付 |
| R6 | E8 | 按 extension/legacy 单独决策 | 高级能力收敛和维护成本下降 |

每个 release slice 都必须产出独立验收报告和 rollback 演练记录；未通过时停在当前可运行状态，不跨阶段“借实现补洞”。

## 4. Done Definition

一个 TASK 只有在以下条件全部满足时才是 done：目标测试先红后绿；定向与阶段回归通过；默认 Legacy 可运行；flag/authority/adapter 行为有证据；migration 与文件变化可恢复；风险和已知限制记录；功能性改动同步更新 `CHANGELOG.md`。一个 EPIC 只有在其 Checkpoint 独立验收且 rollback 演练成功后才可进入下一 EPIC 默认开启评审。
