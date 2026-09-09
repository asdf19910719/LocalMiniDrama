# LocalMiniDrama VNext Migration Architecture

## 1. 迁移策略

VNext 采用四种互补模式：

- **Strangler Fig**：新 route、API 与领域能力旁路接入，逐条替代 Legacy；
- **Branch by Abstraction**：先建立 Command / Query、Provider、Job、Repository Port，再切实现；
- **Expand–Migrate–Contract**：先扩表与双读校验，再切权威，最后才收缩旧结构；
- **Characterization-first**：先以现有测试、真实数据库和项目包固定行为，再重组代码。

“共存”是有限期迁移手段，不是目标架构。每一个兼容层都必须记录 owner、覆盖范围、退役条件和最晚评审阶段。

## 2. Transition Architecture

```text
                         ┌──── feature flags / route switch ────┐
Legacy Vue pages ────────┤                                      │
VNext Studio pages ──────┴─> Contract Client                    │
          │                         │                            │
          │ legacy requests         │ /api/v2                    │
          ▼                         ▼                            │
       /api/v1 ───────> Compatibility Facade ──> Application Core
          │                    │                       │
          │ not-yet-migrated   │ adapters              ├─ new domain policies
          ▼                    ▼                       ├─ canonical job runtime
   Legacy routes/services   Legacy API/Job/Data        └─ artifact transaction
          │                    Adapters                       │
          └────────────────────┬──────────────────────────────┘
                               ▼
               existing tables + expanded VNext tables
               existing files + staged artifact commits
                               │
                 Provider Registry / Legacy Provider Adapter
```

在任何阶段，入口可按 feature flag 回到 Legacy。已经完成的前向数据扩展保留，不执行逆向删表；旧代码通过兼容读继续运行。

## 3. 迁移控制面

### 3.1 Feature Flags

| Flag | 粒度 | 默认 | 用途 |
|---|---|---|---|
| `vnext.shell` | 安装级/用户级 | off | 切换新的 App/Studio Shell |
| `vnext.script` | 项目/剧集 | off | 启用 ScriptRevision 与 Gate |
| `vnext.setup` | 项目/剧集 | off | 启用 Setup 资产工作区 |
| `vnext.storyboard` | 项目/剧集 | off | 启用 Shot Package 工作区 |
| `vnext.film` | 项目/剧集 | off | 启用 review/lock/delivery |
| `vnext.jobs.<kind>` | Job kind | off | 将指定长任务写入 canonical runtime |
| `vnext.provider.<id>` | Provider/model | off | 切换到新 Provider Adapter |
| `vnext.authority.<entity>` | 数据域 | off | 切换读写权威源；只由迁移代码控制 |

Flag 快照写入诊断信息和 Job input，便于复现。数据权威 flag 不暴露给普通 UI，避免用户造成双重事实源。

### 3.2 兼容层目录与责任

| 兼容层 | 输入 | 输出 | 退役条件 |
|---|---|---|---|
| API v1 Facade | 旧 URL/body/response | Application Command/Query | 所有前端、扩展与文档迁至 v2 或明确永久支持 |
| Legacy Read Adapter | 旧表/JSON | VNext Projection | 对应数据已回填、校验且 authority 已切换 |
| Legacy Write-through Adapter | VNext command | 旧 current 字段 | Legacy UI 不再读取该字段 |
| Legacy Job Adapter | async/image/video/director/external/upscale 状态 | canonical JobProjection | 任务类型已原生迁移且旧历史只需归档读取 |
| Legacy Provider Adapter | canonical request | `imageClient` / `videoClient` 调用 | 对应 Provider 原生 adapter 通过门禁 |
| Package Version Adapter | 旧 manifest/schema | canonical import/export model | 支持窗口结束，仍保留只读导入器 |
| Route Redirect Adapter | 旧前端 URL | VNext route | 书签、桌面入口、测试均已更新 |

### 3.3 Authority Switch 规则

一个数据域只按以下顺序迁移：

1. 新结构只写入测试/影子数据；
2. Legacy 权威写，新结构由事务内 projection 或可重放 backfill 更新；
3. 对同一实体执行双读 diff，差异不影响用户但进入诊断；
4. 差异率归零并通过回归后，切换 VNext 为写入权威；
5. 必要字段 write-through 给 Legacy；
6. Legacy UI 退出后停止 write-through；
7. 跨至少一个稳定发布窗口后才 Contract 旧列/表。

