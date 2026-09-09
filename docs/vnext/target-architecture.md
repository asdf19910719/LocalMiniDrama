# LocalMiniDrama VNext Target Architecture

## 1. 架构结论

VNext 的目标不是另起一套产品，而是在现有 Vue 3、Express、SQLite、本地文件、FFmpeg、Electron 与 Provider 能力之上形成一个**可演进的本地优先模块化单体**。

目标架构的核心变化只有三类：

1. 用稳定的 Application Command / Query 与版本化契约隔离页面、领域、Provider 和存储；
2. 用统一的 Job / Attempt / Candidate 生命周期承接长任务，但通过 Adapter 继续读取和控制旧任务；
3. 用可追踪迁移、明确权威源和文件提交日志替代“启动时补列 + 多重事实源”。

不改变的基础判断：单用户、本机运行、SQLite 与文件系统是正确的部署形态；不引入微服务、远程消息队列、云端账号系统，也不重写已经通过大量测试验证的生成协议。

## 2. Current → Transition → Target

```text
CURRENT
Vue pages/stores ── hand-written API ── /api/v1 giant composition root
                                         ├─ domain-ish services
                                         ├─ several task runtimes
                                         ├─ giant image/video clients
                                         ├─ SQLite + ensureAllColumns
                                         └─ local files / FFmpeg / external web
                         │
                         ▼
TRANSITION
Legacy UI ───────────────┐
VNext Studio ── contract client ── API v2 ── Application Facade ── Domain Modules
                         │             │              │
                         └─ v1 facade ─┘              ├─ Legacy API/Job/Data Adapters
                                                     ├─ Provider Registry + Legacy Providers
                                                     └─ SQLite ledger + legacy tables + new tables
                         │
                         ▼
TARGET
Stable Studio Shell ── typed runtime contracts ── versioned API
                                                └─ modular application core
                                                   ├─ Project & Episode
                                                   ├─ Script & Gate
                                                   ├─ Asset & Setup
                                                   ├─ Shot & Reference
                                                   ├─ Generation & Review
                                                   ├─ Film & Delivery
                                                   └─ Package & Provenance
                                                      │
                                                      ├─ durable local Job Runtime
                                                      ├─ Provider/Tool Adapters
                                                      └─ SQLite + atomic local artifact store
```

迁移期允许 Legacy 与 VNext 共存；目标态只有一个领域内核，但 `/api/v1` 可作为兼容外壳保留到所有消费者完成迁移。

## 3. 架构原则与强制不变量

| 原则 | 架构含义 | 验收约束 |
|---|---|---|
| 本地优先 | 数据、媒体、任务恢复都不依赖中心云服务 | 断网时仍可浏览、编辑、导入导出和执行本地工具 |
| 渐进替换 | 新能力旁路接入，旧路径可独立运行 | 任一迁移阶段关闭 VNext flag 后 Legacy 可工作 |
| ID 稳定 | 复用现有 drama/episode/storyboard ID | 不批量重建项目，不因 UI 迁移改 ID |
| 单一写入权威 | 每类事实只有一个 authoritative store | 双读只发生在 Adapter，禁止两边任意写 |
| 长任务后端所有 | 页面关闭不终止任务，刷新可恢复 | UI timeout 不等于 job failed |
| 候选不覆盖 | 生成结果先成为 Candidate，显式选择才改变当前结果 | failed/partial batch 不覆盖已选媒体 |
| 可解释失效 | 上游修改产生 InvalidationRecord，不静默删除下游产物 | stale 内容仍可查看、比较和局部重做 |
| 能力驱动 | Provider 参数和禁用态由 CapabilitySnapshot 决定 | UI 不以供应商名称硬编码参数组合 |
| 契约先行 | API、包格式、任务状态均有 schemaVersion | Adapter 输入输出必须通过契约测试 |
| 前向数据迁移 | 数据库回滚以代码回切和兼容读为主，不做危险逆向 DDL | 每批升级前备份并可由旧版本只读/兼容读取 |

