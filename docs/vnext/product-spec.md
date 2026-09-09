# LocalMiniDrama VNext Product Specification

> 状态：产品设计基线
> 日期：2026-09-09
> 依据：[Current 产品模型](../current/product-model.md)、[Reference 结论](../reference/reference-findings.md)、[Gap Analysis](./gap-analysis.md)、[VNext Scope](./vnext-scope.md)。
> 原则：Reference Product 只验证生产问题和交互模式，不决定我们的技术架构、商业模式或品牌视觉。

## 1. 产品愿景

LocalMiniDrama VNext 是一个本地优先、Provider 可替换的 AI 短剧生产系统。它帮助独立创作者和小型制作团队，把剧本转化为可审核、可恢复、可追溯的整集成片，同时保留用户对本地数据、模型选择、媒体文件和生成历史的控制。

VNext 不以“生成一次成功”为完成，而以以下闭环为完成：

```text
批准的剧本基线
→ 可用且版本明确的资产
→ 通过能力预检的镜头包
→ 可比较、可选用的候选
→ 完整镜头时间线
→ Picture Lock
→ 可追溯 Delivery
```

## 2. 核心产品承诺

1. **已有能力不缩水**：Current 中有价值的图像、视频、TTS Provider，ComfyUI、H3、Director、外部协作、FFmpeg、超分、项目包和本地上传全部保留。
2. **生成前可解释**：用户在提交前知道输入、引用、Provider 能力、参数、估算成本和阻塞原因。
3. **修改后不静默污染**：已批准上游发生变化时，下游被标记 stale，不删除旧结果，也不伪装仍然有效。
4. **生成结果不覆盖历史**：每次生成产生 Candidate/Artifact；只有“选用”才改变当前结果。
5. **长任务可恢复**：刷新或重启后按 Job/Provider task id 对账，前端超时不等于 Provider 失败。
6. **交付是独立状态**：镜头候选、已选用视频、Picture Lock 和整集 Delivery 是不同业务对象。
7. **本地默认安全**：服务默认 loopback，密钥不通过普通 API、日志和默认导出泄露。

## 3. 目标用户与 Jobs to Be Done

| 用户 | 核心 JTBD | VNext 响应 |
|---|---|---|
| 独立短剧创作者 | 用最少技术配置完成一集并知道下一步 | 四阶段 Studio、阶段门禁、标准资产模式、批量生成、短片审核 |
| AI 视频制作人员 | 精确控制镜头、参考、模型、提示词和候选 | Shot Package Inspector、分时码、Capability 表单、H3、候选历史 |
| 小型制作负责人 | 管多集、复用资产、定位失败和控制返工 | 项目/集进度、资产来源、批次、stale 范围、任务中心、Delivery 历史 |
| 技术型本地用户 | 自带 Provider/ComfyUI 并控制落盘 | Provider Registry、能力探测、本地文件/SQLite、可见任务快照 |
| 外部协作用户 | 将任务交给外部 AI 或浏览器通道后可靠回填 | 项目/剧集包、provenance、P2 ChatGPT Web 通道 |

## 4. 产品原则

### 4.1 以用户阶段组织，不以技术资源组织

Studio 对用户呈现四阶段：剧本、设定、分镜、短片。Current 的角色、道具、场景、分镜脚本、分镜图像和分镜视频能力全部保留，但成为阶段内任务，而不是七个并列产品世界。

### 4.2 软浏览、硬执行

用户可以提前浏览下游和查看既有结果；当批准版本、引用或 Provider 能力不满足时，只禁用高成本/改变业务状态的动作。禁用必须显示原因和修复入口。

### 4.3 一份领域真相，多种工作视图

标准资产页、分镜工作台、短片页和自由画布都消费同一 Command/Query 契约。Canvas 是高级投影，不拥有独立保存逻辑。

### 4.4 本地优先，不模拟云钱包

VNext 记录 Provider 估算与实际/未知成本，但不引入余额、充值或强制账户。自托管任务显示“本地/自托管”，避免把平台收费模型强加给本地工作流。

## 5. 产品结构

```text
LocalMiniDrama
├─ 开始
│  ├─ 从想法开始
│  ├─ 从剧本/小说/剧集包开始
│  └─ 打开已有项目
├─ 项目
│  ├─ 剧集与阶段概览
│  ├─ 项目资产
│  ├─ 产物：分镜视频 / Delivery
│  └─ 导入 / 导出 / 外部协作
├─ 单集 Studio
│  ├─ 剧本：Revision / Diff / Approval
│  ├─ 设定：角色 / 场景 / 道具 / 风格 / 音色
│  ├─ 分镜：Shot Package / 生成 / 候选 / 批次
│  └─ 短片：审片 / Picture Lock / Delivery
├─ 资产中心
│  ├─ 角色 / 场景 / 道具库
│  └─ 通用媒体与来源
├─ 任务中心
└─ 设置
   ├─ Provider / 模型 / Workflow
   ├─ 生成与语言
   ├─ 存储 / 安全
   └─ 实验能力
```

