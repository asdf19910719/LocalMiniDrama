# Current × Reference Gap Analysis

> 分析日期：2026-09-09
> 输入：`docs/current/*` 与 `docs/reference/*`。
> 目标：设计 LocalMiniDrama VNext，而不是复刻 RunningHub RHSTORY。参考产品只提供经观察验证的工作流模式；当前产品已经拥有的本地能力、Provider、Adapter、生成管线和生产历史优先保护。

## 1. 执行结论

VNext 应定位为：**本地优先、Provider 可替换、以单集阶段和镜头包为组织方式的 AI 短剧生产系统**。

Current 的优势在“生产内核”：本地 SQLite/文件、桌面封装、多 Provider、图像/视频/TTS、Canonical Reference、H3、Director、FFmpeg、超分、项目包、外部 AI 协作和可恢复视频任务。Reference 的优势在“生产组织”：稳定 Studio Shell、剧本批准、阶段门禁、资产卡/详情抽屉、镜头四区、候选选用、短片审片、批量预检和成本反馈。

因此差距应按下式理解：

```text
OUR VNEXT
= Current 的本地生产内核与供应商覆盖
+ Reference 验证过的阶段、对象、反馈和审核模型
- Current 的错误契约、多重事实源和危险默认值
- Reference 的云钱包、社区增长和品牌外观
```

## 2. 决策与评分规则

### 2.1 决策分类

| 分类 | 含义 |
|---|---|
| `KEEP` | 当前能力和主要语义直接保留，VNext 必须有回归保护 |
| `ENHANCE` | 当前能力有价值，在原边界上补状态、反馈或覆盖范围 |
| `REFACTOR` | 用户能力保留，但内部边界、页面组织或事实源需要重组 |
| `REPLACE` | 当前实现或契约不可持续，以兼容迁移方式替换 |
| `NEW` | Current 没有稳定实现，但对 VNext 闭环必要 |
| `REMOVE` | 当前遗留/危险实现或参考产品外观，不进入 VNext |
| `DEFER` | 有潜在价值，但不进入本轮 VNext；保留研究结论，不做占位实现 |

### 2.2 优先级

| 优先级 | 定义 |
|---|---|
| `P0` | VNext 可安全迁移、形成核心闭环和保护既有能力的发布门槛 |
| `P1` | 核心版本随后应交付的高价值工作流与效率能力 |
| `P2` | 高级用户、特定 Provider 或规模化场景的增强能力 |
| `Not In VNext` | 本轮明确不做；包括延后机会与应删除的非目标能力 |

### 2.3 评分

所有维度为 1–5 分：

- `UV` User Value：用户价值，5 最高；
- `WI` Workflow Improvement：对端到端工作流改善，5 最高；
- `IC` Existing Implementation Cost：基于现状的实现/改造成本，5 最高；
- `MC` Migration Cost：数据、接口、界面和用户习惯迁移成本，5 最高；
- `TR` Technical Risk：技术与回归风险，5 最高；
- `UX` UX Impact：对用户体验改变幅度，5 最高；
- `SI` Strategic Importance：战略重要性，5 最高。

评分不是机械排序公式。安全和数据完整性即使短期 UX 分较低，也可以是 P0；现有强能力即使 Reference 没有，也不会因此删除。

## 3. Feature Gap Matrix

### 3.1 产品壳、导航与交互

