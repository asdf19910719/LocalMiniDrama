# LocalMiniDrama VNext Regression Plan

## 1. 目标与发布门禁

回归计划的第一目标不是证明 VNext 新页面可用，而是证明迁移过程中**当前有价值能力没有减少、历史数据仍可用、在途任务不丢失、回滚真实可执行**。

每个阶段必须同时通过四道门：

1. Legacy baseline：默认 flags 下现有流程无回归；
2. VNext acceptance：当前阶段新增 flow 的状态与契约通过；
3. Coexistence：新旧入口、任务、Provider 和数据能够按既定 authority 共存；
4. Rollback rehearsal：关闭 flag、回切 adapter/构建或恢复备份后仍可工作。

任何一项失败都阻止对应 flag 默认开启；不能用“新功能可用”抵消 Legacy 能力损失。

## 2. 当前基线与保全范围

当前审计记录的验证基线为 1,264 项测试：Backend 920、Frontend 244、Browser Extension 96、External Bridge 4，并包含 Frontend build。实施首个 TASK 时必须重新运行并把实际数量、Node/Electron 版本和日期写入阶段证据；本文中的数字不是永久阈值。

### 2.1 必须保全的能力族

| 能力族 | 核心回归断言 |
|---|---|
| Project/Episode | CRUD、软删/恢复语义、剧集顺序、项目封面、进度、Canvas layout |
| Import/Export | drama ZIP、episode package v1.1、外部 AI package、provenance、round-trip |
| Script/Story | 故事生成、小说导入、角色提取、现有文本可读 |
| Assets | Character/Scene/Prop、Variant、四视图、素材库、Style、上传/本地路径 |
| Storyboard | CRUD/排序/插入、AV contract、首尾帧、reference slots、prompt/H3 draft |
| Image | API/外部通道、batch/queue、任务恢复、结果选择、negative/style snapshot |
| Video | prepared/batch、所有 mode、capability/workflow、poll/retry/cancel/resume、candidate |
| Director | job/artifact/candidate/review/timeline/anchor/quality/governance |
| Audio/Post | TTS、音频提取/计划/混音、merge、字幕/水印、upscale segment/recovery |
| Local/Desktop | SQLite、本地文件、FFmpeg path、Electron start/ready/shutdown、静态资源 |
| External | extension protocol/session/outbox/DOM adapter、external generation idempotency/recovery |
| Configuration | 全 Provider 字段、model map、workflow config、prompt overrides、language |

参考产品没有的能力也在此矩阵中；不得因 VNext 页面暂未展示就删除。

## 3. 测试层次

```text
                   ┌──────────── Live provider / packaged smoke ────────────┐
                   │             少量、显式、非默认                         │
              ┌────┴──── E2E user journeys + rollback drills ──────────────┐
              │          Contract / migration / coexistence tests          │
          ┌───┴─── Application / domain / adapter / runtime integration ───┐
          │                 Unit / state truth table / fixtures             │
          └──────────────── Characterization baseline ──────────────────────┘
```

### 3.1 Characterization Tests

在重构以下文件前先固定输入、输出、副作用和错误：

- `frontweb/src/views/FilmCreate.vue`；
- `frontweb/src/components/AIConfigContent.vue`；
- `frontweb/src/composables/useVideoGenerationPanel.js`；
- `frontweb/src/stores/generationTaskStore.js`；
- `frontweb/src/stores/imageGenerationStore.js`；
- `backend-node/src/routes/index.js`；
- `backend-node/src/services/imageClient.js`；
- `backend-node/src/services/videoClient.js`；
- `backend-node/src/db/migrate.js`。

测试目标是锁定有价值行为，而不是锁定内部函数名或巨型组件 DOM。

### 3.2 Contract Tests

每个边界需要 producer 与 consumer 两侧验证：

| Contract | Producer | Consumer | 必测变体 |
|---|---|---|---|
| API envelope/error | Express v2 route | frontend contract client | success、validation、conflict、404、500、timeout |
| StudioProjection | legacy/new application service | StudioShell | empty、partial、ready、stale、error |
| JobProjection | canonical/legacy adapters | Task Center | 所有状态、UNKNOWN、partial、owner |
| CapabilitySnapshot | Provider/LocalTool adapter | parameter UI + validator | missing config、unsupported、dynamic stale |
| ShotPackage | Shot service | generation preparation/package export | full/partial/reference invalid/version mismatch |
| Candidate/Selection | job handler | review UI/legacy current | select/reselect/concurrent/failed artifact |
| PackageManifest | exporter | importer/extension/external user | supported old version、new version、checksum、path attack |
| Extension protocol | backend | browser extension | version mismatch、retry、idempotency、outbox replay |

### 3.3 Domain State Tests

以 `docs/vnext/state-model.md` 为真值表，至少覆盖：