详细归属见 [information-architecture.md](./information-architecture.md)。

## 6. 核心功能规格

### 6.1 项目与单集

#### 必须支持

- 创建、编辑、导入、导出和删除项目；删除保留 Current 的安全确认并明确 DB/文件结果。
- 创建、复制、批量导入和删除剧集。
- 项目详情按剧集展示当前阶段、批准基线、完成度、stale/失败数量和最后工作位置。
- 分镜视频与整集 Delivery 分开呈现。
- 旧项目打开时执行只读兼容检查；需要迁移时先备份并展示结果。

#### 不做

- 云账户、团队权限、社区发布和钱包。
- 用一个项目级百分比掩盖不同剧集的独立状态。

### 6.2 剧本阶段

#### 页面目标

将“写了什么”和“下游依据哪一版”分开。

#### 功能

- 保留手工编辑、从想法生成、小说/文本/剧集包导入。
- 左侧按 Story Scene/段落导航，中间编辑当前 Draft Revision。
- 自动保存或显式保存产生 `saved`，但不改变批准基线。
- “批准剧本”展示与当前 Approved Revision 的 Diff 和影响范围。
- 批准后形成不可变 Revision；再次编辑产生 `draft_diverged`。
- 若下游已存在，批准新版本只标记依赖 stale，不删除资产、镜头或候选。

#### Gate

- 无 Approved Revision 时，可浏览设定/分镜/短片，但不能执行自动提取、批量生成和 Delivery。
- 允许有权限的本地用户显式 override 仅用于无需批准的手工资产维护；override 要记录原因。

### 6.3 设定阶段

#### 页面目标

快速扫描资产是否完整，必要时深入编辑身份、变体、媒体、声音和来源。

#### 功能

- 角色、Location、道具按分类和 Story Scene 使用范围筛选。
- 标准模式为资产卡网格；单击选择，打开右侧详情 Drawer。
- 资产身份与媒体候选分开：生成/上传产生 Candidate，“设为主形象”改变 Selected Appearance。
- 角色支持语义 Variant、身份锚点、四视图、Seedance 资产和 Voice Profile。
- 场景/道具保留 Current 的参考图、额外图、提示词和素材库能力。
- StyleSpec 通过视觉选择器绑定；应用前展示受影响范围。
- 重新提取先进入 Merge Preview，区分新增、建议更新、人工冲突、保留和疑似删除。
- 标准模式与 P2 Canvas 写入同一资产命令。

#### Ready 条件

资产不要求“每项都有 AI 图”才能进入分镜；每个被镜头引用的必需资产必须有可用描述，且强引用 Provider 所需的媒体/版本必须存在。

### 6.4 分镜阶段

#### 页面目标

在一个稳定镜头上下文中完成输入、意图、生成、比较和序列操作。

#### 布局

- 左侧 Inspector：时长、Story Scene、角色/Variant、Location、道具、声音、首尾帧和其他 Reference Binding。
- 中间 Editor：分时码动作、对白/旁白、镜头、H3/通用提示词、Provider 和规格。
- 右侧 Result：当前采用结果、候选、历史、任务、重试与后处理。
- 底部 Shot Rail：镜头顺序、时长、状态、插入/删除/合并/重排。

#### 功能

- 保留 Current 的分镜生成、导入、编辑、首/尾帧、Omni、引用槽位、Grok 转换、图片/视频历史、TTS 和 Excel/SRT 导出。
- Shot Package 保存稳定引用 ID、版本、用途和 fallback 状态。
- Provider Capability 决定字段可见性、支持状态、默认值和预检；模型切换不删除暂不兼容的用户输入。
- 生成前展示阻塞、警告、Provider/模型、数量、估算成本和快照模式。
- 重试必须选择“复用原快照”或“用当前配置重新编译”。
- 批次显示子任务，允许 partial success，并支持仅重试失败/未知项。

#### Ready 条件

一个 Shot 可生成，需要：基础时长有效、必需文本存在、引用可解析、Capability 兼容、必要 Provider 配置有效。警告可以确认后继续，阻塞必须修复。

### 6.5 短片阶段

#### 页面目标

从“调参数”切换为“审连续性、补缺口、锁画面、交付”。

#### 功能