## 4. 目标运行拓扑

```text
┌──────────────────────── Electron / Browser ────────────────────────┐
│ Vue 3 App Shell                                                    │
│ Projects | Assets | Tasks | Settings                               │
│   └─ Studio: Script | Setup | Storyboard | Film                    │
│        └─ Feature components → Commands / Queries / Job observer   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP / SSE-or-poll contract
┌───────────────────────────────▼─────────────────────────────────────┐
│ Express Modular Monolith                                            │
│ API v2 ─ Application services ─ Domain policies ─ Domain events     │
│ API v1 compatibility facade ────────────────┘                        │
│                                                                     │
│ Job Runtime ─ Provider Registry ─ Local Tool Registry               │
│     │               │                 ├─ FFmpeg                      │
│     │               ├─ text/image/video/TTS                         │
│     │               ├─ ComfyUI / Director / H3                      │
│     │               └─ external-web compatibility                   │
│     │                                                               │
│ SQLite repositories ─ Artifact staging/commit ─ package adapters    │
└─────┼──────────────────────────────┬─────────────────────────────────┘
      │                              │
 SQLite database                 Local filesystem
```

仍采用单 Node 进程作为默认产品形态。Job Runtime 是进程内调度器加 SQLite 持久化 lease，不是独立服务；只有实际证明单进程不足时才考虑 worker 进程。

## 5. 前端目标分层

### 5.1 App 与 Route 层

- `App Shell` 只负责全局导航、全局任务入口、更新/离线状态和 route outlet；
- `StudioShell` 负责项目、剧集、四阶段导航、dirty guard、Gate 摘要和 Inspector 插槽；
- Script、Setup、Storyboard、Film 是独立 route-level feature，不通过条件分支继续堆进 `FilmCreate.vue`；
- Canvas 是 P2 的另一种 workspace projection，与标准页共用同一 Command / Query，不拥有第二套业务规则。

### 5.2 Feature / Application 层

前端组件只消费以下稳定接口：

```text
Query:   getStudioProjection, getScriptRevision, listAssets,
         listShots, listCandidates, getTimeline, observeJobs
Command: saveDraft, approveRevision, mergeAssets, updateShot,
         submitGeneration, selectCandidate, lockPicture, createDelivery
```

Command 返回业务结果或 JobReceipt；Query 返回 versioned projection。组件不直接拼供应商请求、不直接轮询各类旧任务表，也不把 Toast 当作业务状态。

### 5.3 状态所有权

| 状态 | 所有者 |
|---|---|
| Server entity / revision / job | 后端数据库，通过 query cache 投影 |
| 编辑器草稿与脏标记 | feature-local draft controller |
| 路由、筛选、面板开合 | URL 或 view-local state |
| 多选集合 | 当前 workspace selection model |
| Job 观察与重连 | 单一 JobObserver service |
| 通知去重 | NotificationCoordinator |
| Provider capability | 带版本的 query cache |

Pinia 可以保存跨组件 view state，但不得再同时承担队列执行、定时器、网络副作用和通知。

### 5.4 目标目录边界

迁移期新代码放在 `frontweb/src/vnext/`，减少与巨型 Legacy 页面交叉修改：

```text
frontweb/src/vnext/
├─ app/                 # shell、routes、bootstrap
├─ contracts/           # runtime schemas、DTO normalization
├─ application/         # commands、queries、job observer
├─ features/
│  ├─ script/
│  ├─ setup/
│  ├─ storyboard/
│  └─ film/
└─ shared/              # primitives，不放领域规则
```

目标态可在 Legacy 退出后去掉 `vnext` 命名，但不以重命名为迁移前提。

## 6. 后端目标分层

### 6.1 API 层

- `/api/v2` 是目标契约；解析 HTTP、验证输入、注入 requestId、映射响应，不写业务编排；
- `/api/v1` 保持现有 URL，逐端点切换为 Compatibility Facade；
- 所有响应采用统一 envelope，错误包含稳定 `code`、面向用户的 `message`、可选 `details` 与 `requestId`；
- SSE 可以作为任务增量观察优化，但轮询永远保留为可靠回退。

