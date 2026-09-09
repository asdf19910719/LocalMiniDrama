# LocalMiniDrama Production Studio V2.1 下一大版本设计

> 日期：2026-09-05
> 最近修订：2026-09-09
> 状态：已确认的架构母稿；本文描述目标态与迁移边界，不代表全部功能已经实现
> 目标版本：LocalMiniDrama 下一个大版本
> 输入依据：当前代码、RunningHub RH剧场真实交互调查、LibTV 两个画布调查、关键帧衔接调查、风格与提示词行业对照调查

## 0. 文档定位与已确认决策

### 0.1 权威性

本文是 Production Studio V2 系列的唯一架构母稿。后续专项设计、实现计划、产品现状 PRD、交互 UI 文档和截图目录都引用本文，不另建平行的总体架构。2026-09-08 的五份 P0 附件是本文的权威细化，不是第二套架构；它们分别负责功能迁移、状态/Gate、作用域/版本/并发/失效、关键交互流程和 E2E 验收。

逐页交互评审中由用户确认的结论、理由、影响范围和落实状态统一记录在[逐页交互评审决策记录](./2026-09-08-production-studio-v2.1-page-review-decision-log.md)。该记录用于保证后续 AI 和实施者延续已确认决定，不取代本文或五份 P0 附件。

发生冲突时按以下优先级解释：

1. 本文记录的已确认产品边界和领域模型；
2. 本文关联的 P0 权威附件；
3. 已批准的专项设计；
4. 分阶段实施计划；
5. 调研、竞品分析和历史提案。

状态、作用域、版本、并发、失效、旧功能迁移或验收口径发生冲突时，以对应 P0 附件为准，并同步修订本文的概述性文字。

`2026-09-08-runninghub-informed-production-studio-redesign-design.md` 作为 RunningHub 调研增量与摘要保留，不再作为第二份总体架构。`2026-09-08-runninghub-style-system-redesign-design.md` 是风格体系专项规格，由本文引用。

### 0.2 本地优先

本版本已确认采用本地优先，而不是云端 SaaS 复刻：

- 核心制作流程不依赖登录、账号、团队、云端钱包、积分或社区；
- 项目数据库、素材、生成结果、快照、任务恢复信息默认保存在本地；
- 本地模型、ComfyUI 和本地工具是一等 Provider，云端 API 是可选 Provider；
- 使用云端 Provider 时，生成前说明将发送的数据类型、引用素材和可能产生的费用；
- 本地任务优先显示任务数、预计耗时、排队、显存和磁盘需求，不伪造货币价格；
- 云端视频超分是可跳过的增强步骤，不能成为导出基础成片的强依赖；
- ZIP 导入导出、本地备份、任务恢复和素材路径修复是核心能力；
- 团队权限、在线钱包、社区发布、素材商城和第三方价格同步不进入本次大版本。

### 0.3 当前实现基线

本文同时包含“已实现基础”和“目标态”。截至 2026-09-08，状态如下：

| 领域 | 当前状态 | V2.1 处理 |
|---|---|---|
| 四阶段 Studio Shell、阶段状态与批准门禁 | 待实现 | 作为首个内部验收里程碑，不单独切换正式数据 |
| 统一系统/自定义风格、项目图片/视频规则 | 已实现 | 直接复用，不再新建平行风格系统 |
| 图片/视频风格编译与 `generation_style_snapshots` | 已实现 | 纳入统一生成快照外壳 |
| Reference Registry 与 canonical storyboard slots | 部分实现 | 统一所有任务创建入口和 UI 展示 |
| H3 不可变草稿、语义校验、来源指纹 | 已实现 | 补齐 Look 版本依赖和 UI stale 语义 |
| 资产生成模式与任务快照 | 已实现 | 进入候选/current 与剧集 Asset Gate 快照流程 |
| 外部 AI 剧集包、导入预览和来源追踪 | 已实现 | 作为本地优先的可移植协作入口 |
| 视频候选、锚点、Director 时间线 | 部分实现 | 分镜负责逐镜生成与候选，短片负责整集审核、合片与交付；两阶段共用唯一候选事实源 |
| 可恢复视频超分 | 已实现 | 复用现有作业，不另建执行系统 |
| Shot Package、生产阶段状态、统一资产版本与剧集快照 | 待实现 | 按阶段新增，并通过一次性迁移建立唯一事实源 |
| 场次—分镜—时段结构 | 待实现 | 采用方案 B；现有 `storyboards` 继续作为一次视频生成单元，新增结构化时段与多场景绑定 |

所有后续实施计划必须从本表出发，并在动工前重新核对数据库迁移、服务和测试，避免重复建模。

### 0.4 目标用户、能力保留与直接替换决策

V2.1 第一优先用户是个人或小团队创作者，完成目标是从剧本一直做到可直接发布的最终成片。主流程采用“AI 自动推进到关键确认点”：自动解析、编译和批量执行，但在剧本确认、本集设定确认、视频候选采用、Picture Lock 与最终交付前停下。项目资产图片/音色不设置逐项批准；生成后进入候选，点击即成为当前使用项。

迁移总原则是“保留创作能力，淘汰旧实现”：

- ChatGPT 网页生图、API/ComfyUI 生图、普通/Omni/H3 视频生成都是核心生成通道；
- 外部 AI 协作是剧集创建主入口，保留剧情上下文、任务 ZIP/单文件任务 JSON、资产摘要、`package_id`、返回 Schema 和五步安全导入；
- DramaCanvas 保留为阶段内高级可编辑视图，与标准视图使用同一数据和命令；
- 自由创作保留为全局创作实验室，结果由用户显式加入个人素材库或项目；
- 角色/场景/道具公共库合并为本机个人素材库；角色状态、四视图、身份锚点、音色、历史图保留并收敛到资产详情；
- AI 配置完整保留但分基础/高级；任务、Director、外部网页恢复和存储诊断合并进统一任务中心。

产品尚未正式上线，因此不建立 V1/V2 feature flag、旧页面回退、长期双写或旧 API 兼容层。当前本地数据通过一次性备份迁移保留；Phase 1～5 完成全部垂直流程验收后，在 Phase 6 同一次发布切换中删除 `FilmList.vue`、`DramaDetail.vue`、`FilmCreate.vue`、旧 DramaCanvas 及重复服务。

明确淘汰：自动采用第一张图片、技术检测后自动采用视频、非空剧集强制合并/覆盖/追加、重复写入入口、独立旧合片真相、静默覆盖人工提示词、混合状态枚举、前端假进度、无引用检查的物理删除、H3 原生音频与后期 TTS 双重播放、继续生成 1.x/1.1 制作包，以及高级画布的独立数据/生成协议。

## 1. 设计结论

下一大版本不应继续向 `FilmCreate.vue` 追加功能。推荐把产品重构为四阶段 Production Studio：

```text
剧本 Script
   ↓  Script Gate
设定 Bible
   ↓  Look Gate + Asset Gate
分镜 Storyboard
   ↓  Shot Gate
短片 Film
   ↓  Picture Lock + Color Gate + Delivery Gate
交付 Delivery
```

对用户仍只显示“剧本、设定、分镜、短片”四个顶层入口；Picture Lock、调色和交付是短片阶段内部状态，不增加不必要的顶部复杂度。

核心不是页面拆分，而是建立三个唯一真相：

1. **Production Stage State**：当前集每个阶段处于草稿、待审核、已批准还是已失效；
2. **Shot Package（分镜包）**：每个分镜作为一次视频生成单元，保存 1～N 个结构化时段、引用清单、计划时长、声音和 Provider 编译快照；
3. **Artifact Lineage**：每张图、每段视频、每个截帧、每次超分和每版成片来自什么输入与版本。

当前项目已经具备大量可复用能力：角色状态、三帧提示词、canonical reference slots、Omni/H3 编译、视频候选、连续性锚点、Director 时间线、字幕/TTS/水印、基础调色和云超分。本设计的重点是**整合、门禁和可追溯性**，不是推倒重写生成能力。

## 2. 问题定义

### 2.1 当前用户流程问题

当前制作页 `frontweb/src/views/FilmCreate.vue` 超过 1.1 万行，把以下功能放在同一个滚动页面中：

- 剧本创建、选择和导入；
- 全局画风；
- 一键流水线；
- 角色、场景、道具；
- 分镜脚本、分镜图、首尾帧；
- 视频生成和候选；
- 视频配置和整集合成。

导航栏虽然显示“故事剧本、角色、道具、场景、分镜脚本、分镜图、分镜视频”，但完成状态主要由“是否有文字/图片/视频”推导。它不能回答：

- 这版剧本是否经过确认；
- 这张角色图只是生成成功，还是已批准的身份主图；
- 风格改变后哪些旧提示词、旧图片、H3 草稿已经失效；
- 某镜头使用的是哪个角色状态、场景视角、Look 和上一镜状态；
- 哪段视频是候选、已选片、被替换版本还是最终时间线素材；
- 当前成片是预览、Picture Lock、调色版还是交付版。

### 2.2 当前技术问题

1. `FilmCreate.vue` 同时承担布局、状态聚合、业务编排、生成和轮询，改动风险高；
2. `DramaCanvas.vue` 和 FilmCreate 是两套操作表面，尚未成为同一阶段状态的不同视图；
3. 项目风格已经升级为统一风格规则和生成快照，但批准版本、阶段门禁和跨资产 stale 投影尚未收口；
4. H3 草稿已覆盖业务提示词、槽位、参数、配置、技能版本和音视频上下文，提交时也会应用最新风格；但 Look 变化尚未统一反映为草稿层可见的 stale 原因；
5. 风格变化已能影响新的图片/视频编译结果，但已有自动资产 prompt、草稿和候选的失效提示尚未形成统一产品语义；
6. Director candidate/anchor/timeline 能力存在，但普通制作主路径不以它为唯一选片和合片真相；
7. 一键流水线用 20/30 秒倒计时充当“浏览确认”，不是可审计批准；
8. 经典主路径和 Director 主路径都能合片，容易形成双重成片真相；
9. 图片/视频/工作流已有局部能力校验和 `/videos/capabilities`，但尚未形成前后端同源、覆盖所有 Provider 的统一能力契约；
10. 生成、候选、选用、衍生处理和交付版本的谱系不完整。

### 2.3 已确认的强项

本设计必须保留并放大这些能力：

- `character_variants` 和镜头人物状态关联；
- canonical reference slot 顺序和引用可用性；
- 首帧、关键帧、尾帧专业提示词；
- `layout_description` 和邻镜布局上下文；
- Omni 多参考和 H3 结构化编译；
- H3 草稿的 AI/人工/失效/结构校验状态；
- 1～3 个视频候选、质量检查、人工选用和理由；
- 任意时间截帧并派生超分/线稿连续性锚点；
- Director 时间线的排序、源偏移、时长、Cut/Fade/Dissolve；
- 字幕、旁白 TTS、对白音频、水印、基础色调和云超分；
- 持久化异步任务和生成进度聚合；
- 项目 ZIP 导入导出和媒体历史。

