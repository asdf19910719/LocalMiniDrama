# VNext Feature Decisions

> 本文把 [gap-analysis.md](./gap-analysis.md) 的逐项矩阵转成可执行的产品决策。它定义“保留什么、改变什么、明确不做什么”，但不是代码实施计划。

## 1. 决策原则

### 1.1 能力保全优先

Reference 没有展示的 Current 能力不等于低价值。以下能力构成 LocalMiniDrama 的差异化资产，VNext 必须优先保全：

- 多图像/视频/TTS Provider 与历史兼容参数；
- Provider task id、请求快照、重试、恢复和候选历史；
- ComfyUI、本地 GPU 协调和本地文件落盘；
- Canonical Reference、首尾帧、H3 编译与 provenance；
- Director 候选、质量分析和连续性锚点；
- FFmpeg 音频、字幕、水印、合片和视频超分；
- 项目 ZIP、剧集包、外部 AI 协作包；
- Electron、本地 SQLite 和用户已有项目数据。

VNext 可以改变这些能力的入口和内部边界，但不能以“简化 UI”为由删除协议、参数、历史或导入兼容。

### 1.2 产品语义先于视觉结构

四阶段、三栏、镜头轨、卡片和 Drawer 都是投影。先定义 Revision、Gate、Invalidation、Capability、Job、Candidate、Picture Lock 与 Delivery，再决定页面如何展示。否则页面重构会复制当前组件内条件判断。

### 1.3 渐进替换，不整体重写

选择“兼容层 + 双读核对 + 分域迁移”的演进方式：

```text
旧 UI / 旧 API / 旧数据
        ↓ compatibility facade
统一 Command / Query / Capability / Job 契约
        ↓
当前 Provider、文件、SQLite、FFmpeg 内核
```

拒绝一次性重写，因为现有供应商知识、容错和 1,264 项测试是高价值资产；重写无法同时验证所有历史数据与协议分支。

## 2. KEEP：作为 VNext 不变量

| 决策 | 对应 ID | 保留边界 | 允许变化 |
|---|---|---|---|
| 本地优先桌面形态 | S01、T01 | 默认本机、SQLite、文件、Electron、离线可管理项目 | 桌面启动和 ABI 构建方式可以重构 |
| 项目—单集—分镜主干 | S02、G01 | 稳定 ID、归属关系、旧项目可读 | 可增加 Revision、Story Scene、Gate 等新实体 |
| 剧本生产入口 | C01 | 手工、AI、小说/文本导入能力 | 结果先进入 Revision，不再直接视为批准正文 |
| 角色/场景/道具实体 | A01、A09 | CRUD、上传、生成、绑定、既有媒体 | 页面改为卡片/Drawer，关系模型渐进统一 |
| 图像/视频/TTS Provider | G05、G06、G07 | 所有现有协议、能力、任务 ID、快照和恢复 | 内部迁入统一 Provider Registry |
| ComfyUI | G08 | 工作流接入、本地/远端运行和资源协调 | 继续实验隔离，补 capability contract |
| 候选与选用 | G09 | 重生成不覆盖历史，选用是独立业务动作 | 统一图像、视频和 Director 的候选投影 |
| FFmpeg 与超分 | P01、P02 | 音频、字幕、水印、合片、分段恢复 | 统一产物 manifest、取消和错误阶段 |
| 项目/剧集包 | P04、P05 | 旧包可导入，来源和预览保留 | 增加 schema version、digest 和往返验证 |
| 生成快照与 provenance | P06 | 历史输入不可因当前配置变化而丢失 | 统一版本、hash 和展示入口 |
| 自动化测试资产 | T11 的既有部分 | 当前通过的行为持续作为回归基线 | 增加新契约、升级、E2E 和桌面 smoke |

KEEP 不代表冻结代码。它意味着任何重构的验收首先是旧能力仍可用、旧数据仍可解释、旧任务历史仍可查看。

## 3. ENHANCE：在现有能力上补闭环

### 3.1 项目与入口