| ID | 功能/决策单元 | Current | Reference 启发 | 决策 | 优先级 | UV/WI/IC/MC/TR/UX/SI | 判断 |
|---|---|---|---|---|---|---|---|
| S01 | 本地优先桌面产品壳 | Electron + 本地后端已闭环 | 云端稳定壳，但依赖账户 | `KEEP` | P0 | 5/4/1/1/2/4/5 | 是差异化根基，不改成强制云产品 |
| S02 | Project → Episode → Storyboard 层级 | 已稳定存在 | Project → Episode → Scene → Shot 更清晰 | `KEEP` | P0 | 5/5/1/2/2/4/5 | 保留现有 ID 和包格式，在其上补语义，不重建根模型 |
| S03 | 单集七阶段导航 | 功能全但阶段过细、页面巨大 | 剧本/设定/分镜/短片四阶段 | `REFACTOR` | P0 | 5/5/4/2/3/5/5 | 四阶段用于用户心智，七步可作为阶段内任务，不删除能力 |
| S04 | Stable Studio Shell | 项目、剧集、阶段上下文分散 | 项目、集、阶段和状态常驻 | `NEW` | P0 | 5/5/3/2/2/5/5 | 为深层生产提供空间记忆，是体验重组的承载层 |
| S05 | 项目详情与产物归属 | 已有项目、剧集、图片和视频入口 | 清楚区分分镜视频与成片 | `ENHANCE` | P1 | 4/4/3/2/2/4/4 | 强化集级进度、异常和产物分区，不复制发布入口 |
| S06 | 按现有输入开始创作 | 有创意生成、小说/剧本导入，入口分散 | “有想法/有剧本/有视频”任务分流 | `ENHANCE` | P1 | 4/4/2/1/2/4/4 | 先统一想法和剧本入口；视频重绘仍单独延后 |
| S07 | 独立短片审核工作区 | 合片功能存在，审核散在制作页 | 大播放器 + 全集时间线 + 完成门禁 | `NEW` | P1 | 5/5/4/3/3/5/5 | 把现有合片、音频、字幕、超分能力收口为交付流程 |
| I01 | 卡片扫描 + Drawer/Inspector 深改 | 多页面混合卡片、弹窗和长表单 | 模式职责清晰 | `REFACTOR` | P1 | 4/4/4/2/3/5/4 | 保留字段与操作，重组信息密度，不做像素复制 |
| I02 | Inline Editing 与 dirty/saving/saved | 当前可编辑，但保存状态不统一 | 明确编辑生命周期 | `ENHANCE` | P1 | 4/4/3/2/2/4/4 | 尤其用于剧本、镜头提示词和资产名 |
| I03 | Multi-selection 与 Batch Operation | 已有多类批量和画布多选 | 范围、跳过、聚合状态更清楚 | `ENHANCE` | P1 | 5/5/3/2/3/4/5 | 保留现有批量内核，统一预检与部分成功语义 |
| I04 | Context Menu、拖拽与键盘替代 | 部分页面已有 | 低频动作局部化、直接操纵 | `ENHANCE` | P2 | 3/3/3/1/2/4/3 | 不应抢占 P0，但需补撤销、落点和非拖拽路径 |
| I05 | 通知层级 | Toast、任务抽屉和内联状态并存 | Inline/Toast/Banner/Badge/History 分工 | `REFACTOR` | P1 | 4/4/3/1/2/4/4 | 避免 store、service、页面重复通知；长任务不能只靠 Toast |
| I06 | 可访问性与非颜色状态 | 当前覆盖不系统 | 焦点、名称、键盘、禁用原因明确 | `ENHANCE` | P1 | 4/3/3/1/1/4/4 | 与新 Shell 和控件重构同步完成，避免事后补丁 |

### 3.2 剧本、资产与设定