## 3. 设计目标与非目标

### 3.1 目标

1. 普通用户能按四个阶段完成一集，不必理解数据库、Provider 协议或节点图；
2. 高级用户能进入画布、H3 草稿、引用清单和 Director，而不制造第二套数据；
3. 每次高资源或外部计费生成前都能知道输入是否完整、为何失效、预计资源/费用和可降级项；
4. 风格、角色、场景、道具或模型替换后，由系统重编镜头包，不要求用户手改全部提示词；
5. 任何资产当前使用项、本集设定快照和成片都可追溯、比较和回滚；
6. 连续性同时使用长期资产锚点和上一镜即时状态锚点；
7. 把选片、时间线、Picture Lock、调色、超分和交付变成单一成片主路径；
8. 通过一次性迁移保留现有本地项目、媒体、提示词、来源与任务事实；迁移成功后只运行 V2.1 API 和数据模型。

### 3.2 非目标

- 不在本版本实现完整 Premiere/DaVinci 级非线编；
- 不自研视频生成模型；
- 不要求每个项目都使用 3D 导演台；
- 不强迫所有图片和视频都超分；
- 不把所有提示词改成用户不可编辑的黑盒；
- 不为尚未上线的旧页面建立 V1/V2 双轨、长期双写或回退开关；
- 不让自动化跳过批准门禁直接花费大量资源，除非用户明确启用已批准的 Recipe。
- 不把登录、钱包、团队、社区或云端存储设为本地制作主流程的前置条件。

## 4. 总体信息架构

### 4.1 路由

建议新增语义清晰的主路由：

```text
/projects/:projectId/episodes/:episodeId/:stage

stage = script | assets | storyboard | cut
```

面向用户的中文名称仍是“剧本、设定、分镜、短片”。内部使用 `assets` 和 `cut`，避免把领域术语 Bible 暴露给中文用户，也避免 `film` 同时表示项目、页面和成片阶段。

V2.1 只保留上述 canonical Studio 路由。`/film/:id`、`/film/:id/canvas`、`/drama/:id` 和旧页面不作为产品兼容入口；Phase 1～5 全部通过后在 Phase 6 统一删除。开发期书签失效不构成产品兼容需求。

### 4.2 Studio Shell

页面固定区域：

```text
┌ 项目名 ─ 集数 ─ 保存状态 ─ 任务/资源 ─ 设置 ┐
├ 剧本 ─ 设定 ─ 分镜 ─ 短片 ───────────────┤
│ 左：阶段导航/问题列表 │ 中：主工作区 │ 右：检查器 │
└ 全局任务抽屉 / 版本历史 / 错误详情 ─────────┘
```

顶部阶段轨道的主状态只使用：

- `not_started` 未开始；
- `in_progress` 进行中；
- `ready_for_review` 待确认；
- `approved` 已确认；
- `stale` 上游已变化。

`blocked` 是 Gate 计算结果，`queued/running/waiting_external/succeeded/failed/cancelled/unknown` 是任务状态，不写入阶段内容枚举。界面同时显示主状态、阻塞数量和任务 badge，不让失败任务覆盖批准历史。完整真值表见 `2026-09-08-production-studio-v2.1-state-gate-truth-table.md`。

可以浏览后续阶段，但高资源批量生成、可能产生外部费用的生成和最终确认使用硬门禁。若用户从 URL 进入被锁阶段，页面保留正确路由并展示“缺少什么”的 blocker 面板，不静默显示另一个阶段。

### 4.3 标准模式与高级模式

四个阶段都遵守同一原则：

| 标准模式 | 高级模式 |
|---|---|
| 卡片、表格、向导 | 画布、结构化 JSON、编译预览 |
| 自动建议和安全默认值 | 细粒度引用、模型和参数控制 |
| 面向完成任务 | 面向调试和复杂制作 |

两种模式调用同一套 API，使用同一 entity ID、revision 和 approval。切换模式不复制数据。

## 5. 生产状态机

### 5.1 阶段状态

每一集每一阶段保存独立内容状态：

```text
not_started
  → in_progress
  → ready_for_review
  → approved
  → stale
  → in_progress
  → ready_for_review
  → approved
```

`blocked` 由 Gate 计算，任务状态独立保存；二者都不取代内容 revision。合法转换、显示规则和豁免语义以状态/Gate 权威附件为准。

### 5.2 批准语义

批准不是“有文件”或“任务成功”：

- Script Gate：批准剧本 revision；
- Look Gate：批准 Look Bible revision；
- Asset Gate：检查本集必需资产都有当前使用项，并保存精确版本/hash 的本集资产集合快照；
- Shot Gate：批准镜头列表、时长、引用和预演；
- Video Gate：每镜至少有一个已选候选，或明确标记跳过；
- Picture Lock：批准剪辑顺序、入出点、时长和转场；
- Color Gate：批准技术匹配和创意 Look；
- Delivery Gate：批准分辨率、帧率、音频、字幕、水印和文件校验。

不同生产对象不强行共用一套操作层级。项目资产图片/音色只有“候选”和“当前使用项”：生成/上传只建候选，用户点击候选即写 current pointer，旧 current 留在历史；不再暴露临时选中、采用和对象批准。剧集设定阶段只在必需对象通过预检后保存不可变 episode asset set snapshot。视频候选采用、剧本/Look/Shot 确认、Picture Lock 与交付仍保留各自必要的决策。`waived` 是带原因和过期规则的独立 Gate exception，不是对象或阶段状态。

### 5.3 软门禁和硬门禁

| 操作 | 未批准时 |
|---|---|
| 查看下游页面 | 允许，显示 stale/blocked |
| 编辑下游草稿 | 允许，但记录基于哪个上游 revision |
| 生成低成本预览 | 可配置允许 |
| 批量生图/生视频 | 默认禁止，需上游批准 |
| 导出交付母版 | 禁止，需 Picture/Color Gate |

### 5.4 变更失效矩阵

| 变化 | 必须失效 | 保留但标记风险 |
|---|---|---|
| 剧本场次内容改变 | 受影响场次的提取结果、镜头包、编译提示词 | 已生成媒体保留为历史 |
| 全剧 Look 改变 | 自动资产 prompt、分镜图 prompt、H3/Omni 编译快照、Color Gate | 人工 prompt/已批准媒体保留，要求选择保留或重编 |
| 场次 Look 改变 | 该场次镜头包和自动 prompt | 其他场次不动 |
| 角色主版本改变 | 引用该角色的镜头包 | 不引用该角色的镜头不动 |
| 角色状态改变 | 引用该状态的镜头包 | 角色主版本仍有效 |
| 场景视角/状态改变 | 引用该版本的镜头包、构图预演 | 场景实体不删除 |
| 道具状态改变 | 相关镜头包、连续性检查 | 道具主版本仍有效 |
| 镜头时长改变 | 时码、H3 草稿、Provider 编译快照、时间线 | 已生成候选保留但标时长不匹配 |
| Provider/工作流改变 | Provider 编译快照 | 业务意图和引用绑定不变 |
| 选中视频候选改变 | 下游连续性帧、Picture Lock | 其他候选保留 |
| 重新选择上一镜稳定帧 | 直接依赖的下一镜编译/候选 | 更后镜头按依赖图传播 |

失效计算必须基于 fingerprint 和依赖关系，不能靠前端临时布尔值。

## 6. 剧本阶段设计

### 6.1 页面组成

左侧：分场大纲；中间：正文编辑器；右侧：结构检查和版本历史。

分场大纲至少保存：

```json
{
  "sceneKey": "EP01_SC03",
  "heading": "洞穴出口",
  "interiorExterior": "EXT",
  "timeOfDay": "黄昏",
  "characters": ["CHAR_LINFAN", "CHAR_SUWANER"],
  "storyPurpose": "揭露真相并建立告别动机"
}
```

### 6.2 操作

- 保存草稿；
- AI 润色选中段落；
- 重新切分场次；
- 对比上一版；
- 导入/导出；
- 提交确认；
- 重新打开已确认版本。

### 6.3 修改影响

提交确认前显示：

```text
本次修改影响：
- 2 个角色出场关系
- 1 个场景描述
- 3 个分镜
- 3 个 H3 草稿
- 已生成视频不删除，将移入历史并标记“基于旧剧本”
```

保存和执行拆成两个正交决定：

- 保存未批准草稿：不影响当前批准版和下游；
- 批准新 revision：必须计算并写入受影响下游的 stale，用户不能跳过；
- 批准后可选择“暂不执行”“刷新受影响场次”或“整集重新提取”，这只决定是否立即启动任务，不改变 stale 事实。

## 7. 设定阶段设计

### 7.1 分类

设定页包含四个标签：

```text
Look｜角色（含人物音色）｜场景｜道具
```

Look 放在第一位，因为它会约束后续所有视觉资产；角色、场景和道具沿用现有数据。人物音色归人物详情；环境底噪、音效、音乐意图及混音归 Episode Audio Plan/Cut，不建立平级的项目声音资产入口。

### 7.2 Look Approval

当前 `StylePickerButton` 升级为 Look 工作台，不再把“点击预设”直接等同于项目画风生效。

Look Bible 字段：

```json
{
  "medium": "3D国潮动漫",
  "realism": 0.65,
  "rendering": ["PBR材质", "柔和全局光"],
  "cameraLanguage": ["35mm-65mm", "克制推拉", "避免鱼眼"],
  "lighting": ["低调布光", "轮廓冷光"],
  "palette": {
    "dominant": ["#183047", "#6F8A9B"],
    "accent": ["#D86B3C"],
    "skinStrategy": "肤色保持中性偏暖",
    "forbidden": ["高饱和荧光绿"]
  },
  "texture": ["轻胶片颗粒", "潮湿石材"],
  "negativeAesthetic": ["塑料皮肤", "过锐HDR", "海报式摆拍"],
  "promptZh": "...",
  "promptEn": "..."
}
```

确认流程：

1. 选择预设或自定义；
2. 系统用同一固定测试主体生成 2～4 张低成本 Style Probe；
3. 用户并排比较；
4. 可锁定媒介、色域、人物肤色、镜头语言等字段；
5. 选中候选并填写可选理由；
6. 保存不可变 Look revision；
7. 后续生成引用 `look_profile_id + version + fingerprint`。

### 7.3 场次 Look 与 Color Script

V2.1 Look 固定为三层，解析优先级为 `Shot 特殊覆盖 > StoryScene 场次 Look > Project Look`；不增加 Episode Look。全剧 Look 之下允许场次覆盖：

```text
全剧 Look Bible
  ├─ SC01 日/压抑/冷灰
  ├─ SC02 洞穴/冰蓝/高反差
  ├─ SC03 黄昏/橙蓝过渡
  └─ SC04 告别/低饱和暖金
```

Color Script 不是必须为每镜生一张色卡。第一版用场次卡即可：主色、辅色、禁色、曝光、对比度、主光方向、材质和情绪。镜头级覆盖只在闪回、梦境、主观镜头等特殊情况使用。