- Script draft/saved/approved/reopened；
- Gate blocked/ready/stale；
- Job queued/running/waiting/cancel_requested/succeeded/failed/cancelled；
- Batch success/partial success/failed/cancelled；
- Candidate available/selected/rejected/missing artifact；
- Timeline draft/locked/superseded；
- Delivery queued/processing/succeeded/partial/failed；
- UI Default/Hover/Selected/Disabled/Loading/Empty/Processing/Success/Error。

非法状态转换必须失败且不产生部分写入。

## 4. 测试环境矩阵

| 维度 | 必测值 |
|---|---|
| Runtime | Node 22 开发态；Electron 打包态使用的 Node/ABI |
| OS | Windows 主支持；macOS 打包脚本变更时执行 smoke |
| DB | fresh、旧 schema 样本、pre-director、pre-image-task、current、大项目 |
| Network | online、offline、timeout、断线重连、代理/自签名显式配置 |
| Storage | 正常、只读、路径缺失、空间不足、文件被占用、hash 不符 |
| Provider | 未配置、配置错误、fixture 成功、fixture 错误、可选 live |
| Flags | all off、当前 stage on、混合 runtime、rollback 后 |
| Project size | empty、1 episode/1 shot、典型项目、200+ shots 压力样本 |

Live Provider 测试可能产生费用，始终 opt-in，不作为普通 CI 默认步骤；迁移某 Provider 默认开启前必须至少有一次受控 live smoke 证据。

## 5. 数据库迁移回归

### 5.1 Fixture Set

每个 fixture 包含：脱敏 DB、schema fingerprint、关键 row counts、代表 ID、文件 manifest、预期 migration version。禁止包含真实 key、真实用户内容或本机绝对路径。

### 5.2 每个 Migration 必测

1. fresh install 一次成功；
2. 每个受支持历史 fixture 升级成功；
3. 同一库运行两次结果相同；
4. SQL 中途失败，事务不留下半 schema；
5. 进程在 migration 间中断，再启动可继续；
6. checksum 被修改时拒绝 readiness；
7. 原有 ID、row count 和 package export 语义不丢失；
8. 新旧 projection diff 在批准范围内；
9. backup manifest 与恢复演练成功；
10. 数据含孤儿、坏 JSON、缺文件时给诊断，不静默删除。

### 5.3 Authority Switch Tests

每个域使用固定样本依次验证：Legacy write → dual-read equal → VNext write + Legacy read-after-write → flag off → Legacy edit policy → flag on。若同一项目允许两个入口编辑，必须得到明确 conflict/disabled，不允许 last-write-wins 静默覆盖。

### 5.4 Contract Migration Tests

删除列/表前额外要求：运行时兼容命中连续一个稳定窗口为零；旧包仍可导入；完整 DB + 文件 manifest 备份已恢复过；contract 后的 current build 可从备份前向恢复；旧二进制是否只读兼容有明确结论。

## 6. 文件与 Artifact 回归

对 artifact 提交流程设置 crash points：

```text
download/write temp
→ probe/hash
→ DB pending journal
→ atomic rename
→ DB committed/reference
→ cleanup temp
```

在每个箭头处模拟异常并验证 reconcile。断言包括：

- 未 committed 的文件不会出现在业务 Query；
- committed artifact 必须可打开且 hash/size/mime/probe 一致；
- retry 不重复生成 DB row 或覆盖不同文件；
- 删除被引用媒体时被阻止或 tombstone；
- 项目删除、导入失败、Job 取消后无不可解释孤儿；
- 旧 `url`/`local_path` 仍能经 Legacy resolver 打开；
- Windows 文件占用与 Electron 路径必须有覆盖。

## 7. Job Runtime 与共存回归

### 7.1 Runtime State Matrix

| 场景 | 预期 |
|---|---|
| queued 时重启 | 重启后重新获得 lease 并执行一次 |
| running 本地 step 时崩溃 | checkpoint 前 step 按幂等策略重做或继续 |
| waiting external 时重启 | 恢复 poll，不重复 submit |
| cancel 与 success 同时到达 | 依据 provider receipt/event order 得到唯一终态 |
| cancel 请求未确认 | 保持 CANCEL_REQUESTED，不伪装 CANCELLED |
| retry | 新 Attempt，旧错误可见 |
| UI timeout | UI disconnected，后端 Job 状态不变 |
| batch 混合结果 | PARTIAL_SUCCESS，成功候选可用，失败项可单独重试 |
| flag 在运行中关闭 | 在途 Job 仍由 `runtime_owner` 完成，新 Job 走回切路径 |
| 两窗口重复提交 | idempotency key 只创建一个 Job |

### 7.2 Legacy + Canonical Mixed List