目标 envelope：

```json
{
  "success": true,
  "data": {},
  "meta": { "schemaVersion": "2.0", "requestId": "..." }
}
```

错误：

```json
{
  "success": false,
  "error": { "code": "CAPABILITY_UNAVAILABLE", "message": "...", "details": {} },
  "meta": { "schemaVersion": "2.0", "requestId": "..." }
}
```

### 6.2 Application 层

Application Service 是唯一用例入口，负责事务边界、权限/本地安全检查、领域政策调用、Job 提交、Outbox/文件日志与结果投影。建议模块：

| 模块 | 职责 | 复用来源 |
|---|---|---|
| ProjectEpisode | 项目/剧集生命周期、导入导出 | drama、project deletion、package services |
| Script | revision、scene、批准 | story generation、episodes/storyboards 数据 |
| Gate | 阶段就绪、失效传播、重做范围 | 新增政策，读取现有状态 |
| AssetSetup | Identity、Variant、Voice、Style、Merge | characters/scenes/props/libraries/style |
| Shot | ShotRevision、reference、AV contract | storyboard、frame prompt、reference services |
| Generation | capability、job、attempt、candidate、selection | image/video/director/upscale/external runtimes |
| FilmDelivery | timeline、picture lock、render、delivery | director timeline、video merge、audio、FFmpeg |
| Package | manifest、provenance、round-trip | drama/episode/external package services |

### 6.3 Domain 层

领域层只表达 `docs/vnext/domain-model.md` 中已经批准的实体和政策，不依赖 Express、SQLite、文件路径或 Provider SDK。关键政策包括：

- RevisionApprovalPolicy；
- StageGatePolicy；
- InvalidationPolicy；
- CandidateSelectionPolicy；
- PictureLockPolicy；
- CapabilityValidationPolicy；
- BatchAggregationPolicy。

### 6.4 Infrastructure 层

Infrastructure 实现 repository、provider、local tool、package 与 artifact port。旧服务允许先作为 Adapter 内部实现，禁止新 Application Service 反向依赖 `routes/index.js` 或 Vue 请求形状。

## 7. Bounded Context 与依赖方向

```text
Project/Episode
   ├──> Script ──> Gate
   ├──> Asset/Setup ──> Gate
   └──> Shot ──> Generation ──> Film/Delivery
          │             │              │
          └─────────────┴────> Package/Provenance

Cross-cutting ports: Capability, Job, Artifact, Clock, Idempotency, Logging
```

依赖只能指向领域抽象。Provider 不得回写页面模型；Film 不得通过修改 `video_generations` 的任意字段来隐式选择候选；Package 只通过公开 projection 导出。

## 8. Provider 与能力架构

### 8.1 统一 Port

每个 Provider Adapter 实现其支持的子集：

```text
describeCapabilities(context) → CapabilitySnapshot
validate(request, capability)  → ValidationResult
submit(request)                → ProviderAttemptReceipt
poll(attempt)                  → AttemptProgress
cancel(attempt)                → CancellationResult
normalizeResult(raw)           → ArtifactCandidate[]
normalizeError(raw)            → ProviderError
```

CapabilitySnapshot 必须带 `providerId`、`modelId`、`mediaType`、参数 schema、reference 限制、时长/尺寸限制、异步语义、成本信息可用性、版本和获取时间。

### 8.2 渐进复用

- 第一阶段用 `LegacyImageProviderAdapter` / `LegacyVideoProviderAdapter` 包装 `imageClient.js` 和 `videoClient.js`；
- ComfyUI 已有 Registry 直接实现目标 Port；
- Jimeng、xAI、DashScope、Gemini/Veo、Vidu、Kling、Volc、Sora、Agnes、MiniMax H3 等逐个抽离；
- 每迁移一个 Provider，旧路径仍可由 flag 回切；
- 只有同一 Provider 的契约、回归、恢复、取消都通过后，才删除巨型 client 中相应分支。