- 大播放器播放当前已选用镜头，支持连续播放。
- 全集时间线显示 Story Scene、镜头段、时长、缺失、stale、未选用、已锁定状态。
- 问题镜头可返回分镜页并保持当前 Shot。
- 全部必需镜头已选用且无阻塞 stale 时，可创建 Picture Lock。
- Picture Lock 冻结 Timeline Revision 与每镜 selected Candidate，不冻结历史数据。
- Delivery 配置复用当前 TTS、音频、字幕、水印、合片和超分能力。
- 每次 Delivery 是独立产物；失败可基于同一 Picture Lock 重试，不覆盖旧成片。

### 6.6 任务中心

- 对象内联状态始终是主要反馈；任务中心提供跨项目追溯。
- 按项目、剧集、对象、类型、Provider、状态和时间筛选。
- 显示输入快照、Capability 版本、Provider task id、估算/实际成本、阶段、错误和结果落点。
- `unknown` 和 `reconciling` 是真实状态；用户可触发重新对账。
- 取消显示“已请求”“Provider 已确认”或“无法确认”，不制造确定性。

### 6.7 设置

- 保留所有现有 Provider、协议、模型、Workflow、Prompt Override、场景模型映射和生成设置。
- 配置表单由 schema/capability 驱动，不在一个巨型组件内维护所有分支。
- 密钥只显示掩码和存在状态；普通导出不含密钥。
- Provider 测试显示 DNS/连接/认证/模型/能力等具体阶段。
- 实验项统一在“实验能力”中启停，关闭后主流程仍完整。

## 7. 功能优先级

### P0

- 本地/数据/Provider 能力保全；
- Migration ledger、API/Capability/Job 契约；
- 密钥与网络安全；
- Stable Studio Shell；
- Script Revision、Approval、Gate、Invalidation；
- Shot Package、候选/选用和可恢复任务；
- 现有图像/视频/TTS/FFmpeg/项目包回归。

### P1

- 项目详情、开始入口、标准资产页与 Merge Preview；
- 风格、音色和跨项目资产中心；
- 批量预检、成本记录和统一通知；
- 短片审核、Picture Lock、Delivery；
- ComfyUI 产品化保护、Provider Registry 渐进迁移；
- 页面拆分、DB/文件补偿、桌面构建治理。

### P2

- Director、H3 深度体验、ChatGPT Web；
- 自由 Canvas 高级投影；
- 高级拖拽/上下文序列编辑；
- 重新生成 OpenClaw 适配。

### Not In VNext

- 独立 external-bridge 主线接入；
- AI 项目助手；
- 完整 2D/3D 工具；
- 视频重绘；
- 云账户、钱包、团队、社区和平台发布；
- RunningHub 品牌视觉复制。

## 8. 非功能要求

| 领域 | 要求 |
|---|---|
| 兼容 | 旧项目、旧媒体路径、旧任务历史和旧包可读；旧 Provider 不因 UI 重构消失 |
| 性能 | 200 镜项目可操作；长列表和镜头轨使用虚拟化/增量加载；切镜不整页重载 |
| 可靠性 | Job 持久化、lease、重启对账；DB/文件使用 staging 和补偿记录 |
| 安全 | loopback 默认、secret 脱敏、日志 redaction、无全局 TLS 绕过 |
| 可访问性 | 键盘导航、可见焦点、非颜色状态、可访问名称、Modal 焦点圈定 |
| 可观察性 | correlation id、reason code、Provider task id、状态时间戳和用户可执行建议 |
| 可扩展性 | Provider 专属字段使用 namespaced extension，不污染通用字段，也不被统一层丢弃 |

## 9. 成功指标

### 正确性

- 历史库升级和包往返无实体/媒体引用丢失；
- 上游批准变化后，受影响对象 100% 有可解释 stale reason；
- 候选和 Delivery 不被新生成覆盖；
- 默认 API、日志和导出不出现完整密钥。

### 工作流

- 用户从任意 Studio 页面可识别项目、剧集、阶段、当前对象和阻塞原因；
- 修改上游后可筛选并仅重做受影响项；
- 任务刷新/重启后可继续对账；
- Delivery 前能准确识别缺失、未选用和 stale 镜头。

### 能力保全

- Current 的 Provider、ComfyUI、H3、Director、外部协作、音频、合片、超分和本地上传均有回归结果；
- P2 全部关闭时，P0/P1 主流程仍可从剧本完成到 Delivery。

## 10. 验收边界

VNext 产品规格完成的判定不是“页面像 Reference”，而是：旧项目和模型仍能工作，同时用户可以依据明确的 Revision、Gate、Capability、Job、Candidate、Picture Lock 和 Delivery 状态完成整集生产。