同一个 Task Center 同时放入 async、image、video、director、external、upscale 与 canonical jobs，验证：排序、项目/剧集过滤、去重、动作 capability、详情、错误、raw status 和单次通知。不得为了统一展示修改 Legacy 历史 row。

## 8. Provider 回归矩阵

每个 `providerId + protocol family` 独立建立 fixture corpus：

| 维度 | 必测内容 |
|---|---|
| Capability | 模型、尺寸/比例、时长、reference 类型/数量、音频、异步、成本可用性 |
| Validate | 缺配置、越界参数、不支持组合、stale capability |
| Submit | headers/auth、body、file/reference staging、idempotency |
| Poll | queued/running/success/failure/timeout/rate-limit、未知状态 |
| Cancel | 支持/不支持/已完成/race |
| Result | URL/base64/file、多候选、元数据、过期链接 |
| Error | HTTP、vendor code、retryable、用户消息、redaction |
| Recover | restart 后只 poll、不重复 submit |

迁移验收采用 A/B fixture parity：同一 canonical request 进入 LegacyProviderAdapter 与原生 Adapter，比较规范化 request、result、error 和 lifecycle，不比较无意义字段顺序。

必须保全的 Provider/能力至少包含当前文档列出的文本、OpenAI-compatible/Volc/DashScope/Nano Banana/Kling/Gemini 图像，以及 Jimeng、xAI、DashScope、Gemini/Veo、Vidu、Kling/Omni、Volc Omni、Sora、Agnes、MiniMax H3 视频，MiniMax/OpenAI-compatible TTS、ComfyUI 与现有 fallback。

## 9. 用户旅程 E2E

### J1 — 现有项目继续制作

打开 Legacy 项目 → 编辑资产/分镜 → 图像/视频生成 → 选择结果 → 合成。全程 flags off，结果与基线一致。

### J2 — VNext 从脚本到首个候选

打开项目 → Script 保存草稿 → 批准 → Setup 提取并 Merge Preview → 批准 Setup → 创建/编辑 Shot Package → 能力校验 → 提交 Job → 刷新/重启 → 候选出现 → 选择。验证每步 Gate、反馈和状态。

### J3 — 上游修改与局部重做

批准后修改角色 Variant 或脚本场景 → 产生 InvalidationRecord → 已有候选仍可见但 stale → 只重做受影响 Shot → 未受影响 Shot/候选/媒体 hash 不变。

### J4 — 批量部分成功

批量生成 10 个镜头，注入 3 个失败 → Batch=PARTIAL_SUCCESS → 7 个候选可审核 → 失败 3 个单独重试 → 不重复成功项。

### J5 — Picture Lock 到 Delivery

选齐候选 → lock preflight → PictureLock → 创建含音频/字幕/水印/超分的 Delivery → 中间 step 失败 → 从 checkpoint 重试 → 成片和 manifest 可打开、可复现。

### J6 — Package Round-trip

Current 项目导出 → VNext 导入预览 → 映射/冲突处理 → 导入 → 再导出 → canonical 内容、媒体 hash、provenance、未知字段策略符合预期；旧 v1.1 剧集包仍可导入。

### J7 — Legacy/VNext 回切

在 VNext approved 后关闭 stage flag → Legacy 页面看到 write-through current → 完成一次允许的 Legacy 操作 → 按 authority policy 重新进入 VNext → 无静默覆盖或明确要求 reconcile。

### J8 — External 与高级能力隔离

扩展/Director/H3 配置缺失或失败 → 核心 Script/Setup/Storyboard/Film 仍可工作；启用时 job/candidate/artifact 可进入统一投影；禁用后历史产物仍可读。

## 10. UI 与交互回归

每个 route-level page 和核心 primitive 使用状态 fixture 覆盖：

| 状态 | 断言 |
|---|---|
| Default | 主信息、主动作和上下文完整 |
| Hover | 只增强 affordance，不承载唯一信息 |
| Selected | 单选/多选范围、Inspector 目标明确 |
| Disabled | 原因可见，不能触发请求 |
| Loading | 保持布局稳定，可取消的请求可离开 |
| Empty | 解释为什么为空并提供合法下一步 |
| Processing | 显示后端事实、进度/阶段、可恢复性 |
| Success | 结果位置和后续动作明确，通知去重 |
| Error | 稳定错误、重试/修复入口、用户输入不丢失 |

额外验证：键盘导航、焦点回归 Modal/Drawer、Inspector 关闭、Context Menu 等价键盘路径、Drag & Drop 非拖拽替代、多选批量影响预览、dirty route guard、窄宽窗口、不因轮询产生布局跳动。

## 11. 性能与稳定性