色卡图片的引用角色必须是 `look`，不能伪装成 `scene`。

### 7.4 资产统一模型

角色、场景、道具共用以下概念：

```text
Entity（语义实体）
└─ Version（不可变版本）
   ├─ description revision
   ├─ prompt revision
   ├─ reference bindings
   ├─ generation candidates
   ├─ adopted artifact
   └─ approval
```

角色版本类型：`identity_master / costume / injury / age / pose_reference`。
场景版本类型：`master / view / time / weather / damage_state / zone`。
道具版本类型：`master / held / opened / damaged / depleted / transformed`。

项目级聚合入口的用户可见名称固定为“项目设定”（内部原型路由可继续沿用 `project-bible` 以保持深链可恢复）。首屏固定为外部 AI 创作上下文、Project Look、生产对象概览三块：本页直接编辑项目简介、题材、故事基础设定、不可改变的设定和跨集连续性备注；人物/状态、场景和道具只读聚合并精确跳转项目资产处理，不能在本页创建或采用媒体候选。Project Look 保持项目作用域并进入独立工作台，不绑定任意剧集。

项目设定不是图片/视频的通用 Prompt 来源，也不是生成 Gate。项目梗概、故事设定和跨集连续性不得整段注入 Provider Prompt；只有 Project Look，以及已经归一化并明确选入当前任务的人物当前外观/生产状态、场景当前生产状态和道具当前生产状态可以参与生成。当前分镜、参考资产、生成模式、镜头连续性和 Provider 参数仍由对应制作阶段提供。只有实际进入任务快照的有效输入变化才按引用范围触发 stale；项目简介、故事基础设定或连续性备注变化只使下一次外部 AI 上下文需要刷新，不得让既有图片和视频整体过期。

V2.1 首版不在“项目设定”中建设百科式结构化世界观事实库、伏笔追踪器、人物关系图或事件时间线，也不自动推断剧情事实。首屏主操作为“生成外部 AI 上下文”，进入项目剧集创建/导入中心的外部 AI 场景，按“选择目标集号 → 当前数据预览 → 缺失提示 → 复制 Markdown/下载 → 外部创作 → V2.1 JSON 回流 → 五步导入确认”执行。生成或复制上下文本身不调用外部模型、不创建剧集，也不产生费用；外部新增人物/状态/场景/道具必须经过导入预览确认，不能覆盖已有 Look、资产当前使用项或自动启动媒体任务。

### 7.5 资产详情抽屉

项目资产采用“生产对象优先”，只管理当前项目可跨集复用的人物/状态（含人物音色）、场景资产和道具及其当前使用项、媒体候选、版本历史、生成记录和使用位置。分镜图片与逐镜正式视频候选归分镜阶段；整集审核、环境声、音效、音乐与时间线归短片阶段；全局个人资产库负责跨项目复用；剧集设定负责按实际音频策略确认本集所用资产并保存 Asset Gate 快照。

首屏提供可解释统计、`全部/人物/场景/道具` 分类、搜索/状态/使用/来源/媒体/剧集筛选、卡片/列表切换和批量操作。人物卡直接显示音色状态和快捷试听，不建立平级声音卡。类型与对象焦点写入 URL。所有资产详情固定为“概览 / 版本与候选 / 使用位置 / 生成记录 / 高级”，统一显示：

- 名称、描述、出场集/场次；
- 当前使用版本；
- 候选和历史；
- 主参考图和辅助参考图；
- 自动 prompt 与人工覆盖；
- 模型、布局、画幅、成本预估；
- 跟随哪个 Look revision；
- 依赖它的镜头列表；
- 生成、上传、比较、点击使用、派生版本和下载。

从个人资产库进入项目时必须选择“引用固定版本”或“复制到项目”；两者均不自动随库更新漂移。生成和上传只创建候选，用户点击候选即保存为当前使用项，旧 current 保留在候选历史；不再提供资产级临时选择、采用和批准。场景与道具都使用“稳定对象 → 剧情状态 → 视图参考 → 媒体候选”关系：剧情变化与空间/构图角度必须分层，切换某个组合的候选不得改写其他组合。人物形象与人物音色分别维护候选和 current pointer，改选音色不得改变形象候选。用户点击“进入分镜”时，系统在同一次跳转中自动校验必需资产并保存精确版本/hash 快照；音色只有在本集所选音频策略明确依赖该人物音色且当前音色缺失时才阻断，不增加阶段级确认动作。批量操作允许生成缺失候选、入队、设置模式、标签、从库添加和归档未使用项，但不允许自动批量设为当前使用项。

日常删除统一为可恢复归档。被剧集、分镜、任务、候选或交付引用的版本和媒体禁止物理删除。项目详情不设置一级“数据管理”页：导出备份、从备份恢复和删除项目进入项目操作；永久清理、完整性检查、媒体重定位及迁移/恢复记录进入“设置 → 高级数据工具”。物理清理必须先执行 dry-run，并完成依赖、活动任务、受控路径和事务检查。

### 7.6 标准/高级共用数据

标准模式显示资产卡；高级模式使用重构后的画布节点。节点中的 prompt、模型和引用更新同一 asset version，不能写回 `metadata.workflow_groups` 形成另一套半结构化真相。现有 DramaCanvas 只作为交互能力参考，不复用其独立数据和保存协议。

## 8. 分镜阶段设计

### 8.0 已确认领域模型：场次—分镜—时段（方案 B）

面向用户和外部 JSON 的生产结构固定为：

```text
剧集 Episode
├─ 场次 StoryScene：剧本叙事结构
├─ 分镜 Storyboard：一次视频生成单元
│  ├─ 时段 TimedSegment 1..N：分镜内部连续时间码
│  └─ 视频候选 VideoCandidate[]：生成结果，不另建“视频段”业务层
└─ 场景资产 / 角色资产 / 道具资产
```

术语约束：

- “场次”表示剧本中的时空叙事单元；现有 `scenes` 表和设定页对象统一称为“场景资产”，二者不能混用；
- 一条 `storyboards` 记录继续表示一个分镜，也就是一次 Provider 视频生成请求的业务单元；
- 每个分镜必须包含至少一个时段；简单连续动作允许只有一个覆盖全时长的时段；
- 时段不是新的顶层“子分镜”，只负责表达该分镜内部的时间范围、动作、运镜、对白、声音和资产生效范围；
- 一个分镜可以关联多个场次或场景资产，但是否能够作为一次请求提交，必须由当前 Provider 的多时段、多场景和引用上限能力决定；
- 视频是分镜的候选产物；不在“场次”和“分镜”之间增加用户可见的“视频段”层级。

15 秒等模型时长只表示 Provider 的上限或可选规格，不是分镜生成时的固定目标。系统不得为填满上限添加停顿、重复动作或无剧情价值的内容。

### 8.0.1 分镜与短片职责边界

- 分镜阶段负责 StoryScene、Shot Package、Timed Segment、资产引用、分镜图/关键帧、连续性意图、普通/Omni/H3 prompt 编译、Video Recipe 能力预检、费用确认、正式逐镜视频任务、VideoCandidate 比较/采用和 Shot Gate。
- 分镜阶段可以生成图片和不进入主链的本地低成本 motion previs；previs 必须标记 `artifact_role=previs`，不能成为 VideoCandidate、不能采用进 Timeline，也不能通过 Video Gate。
- 短片阶段负责整集镜头审核、A/B 复核、连续播放、连续性稳定帧、Video Gate、Timeline、声音、后期和交付。它可以为失败镜头、重拍或审核改选调用同一候选服务，但不再把首次视频生成作为页面主流程。
- 分镜与短片共用唯一 VideoCandidate 集合和 adopted pointer。分镜改选 adopted 候选不会静默替换已存在的 Timeline clip；短片必须让用户选择“仅改默认候选”或“替换当前时间线片段”。
- Shot Gate 不普遍要求分镜图。只有用户选择的 Video Recipe 明确需要首帧或参考图时，分镜阶段提交任务前的 Provider preflight 才把缺图列为 blocker；用户仍可先确认 Shot Package，再补图并生成视频。

### 8.1 页面结构

```text
左：场次/分镜轨道
中：故事板、分镜图、关键帧和可选 motion previs
右：分镜与时段检查器
底：整集时长轨、问题和批量操作
```

分镜与时段检查器分为：

- 基本：分镜号、关联场次、计划时长、当前 Provider 请求时长、叙事目的；
- 时段：1～N 个连续时间码块；允许单时段，支持新增、拆分、合并、重排和按时段绑定资产；
- 画面：景别、机位、镜头运动、构图和光线；
- 表演：角色、动作节拍、对白、情绪；
- 状态：服装、伤势、道具持有、进入/离开位置；
- 引用：canonical reference manifest；
- 声音：对白、旁白、环境、音效、音乐；
- 目标 Video Recipe：模式、模型、请求参数、任务数、并发、费用、能力预检和明确降级；
- 视频候选：正式任务、候选比较、生成历史、采用为本镜与重试；
- 质量：时长、引用、连续性和冲突检查。

结构更新入口严格区分来源和写入边界：

- `从当前剧本重新生成分镜` 只读取当前已确认 Script revision。运行前展示来源 revision、结构模型、预计费用/耗时；运行后展示新增、变化、拟删除、不变镜头 diff，人工锁定冲突逐项处理，最终只创建新 Shot revision；
- `导入分镜文件` 在 V2.1 只接收 Excel `.xls/.xlsx`、CSV `.csv` 与 `shot-package@2.1` JSON，必须经过解析/字段映射、结构预览、资产匹配和版本差异后创建新 Shot revision。DOCX/文本 AI 辅助解析后置；完整 Episode Package 和外部 AI 回流 JSON 属于剧集页入口；
- 两个入口都不直接覆盖当前 Shot revision，也不删除已有图片/视频候选、任务与媒体历史。

Video Recipe 区必须把输出媒体时长与任务处理耗时分开：计划/请求时长属于输出规格；预计排队、预计生成处理和预计总耗时属于非承诺的运行估计，并记录估计样本。运行中记录已运行和预计剩余；完成候选记录提交/开始/完成时间及实际排队、处理、总耗时。相同信息投影到全局任务中心。

### 8.2 Shot Package

每个分镜保存 Provider 无关的业务包。机器合同以 [`shot-package-v2.1.schema.json`](./schemas/shot-package-v2.1.schema.json) 为准。`planned_duration_seconds` 是剧情规划值；`request_duration_seconds` 由 Provider 适配和 preflight 产生，不由外部 AI 或分镜解析器擅自写死：