- `S05`：项目详情增加每集阶段、阻塞、失败任务和产物摘要；分镜视频与成片分区。
- `S06`：把已有想法生成、剧本粘贴/文件/小说导入收拢为“从现有输入开始”，但不在 VNext 加视频重绘。
- `A09`：所有生成表面都保留上传/选择本地文件的同级入口。

### 3.2 编辑反馈

- `I02`：统一 `clean → dirty → saving → saved/save_failed`，确认内容被编辑时进入新草稿。
- `I03/G11`：批量操作显示范围、已选数、跳过条件、Provider、估算成本、子任务和部分成功；只重试失败项。
- `I04`：拖拽必须有按钮/菜单/键盘替代；镜头排序要有落点、撤销和失效反馈。
- `I06`：选中、失败、禁用、stale 不能只靠颜色；Modal/Drawer 管理焦点和返回点。

### 3.3 资产与风格

- `A02`：明确三层关系：Asset Identity → Semantic Variant → Media Candidate/Selected Appearance。
- `A05`：保留 StyleSpec 和生成快照；风格库只负责发现、预览影响和应用，不让卡片点击静默污染下游。
- `A06`：声音也采用候选/试听/绑定；Voice Profile 独立于某次 TTS 结果。

### 3.4 镜头与生成

- `G02/G03`：把当前镜头依赖、分时码、Reference Slots、H3、首尾帧和声音组成统一 Shot Package。
- 引用显示稳定对象和版本；失效时区分 `missing`、`stale`、`incompatible`、`text-fallback`。
- `G13/G14/G15`：Director、H3、ChatGPT Web 保持高级/实验能力，接入统一 Job/Candidate 投影，不进入普通用户硬门禁。

### 3.5 结果与交付

- `P08`：每个成功动作说明落点，例如“保存为候选”“已设为主结果”“已加入资产库”“已生成 Delivery”。
- 合片和超分继续在本地执行，但进入短片审核页的任务历史，而不是散落在分镜卡片和弹窗中。

## 4. REFACTOR：保留行为，重组边界

| 决策 | 对应 ID | 当前问题 | VNext 边界 |
|---|---|---|---|
| 四阶段与七步关系 | S03 | 七类功能既是导航又是实现结构 | 用户看到四阶段；角色/道具/场景等作为“设定”内任务，现有 API 不变 |
| 卡片/详情/通知 | I01、I05 | 多个表面重复字段和通知 | 列表负责扫描，Inspector/Drawer 负责深改，Modal 负责短事务，Task History 负责长任务 |
| Story Scene 与 Location | C04 | 当前 `scenes` 语义混合 | 新建显式映射；旧 scene 先兼容读取，不直接拆除 |
| 资产标准模式 | A03 | 三类资产各有近似大表单 | 共用交互框架和 command，不强行把领域字段做成一个万能实体 |
| 跨项目素材库 | A07 | 公共库、项目素材、媒体库重叠 | 统一来源/复制/引用/版本语义；保留 Character/Scene/Prop 身份 |
| Capability 契约 | G04 | UI、路由和 Provider 各自判断能力 | 一份 versioned capability 同时驱动表单、校验、报价、执行与快照 |
| Provider Registry | G12、T09 | 新 registry 与 legacy client 并存 | 每个协议独立 adapter；完成契约测试后逐个切换，旧 facade 暂存 |
| 权威事实源 | T07 | JSON、关系表、generation 和当前字段双写 | 每个关系指定 authority；旧字段先双读核对，再停止写入，最后只读迁移 |
| 巨型页面 | T08 | `FilmCreate`、AI Config 集中全部编排 | 先建立阶段 command/query，再拆 route feature 和视觉组件 |
| DB/文件一致性 | T10 | 双写无统一补偿 | staging、commit marker、补偿 journal 和孤儿扫描 |
| Electron 构建 | T13 | native ABI 和开发后端副本漂移 | 固定 Node/Electron ABI，后端副本只作为构建产物 |