| 指标 | 目标/比较方式 |
|---|---|
| Projects 首屏 | 不劣于 Legacy 基线 20%，并记录 DB query count |
| 200+ Shot 列表 | 交互无长时间主线程阻塞；只渲染可见区域或等效优化 |
| Task Center | 500 mixed jobs 下轮询不随组件数倍增 |
| DB migration | 时间和文件增量可观测；大库不会超时后继续后台改 schema |
| Restart recovery | Job 数量增加时 bounded reconcile，不重复 submit |
| Artifact import | 流式/受限内存；500MB 现有上限下有进度和磁盘检查 |
| Electron startup | readiness 前不展示可操作空壳；异常可诊断 |

性能门限先以当前测量基线确定，不能凭空设绝对毫秒；超过 20% 退化必须解释并批准。

## 12. 安全回归

- 默认只监听 loopback；远程配置未认证时拒绝启动或明确阻止；
- CORS 不默认为任意 origin；
- list/get/test/export/log/error 均不出现完整 API key/token；
- migration fixtures、诊断包和项目包执行 secret scan；
- 不全局禁用 TLS 校验；Provider 测试豁免只影响该 transport；
- zip path traversal、zip bomb、绝对路径、符号链接、超大请求被拒绝；
- `/static` 与 artifact content endpoint 不能越过 allowed roots；
- extension/bridge token、protocol version、idempotency 与 replay 防护持续通过。

安全门禁属于 CP0，并在每个后续 Checkpoint 重跑。

## 13. 阶段回归门禁

| Checkpoint | 必跑重点 | Go 条件 | No-go / rollback |
|---|---|---|---|
| CP0 | 全量、DB fixtures、backup、security、packaged smoke | Legacy 等价且双启动无 schema diff | 回切构建/恢复备份 |
| CP1 | v1/v2 contract parity、Legacy adapters、runtime bootstrap | v2 可完全卸载而 v1 不变 | 不挂 v2 |
| CP2 | routes/deep links/nine states/job observer | 只读、无 mutation diff | shell flag off |
| CP3 | revision/gate/invalidation/concurrency/write-through | 保存≠批准，stale 不删产物 | script flag off |
| CP4 | asset adapters/merge/current selection/library | 无误合并、旧 UI 同实体 | setup flag off |
| CP5 | Shot round-trip/reference/capability/Legacy parity | 全字段、无 unsupported submit | storyboard flag off |
| CP6 | runtime crash matrix/mixed jobs/provider parity | 不重复 submit、在途 owner 稳定 | kind/provider flag off + drain |
| CP7 | lock/delivery/FFmpeg/artifact recovery | 输出可复现、step 可恢复 | film flag off |
| CP8 | compatibility hit=0、package/history/desktop/full suite | 能力矩阵不减少、rollback 演练通过 | revert 单模块；取消 contract |

## 14. Rollback 演练

### 14.1 UI/Flag 回滚

在有真实草稿、approved data、running job、selected candidate 的测试项目上关闭对应 flag；验证旧路由可打开、current projection 正确、Job 继续、历史结果可见。再次开启 flag 后状态不丢。

### 14.2 Adapter/Runtime 回滚

创建一批 Legacy owner 和 canonical owner 任务，切换 job/provider flag；验证旧任务不被新 runtime 接管，新任务不被旧 runtime 重复执行。先 drain canonical queue，再回切默认提交路径。

### 14.3 应用版本回滚

在 additive schema 阶段安装上一版本，验证它能使用兼容字段读取/继续 Legacy flow；若上一版本不支持写入新库，runbook 必须明确只读或先导出，而不能承诺无条件降级。

### 14.4 DB/Artifact 恢复

停服务 → 验证 backup 与 manifest → 恢复 DB 和对应文件集 → 启动旧构建 → 运行 health/readiness → 打开代表项目 → 导出包再校验。升级后已有新用户写入时禁止直接覆盖，先走增量导出/前向修复。

## 15. 证据与签署

每个 Checkpoint 在 `docs/vnext/_evidence/` 生成一份报告，至少记录：

- commit/build/version、时间、环境；
- 实际测试命令、通过/失败/跳过与耗时；
- flags 与 runtime owner 分布；
- migration before/after/checksum/backup；
- v1/v2 或新旧 projection diff；
- Provider capability 与可选 live smoke；
- artifact orphan/hash 检查；
- E2E 结果和已知限制；
- rollback 演练步骤与结果；
- Product、UX、Frontend、Backend、Data/Release 的 go/no-go 签署。

证据目录记录验收事实，不替代根 `CHANGELOG.md`；已经实现并验证的用户可感知变更仍需写入 `[未发布]`。

## 16. 完成标准

VNext 回归完成必须证明：现有项目和包可无损打开；所有受保护 Provider/本地能力仍可用；新旧 route/API/job/data 可以按阶段共存；刷新、重启、取消、重试和部分成功语义正确；Picture Lock 与 Delivery 可追溯；安全边界收紧；任一阶段至少有一个已经演练的 rollback point。仅通过新 UI 截图或 happy path 不构成完成。