禁止双向双写；它无法定义冲突归属，也无法可靠回滚。

## 4. 阶段总览

| 阶段 | 独立交付物 | Legacy 共存方式 | 主要 rollback point |
|---|---|---|---|
| M0 基线与安全护栏 | 可重复测试、DB 样本、备份、ledger、flags、安全默认值 | 所有业务仍走 Legacy | 关闭 bootstrap；恢复升级前 DB 备份；回切上一应用版本 |
| M1 契约与兼容骨架 | v2 envelope、Command/Query ports、能力/Job projection adapters | v1 路由不变，新接口只读 | 停止挂载 `/api/v2`，Legacy 无数据依赖 |
| M2 VNext Shell（只读） | 新 App/Studio Shell、项目/剧集/阶段只读投影 | 可逐入口切回 Legacy 页面 | `vnext.shell=off` |
| M3 Script + Gate | revision、批准、失效记录、脚本工作区 | 旧脚本读 current projection；保留旧编辑入口 | `vnext.script=off`，新 revision 表保留只读 |
| M4 Setup + Assets | Identity/Variant/Voice/Style、Merge Preview | 旧角色/场景/道具 API 由 adapter 服务 | `vnext.setup=off`，write-through 保持旧 current 字段 |
| M5 Storyboard + Shot Package | ShotRevision/reference/capability-driven controls | 旧 FilmCreate 分镜仍可使用现有 storyboards | `vnext.storyboard=off`，ShotRevision 不覆盖旧镜头 |
| M6 Job/Candidate/Provider 收敛 | canonical runtime，逐 Job kind/Provider 灰度 | LegacyJob/Provider Adapter 同时存在 | 按 kind/provider 关闭 flag；未完成 Job 由原 runtime 继续 |
| M7 Film/Delivery | review、picture lock、timeline revision、delivery | 旧 merge/audio/upscale 作为 LocalTool Adapter | `vnext.film=off`，交付产物和锁定记录保留 |
| M8 高级能力与收缩 | Canvas/Director/H3/外部生成按价值接入；删除已退役兼容层 | 仅保留明确支持的 v1/package readers | 逐模块回滚；Contract DDL 只在备份和稳定窗口后执行 |

## 5. 分阶段迁移设计

### M0：基线、迁移与安全护栏

**进入条件**：当前四套测试可运行，已盘点支持的数据库版本和本地目录。

**变更**：

- 冻结当前测试计数、关键用户旅程和 Provider capability 样本；
- 建立脱敏的历史 DB fixtures、项目/剧集包 golden fixtures 与文件 manifest；
- 引入 migration ledger，并将既有 01–35 + `ensureAllColumns()` 结果登记为 baseline；
- 每次升级前制作一致性备份，升级后记录 checksum；
- 引入只读 feature flag service；
- 收紧 loopback、CORS、TLS 和 secret 输出边界。

**独立验收**：全新库和至少两种历史库可启动两次；第二次无 schema 变化；所有 Legacy flow 与基线一致；配置 API/日志不泄露完整 key。

**Rollback point**：应用回切到阶段前版本；数据库使用自动备份恢复。M0 不删除旧列，不改变业务 ID。

### M1：契约与兼容骨架

**进入条件**：M0 迁移样本稳定。

**变更**：

- 挂载 `/api/v2` health、capabilities、studio projection、jobs 只读端点；
- 引入 runtime schema 与统一 error envelope；
- 建立 Application ports，不移动现有实现；
- 用 Legacy Read/Job/Provider Adapter 输出 canonical projection；
- 将 `routes/index.js` 的 runtime bootstrap 逐步搬到显式 lifecycle module，但保持行为不变。

**独立验收**：相同项目通过 v1 与 v2 投影得到语义等价结果；未知/错误输入返回稳定 code；关闭 v2 不影响 v1。

**Rollback point**：取消 `/api/v2` mount 与 lifecycle bootstrap flag；无新业务写入，无需数据回滚。

### M2：VNext Shell（只读）

**进入条件**：M1 projection contract 通过。

**变更**：

- 新建 Projects、ProjectDetail、StudioShell 与四阶段占位/只读摘要；
- 现有 `/`、`/drama/:id`、`/film/:id` 不删除；新增 `/vnext/...` 路由；
- 只读显示当前项目、剧集、阶段、任务、能力与恢复入口；
- 建立 route-level error、loading、empty、disabled 状态。