禁止把 REFACTOR 解释为“先建一套新页面，再逐个复制旧按钮”。每个阶段迁移都要从共享 command/query 调用现有内核，线性台和画布不能继续双写。

## 5. REPLACE：旧实现不能作为 VNext 基础

### 5.1 Job Runtime（G10）

替换通用 `async_tasks` 的进程内执行语义，形成持久化 Job Runtime：

```text
draft → validating → queued → running
                          ├─ succeeded
                          ├─ partial_success
                          ├─ failed
                          ├─ cancelled
                          └─ unknown → reconciling
```

迁移要求：

- 保留旧任务只读历史；
- 用 adapter 映射图像、视频、Director、超分和外部网页任务；
- 取消区分“本地已请求取消”和“Provider 已确认取消”；
- 进程重启后根据 lease/provider task id 对账，不能直接判失败；
- Batch 是聚合，不覆盖子任务事实。

### 5.2 数据迁移（T02）

替换“启动时全量重放 SQL + `ensureAllColumns()`”的双重 schema 定义。新机制必须有 migration ledger、事务、checksum、baseline、备份/恢复说明和历史库升级测试。`ensureAllColumns()` 只能在全部已知安装进入 ledger 后退役。

### 5.3 安全边界（T03、T04）

- API 默认只返回密钥是否存在和掩码；日志强制 redaction；配置导出默认不含 secret。
- 独立服务默认 loopback；远程模式是单独能力，必须有认证、授权来源和 TLS。
- Secret 存储逐步迁入 OS credential vault 或受保护的本地加密存储；旧明文列在迁移期只读兼容。

### 5.4 API 契约（T06）

以 runtime schema/OpenAPI 定义请求、响应、错误和 capability。保留 `/api/v1` URL 的兼容 facade，优先修复：

- `{success,data}` 与 `{error}` 混用；
- FreeCreate 调用不存在的 API；
- MediaLibrary 丢失 keyword；
- Asset update 字段与表不一致；
- 前端声明后端不存在的 `addToTeamLibrary`；
- OpenClaw 文档和请求体漂移。

### 5.5 媒体库（A08）

保留现有 `assets` 数据，但替换上传/列表/更新契约。上传必须在同一工作流中完成文件校验、staging、Asset 入库和返回；搜索、筛选、软删与文件回收使用同一 schema。

## 6. NEW：VNext 必须新增的产品语义

### 6.1 Stable Studio Shell（S04）

常驻：返回项目、项目名、单集选择器、四阶段轨道、任务/阻塞摘要。Shell 只管理上下文和阶段，不持有角色/分镜业务逻辑。

### 6.2 Script Revision 与批准（C02）

最小语义：

- `draft_revision`：可编辑、可自动保存；
- `approved_revision`：下游依赖的不可变基线；
- `draft_diverged`：批准后又有修改；
- `approval_diff`：确认前显示变化和影响；
- 旧项目导入时记录明确的 migration decision，不静默猜测。

### 6.3 Gate 与 Invalidation（C03）

Gate 只限制高成本/不可逆执行，不限制用户浏览下游。阻塞反馈必须包含：规则、受影响对象、修复动作和是否允许显式 override。

失效传播不删除结果：旧候选继续可看，标为来源版本和 stale reason；用户可选择保留、重新编译或重新生成。

### 6.4 资产提取 Merge Preview（A04）

重新提取先生成差异集：新增、建议更新、人工修改冲突、保持、疑似删除。默认不覆盖人工字段和已被镜头引用的资产。

### 6.5 Picture Lock 与 Delivery（P03）

新增整集交付状态：

```text
shots_in_progress
→ all_required_shots_selected
→ picture_lock_draft
→ picture_locked
→ delivery_queued
→ delivered / delivery_failed
```

任何镜头只有候选但未选用时，不能算完成。Picture Lock 后上游变更产生新 timeline revision，不静默覆盖既有 Delivery。

### 6.6 成本与使用记录（P07）