### 8.3 本地工具

FFmpeg、音频、字幕、水印、合成、超分以 LocalToolAdapter 接入同一 Job Runtime，但 Capability 与远端 Provider 分开，避免把“本机是否有二进制”误当成模型能力。

## 9. 统一 Job Runtime

### 9.1 Canonical 状态

```text
DRAFT → QUEUED → RUNNING → {SUCCEEDED | FAILED | CANCELLED}
                    ├─────→ WAITING_EXTERNAL
                    └─────→ CANCEL_REQUESTED

Batch result: SUCCEEDED | PARTIAL_SUCCESS | FAILED | CANCELLED
```

Retry 创建新 Attempt，不抹掉旧 Attempt；Job 保存输入快照、能力快照、幂等键、进度、checkpoint、错误、产物引用和 correlationId。

### 9.2 本地耐久性

- SQLite lease：`lease_owner`、`lease_expires_at`、`heartbeat_at`；
- 进程启动执行 reconcile，不把所有 RUNNING 一律标 FAILED；
- Provider poll、文件下载、FFmpeg step 都可保存 checkpoint；
- cancel 先记录 `CANCEL_REQUESTED`，确认 Provider/进程终止后才是 `CANCELLED`；
- JobObserver 读取 canonical projection，也可聚合 Legacy task adapter；
- 单进程 GPU mutex 保留；若未来多进程再把互斥提升为持久化 resource lease。

## 10. 数据与存储目标

### 10.1 SQLite 保留策略

`dramas`、`episodes`、`storyboards` 和现有稳定实体保留 ID 与主要表。高变化语义用新表扩展：revision、gate/invalidation、reference、job/attempt/candidate、timeline/picture lock/delivery。

迁移采用 Expand → Backfill → Dual-read verification → Authority switch → Contract。禁止在 Authority switch 前删列、改 ID 或清理旧 JSON。

### 10.2 Schema Migration Ledger

目标 runner 维护：`version`、`name`、`checksum`、`applied_at`、`app_version`、`duration_ms`。既有 01–35 迁移做一次性 baseline 记录；新迁移放在独立目录并逐个事务执行。`ensureAllColumns()` 在所有受支持安装完成 baseline 后才退出。

### 10.3 权威源

| 事实 | 目标权威源 | Legacy 兼容 |
|---|---|---|
| Project/Episode/Shot identity | 现有主表 ID | 原样读取 |
| Script 内容 | ScriptRevision + StoryScene | Adapter 从 episode/storyboard 投影 |
| 角色/场景/道具关系 | 结构化 binding/identity | 双读校验旧 JSON 与关系表 |
| 当前媒体 | Candidate Selection | 回写必要的 legacy current URL，直到旧 UI 退出 |
| Job 状态 | GenerationJob + latest Attempt | LegacyJobAdapter 投影旧表 |
| Timeline/锁定 | TimelineRevision + PictureLock | Director timeline/merge 作为来源或导入 |
| 文件 | Artifact row + manifest/hash | 旧 URL/local_path 继续可解析 |

### 10.4 文件一致性

媒体写入使用：`stage temp → hash/probe → DB transaction + journal → atomic rename → mark committed`。失败由 compensation/reconcile 清理。删除先进入可恢复的 tombstone/垃圾回收队列，避免 DB 与文件互相悬空。

## 11. 安全边界

- 默认只监听 `127.0.0.1`；远程监听必须显式启用认证与 TLS；
- API key 默认不回传明文，日志、错误、导出包统一 redaction；
- 凭证迁移到 OS credential vault 或本地加密 secret store，数据库只存引用；
- 移除进程级 `NODE_TLS_REJECT_UNAUTHORIZED=0`，测试证书只注入到单 Provider transport；
- 静态文件服务使用规范化路径和 allowlist，导入包防路径穿越与 zip bomb；
- mutation 使用 requestId/idempotency key，外部扩展协议保留 token 与版本检查。

这些是 Target Architecture 的基础设施 P0，不等待视觉改版完成。