```json
{
  "schema": "local-mini-drama.shot-package",
  "version": "2.1",
  "shot_id": "EP01_SC01_SH01",
  "revision": 3,
  "story_scene_ids": ["EP01_SC01"],
  "planned_duration_seconds": 8,
  "request_duration_seconds": null,
  "story_intent": "林凡决定接下任务，压住伤势",
  "visual": {
    "shot_size": "medium_close_up",
    "camera_angle": "eye_level",
    "camera_movement": "slow_push_in",
    "composition": "林凡右三分位，苏婉儿左后景",
    "lighting": "冷环境光，脸侧微暖"
  },
  "timed_segments": [
    {
      "id": "SEG01",
      "start_seconds": 0,
      "end_seconds": 3,
      "action": "林凡咳嗽并握紧药瓶",
      "scene_asset_version_ids": [31],
      "character_state_version_ids": [8],
      "prop_version_ids": [12]
    },
    {
      "id": "SEG02",
      "start_seconds": 3,
      "end_seconds": 8,
      "action": "说完后转身向山林走去",
      "dialogue": [{ "start_seconds": 3, "end_seconds": 5, "speaker_asset_version_id": 8, "text": "别担心，我没事" }],
      "scene_asset_version_ids": [31],
      "character_state_version_ids": [8],
      "prop_version_ids": [12]
    }
  ],
  "continuity": {
    "entry": { "facing": "left", "propHand": "right" },
    "exit": { "facing": "away", "propHand": "right" },
    "axis": "AXIS_SC01_A"
  },
  "look_ref": { "version_id": "LOOK_SC01_V2", "fingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
  "references": [
    { "role": "scene_view", "asset_version_id": 31, "required": true },
    { "role": "character_state", "asset_version_id": 8, "required": true },
    { "role": "prop", "asset_version_id": 12, "required": true },
    { "role": "continuity_frame", "artifact_id": "FRAME_21", "required": false }
  ],
  "audio": {
    "dialogue": [{ "start_seconds": 3, "end_seconds": 5, "speaker_asset_version_id": 8, "text": "别担心，我没事" }],
    "narration": [],
    "ambience": ["风吹松林"],
    "sound_effects": [],
    "music_intent": "不进入旋律，只保留低频悬念"
  }
}
```

用户编辑的是 Shot Package；Provider 文本只是编译结果。

时段约束：

- `timed_segments.length >= 1`，单时段是完整合法形态；
- 第一个时段从 0 开始，最后一个时段结束于 `planned_duration_seconds`；
- 相邻时段不得重叠或留空档，总时长必须闭合；
- 只有动作、机位、场景、角色状态、对白归属或声音阶段出现有意义变化时才增加时段；
- 分镜级引用是所有时段引用的稳定并集；时段级引用决定对应时间范围内哪些资产实际生效；
- 旧分镜迁移时生成一个覆盖全时长的默认时段，原 `scene_id` 投影为该时段的首个场景资产引用。

### 8.2.1 外部 JSON V2.1 唯一合同

直接单集 JSON 使用 [`episode-package-v2.1.schema.json`](./schemas/episode-package-v2.1.schema.json)，外部 AI 回流使用 [`external-ai-result-v2.1.schema.json`](./schemas/external-ai-result-v2.1.schema.json)。两者都固定为 `schema + version: "2.1"`，使用 `story_scenes[]` 和带结构化时段的 `shot_packages[]`。未知顶层/业务字段拒绝，扩展信息只能放入显式 `extensions`。

最小结构示例：

```json
{
  "schema": "local-mini-drama.episode-package",
  "version": "2.1",
  "episode": {
    "episode_number": 1,
    "title": "客房来电",
    "summary": "夜班服务员发现不存在的房间发来订单。",
    "script": "内景·酒店走廊·深夜……",
    "duration_target_seconds": 90
  },
  "assets": {
    "characters": [],
    "scene_assets": [{
      "source_key": "scene_hotel_room",
      "name": "208 房门口",
      "state": "深夜",
      "description": "老旧酒店二层走廊尽头的客房门",
      "atmosphere": "冷清、压迫"
    }],
    "props": []
  },
  "story_scenes": [
    {
      "source_key": "story_scene_01",
      "scene_number": 1,
      "heading": "内景·酒店客房·深夜",
      "location_scene_ref": "scene_hotel_room",
      "summary": "角色在空房门口听见电话铃声。"
    }
  ],
  "shot_packages": [
    {
      "source_key": "shot_01",
      "shot_number": 1,
      "story_scene_refs": ["story_scene_01"],
      "planned_duration_seconds": 8,
      "story_intent": "角色确认声音来自空房内部。",
      "visual": {
        "shot_size": "medium",
        "camera_angle": "eye_level",
        "camera_movement": "slow_push_in",
        "composition": "角色位于右侧，房门占据左侧",
        "lighting": "冷色走廊灯"
      },
      "timed_segments": [
        {
          "start_seconds": 0,
          "end_seconds": 8,
          "action": "角色缓慢转头看向门口，镜头轻微推进",
          "scene_asset_refs": ["scene_hotel_room"],
          "character_state_refs": [],
          "prop_refs": []
        }
      ],
      "continuity": { "entry": {}, "exit": {}, "axis": null },
      "audio": { "dialogue": [], "narration": [], "ambience": ["走廊空调低鸣"], "sound_effects": ["电话铃"], "music_intent": null }
    }
  ]
}
```

协议识别只读取根级 `schema` 和字符串 `version`；名称未知返回 `PACKAGE_SCHEMA_UNSUPPORTED`，版本非 `2.1` 返回 `PACKAGE_VERSION_UNSUPPORTED`，未知字段/类型错误返回 `PACKAGE_SCHEMA_INVALID` 并携带 JSON Pointer。Schema 通过后再执行业务校验：source key 唯一、引用可解析、场次/分镜顺序唯一、时段从 0 连续闭合到计划时长、台词位于时段内、禁止携带 Provider/模型/`request_duration_seconds`/最终 prompt/Project Look。

External AI adapter 是确定性纯转换：校验 `package_id` 与回流 `assets_digest` → 将任务快照中的既有资产和 `new_assets.characters/scene_assets/props` 合并，并把 `new_assets.character_states` 按 `character_ref` 追加到对应人物 → 保持 `episode/story_scenes/shot_packages/audio_plan/extensions` 不变 → 生成规范化 `local-mini-drama.episode-package@2.1` → 进入同一个五步预览与原子导入。缺失人物、重复 `source_key` 或默认状态冲突均在适配阶段显式报错，不允许模型再次改写结果。

V2.1 外部导入缺少 `story_scenes`、`shot_packages` 或 `timed_segments` 必须校验失败，不做运行期旧协议升级；只有一次性本地数据库迁移会把旧分镜明确转成覆盖全时长的单时段。

### 8.2.2 外部 JSON 导入目标与安全边界

V2.1 的完整剧集制作包只允许两种写入目标：

1. 在当前项目中创建新剧集；
2. 填充一个经服务端再次确认的空白剧集。

V2.1 **不支持把外部 JSON 合并、覆盖或追加到已有内容的非空剧集**。只要目标剧集已有剧本/梗概、场次、分镜、分镜媒体或成功导入记录，预览必须标记 `TARGET_NOT_BLANK`，正式提交必须在事务内再次检查并拒绝。界面只提供“选择空白剧集”“创建新剧集”“取消”，不得提供“强制覆盖”“智能合并”或隐藏的绕过入口。

选择这一约束是为了避免外部 JSON 破坏本地人工编辑、资产引用、候选图片/视频、H3 草稿、时间线及其依赖关系。旧剧集需要采用外部结果时，应导入为新剧集后人工比较，不在 V2.1 内建设三方合并和覆盖恢复机制。

导入只创建或复用结构化数据：剧集草稿、剧本、叙事场次、角色/角色状态、场景资产、道具、分镜、时段和引用关系。导入不会自动生成资产图片、分镜图片、视频或音频，不启动 Provider 任务，也不产生远端生成费用。导入成功后的所有新内容保持草稿/待确认状态。

完整制作包入口属于项目/剧集层级：放在项目详情的剧集列表、空项目/空剧集引导和新建项目向导中。Production Studio 不放置“导入外部 JSON”主按钮；已由外部包创建的剧集只显示紧凑“外部来源”入口，用于只读查看原始 JSON、规范化数据、哈希和导入报告。

### 8.2.3 项目剧集中心交互边界

项目详情“剧集”使用紧凑列表，显示集号、标题、目标时长、来源、最近工作位置、阻塞和四阶段状态。顶部提供剧集/正在制作/需要处理/外部来源计数、搜索、集号/最近工作排序，以及全部、剧本、设定、分镜、短片阶段筛选。阶段格直接进入准确剧集阶段；主动作恢复本集真实最近位置；空白剧集进入同一六来源选择器。

六类来源固定为：空白手工、想法/剧本 AI、小说/长文本、外部 AI 协作、直接 V2.1 JSON、已有视频。选择器本身零写入、零任务；所有来源共用“创建新剧集/填充空白剧集”的目标保护。想法/剧本 AI 只生成可审阅草稿；小说/长文本先预览章节、拆集和编号冲突；已有视频只登记原始媒体/hash/路径并进入短片时间线，不复制大文件或自动生成镜头。

外部 AI 采用“生成创作上下文 → 创建本集任务包 → 外部会话协作 → 选择结果 JSON → 统一五步导入”。ZIP 与单文件任务 JSON 是同一 package attempt 的等价载体，使用相同 `package_id/assets_digest`。导入来源详情不可变，至少保存原始 JSON、规范化结果、资产匹配决策、package id、SHA-256 和导入报告。

剧集菜单只提供重命名、复制为草稿、设置目标时长、调整集序、可恢复归档和查看来源；复制不复制运行任务，归档不物理删除内容或来源记录。事务导入失败时保留文件、目标和匹配决策供重试，数据库不得留部分写入。

### 8.3 Reference Manifest

延续现有 canonical slot 设计，数据库真相使用稳定 ID 和职责：

```json
{
  "bindingId": "ref_...",
  "role": "character_state",
  "entityType": "character_variant",
  "entityId": 88,
  "artifactId": "img_...",
  "required": true,
  "sortOrder": 20,
  "framingNote": "只参考身份和服装，不参考三视图拼版构图"
}
```

提交给 Provider 时才生成 `@图片1` 或 `Mixed 1`。保存编译快照：

```text
bindingId → Provider slot index → URL/hash → prompt label
```

增删引用时只令编译结果 stale，不改业务引用 ID。

### 8.4 预演产物

2D画板、3D导演台和 AI 分镜图都属于构图预演，但职责不同：

| 类型 | 作用 | 是否直接作为身份参考 |
|---|---|---:|
| `composition_previs_2d` | 站位、轴线、运动箭头 | 否 |
| `composition_previs_3d` | 机位、焦段感、空间透视 | 否 |
| `storyboard_frame` | 叙事构图和角色外观联合参考 | 可选 |
| `first_frame` | 视频起点 | 是，适用于 I2V/FL2V |
| `key_frame` | 动作高潮/中间状态 | 取决于 Provider |
| `last_frame` | 设计终点 | 是，适用于 FL2V |
| `continuity_frame` | 上一段真实生成状态 | 是，适用于相邻镜 |

LocalMiniDrama 首版不必实现完整 3D 引擎。可先将外部/内置 2D 草图、站位 JSON、相机参数和截图作为版本化预演产物；3D 作为高级可插拔工具。

### 8.5 时长预算器

每次修改镜头时实时计算：