| ID | 功能/决策单元 | Current | Reference 启发 | 决策 | 优先级 | UV/WI/IC/MC/TR/UX/SI | 判断 |
|---|---|---|---|---|---|---|---|
| C01 | 剧本编辑、生成和导入 | 已支持手工、AI、小说与批量脚本 | 草稿先于批准 | `KEEP` | P0 | 5/5/1/1/2/4/5 | 保护现有入口和 Provider，不重写文本生成 |
| C02 | Script Revision、Diff 与批准版本 | 正文存在，但无稳定 revision/approval | 保存与确认分离 | `NEW` | P0 | 5/5/4/4/4/5/5 | VNext 的关键新模型；旧正文需映射为初始批准或草稿 |
| C03 | Stage Gate 与 Dependency Invalidation | 当前主要靠页面条件和人工补生成 | 软浏览、硬执行、stale 可见 | `NEW` | P0 | 5/5/5/4/5/5/5 | 必须以依赖图和原因码实现，不能只加“下一步”按钮 |
| C04 | Story Scene 与视觉 Scene/Location 区分 | `scenes` 同时承载多种语义 | 场次与场景资产分离 | `REFACTOR` | P1 | 4/4/4/4/4/4/4 | 先建立映射和兼容读取，避免直接拆表造成数据丢失 |
| A01 | 角色、场景、道具稳定实体 | CRUD、生成和绑定已完整 | 资产身份独立于图片 | `KEEP` | P0 | 5/5/1/2/2/4/5 | 当前核心资产模型必须保留 |
| A02 | 角色变体、身份锚点与语义派生状态 | 已有变体、四视图、anchors、Seedance 资产 | Appearance/Variant 语义清晰 | `ENHANCE` | P1 | 5/4/3/3/3/4/5 | 统一“候选图、主形象、剧情状态”三种概念 |
| A03 | 设定标准模式资产卡 + 详情抽屉 | 有卡片和多套对话框 | 扫描与深改分工 | `REFACTOR` | P1 | 4/4/4/2/3/5/4 | 共用现有资产 API，不再复制三套编辑流程 |
| A04 | 重新提取的 Merge Preview | 当前提取可能直接写入或路径不一致 | 新增/更新/保留/潜在删除预览 | `NEW` | P1 | 5/5/4/3/3/4/5 | 保护人工编辑和下游绑定，禁止静默覆盖 |
| A05 | StyleSpec、样式快照与视觉选择器 | StyleSpec、预设和快照能力强 | 风格卡、筛选、推荐模型 | `ENHANCE` | P1 | 4/4/3/2/2/5/4 | 保留可审计编译内核，只吸收视觉发现和影响预览 |
| A06 | 角色 Voice Profile、试听与绑定 | 已有 voice style、TTS、声音资产 | 试听与绑定分离 | `ENHANCE` | P1 | 4/4/3/3/3/4/4 | 复用 TTS/音频管线，补候选和绑定语义 |
| A07 | 跨项目角色/场景/道具素材库 | 三套公共库和项目导入存在 | 引用/复制/版本/来源需明确 | `REFACTOR` | P1 | 4/4/4/4/4/4/4 | 合并交互和 provenance，不合并领域实体 |
| A08 | 通用媒体库 | 浏览可用，上传/搜索/更新契约损坏 | 资产中心需要可靠入库与绑定出口 | `REPLACE` | P1 | 4/4/3/3/3/5/4 | 以真实 Asset schema 重建服务契约，保留已有资产记录 |
| A09 | 本地上传作为一等来源 | 角色/场景/道具/分镜均支持 | 上传与 AI 候选同级 | `KEEP` | P0 | 5/4/1/1/1/4/5 | 是本地工作流重要能力，不能被生成优先设计削弱 |

### 3.3 分镜、生成与 Provider