## 12. 可观测性与诊断

结构化事件至少包含 `timestamp`、`level`、`requestId`、`jobId`、`attemptId`、`providerId`、`projectId`、`episodeId`、`eventName`、`durationMs` 和脱敏错误。诊断页只展示能力、队列、存储、迁移版本和失败摘要，不暴露 secret 或完整请求体。

推荐的本地指标：Job 排队/运行/恢复数量、各 Provider 成功率与延迟、批次部分成功率、artifact 孤儿数、migration/reconcile 结果、前端重复通知数量。

## 13. 打包与运行

- 开发态仍为 Vite `3013` + Express `5679`；
- Electron 仍捆绑前端 dist、Node backend、SQLite native dependency 与 FFmpeg；
- 一个构建版本源注入前后端与 migration metadata；
- 启动顺序固定为配置校验 → DB 备份判断 → migration → repository health → runtime reconcile → HTTP ready；
- `/health` 拆分为 liveness 与 readiness，migration/reconcile 未完成时不宣告 ready；
- 浏览器扩展和 external bridge 是可选 Adapter，不成为核心制作路径的启动依赖。

## 14. 最大化复用清单

| 当前资产 | 目标去向 | 决策 |
|---|---|---|
| Vue 3 / Element Plus / Vue Router / Pinia | App Shell 与 feature UI 基础 | KEEP |
| drama/episode/storyboard 领域与 ID | ProjectEpisode / Shot 核心 | KEEP + ENHANCE |
| character/scene/prop/variant/library | AssetSetup Adapter 后逐域收敛 | KEEP + REFACTOR |
| image task/batch | 首批 Job/Batch 行为样本和兼容源 | KEEP + ADAPT |
| unified video lifecycle | Video Generation application implementation | KEEP + ENHANCE |
| ComfyUI Registry | Provider Registry 原生实现 | KEEP |
| `imageClient.js` / `videoClient.js` | Legacy Provider Adapter 内的兼容知识 | REFACTOR，禁止重写 |
| Director job/candidate/artifact | Candidate review 与高级工作流 | ENHANCE |
| H3 prompt draft/semantic review | Provider extension contract | KEEP |
| upscale runtime/segment recovery | Local/remote post-process Job Adapter | KEEP |
| FFmpeg merge/audio/subtitle/watermark | Film/Delivery LocalToolAdapter | KEEP |
| package/provenance services | Package bounded context | KEEP |
| browser extension outbox/protocol | ExternalWeb Adapter | KEEP，P2 隔离 |
| SQLite、本地 storage、Electron | 目标部署底座 | KEEP |

## 15. 明确不做

- 不把模块化单体拆成微服务；
- 不在 VNext 首发引入团队、权限、钱包、社区或云项目；
- 不以 RunningHub 页面结构替代本项目已有生成和本地能力；
- 不一次性替换 `FilmCreate.vue`、所有 Provider、所有任务表或全部数据库 schema；
- 不用双写永久维持两个权威源；
- 不为“统一”强行把 Character、Location、Prop 的领域字段压成一张万能表；
- 不在没有真实负载证据前引入 Kafka、Redis、Kubernetes 或分布式事务。

## 16. Target Architecture 验收

达到目标态需同时满足：

1. 四阶段 Studio 只通过公开 Command / Query 工作，标准页与 Canvas 业务结果一致；
2. `/api/v2` 契约和错误模型稳定，仍需保留的 `/api/v1` 均由 facade 测试保护；
3. 所有 P0 Provider/本地工具通过 capability 与 contract tests；
4. 所有新长任务由 durable Job Runtime 管理，旧任务历史仍可读；
5. migration ledger 能从受支持的历史数据库升级，并通过重复执行与中断恢复测试；
6. 上游变更、候选选择、Picture Lock、Delivery 都有可追踪状态；
7. 密钥、监听、TLS、日志和文件路径符合本地安全边界；
8. Legacy UI 退出前后，现有项目、包格式、媒体与生成链路无能力损失。