- 总集时长；
- 场次时长；
- 本分镜时段数；
- 对白预计时长；
- Provider 可选时长；
- 剧情计划时长与实际请求时长；
- Provider 是否支持当前时段数和场景资产数；
- 相邻镜头合并后是否超上限；
- 生成实际时长与目标偏差。

默认规则建议：

```text
单一清晰动作或连续表演：允许 1 个时段，通常 2～8 秒
动作 + 反应：4～8 秒
含一句短对白：按 TTS 估算 + 0.5～1 秒表演余量
每 5 秒超过 3 个显著动作：警告
镜头内超过 3 个机位变化：建议拆镜
```

规则是可配置警告，不替代导演判断。不得使用“总时长 ÷ 5 秒”机械决定时段数量，也不得把 15 秒或任一 Provider 最大时长当作必须填满的目标。

自动规划顺序固定为“剧本语义切分 → 连续动作/场景判断 → 形成 1～N 时段 → Provider 能力预检 → 选择合法请求时长”。若 Provider 仅支持离散时长，保留剧情计划时长，并显示实际请求时长及后续裁剪差异。

### 8.6 Shot Gate

批准分镜前检查：

- 镜号唯一且顺序连续；
- 计划时长与时段时间码闭合；
- 至少一个时段；单时段不得被误报为结构不足；
- 计划时长不被强制扩展到 Provider 最大时长；
- 必要角色状态/场景/道具已绑定本集 Asset Gate 快照中的精确版本；
- Prompt 中无越界引用；
- 构图和人物状态与邻镜不冲突；
- Provider 支持请求模式；
- Provider 支持当前时段数、多场景使用方式和请求时长；
- 首尾帧或参考图数量在模型上限内；
- 台词时长不超过镜头；
- 2D/3D预演若存在，版本未失效；
- 提交正式视频任务前显示预计任务数、费用/资源、批量策略和所有显式降级。

Shot Gate 确认 Shot Package 的结构和输入有效性，不等于视频已生成。进入短片页面可以是软导航；Picture Lock 之前，Video Gate 仍要求每个必需镜头具有已采用候选或有效豁免。

## 9. Prompt Compiler V2

### 9.1 分层

```text
Look Bible / Scene Look
        +
Asset facts / state facts
        +
Shot Package / timed segments
        +
Reference Manifest
        +
Provider Capability
        ↓
Provider-specific compiled prompt + request snapshot
```

不要把人物外貌、场景和风格复制到每条可编辑长文本中。文本编辑器提供三层：

1. 业务意图：用户主要编辑；
2. 自动编译预览：可查看；
3. 人工 Provider 覆盖：高级可编辑，必须记录来源和 stale 策略。

### 9.2 按模式编译

| 模式 | 编译重点 | 避免 |
|---|---|---|
| T2V | 主体、场景、构图、风格、动作、镜头、节奏 | 无参考却缺主体信息 |
| I2V | 动作、镜头运动、时间推进、环境动态 | 重复描述输入图中所有静态细节 |
| FL2V | 从首帧到尾帧的可实现变化和路径 | 同时要求互相冲突的构图 |
| Ref2V/Omni | 每个引用职责、主体关系、动作/声音 | 只靠裸位置序号 |
| H3 | H3 固定结构、多模态说明、声景、音乐和时间线 | 编译后再拼普通 style 尾巴 |
| V2V/重拍 | 保持区间、修改区间、参考视频和替换意图 | 把整段当全新视频生成 |

### 9.3 统一 fingerprint

所有 prompt revision 的 source fingerprint 至少包含：

```text
shot_package_hash
reference_manifest_hash
look_profile_hash
asset_version_hashes
duration / dimensions / audio
provider_config_snapshot
workflow_hash
compiler_version / skill_hash
manual_override_policy
```

H3 必须补入 `look_profile_hash`，并让预览、编译、提交使用同一个 resolved Look。风格变化后 H3 draft 必须显示 `stale: look`。

### 9.4 人工覆盖策略

自动 prompt：上游变化后自动 stale，可一键重编。
人工覆盖：不自动覆盖，提供：

- 保留人工内容并更新引用快照；
- 用新输入重编后显示 diff；
- 放弃人工覆盖；
- 锁定某些段落，重编其余段落。

### 9.5 H3 草稿交互合同

H3 草稿是正式视频任务的可见输入，不是通用 Prompt 编译按钮的隐藏副作用。分镜页必须提供独立“生成 H3 提示词”动作、可编辑草稿、来源 Shot/Recipe revision、fingerprint、生成时间/编译器，以及结构、引用槽位、音频语义覆盖和 PromptStyleGate 四类校验结果。

来源 revision、引用或声音事件变化时，旧草稿保留并标记 `stale`；结构、槽位或声音语义失败时标记 `invalid`。两种状态都不能创建新的正式视频任务，用户可以保留人工文本后重新生成或直接编辑修复。任何自动重编都不得静默覆盖人工 H3 文本。

## 10. 短片阶段设计

### 10.1 页面结构

```text
上：整集审核状态、场次筛选、待处理问题和连续播放
左：镜头轨和版本状态
中：当前候选/已选视频预览
右：来源快照、候选历史、质量、修复和稳定帧工具
下：成片时间线、音轨和 Picture Lock
```

页面固定为三个主标签：`镜头审核`、`时间线`、`交付`。首次正式视频生成在分镜阶段完成；短片阶段通过同一候选服务提供重新生成、补充候选和局部重拍，作为审核修复动作而非第一主动作。

### 10.2 镜头审核与候选

镜头审核复用并升级 `VideoGenerationPanel.vue` 的候选能力，但将输入与生成设置收为来源快照/修复抽屉：

- 读取分镜阶段采用的候选、Provider、Recipe、Prompt、Reference Manifest 和输入 fingerprint；
- 主预览、连续播放、A/B 比较、逐帧检查和技术质量结果；
- 1～N 个候选、采用历史及来源快照；
- 重新生成、补充候选、局部重拍、队列、取消和重试；
- 候选元数据和错误；
- 采用/改选理由与是否替换 Timeline clip 的明确决策；
- 稳定帧和 Video Gate。

候选采用事件是 Video Gate 的事实来源。`storyboards.video_url` 只作为一次性迁移输入；运行期不再读取或写入该字段决定当前候选。

### 10.3 批量策略

批量生成不是固定并发数，而是依赖图调度：

```text
无相邻连续性依赖的镜头 → 可并行
使用上一镜 continuity_frame → 串行链
同一 Provider/GPU 的资源限制 → 按队列串行或限流
需要用户选片后才能继续 → 暂停在 review
```

提供三种用户策略：

- 快速预览：独立镜头并行，暂不使用真实上一镜帧；
- 连续性优先：每镜选片/自动质量门通过后生成下一镜；
- 自定义：画布中编辑依赖。

V2.1 不做语义自动选片。系统可自动检查可读、解码、时长、编码、黑帧、冻结和缺帧，并标记 `technically_eligible`；最终“采用为当前”必须由用户执行并可填写理由。

### 10.4 连续性锚点统一

当前“尾帧衔接”和 Director 任意帧锚点合并为一个入口：**创建下一镜状态参考**。

流程：

1. 从已选候选读取真实视频；
2. 默认在结尾 0.2～1.0 秒范围寻找清晰稳定帧；
3. 可人工拖动选择；
4. 执行人脸清晰、运动模糊、遮挡和构图检查；
5. 可选原图、2× 超分或线稿派生；
6. 保存 source artifact、时间/帧号、hash、用途和参数；
7. 绑定到下一镜 `continuity_frame`；
8. 下一镜 Provider 不支持时明确降级为构图参考或不使用。

不允许“生成完成立即不可逆覆盖下一镜首帧”。已有首帧进入历史，新锚点先作为候选引用，用户或 Recipe 决定采用。

### 10.5 局部重拍

第一版局部重拍应基于支持 V2V/segment edit 的 Provider：

- 在时间线上选择区段；
- 固定区段前后上下文；
- 引用原视频和必要资产；
- 描述只需要修改的表演/动作/物体；
- 新结果作为候选片段，不直接覆盖已选视频；
- 选用后建立父子 artifact lineage。

若 Provider 不支持，UI 应建议：重新生成整镜、裁掉问题区间或用相邻镜头遮挡，不显示无效按钮。

### 10.6 时间线和 Picture Lock

升级现有 `DirectorTimelinePanel.vue`：

- 镜头拖拽排序；
- 多区段拆分/删除/恢复；
- 入点、出点、变速；
- Cut/Fade/Dissolve；
- 视频、对白、旁白、环境、音乐轨；
- 全片播放；
- 时间码和总时长；
- 时间线版本；
- 保存草稿与 Picture Lock 分开。

Picture Lock 后：

- 仍可创建新时间线版本；
- 当前锁定版本不可就地修改；
- 调色、字幕、混音和超分绑定此版本；
- 重新选片或改剪辑会令后期版本 stale，但不删除旧输出。

Picture Lock 只锁画面剪辑决定。对白、旁白、音乐、音效、字幕、水印、调色和超分属于绑定 `picture_lock_id` 的 Post Revision；不改变画面时长的修改只派生新 Post Revision，不打破 Picture Lock。Delivery Revision 必须同时绑定明确的 Picture Lock 与 Post Revision。

### 10.7 后期处理分层

不要把所有操作都叫“高清”。分为：

#### 技术修复

- 解码/黑帧/冻结/时长检测；
- 去字幕/去水印（在有合法素材和适用模型时）；
- 人声增强；
- 伴奏提取；
- 降噪和响度；
- 超分。

#### 镜头匹配

- 曝光；
- 白平衡；
- 对比度；
- 饱和度；
- 肤色和黑位；
- 相邻镜差异检测。

#### 创意 Look

- 应用批准的 show/scene Look；
- LUT/曲线/色彩变换；
- 强度和例外镜头；
- 人工预览与批准。

正确顺序建议：

```text
选片 → 剪辑/Picture Lock
→ 基础合片母版（Base Composite，固定 picture revision 与 hash）
→ 技术校正和镜头匹配
→ 创意 Look
→ 合片后按需超分
→ 字幕/水印/最终混音
→ 编码与交付验证
```

基础合片母版是 Picture Lock 后所有后期步骤的可追溯基线，必须在运行可选超分之前持久化，不能只存在于临时工作目录。现有云超分设计要求“合片后、字幕和水印前”应保留。若调色会明显改变画面，通常先做颜色处理再超分；具体顺序由处理模型和性能测试固化成 recipe。超分的跳过、成功或失败后回退基础母版都必须写入 Post Revision；失败不得删除、替换或隐藏基础合片。编码校验未通过时 Delivery Gate 阻断导出。

### 10.8 何时超分

自动建议条件：

- 源分辨率低于交付分辨率；
- 时间线存在明显裁切/放大；
- 参考细节重要且画面内容本身正确；
- Provider 输出柔软但无结构错误。

不建议条件：

- 人物身份、手指、动作或构图本身错误；
- 严重闪烁或帧间变形；
- 只是码率低；
- 源文件已达到交付规格且细节足够。