**独立验收**：刷新、深链、返回和多剧集切换稳定；只读页面不产生数据差异；可一键回旧页面。

**Rollback point**：关闭 `vnext.shell` 或移除导航入口，Legacy 路由不变。

### M3：Script Revision、Gate 与 Invalidation

**进入条件**：Shell 可观察现有项目；历史脚本样本已定义。

**变更**：

- 扩展 `script_revisions`、`story_scenes`、`stage_approvals`、`invalidation_records`；
- 将现有 episode/storyboard 文本投影为 revision 0，不改原 ID；
- 新 Script command 只写 revision；批准后更新兼容 current projection；
- Gate 计算下游 stale 范围，不删除已有媒体；
- Legacy 脚本编辑继续可用，但项目只能选定一个写入权威入口。

**独立验收**：保存草稿≠批准；批准产生不可变 revision；上游修改显示 stale；关闭 VNext 后旧页面能看到最新 approved current projection。

**Rollback point**：`vnext.script=off`；旧 current 字段仍完整；新 revision 和 invalidation 作为审计数据保留。

### M4：Setup 与资产权威

**进入条件**：Script approval 可产生可重放资产提取输入。

**变更**：

- 以现有 Character/Scene/Prop/Variant/Library 为物理来源，建立 AssetIdentity projection；
- 新增 VoiceProfile、StyleBinding、MergeDecision 等缺失语义；
- 资产提取先生成 Merge Preview，不直接覆盖；
- 定义 entity current media 与 Candidate Selection 的权威关系；
- 修复现有资产 API schema 漂移后再让 VNext 消费。

**独立验收**：新增/匹配/合并/忽略可预览和撤销；旧素材库与 VNext 资产中心指向同一实体；图片候选不自动改 current。

**Rollback point**：`vnext.setup=off`；兼容 write-through 保证旧 UI 可见；MergeDecision 可逆，新表不删除。

### M5：Storyboard 与 Shot Package

**进入条件**：已批准 Script 与 Setup gate 稳定。

**变更**：

- 保留 `storyboards.id` 作为 Shot identity；新增 ShotRevision 和 ReferenceBinding；
- 把台词、旁白、时长、构图、首尾帧、角色/变体/道具、模型与参数形成版本化 Shot Package；
- reference slots、AV contract、frame prompts、H3 draft 通过 Adapter 接入；
- ProviderParameterBar 完全由 CapabilitySnapshot 决定可用项；
- 标准页先交付，Canvas 继续走旧入口但共享已迁移 command。

**独立验收**：旧镜头无损读取；新 revision 可比较；reference 失效可见；unsupported 参数在提交前被拒绝；旧 FilmCreate 仍可工作。

**Rollback point**：`vnext.storyboard=off`；ShotRevision 是附加数据，不覆盖旧宽表；必要的已批准变更已投影回 Legacy。

### M6：Job、Candidate 与 Provider 渐进收敛

**进入条件**：Job projection 可表示所有旧状态，Provider contract 已有离线 fixtures。

**变更顺序**：

1. 先统一只读任务中心；
2. 迁移纯本地/可控 Job（FFmpeg probe 或包校验）验证 lease/reconcile；
3. 迁移图像 task/batch；
4. 迁移统一视频生命周期；
5. 迁移 TTS、merge、upscale；
6. Director 与 external web 最后接入；
7. Provider 逐个从 Legacy adapter 抽成原生 adapter。

每个 Job 在创建时固定 runtime owner；切 flag 不会把运行中的任务换执行器。旧历史通过 LegacyJobAdapter 读取，新任务只由一个 runtime 写。

**独立验收**：刷新/重启恢复、cancel、retry、新 Attempt、partial batch、candidate select 与 artifact 持久化均通过；每个已迁 Provider 能单独回切。

**Rollback point**：关闭对应 `vnext.jobs.<kind>` 或 `vnext.provider.<id>`；在途 Job 由创建它的 runtime 收尾；canonical 数据不逆删。

### M7：Film、Picture Lock 与 Delivery

**进入条件**：候选选择与媒体 artifact 权威已稳定。

**变更**：