| ID | 功能/决策单元 | Current | Reference 启发 | 决策 | 优先级 | UV/WI/IC/MC/TR/UX/SI | 判断 |
|---|---|---|---|---|---|---|---|
| G01 | Storyboard/Shot 编辑主模型 | 分镜宽表与编辑能力成熟 | Shot 是一次生成边界 | `KEEP` | P0 | 5/5/2/3/3/5/5 | 保留现有 Storyboard ID、媒体和包格式 |
| G02 | Shot Package Inspector | 绑定、提示词、声音、参考已存在但分散 | 左输入/中意图/右结果/下序列 | `ENHANCE` | P0 | 5/5/4/3/4/5/5 | 将现有能力重组到同一镜头上下文，不另造镜头模型 |
| G03 | 分时码、Canonical Reference、Reference Slots | H3、引用槽位、首尾帧和 anchors 已有 | 稳定 ID、失效和 text fallback 可见 | `ENHANCE` | P0 | 5/5/3/3/3/5/5 | 当前技术能力强于参考，应补 UX 与验证而非替换 |
| G04 | Provider Capability 驱动表单与预检 | 能力查询存在，但 UI/执行契约仍有分支 | 参数、引用、时长、规格同源 | `REFACTOR` | P0 | 5/5/5/4/5/5/5 | 建立唯一 capability contract；迁移期兼容现有 Provider |
| G05 | 图像 Provider 与生成管线 | 多协议、落盘、历史、批次已完整 | Reference 未提供更强本地实现 | `KEEP` | P0 | 5/5/1/1/3/4/5 | 所有现有协议列入回归矩阵，不因参考缺失而删除 |
| G06 | 视频 Provider 与统一生命周期 | 多协议、恢复、候选已完整 | 任务/候选/选用语义更清晰 | `KEEP` | P0 | 5/5/2/2/4/5/5 | 保护 provider task id、快照、重试和恢复 |
| G07 | TTS Provider 与音频生成 | MiniMax/OpenAI-compatible 已闭环 | 声音身份产品化 | `KEEP` | P0 | 4/4/1/1/2/3/4 | 修复安全问题，但不替换生成能力 |
| G08 | ComfyUI Workflow Provider | 注册表、工作流和 GPU mutex 已有 | 参考未覆盖该本地能力 | `KEEP` | P1 | 4/4/2/2/4/3/5 | 是本地差异化能力，保持实验隔离并补能力契约 |
| G09 | 候选、历史、选用和重试 | 图像/视频/Director 多处已有 | Candidate 不覆盖主结果 | `KEEP` | P0 | 5/5/2/3/3/5/5 | 统一投影，不丢历史与 selection reason |
| G10 | 统一可恢复 Job Runtime | 多套任务；通用任务不可续跑/真取消 | 任务四层反馈与 unknown/reconcile | `REPLACE` | P0 | 5/5/5/5/5/5/5 | 以兼容 facade 逐类迁移，不能一次切断旧任务 |
| G11 | 批量预检、部分成功与仅重试失败 | 批次/子任务基础已存在 | 范围、跳过、费用、分项结果明确 | `ENHANCE` | P1 | 5/5/3/2/3/5/5 | 不用批次状态覆盖子任务；成功结果立即可用 |
| G12 | Provider Registry 与 legacy adapters | 新 registry 主要覆盖 ComfyUI，旧 client 知识丰富 | Provider 能力应可替换 | `REFACTOR` | P1 | 4/4/5/4/5/2/5 | 渐进迁入 registry；迁完一个协议才退役一个旧分支 |
| G13 | Director、质量分析、锚点和候选组 | 已有实验实现 | 可支撑高级审片和连续性 | `ENHANCE` | P2 | 4/3/4/3/4/4/4 | 不阻塞普通生成；先稳定状态机和真实项目验收 |
| G14 | H3 提示词编译、来源和语义确认 | 已有草稿、指纹、provenance、review | Reference 只有一般分时码提示词 | `ENHANCE` | P2 | 4/4/3/2/4/4/5 | 保持模型专属编译器，接入统一 Shot Package/Capability |
| G15 | ChatGPT Web 外部生成 | 扩展、outbox、attempt/event/result 已有 | Reference 未覆盖 | `ENHANCE` | P2 | 3/3/4/3/5/3/4 | 是可选通道，不成为核心链路依赖 |

### 3.4 后期、交付与可携带性