前三类问题应重生成、局部重拍、稳定或重编码，超分不会修复语义错误。

## 11. 数据模型

### 11.0 建模原则与现有结构复用

新领域概念不等于必须新建物理表。每项实施前按“直接复用 → 增加字段 → 新表”的顺序判断；没有一次性迁移映射、备份恢复和验收策略，不允许建立第二套事实源。迁移完成后运行时不得继续把旧字段当作并行事实源。

| 目标领域 | 优先复用 | 当前决策 |
|---|---|---|
| 风格定义与项目规则 | `custom_styles`、项目风格元数据、统一风格目录 | 复用；Look Approval 通过版本/状态层补充 |
| 生成风格快照 | `generation_style_snapshots`、任务 `style_snapshot` | 复用并扩展关联字段 |
| 图片生成作业 | `image_generation_tasks`、`image_generations` | 保留为执行记录，不承担资产 current 选择或剧集快照确认 |
| 视频生成作业 | `video_generations`、工作流配置快照 | 保留为执行记录，不承担镜头批准 |
| H3 草稿 | `storyboard_h3_prompt_drafts` | 扩展为 V2.1 Prompt revision 事实源并补齐 Look/引用/编译版本 |
| 资产版本 | `character_variants`、角色/场景/道具当前图、媒体历史 | 一次性迁移到统一不可变资产版本；旧当前字段迁移后不再承担真相 |
| 镜头引用 | canonical storyboard slots、`referenceRegistry` | 一次性迁移到稳定 binding 与 immutable task snapshot |
| 视频候选与连续性 | Director candidate、artifact、anchor | 收口为唯一候选/锚点主路径 |
| 时间线和后期 | Director timeline、`video_merges`、`video_upscale_jobs` | 优先扩展，禁止平行合片真相 |
| 外部协作与可移植性 | `external_ai_package_tasks`、episode import/provenance | 直接复用并接入阶段状态 |

### 11.1 强制版本事实源与后续目标表

阶段历史、剧本、Look、资产媒体版本/current、剧集资产集合快照、Shot、稳定引用、Picture Lock、Post、Delivery 和 Gate 豁免需要不可变或可审计事实源，不再保持“是否建表”模糊。现有 Director/H3/生成表能够满足不可变历史时直接扩展；不能满足时按作用域/版本权威附件中的强制事实源建表。承接现有本地数据的目标表结构和迁移映射必须在 Phase 1 的副本迁移演练前就绪，正式数据只在 Phase 6 切换时迁移；只服务后续新增能力且没有旧数据输入的 Picture/Post/Delivery 表可在对应阶段创建，但不得形成新旧并行事实源。

#### `production_stage_states`

```text
id, drama_id, episode_id, stage,
content_revision, status,
source_fingerprint, blocker_json,
approved_revision, approved_by, approved_at,
created_at, updated_at
```

唯一键：`episode_id + stage`。

#### `look_profiles` / `look_profile_versions`

优先评估在现有统一风格体系之上增加项目级批准版本，而不是复制系统风格目录和自定义风格定义。

```text
id, drama_id, scope_type, scope_id, name, active_version_id, created_at
```

```text
id, look_profile_id, version, parent_version_id,
definition_json, prompt_zh, prompt_en, fingerprint,
status, selected_artifact_id, approved_by, approved_at, created_at
```

#### `production_asset_versions`

首期优先由现有角色状态、场景/道具图片和媒体历史投影统一接口；当批准历史、父子版本或跨集复用无法可靠表达时再落表。

```text
id, entity_type, entity_id, version, version_role,
parent_version_id, description_snapshot, prompt_revision_id,
look_version_id, selected_artifact_id, fingerprint,
status, approved_at, created_at
```

不立即替代 `character_variants`。迁移期为现有角色状态建立映射，后续再统一。

#### `shot_packages`

```text
id, storyboard_id, revision, schema_version,
package_json, source_fingerprint, status,
approved_at, created_at, updated_at
```

#### `reference_bindings`

仅保存需要稳定审批、版本追踪和依赖失效的业务绑定；任务提交时的编号、URL 和 Provider 映射继续固化在 immutable reference snapshot 中。

```text
id, owner_type, owner_id, owner_revision,
reference_role, entity_type, entity_id, asset_version_id,
artifact_id, required, sort_order, framing_note,
source_fingerprint, created_at
```

#### `prompt_revisions`

首期不替换 `generation_style_snapshots` 和 `storyboard_h3_prompt_drafts`。它只在多个编译器确实需要共享人工覆盖、版本比较和批准语义后启用。

```text
id, owner_type, owner_id, purpose, provider_key,
source_text, compiled_text, negative_text,
source_fingerprint, look_fingerprint, compiler_version,
manual_policy, status, validation_json, created_at
```

#### `quality_reports`

```text
id, artifact_id, gate, analyzer_version,
status, metrics_json, issues_json, created_at
```

#### `timeline_versions`

若现有 `director_timelines` 不便扩展，再新增：

```text
id, episode_id, version, parent_id, state,
timeline_json, source_fingerprint,
picture_locked_at, output_artifact_id, created_at
```

优先评估直接扩展 `director_timelines`，避免双表。

### 11.2 复用和扩展现有表

- `director_artifacts`：继续作为视频/派生产物谱系中心，扩展 `artifact_type`、`owner_type/id`、`look_fingerprint`；
- `director_candidate_groups/candidates`：作为视频候选唯一主路径；
- `director_anchors`：作为 continuity frame；扩展目标镜头绑定；
- `generation_style_snapshots`：作为图片/视频风格编译快照的现有事实源，扩展阶段、版本和来源关联；
- `image_generation_tasks`：继续保存 prompt/reference/style/asset mode 等不可变任务输入；
- `storyboard_h3_prompt_drafts`：短期保留专用表并补 Look 版本依赖；只有共享编辑/批准收益明确时才迁移到通用 `prompt_revisions`；
- `image_generations/video_generations`：保留 Provider 作业记录，不承担批准状态；
- `storyboards`：一次性迁移到 Shot Package、StoryScene、Timed Segment 与 Reference Binding；迁移验收后旧字段不再参与运行时决策；
- `video_merges` 和 `video_upscale_jobs`：继续作为执行记录；已实现的恢复、重试、跳过和取消能力直接复用；
- `external_ai_package_tasks` 与 episode import/provenance：作为本地优先的外部协作和可移植性基础。

### 11.3 一次性迁移与当前投影

升级器先备份 SQLite，再在同一迁移事务中把旧当前字段转换为 V2.1 revision/candidate/adopted pointer。角色/场景/道具当前图、`storyboards.video_url`、首尾帧和 `episodes.video_url` 只作为迁移输入；迁移完成后，界面 current 值由 V2.1 current/adopted/delivery 查询即时派生，不再双写旧字段。

旧分镜没有可靠叙事场次时统一进入本集“未分场（迁移）”，每镜生成一个覆盖原计划时长的时段；不得猜测剧情分场。旧当前图片/视频迁移为 candidate + adopted，但不自动批准。任何迁移失败必须回滚数据库并保留备份、媒体文件和可读迁移报告。

## 12. API 设计

### 12.1 阶段

```text
GET  /api/v2/episodes/:episodeId/stages
GET  /api/v2/episodes/:episodeId/stages/:stage
POST /api/v2/episodes/:episodeId/stages/:stage/submit-review
POST /api/v2/episodes/:episodeId/stages/:stage/approve
POST /api/v2/episodes/:episodeId/stages/:stage/reopen
GET  /api/v2/episodes/:episodeId/impact?fromRevision=...
```

所有批准端点要求 `expected_revision`，防止过期客户端状态批准新内容。

### 12.2 Look 和资产

```text
GET/POST /api/v2/dramas/:dramaId/look-profiles
POST     /api/v2/look-profiles/:id/versions
POST     /api/v2/look-versions/:id/probes
POST     /api/v2/look-versions/:id/approve

GET      /api/v2/assets/:type/:id/versions
POST     /api/v2/assets/:type/:id/versions
POST     /api/v2/asset-versions/:id/generations
POST     /api/v2/asset-candidates/:id/adopt
POST     /api/v2/asset-versions/:id/approve
```

### 12.3 镜头包和编译

```text
GET  /api/v2/shots/:id/package
PUT  /api/v2/shots/:id/package
GET  /api/v2/shots/:id/references
PUT  /api/v2/shots/:id/references
POST /api/v2/shots/:id/preflight
POST /api/v2/shots/:id/compile
POST /api/v2/shots/:id/approve
```

`preflight` 返回：

```json
{
  "ready": false,
  "blockers": [],
  "warnings": [],
  "providerCapabilities": {},
  "compiledReferenceSnapshot": [],
  "estimatedTasks": 3,
  "estimatedCost": null,
  "estimatedGpuSeconds": 180
}
```

本地模型无法精确折算货币时，显示预计 GPU 时间和任务数，不伪造费用。

### 12.4 视频和时间线

现有 Director 底层执行能力可复用，新增面向产品的聚合层。正式视频候选、采用、连续性帧和局部重拍 API 是跨页面的同一业务服务：Storyboard Stage 用于首次逐镜生成和采用，Cut Stage 用于整集审核中的补充候选、改选与修复。时间线、Picture Lock、后期和交付 API 只由 Cut Stage 调用。服务端必须按权限与状态校验命令，不依赖前端页面名称作为安全边界：

```text
POST /api/v2/shots/:id/video-candidate-groups
POST /api/v2/video-candidates/:id/adopt
POST /api/v2/video-artifacts/:id/continuity-frames
POST /api/v2/video-artifacts/:id/retakes

POST /api/v2/episodes/:id/timelines
POST /api/v2/timelines/:id/picture-lock
POST /api/v2/timelines/:id/render-preview
POST /api/v2/timelines/:id/color-match
POST /api/v2/timelines/:id/deliver
```

## 13. 前端模块拆分

建议结构：

```text
frontweb/src/views/productionStudio/
  ProductionStudio.vue
  ScriptStage.vue
  BibleStage.vue
  StoryboardStage.vue
  FilmStage.vue

frontweb/src/components/production/
  StageRail.vue
  StageGatePanel.vue
  RevisionHistoryDrawer.vue
  DependencyImpactDialog.vue
  CostPreflight.vue

frontweb/src/components/look/
  LookApprovalWorkbench.vue
  LookProbeCompare.vue
  SceneLookCard.vue
  ColorScriptBoard.vue

frontweb/src/components/assets/
  AssetGrid.vue
  AssetDetailDrawer.vue
  AssetVersionHistory.vue
  AssetReferenceEditor.vue

frontweb/src/components/storyboard/
  ShotRail.vue
  ShotInspector.vue
  ReferenceManifestEditor.vue
  TimedBeatEditor.vue
  PrevisWorkspace.vue

frontweb/src/components/film/
  ShotGenerationWorkspace.vue
  CandidateReview.vue
  ContinuityFramePicker.vue
  FilmTimeline.vue
  PictureLockPanel.vue
  ColorMatchPanel.vue
  DeliveryPanel.vue
```