- 从 selected candidates 生成 TimelineRevision；
- PictureLock 固定 shot revision、candidate/artifact、顺序与依赖 hash；
- FFmpeg merge、音频、字幕、水印、超分作为 Delivery Job steps；
- Delivery 保存 manifest、参数、来源、状态和失败 step；
- 修改已锁定上游时创建新 timeline 或显式解锁，不静默改旧交付。

**独立验收**：锁定可复现；交付失败可从 checkpoint 恢复；源候选仍可追溯；旧 video merge 输出能导入 Delivery history。

**Rollback point**：`vnext.film=off`；旧合成入口仍可用；已生成成片和 manifest 保留为普通 artifact。

### M8：高级能力与受控收缩

**进入条件**：P0/P1 flow 已稳定至少一个发布窗口，每个 Legacy 模块有使用与兼容数据。

**变更**：

- Canvas 改为共享 Command / Query；
- Director/H3/ChatGPT Web/OpenClaw 按 P2 价值接入；
- 清理已确认无引用的 Queue、Stub、FreeCreate 遗留；
- Provider 全迁后缩小巨型 client；
- 所有支持安装进入 ledger 后移除 `ensureAllColumns()`；
- 旧表/列只在备份、导出、遥测和恢复演练完备时 Contract。

**独立验收**：删除前后能力矩阵相同；打包、扩展、包导入和历史库均通过；无兼容调用命中退役代码。

**Rollback point**：代码清理每模块独立提交并可回滚。涉及 DDL 收缩时，发布前生成完整 DB + 文件 manifest 备份，并提供前向恢复迁移；不承诺用旧二进制写新库。

## 6. 持续可运行保证

每个合并必须满足：

1. 默认 flags 下当前产品启动、构建和全量测试通过；
2. 新 schema 是 additive，旧查询不会因缺列/改名失败；
3. 新 route 使用独立路径或受 flag 控制，不替换无回退的主入口；
4. 在途 Job 绑定 runtime owner，不随部署中途换执行器；
5. migration 失败发生在 HTTP ready 之前，并保留升级前备份；
6. 文件先 staging 后 commit，失败不会留下被业务引用的半文件；
7. v1 facade 与 package adapter 的 characterization tests 持续运行；
8. 任一阶段只要关闭对应 flag，不需要手工改数据库即可回到上一用户流程。

## 7. Rollback 层级

| 层级 | 适用场景 | 动作 | 数据处理 |
|---|---|---|---|
| R0 UI 回切 | 页面或交互问题 | 关闭 stage/shell flag | 无数据变化 |
| R1 Adapter 回切 | 单 API/Provider/Job kind 问题 | 切回 Legacy adapter/runtime | 在途任务保持原 owner，新数据保留 |
| R2 应用版本回切 | 跨模块回归 | 回滚到上一可运行构建 | additive schema 留存，旧版走兼容字段 |
| R3 DB 恢复 | migration 未完成或数据校验失败 | 停止服务，恢复升级前 DB 备份 | 同步恢复对应文件 manifest；仅在用户写入尚未恢复前执行 |
| R4 Artifact 恢复 | 文件提交/删除错误 | journal reconcile 或 tombstone restore | DB 引用与 hash 重新核对 |

如果升级后已经产生用户写入，不直接用旧备份覆盖；应先导出增量或用前向修复迁移。Rollback runbook 必须把“代码回切”和“数据恢复”分开。

## 8. Legacy 退役门禁

Legacy 模块只有同时满足下列条件才可删除：

- 已有替代路径覆盖同等或更高 User Value；
- 连续一个稳定发布窗口无兼容调用，或调用者已明确列出并迁移；
- 新旧 projection diff 为零或差异有批准的解释；
- 历史 DB、包、书签和在途任务有读取/恢复方案；
- 对应 Provider/Job/页面的测试和诊断已经转移；
- 回滚点已创建并完成一次演练；
- 删除不减少 `docs/vnext/vnext-scope.md` 所保护的本地、Provider、包、外部协作能力。

## 9. 发布与验收节奏

每个 M 阶段至少经历：开发者 flag → 内部项目 → 历史项目副本 → 默认开启 → 稳定窗口 → Legacy 退役评审。不同 stage、Job kind 和 Provider 可以处于不同阶段，避免一项高风险 Provider 阻塞整个 VNext。

阶段验收报告必须包含：测试命令与结果、schema before/after、双读 diff、能力矩阵、在途 Job 恢复、artifact manifest、已知限制、flag 默认值、rollback 演练结果和 go/no-go 决策。