| ID | 功能/决策单元 | Current | Reference 启发 | 决策 | 优先级 | UV/WI/IC/MC/TR/UX/SI | 判断 |
|---|---|---|---|---|---|---|---|
| P01 | FFmpeg 音频、字幕、水印和合片内核 | 已完整 | 短片页将其产品化 | `KEEP` | P0 | 5/5/1/1/3/4/5 | 是本地交付核心，不因 UI 重构替换 |
| P02 | 视频超分与分段恢复 | 状态机和恢复成熟 | Reference 只展示增强概念 | `KEEP` | P1 | 4/3/1/1/3/3/4 | 作为后处理能力保留，不把增强误当内容修复 |
| P03 | Picture Lock、Timeline Revision、Delivery Asset | 当前有合片记录，缺少明确批准/交付语义 | 逐镜审核后保存成片 | `NEW` | P1 | 5/5/5/4/4/5/5 | 区分“镜头有候选、已选用、全集锁定、已交付” |
| P04 | 项目 ZIP 导入导出 | 已闭环 | 云产品没有同等本地可携带性 | `KEEP` | P0 | 5/4/1/2/2/3/5 | 保持兼容并加入 manifest 版本/往返校验 |
| P05 | 剧集包与外部 AI 协作包 | 已有预览、来源和导入 | Reference 未覆盖 | `KEEP` | P1 | 4/4/2/2/3/3/4 | 是开放本地工作流优势 |
| P06 | 生成快照、来源与 provenance | 多表已有 snapshot/hash/source | Reference 强调历史输入 | `KEEP` | P0 | 5/5/2/3/3/3/5 | 统一 schema version，禁止只保留当前配置 |
| P07 | Provider 成本估算与使用记录 | 无稳定统一实现 | 价格靠近生成、失败费用可追溯 | `NEW` | P1 | 4/4/4/3/4/4/4 | 不建钱包；允许 actual 为 unknown，本地任务标识本地成本 |
| P08 | 结果落点、下载和资产绑定 | 多处已有，但工具/媒体入口不一致 | 成功必须说明保存到哪里 | `ENHANCE` | P1 | 4/4/3/2/2/4/4 | 统一候选、主结果、资产库和 Delivery 的动作语言 |

### 3.5 架构、安全与数据迁移

| ID | 功能/决策单元 | Current | Reference 启发 | 决策 | 优先级 | UV/WI/IC/MC/TR/UX/SI | 判断 |
|---|---|---|---|---|---|---|---|
| T01 | SQLite + 本地文件事实基础 | 适合单机并已广泛使用 | Reference 为云端，不构成替代依据 | `KEEP` | P0 | 5/4/1/1/3/2/5 | 数据主权和离线能力是产品战略，不迁云数据库 |
| T02 | Migration Runner 与 schema baseline | 无 ledger、重复重放、ensure 双定义 | 参考产品不可见 | `REPLACE` | P0 | 5/5/4/5/5/1/5 | VNext 数据迁移前置门槛；先基线和升级测试再改模型 |
| T03 | 密钥存储、API 脱敏和日志 | 明文返回/导出，TTS 日志泄密 | 云账户不适用 | `REPLACE` | P0 | 5/3/3/4/4/2/5 | 先停止泄露，再迁 OS credential vault/加密存储 |
| T04 | 本地网络边界 | 独立后端默认全网卡且无认证 | 参考的账号体系不应复制 | `REPLACE` | P0 | 5/3/2/2/3/1/5 | 默认 loopback；远程模式必须显式认证和 TLS |
| T05 | 全局 `insecure_tls` 绕过 | 可关闭全进程证书校验 | 无可借鉴价值 | `REMOVE` | P0 | 5/2/2/2/2/1/5 | 允许 Provider 级受控证书配置，不保留全局开关 |
| T06 | API schema、错误包和客户端 | 手写契约已发生多处漂移 | Reference 只提供 UX 结果 | `REPLACE` | P0 | 5/5/5/4/5/3/5 | 用 versioned runtime schema/OpenAPI；保留 `/api/v1` 兼容 facade |
| T07 | 多重事实源 | JSON、关系表、当前媒体与 generation 记录重叠 | 标准/自由模式必须同一真相 | `REFACTOR` | P0 | 5/5/5/5/5/3/5 | 逐域指定 authority，双读核对后再停止旧写入 |
| T08 | `FilmCreate` / AI Config 巨型组件 | 能力丰富但职责集中 | Reference 按阶段与详情层分工 | `REFACTOR` | P1 | 4/4/5/3/5/5/4 | 以 P0 command/query 契约为前提，禁止先重写页面 |
| T09 | 巨型 image/video Provider clients | 供应商知识集中，测试覆盖高 | Capability 契约可作为边界 | `REFACTOR` | P1 | 4/4/5/4/5/1/5 | 逐协议抽 adapter，保持请求和结果行为一致 |
| T10 | DB + 文件双写 | 缺少统一事务/补偿 | 参考不可见 | `REFACTOR` | P1 | 5/4/4/4/4/2/5 | staging + commit/compensation journal，先覆盖导入和生成落盘 |
| T11 | 测试资产与 VNext 验证 | 1,264 项测试通过，但缺 E2E/升级矩阵 | Reference 强调流程，不能替代验证 | `ENHANCE` | P0 | 5/5/4/2/3/1/5 | 既有测试是迁移护栏；补历史库、包往返、E2E、Electron smoke |
| T12 | 结构化日志和任务观测 | console 为主，错误语义不一 | 任务历史和 ID 分层可借鉴 | `NEW` | P1 | 4/4/4/2/3/3/4 | correlation id、状态原因、敏感字段 redaction |
| T13 | Electron native ABI 与开发后端副本 | 可运行但版本/副本易漂移 | Reference 无本地集成 | `REFACTOR` | P1 | 4/3/4/3/4/1/4 | 固定支持 LTS/ABI，构建期产物替代长期源码副本 |