现有 `StylePickerButton` 变为 Look 工作台中的 preset browser；`VideoGenerationPanel` 拆出可复用表单、候选和锚点组件；`DirectorTimelinePanel` 升级为 FilmTimeline；新高级画布接替 DramaCanvas 的节点化编辑能力，但使用各阶段同一事实源和命令。

## 14. 后端服务拆分

建议新增：

```text
productionStageService.js
productionRevisionService.js
dependencyInvalidationService.js
lookProfileService.js
assetVersionService.js
shotPackageService.js
referenceManifestService.js
promptCompilerRegistry.js
providerCapabilityService.js
productionPreflightService.js
filmTimelineService.js
qualityGateService.js
deliveryService.js
```

复用：

- `referenceSlotService` → reference manifest 兼容解析；
- `h3PromptCompiler/h3PromptDraftService` → H3 adapter；
- `unifiedVideoGenerationService` → 统一生成执行器；
- `candidateGroupService` → 候选审核；
- `continuityAnchorService` → 稳定帧衔接；
- `timelineService/videoMergeService` → 时间线和渲染；
- `directorQualityService` → 技术质量门；
- `mergedEpisodePostProcess/directorPostproductionService` → 声音、字幕、颜色；
- `videoUpscale` → 可恢复云超分作业。

## 15. Provider 能力契约

统一能力对象建议：

```json
{
  "provider": "minimax",
  "model": "h3",
  "modes": ["i2v", "fl2v", "ref2v"],
  "reference": {
    "min": 1,
    "max": 9,
    "image": true,
    "video": false,
    "audio": true,
    "semanticLabels": true
  },
  "duration": { "kind": "range", "min": 5, "max": 15, "step": 1 },
  "segmentation": {
    "supportsTimedSegments": true,
    "maxTimedSegments": 8,
    "supportsMultiScene": true,
    "maxSceneAssets": 4
  },
  "resolution": ["864x480", "1280x704"],
  "features": {
    "firstFrame": true,
    "lastFrame": true,
    "nativeAudio": true,
    "videoContinuation": false,
    "segmentRetake": false,
    "cameraControl": false
  },
  "incompatibilities": [
    ["lastFrame", "cameraControl"]
  ]
}
```

前端表单、preflight、编译器和提交服务全部读取同一能力对象。隐藏、禁用、降级和错误必须来自同一个判定函数。

`duration.max` 只表示上限，不表示默认值或目标值。能力未知时不得猜测支持多时段或多场景；单时段、单场景路径仍可按已知能力执行。Provider 只接受离散时长时，`duration` 改用 `{ "kind": "enum", "values": [4, 6, 8] }`，由 preflight 将 `plannedDurationSeconds` 映射为合法的 `requestDurationSeconds` 并显示差异。

## 16. 质量门

### 16.0 PromptStyleGate

V2.1 的风格自动校验止于 Provider 提交前，不建设生成结果级 `StyleConformanceGate`，不对图片做视觉理解，也不对视频抽帧检查色彩、材质、光照、角色渲染方式或时序稳定性。

`PromptStyleGate` 只验证：

- 项目 `style_id` 和风格版本有效；
- 当前语言对应的权威风格块在最终正向提示词中完整出现且只出现一次；
- 风格负向条款完整进入负向提示词；
- 普通图片、普通视频、Omni 和 H3 均使用同一个已解析 StyleSpec；
- H3 在正式结构内完成风格注入，不允许生成 H3 后再套普通视频提示词外壳；
- 快照中的最终提示词、负向提示词和风格版本与真正提交给 Provider 的请求逐字一致。

任何必选项缺失、重复、冲突或快照不一致都阻止提交并返回具体条款；校验通过只证明提示词合同正确，不承诺模型输出质量。

### 16.1 Look Gate

- 测试图是否使用同一可比较主体；
- 媒介、色域、肤色和材质是否一致；
- 是否存在禁用美学；
- 中英文 prompt 是否语义一致；
- 是否保存 fingerprint 和批准版本。

### 16.2 Asset Gate

- 主图是否清晰；
- 角色身份特征是否稳定；
- 三/四视图是否没有宫格文字污染；
- 场景多视角是否属于同一空间；
- 道具比例和状态是否明确；
- 参考图是否达 Provider 最低尺寸；
- 状态派生是否有父版本。

### 16.3 Shot Gate

- 时间码闭合；
- 动作和对白密度合理；
- 引用可用且未错位；
- 轴线、朝向、持物、伤势和服装连续；
- Look 与场次一致；
- Provider 能力兼容。

### 16.4 Video Gate

V2.1 不新增基于 VLM、抽帧或相似度的自动结果质量评分。Video Gate 只检查生成任务已结束、媒体可读取、时长/编码满足时间线要求、每个必需分镜已有人工采用候选或明确跳过；构图、角色、光线和动作质量由用户在候选比较中判断，可选填写采用/拒绝理由。

### 16.5 Color Gate

- 先做镜头匹配，再做创意 Look；
- 自动结果必须可预览和逐镜例外；
- 关键肤色不被 LUT 推出安全范围；
- 相邻镜头没有突兀曝光/白平衡跳变；
- 输出色彩空间和编码标记一致。

### 16.6 Delivery Gate

- 分辨率、帧率、时长；
- 音频轨、响度、峰值；
- 字幕同步和安全区；
- 水印和片尾；
- 黑帧、冻结、缺帧、解码；
- 文件 hash 和 manifest；
- 实际输出不是旧时间线/旧 Look 版本。

## 17. 一键流程重设计

当前倒计时式一键流程改为 Recipe：

```text
Recipe = 已批准输入 + 执行策略 + Provider 配置快照 + 停止条件
```

默认 Recipe：

1. 生成文本框架；
2. 停在 Script Gate；
3. 批量生成 Look Probe 和资产低成本候选；
4. 停在 Look/Asset Gate；
5. 生成分镜文本和预览图；
6. 停在 Shot Gate；
7. 按快速预览或连续性优先策略生成视频；
8. 停在候选 review；
9. 所有镜头选片后构建时间线；
10. Picture Lock 后执行后期和交付。

V2.1 不提供相似度或视觉质量阈值自动选片。Recipe 可自动完成技术检测并停在候选 review；用户采用候选后流程才继续。自动采用或自动批准如未来需要，必须建立结果级质量能力后另行设计。

暂停和恢复必须由后端持久化 job graph 驱动，不能依赖前端倒计时或内存 Promise。

## 18. 从 RunningHub 与 LibTV 吸收的具体点

| 来源 | 吸收点 | 如何落地 | 不照搬之处 |
|---|---|---|---|
| RH剧场 | 四阶段轨道 | ProductionStudio 路由与 stage state | URL/可见阶段必须一致 |
| RH剧场 | 主资产 + 派生资产 | production asset versions | 派生版本必须有角色和父版本 |
| RH剧场 | 标准/自由模式 | 同 API 的卡片/画布双视图 | 不保存两套数据 |
| RH剧场 | 时码镜头 prompt | TimedBeatEditor + duration gate | 不鼓励超长过载文本 |
| RH剧场 | 2D/3D导演台 | versioned composition previs | 不在首版自研完整 3D DCC |
| RH剧场 | 动态 Provider 参数 | capability service | 不把所有模型映射成相同表单 |
| RH剧场 | 生成后工具 | FilmStage action registry | 工具按素材状态和能力显示 |
| 青城夜巡人 | 场景多视图和长期资产锚点 | scene version roles | 不用多视图拼图直接控制成片布局 |
| 青城夜巡人 | 多模态图片+声音引用 | reference manifest | 不用裸 Mixed N 作数据库真相 |
| 秋人 | 独立色卡/摄影圣经 | Look/Color Script reference | 不复制五千字固定提示词到每镜 |
| 秋人 | 轴线/动作结束状态 | continuity entry/exit schema | 不仅写“承接上一镜” |
| 关键帧调查 | 任意稳定帧优于编码尾帧 | ContinuityFramePicker | 不自动不可逆覆盖下一镜首帧 |
| H3/超分调查 | 编译可追溯、成片后按需超分 | fingerprint + recoverable upscale | 不对语义错误使用超分 |

## 19. 迁移与实施阶段

### Phase 1：领域地基与迁移器副本验证

- 固定 Node 22.22.3，统一阶段、对象、任务、Gate、waiver、revision 和乐观锁；
- H3 freshness 纳入 ResolvedLook，PromptStyleGate 覆盖 ChatGPT/API/ComfyUI 生图及普通/Omni/H3 视频提交；
- canonical references、Provider capability、候选 → 锚点 → 时间线成为统一生成地基；
- 实现 SQLite 备份、迁移 journal、迁移器、完整性校验和失败恢复，但只在数据库副本与测试 fixture 上执行；
- Phase 1～5 不迁移正式本地数据库、不切换正式路由，也不删除旧页面。所有阶段只用于内部开发、测试和验收。

### Phase 2：项目中心与剧集创建

- Project Hub、项目详情、剧集管理和最近工作；
- 空白手工、想法/剧本 AI、小说/长文本分章、外部 AI 协作、直接 V2.1 JSON、已有视频六类剧集来源；
- 外部 AI 上下文、任务 ZIP/单文件任务 JSON、资产摘要、严格返回 Schema 和五步安全导入；
- 项目 ZIP 与单集制作包严格分流；
- 本机个人素材库入口和统一任务中心壳。

### Phase 3：剧本与设定

- Script Revision、自动保存、解析 diff、人工字段锁定、Script Gate；
- Project/StoryScene/Shot Look 解析与批准；
- 角色、状态、四视图、身份锚点、音色、场景资产、道具和历史版本；
- ChatGPT 网页、API、ComfyUI 生图统一为通道；
- 图片候选、当前使用项、人物多状态、剧集资产集合快照和受影响依赖。

### Phase 4：分镜与高级画布

- 方案 B 的 StoryScene—Shot—Timed Segment，单时段合法，多场景/多资产按时段绑定；
- Shot Package、Reference Manifest、计划/请求时长、Provider preflight 和 Shot Gate；
- 普通/Omni/H3 统一 compiler adapter，保留人工 H3 编辑和 PromptStyleGate；
- H3/Omni/普通视频提示词编译、目标 Recipe preflight、费用确认、正式逐镜视频任务、VideoCandidate 候选比较与采用；
- 批量生成缺失/过期镜头视频，单镜失败不回滚已成功项；
- 新高级画布接替 DramaCanvas 的能力，以阶段 `?mode=advanced` 呈现，并与标准视图调用同一命令 API；
- 按音频拆镜、提示词重建等旧按钮收敛为 preflight 建议和重新编译动作。

### Phase 5：短片与最终成片