记录 Provider、模型、数量、估算、实际/未知成本、失败是否收费和计量来源。不实现钱包、充值或内部余额；本地/自托管任务明确标识“无平台远端计费”，不伪装为零资源成本。

### 6.7 结构化观测（T12）

日志和任务历史共享 correlation id、object id、provider task id、阶段、reason code；默认脱敏。用户看到可理解原因和恢复动作，技术详情可展开。

## 7. REMOVE：停止延续错误与遗留

| 对应 ID | 移除项 | 条件 |
|---|---|---|
| T05 | 全局 `insecure_tls` | 先提供 Provider 级证书/代理配置，不保留等价全局后门 |
| X09 | `FreeCreate` 旧页面与损坏轮询 | 新工具箱若需要，必须复用统一 Job/Provider/Asset 契约 |
| X11 | 未挂载 stub、unused queue、隐藏旧流程 | 先完成引用扫描、兼容标记和回归测试 |
| X12 | RunningHub 品牌外观复制 | 直接不进入设计系统；只保留层级和密度原则 |

Legacy video adapter 和 `ensureAllColumns()` 不是立即 REMOVE：它们分别要等 Provider 迁移和数据库 ledger 覆盖完成。提前删除会破坏已有能力和旧库。

## 8. DEFER：明确不进入 VNext

| 对应 ID | 功能 | 延后原因 | 重新评估触发条件 |
|---|---|---|---|
| X02 | 独立 external-bridge | 与浏览器扩展桥职责未收敛 | 明确唯一外部生成协议和真实使用方 |
| X03 | AI 项目助手 | 容易成为不透明控制面 | 核心 command/query 稳定且助手仅调用公开命令 |
| X04 | 2D/3D 专业预演 | 成本和交互复杂，需求未验证 | Director/Canvas 使用数据证明构图预演是高频瓶颈 |
| X05 | 视频重绘 | 参考产品内部流程也未验证 | 独立完成版权、输入、版本、恢复和回写研究 |
| X06 | 云账户、钱包、充值 | 违背本地优先的当前目标 | 产品正式提供托管计费服务 |
| X07 | 团队空间/权限/审批 | 会重定义身份、冲突和数据归属 | 单机闭环稳定且有明确多人客户证据 |
| X08 | 社区、点赞、返利、平台发布 | 是增长系统而非生产内核 | 出现明确分发战略和内容治理能力 |

DEFER 的功能不建立路由占位、空表或禁用按钮。相关研究保留在文档中，避免半成品成为新遗留。

## 9. 被否决的三种路线

### 路线 A：逐页复制 Reference

优点是视觉上快速接近成熟产品；缺点是会丢失本地 Provider、H3、Director、包交换和超分的真实工作流，还会复制钱包/社区等不适合本地产品的概念。否决。

### 路线 B：重写前后端与数据库

优点是短期模型看起来干净；缺点是旧项目、供应商参数、媒体路径、任务历史和容错知识无法一次验证，迁移风险最高。否决。

### 路线 C：先做漂亮四阶段 UI，再补领域模型

优点是能迅速展示；缺点是 Gate、stale、candidate、delivery 仍会变成组件局部状态，再次形成巨型页面。否决。

采用路线：**契约与迁移护栏先行 → Studio Shell 与核心阶段投影 → 审核交付 → 高级能力接入**。

## 10. 决策完成标准

VNext 决策被正确执行，应同时满足：

1. 旧项目可打开、可生成、可合片、可导出；
2. 所有现有 Provider 至少保持当前能力，迁移状态可见；
3. 保存不等于批准，批准后修改会产生可解释的 stale；
4. 高成本动作提交前能看到能力、引用、范围和成本预检；
5. 候选不会覆盖历史，选用、锁定和交付是不同状态；
6. 刷新或重启后任务进入对账，不因前端超时被误判失败；
7. 本地服务默认不暴露网络，API 和日志不泄露密钥；
8. Reference 的账户、钱包、社区和具体品牌视觉没有渗入核心模型。