### 3.6 高级能力、遗留与明确非目标

| ID | 功能/决策单元 | Current | Reference 启发 | 决策 | 优先级 | UV/WI/IC/MC/TR/UX/SI | 判断 |
|---|---|---|---|---|---|---|---|
| X01 | Vue Flow 自由画布 | 已有多选、组和 Director 入口 | 自由模式只应是统一数据投影 | `ENHANCE` | P2 | 3/3/4/3/4/4/3 | 保留高级用户价值，但所有写入走统一 command 层 |
| X02 | 独立 `external-bridge` | 小型实验服务，主应用未消费 | Reference 无对应能力 | `DEFER` | Not In VNext | 2/2/4/3/4/1/2 | 先决定与浏览器扩展桥的唯一长期边界 |
| X03 | AI 项目助手 | 当前无稳定统一入口 | Reference 为可选抽屉 | `DEFER` | Not In VNext | 2/2/4/2/4/3/2 | 不能替代结构化控制面，核心闭环稳定后再评估 |
| X04 | 2D 画板 / 3D 导演台 | 有画布/Director 基础但非同等功能 | Reference 的专业预演区 | `DEFER` | Not In VNext | 3/2/5/4/5/4/3 | 不应成为普通镜头门禁；先验证真实使用需求 |
| X05 | 视频重绘 | 当前无完整路线 | Reference 仅入口，内部未实测 | `DEFER` | Not In VNext | 3/2/5/4/5/4/2 | 输入、版权、版本和回写语义均未验证 |
| X06 | 云账户、钱包和充值 | 当前不需要 | Reference 云商业模式能力 | `DEFER` | Not In VNext | 1/1/5/4/5/3/1 | 不适合本地核心；成本记录不依赖钱包 |
| X07 | 团队空间、权限与审批 | 当前单机 | Reference 未实测 | `DEFER` | Not In VNext | 3/3/5/5/5/5/3 | 会改变数据、身份和冲突模型，必须独立产品阶段 |
| X08 | 社区、点赞、返利和平台发布 | 当前以导出为终点 | Reference 增长/分发能力 | `DEFER` | Not In VNext | 1/1/5/4/5/3/1 | 与 VNext 本地生产闭环无关 |
| X09 | `FreeCreate` 旧页面 | 主入口隐藏，图像链路损坏 | Reference 有工具箱但要求结果可入库 | `REMOVE` | P1 | 2/2/2/2/2/2/3 | 删除旧实现；未来工具箱复用统一生成组件，不修补旧页 |
| X10 | OpenClaw 适配器 | 文档契约大量失效 | Reference 无对应能力 | `REPLACE` | P2 | 2/2/3/2/3/1/3 | 从真实 API schema 生成；未修复前不宣传可用 |
| X11 | 未挂载 stub、unused queue、隐藏旧流程 | 已确认存在 | 无参考价值 | `REMOVE` | P1 | 2/2/2/2/2/2/3 | 在引用扫描和回归测试后清理，已发布兼容路由先给弃用期 |
| X12 | RunningHub 品牌外观、暗色唯一主题、荧光色 | Current 有自己的主题 | 仅为视觉快照 | `REMOVE` | Not In VNext | 1/1/2/1/1/2/1 | 学信息层级，不复制色值、卡片构图和平台品牌 |