- Director Timeline 成为唯一合片事实源；
- 整集镜头审核、连续播放、A/B 复核、Video Gate、连续性稳定帧与局部重拍；
- 通过与分镜相同的候选服务补充/重新生成失败镜头，并明确处理 adopted 候选与 Timeline clip 的关系；
- 视频候选复核、排序、裁剪、变速、转场和 Picture Lock；
- 对白、旁白、音乐、音效、字幕、水印、调色和可恢复超分进入 PostRevision；
- 明确 H3 原生声音与后期 TTS 所有权，禁止双重播放；
- DeliveryRevision、输出 manifest、文件 hash 和失败回退；
- 自由创作结果可进入个人素材库或项目正式链路。

### Phase 6：旧实现删除与产品收口

- 先冻结新任务并处理所有运行中/等待外部任务，再备份正式 SQLite、执行一次性迁移和完整性校验；
- 在同一发布切换中启用 V2.1 canonical 路由，并删除 `FilmList.vue`、`DramaDetail.vue`、`FilmCreate.vue` 和旧 DramaCanvas；
- 删除旧制作写 API、重复编排、旧状态机、旧合片真相、旧画布保存协议和 1.x/1.1 新导出；
- 保留数据安全所需的一次性迁移器与迁移报告，不保留旧页面回退、feature flag 或长期双写；
- 完成数据库/媒体对账、性能、UI、真实任务恢复和端到端成片验收；
- 更新用户文档、迁移说明和唯一 `CHANGELOG.md`。

## 20. 验收标准

### 20.1 端到端用户验收

1. 新建项目后，用户能按四阶段完成一集；
2. 未批准输入可浏览下游，但不能误触高资源批量生成或外部计费任务；
3. 修改剧本只失效受影响场次；
4. 切换 Look 后，所有自动 prompt/H3 草稿正确显示 stale；
5. 人工 prompt 不被静默覆盖；
6. 替换角色状态后，只重编引用它的镜头；
7. 每镜可生成多个候选、质量检查、选用并保留历史；
8. 能从已选视频选稳定帧作为下一镜引用；
9. Provider 不支持该引用时，UI 明确阻止或降级；
10. 一个分镜可合法只含一个时段，也可在 Provider 支持时包含多个时段和场景资产；
11. 分镜不会为了填满 15 秒或 Provider 最大时长而机械扩写剧情；
12. 计划时长与实际请求时长有差异时，生成前明确显示；
13. PromptStyleGate 能阻止风格块缺失、重复、负向条款遗漏和快照不一致，不执行结果级风格分析；
14. 时间线可裁剪、排序、变速、转场并保存版本；
15. Picture Lock 后后期绑定正确版本；
16. 超分失败可恢复或跳过，基础合片不丢失；
17. 导出 manifest 可追溯到剧本、Look、资产、prompt、候选和时间线版本。

### 20.2 自动化验收

- stage 状态机和乐观锁；
- dependency invalidation 矩阵；
- Look hash → H3 stale；
- asset version → affected shot package only；
- reference manifest → Provider slot snapshot；
- Provider capability 表单/后端同源；
- PromptStyleGate 对图片、普通视频、Omni、H3 和提交快照进行逐字合同校验；
- 单时段、多时段、多场景与离散 Provider 时长的 preflight；
- candidate adopt → current video projection；
- adopted artifact → continuity frame → next shot payload；
- timeline Picture Lock immutability；
- color/post/upscale 顺序；
- 后端重启后的任务恢复；
- 一次性本地数据备份、迁移、校验和失败恢复；
- 前端窄屏/长集性能，不能重新出现 1.1 万行页面级全量重渲染。

### 20.3 性能目标

- 200 镜项目切换阶段不加载所有视频二进制；
- 镜头轨虚拟列表；
- 单镜更新不触发整集深度 watch；
- 媒体缩略图懒加载；
- stage summary 使用聚合 API；
- 候选和历史分页；
- 任务轮询聚合为 episode/job stream，避免每卡独立轮询。

## 21. 风险与对策

| 风险 | 对策 |
|---|---|
| 一次性迁移丢失本地数据 | 迁移前数据库备份；事务内转换；数量/引用/文件 hash 对账；失败自动恢复 |
| 抽象层过多导致开发慢 | Phase 1 只统一必要的 resolver/fingerprint/capability 与迁移事实源，逐步扩展 |
| 用户被批准流程拖慢 | 允许软浏览、批量批准和已批准 Recipe |
| 高级画布再次形成旁路 | 所有写操作必须走 V2 API，不允许直接改 metadata |
| Prompt 编译黑盒 | 保存业务意图、编译输出、引用快照和 diff |
| 自动连续性造成错误传播 | 稳定帧作为候选引用；依赖链可见、可断开 |
| 自动调色损伤肤色 | 镜头匹配与创意 Look 分层，Color Gate 人工复核 |
| Provider 快速变化 | 能力契约由配置/适配器提供，UI 不硬编码 |
| 大项目状态计算慢 | 保存依赖边和 fingerprint，增量失效 |
| 测试环境不稳定 | 固定 Node 22.22.3，与 better-sqlite3 ABI 对齐 |

## 22. 备选方案

### 方案 A：继续扩展 FilmCreate

优点是短期快；缺点是状态、渲染和认知复杂度继续增长，无法形成明确批准和版本边界。否决。

### 方案 B：完全照搬 RH剧场四页 UI

优点是外观成熟；缺点是会丢掉 LocalMiniDrama 已有的 H3、canonical slots、Director artifact 和可恢复云超分优势。否决。

### 方案 C：以 DramaCanvas 为唯一主界面

优点是灵活；缺点是普通用户难以知道下一步和完成条件，节点图不天然等于生产状态机。画布应作为高级视图，不作为唯一入口。否决。

### 方案 D：四阶段壳 + 单一数据模型 + 高级画布

兼顾普通制作路径、复杂项目和现有能力复用，是推荐方案。

## 23. 首个内部可验收里程碑

第一个内部可验收的 V2.1 里程碑不是“把四个页面都画出来”，而是：

1. ProductionStudio Shell；
2. Script Stage + Script Gate；
3. Bible Stage 中的 Look Approval 和角色/场景/道具批准状态；
4. H3/自动资产 prompt 的 Look 版本依赖和 stale 可见性修复；
5. 在数据库副本上完成一次性迁移、校验、断电恢复和失败恢复演练；
6. 完整的 stage/approval/invalidation 自动化测试。

该里程碑不独立上线、不接管正式本地数据。它通过内部验收后，为后续分镜和短片阶段建立稳定地基；只有 Phase 1～5 全部通过，才允许在 Phase 6 执行正式数据迁移、路由切换和旧实现删除。

## 24. 关联文档

以下五份 P0 附件是本母稿的权威细化；出现状态、作用域、迁移归属、并发、交互流程或验收冲突时，附件中的精确表格优先于本母稿的概述性文字：

- `docs/superpowers/specs/2026-09-08-production-studio-v2.1-legacy-feature-migration-matrix.md`（旧能力保留、合并、重设计、删除与一次性迁移条件）
- `docs/superpowers/specs/2026-09-08-production-studio-v2.1-state-gate-truth-table.md`（阶段/对象/任务/Gate/waiver 真值表）
- `docs/superpowers/specs/2026-09-08-production-studio-v2.1-scope-version-concurrency-invalidation.md`（Look/资产作用域、版本、并发、失效、Picture/Post/Delivery）
- `docs/superpowers/specs/2026-09-08-production-studio-v2.1-interaction-flow-contracts.md`（六类来源、外部协作、配置、网页生成、音频、任务、迁移与危险操作状态表）
- `docs/superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md`（按功能包和阶段放行的 E2E 验收矩阵）
- `docs/superpowers/specs/schemas/shot-package-v2.1.schema.json`、`episode-package-v2.1.schema.json`、`external-ai-result-v2.1.schema.json`（机器可验证协议合同）；`test-version-contract.ps1` 固定验证字符串 `"2.1"` 通过、数值 `2.1` 与其他字符串版本拒绝

- `docs/research/localminidrama-product-baseline/README.md`（当前产品基线、对标包与建议阅读顺序）
- `docs/research/localminidrama-product-baseline/localminidrama-as-is-prd.md`（现有产品完整事实基线）
- `docs/research/localminidrama-product-baseline/localminidrama-screenshot-catalog.md`（13 张本地实机截图证据目录）
- `docs/research/localminidrama-product-baseline/runninghub-localminidrama-gap-matrix.md`（功能、流程、交互、UI、数据与技术全量差异矩阵）
- `docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md`（本母稿的页面级交互与 UI 细化）
- `docs/research/localminidrama-product-baseline/production-studio-v2.1-prototype.html`（可点击目标原型）
- `docs/superpowers/plans/2026-09-08-production-studio-v2.1-phase-0.md`（历史计划，待按六阶段方案重写，不可执行）
- `docs/superpowers/plans/2026-09-08-production-studio-v2.1-phase-1.md`（待按无双轨、一次性迁移决策重写，不可执行）
- `docs/superpowers/plans/2026-09-08-production-studio-v2.1-project-hub-and-episode-import.md`（历史计划，待按当前协议和外部 AI 主入口重写，不可执行）
- `docs/research/RunningHub-RH剧场短剧制作全流程交互调查-2026-09-05.md`
- `docs/research/style-prompt-pipeline-industry-review-2026-09-04.md`
- `docs/LibTV青城夜巡人视频制作流程调查说明.md`
- `docs/LibTV秋人视频制作流程调查说明.md`
- `docs/分镜视频关键帧衔接机制调查说明.md`
- `docs/Zealman-MiniMax-H3-U06工作流导出与RTX超分调查说明.md`
- `docs/superpowers/specs/2026-09-05-canonical-storyboard-reference-pipeline-design.md`
- `docs/superpowers/specs/2026-09-05-cloud-video-upscale-postprocess-design.md`
- `docs/superpowers/specs/2026-09-08-runninghub-informed-production-studio-redesign-design.md`（竞品调研增量摘要，非平行架构）
- `docs/superpowers/specs/2026-09-08-runninghub-style-system-redesign-design.md`（风格体系专项规格）
- `docs/research/runninghub-product-design/README.md`

两份 V2.1 HTML 原型用于评审视觉层级、页面跳转和局部领域规则，是“目标态交互演示”，不是业务闭环或实现验收证据。功能完成度只能以 E2E 验收矩阵要求的真实 API、SQLite 事实、任务/Provider 行为和 UI 操作证据判定。

## 25. 最终建议

LocalMiniDrama 的下一大版本应该从“功能很多的生成页面”升级为“本地优先、有批准、有版本、有引用、有成片状态的制作系统”。

推荐决策是：

```text
保留现有生成与 Director 能力
  + 修复 Look/H3/Prompt 失效正确性
  + 建立四阶段 Production Studio
  + 用 Shot Package 和 Reference Manifest 统一镜头输入
  + 用候选/时间线/Picture Lock 统一成片输出
  + 用 Color Gate 和 Delivery Gate 收口质量
```

完成这次改造后，替换自定义风格、人物、场景、道具或模型将成为“改选当前使用项，在剧集确认时更新精确快照并增量重编”的操作，而不是人工追着每条提示词和每个旧缓存修改。这是该版本最关键的产品价值。