## 4. 关键差距簇

### 4.1 不是页面差距，而是状态语义差距

Current 已有“保存、生成、候选、合并”等动作，但缺少跨阶段共享的：

- `Draft Revision` 与 `Approved Revision`；
- `Gate` 的规则、原因码和可恢复动作；
- 上游变化后的 `stale/missing/incompatible/text-fallback`；
- 镜头与整集的 `selected/picture_locked/delivered`；
- Job 的 `unknown/reconciling/partial_success`。

如果只先做四阶段页面，这些状态仍会由组件条件分散维护，最终只是把旧复杂度换了外壳。

### 4.2 不是 Provider 缺口，而是 Provider 契约缺口

Current 的 Provider 覆盖和本地集成强于 Reference。VNext 不应减少协议，而应让 UI、预检、执行和快照共同消费同一份 Capability：引用类型/数量、时长、分辨率、首尾帧、音频、取消、续画、费用和恢复能力。旧 adapter 作为兼容层逐个迁移，不允许“大重写后再补供应商”。

### 4.3 不是生成缺口，而是审核与交付缺口

Current 能生成和合片，但“已生成候选”“已选用镜头”“整集画面锁定”“已生成交付资产”仍不够清晰。VNext 应新增短片审核阶段与 Picture Lock/Delivery 语义，把现有 FFmpeg、TTS、字幕、超分能力组织成可审查的交付链。

### 4.4 不是资产数量缺口，而是权威关系缺口

角色、场景、道具、变体和素材库均已存在。需要解决的是候选图、主形象、剧情派生状态、跨项目来源和分镜绑定之间的权威关系，并消除 JSON 与关系表双写。Reference 的资产卡只是更好的投影，不是新的数据真相。

## 5. VNext 决策护栏

1. 所有 `KEEP` 能力必须进入回归矩阵，尤其现有图像/视频/TTS Provider、ComfyUI、H3、Director、项目包、FFmpeg 和超分。
2. `REFACTOR` 不允许改变稳定 ID、已保存媒体路径和项目包语义，除非有双读、回填和回滚路径。
3. `REPLACE` 必须提供兼容 facade；旧库、旧任务和旧前端不能在同一发布中被强制切断。
4. `NEW` 的 Stage、Revision、Gate、Invalidation、Picture Lock 必须先有领域语义，再进入 UI。
5. `DEFER` 不建立半成品入口或占位表，以免成为下一轮遗留。
6. 不复制 Reference 的品牌视觉、钱包、社区和未经验证的团队/发布流程。

## 6. 结论

最具战略价值的路线不是“做一个更像 RunningHub 的 LocalMiniDrama”，而是让现有本地强能力拥有更清晰的阶段、批准、失效、候选和交付语义。VNext 的成功标准是：旧项目和旧 Provider 继续工作，用户却能更快判断“当前在哪一步、为什么不能生成、哪一版被采用、哪些下游已过期、结果最终去了哪里”。
