# Production Studio V2.1 全量产品、交互与制作链评审

> 首次评审：2026-09-09
> 本次复核修订：2026-09-09
> 评审对象：V2.1 架构母稿、P0 附件、统一原型、逐页决策记录、交互与 UI 规格、52 项迁移矩阵和 78 项 E2E 矩阵。
> 边界：本报告评审的是产品规格和交互原型，不代表业务代码、数据库迁移、Provider、FFmpeg 或真实媒体链路已经实现。

## 1. 复核结论

V2.1 的产品方向、领域模型和信息架构正确；在本轮补齐剩余页面、修正 Cut 门禁并统一迁移权威口径后，**规格与原型执行关口通过，可以进入 `writing-plans`，但尚未进入产品代码开发**。

原报告提出的问题并非全部错误，其中关于原型占位、关键接缝、Cut 门禁、基础合片母版和超分决策持久化的判断，在当时状态下成立；这些问题现已在规格和统一原型中修复。原报告把 V2.1 的一次发布切换判定为与“既定渐进迁移”冲突，以及要求隐藏自由创作/高级画布，则依据了较旧的 `docs/vnext` 范围口径，与后来用户确认的 V2.1 权威方案冲突，需要撤销。

| 原评审结论 | 复核判定 | 当前处理 |
|---|---|---|
| 产品方向正确，Local Provider、H3、精确引用和 Revision 模型是差异化 | 正确 | 保留 |
| 17 个注册页面只有 7 个完整、10 个占位 | 当时正确，现已过时 | 17/17 已有页面级原型；52/52 能力有稳定覆盖映射 |
| 外部 AI 导入、剧本确认、剧集资产快照缺交互接缝 | 当时正确，现已修复 | 六来源、五步导入、剧本 revision、资产 snapshot/Gate 已可交互展示 |
| Cut `6/9` 仍可 Picture Lock、编码等待仍可导出 | 正确且属于 P0 | 已禁用对应动作并显示 blocker 与恢复路径 |
| 需要基础合片母版并持久化超分跳过/成功/回退 | 正确 | 已加入 Base Composite、Post Revision 决策和 lineage |
| Phase 6 一次迁移/切路由/删旧实现是 Big Bang P0 冲突 | 不正确 | 当前权威决定正是 Phase 1～5 内部验证、Phase 6 一次性迁移与切换；安全来自备份、journal、事务、冻结、对账和恢复，不来自运行期双轨 |
| 必须保留 V1/V2 Feature Flag、Adapter、双写和旧路由回退 | 不正确 | 与已确认“V2.1 直接替换、无运行期双轨”冲突，不采纳 |
| 快速创作和 Canvas 首发应隐藏 | 部分错误 | 两者是已确认保留的可选辅助工具；须复用统一数据和任务，不得恢复旧孤岛实现 |
| 完整 2D、完整 3D、视频重绘不应伪装为 V2.1 已完成产品 | 正确 | 继续排除；高级画布只提供共享领域模型的高级投影 |

## 2. 当前权威口径

当文档出现冲突时，依次采用：

1. 用户最新明确确认的逐页决策；
2. [V2.1 架构母稿](../superpowers/specs/2026-09-05-production-studio-v2-design.md)及其 P0 附件；
3. [逐页交互评审决策记录](../superpowers/specs/2026-09-08-production-studio-v2.1-page-review-decision-log.md)；
4. [交互与 UI 规格](../research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md)；
5. `docs/vnext/*` 中未同步的新旧范围研究。

迁移权威方案为：Phase 1～5 只进行内部开发、自动测试和影子验证，不接管正式路由；Phase 6 冻结任务，创建备份和 migration journal，在事务中迁移并对账，统一切换 canonical route，删除旧页面与旧 API 实现。V2.1 不保留运行期 V1/V2 feature flag、双写、旧页面回退或旧 API 兼容层。断电、迁移失败和对账失败通过 journal、事务回滚、备份恢复与人工恢复流程处理。

这里仍可存在 Provider Adapter、外部 AI 确定性 Adapter 或导入格式 Adapter；它们是领域边界，不是 V1/V2 运行期兼容层，不能混为一谈。

## 3. 产品与 RunningHub 对比

V2.1 应继续借鉴 RunningHub 已验证的 Studio Shell、项目—剧集—阶段心智、分镜逐镜生成、候选比较、批量预检、成本靠近提交、整集审核与时间线；不复制云账户、钱包、社区、平台发布、具体品牌视觉和模型价格硬编码。

相对参考产品，V2.1 的关键优势是：

- 本地 SQLite、文件、FFmpeg 与可替换 Provider；
- API、ComfyUI、ChatGPT 网页和外部 AI 协作并存；
- Script、Asset Snapshot、Shot、Picture、Post、Delivery 多层 Revision；
- 人物/状态、场景/剧情状态/视图、道具/状态的精确引用；
- H3 可编辑草稿、fingerprint、Reference Manifest 和声音语义校验；
- Candidate 与 current/adopted 分离，历史不因改选被覆盖；
- Picture Lock、基础合片、超分回退与交付 lineage；
- 本地数据完整性、媒体重定位、迁移 journal 和 dry-run 清理。

仍需在产品开发阶段证明而不能由原型证明的能力包括：真实 Provider capability、任务恢复、文件 hash、事务导入、媒体引用保护、FFmpeg 基础合片/编码、Post/Delivery artifact 持久化和正式迁移恢复。

## 4. 17 个注册页面复核

| 页面 | 判定 | 已明确的页面职责与关键交互 |
|---|---|---|
| 项目列表 `projects` | 通过 | 默认卡片视图；整卡进入概览；唯一 CTA 恢复精确剧集/阶段；支持列表视图与异常状态 |
| 新建项目 `project-new` | 通过 | 最小字段建立可见项目壳，再复用六类首集来源；取消不静默删除 |
| 项目归档导入 `project-import` | 通过 | 只接受 project archive 2.1；展示 manifest、缺失媒体和空间；默认导入为新项目；失败零写入 |
| 项目概览 `project-overview` | 通过 | 项目级下一步、四阶段汇总、Look 和可操作 blocker；不复制剧集列表或活动流 |
| 项目设定 `project-bible` | 通过 | 外部 AI 上下文、Project Look、生产对象聚合；不是通用图片/视频 Prompt 来源 |
| 项目剧集 `project-episodes` | 通过 | 紧凑剧集列表、四阶段筛选、六类来源、外部 AI、五步导入、来源审计和可恢复归档 |
| 项目资产 `project-assets` | 通过 | 人物/场景/道具生产对象、状态/视图、图片/音色候选、生成模式、任务、使用位置和异常恢复 |
| 剧本 `studio-script` | 通过 | 场次导航、800ms 保存、恢复副本、版本/Diff、资产解析预览、确认 revision 与下游失效分离 |
| 剧集设定 `studio-assets` | 通过 | 本集引用对象选择、项目 current 差异、条件音色、不可变 snapshot 和进入分镜 Gate |
| 分镜 `studio-storyboard` | 通过 | 镜头/时段、分镜图、H3/Prompt、Reference Manifest、逐镜正式视频、候选采用和批量预检 |
| 短片 `studio-cut` | 通过 | 镜头审核、NLE-lite 时间线、声音/字幕、Picture Lock、基础合片、后期、编码和交付 |
| 个人资产库 `library` | 通过 | 搜索筛选、来源/许可/路径、固定版本引用/复制、离线恢复和引用保护 |
| 自由创作 `quick-create` | 有条件通过 | 可选旁路，复用 canonical job/media/candidate；不参与四阶段 Gate；产品开发不得复用旧孤岛数据链 |
| 高级画布 `canvas` | 有条件通过 | 共享命令与领域数据的高级投影；布局是视图状态；完整 2D/3D/重绘不在范围 |
| AI 配置 `settings-ai` | 通过 | 分层配置、密钥脱敏、用途映射、能力探测、导入冲突、网页会话/重绑 |
| 常规设置 `settings-general` | 通过 | 日常路径与创作默认值；路径离线和保存冲突；修复工具不混入本页 |
| 高级数据工具 `settings-data` | 通过 | 完整性、媒体重定位、迁移/恢复记录、受控物理清理；不占项目一级导航 |

“有条件通过”不表示还缺页面，而是实施时必须守住共享领域模型和范围边界。

## 5. App Shell 与通用交互复核

### 5.1 已通过

- 产品 Rail 与原型评审工具已分离；覆盖导航器、场景切换只属于原型。
- 项目详情只有概览、项目设定、剧集、资产四个一级分区；备份/恢复/删除在项目操作，高级修复在设置。
- 路由变化会关闭 route-scoped 临时覆盖层，避免确认层跨页面残留。
- 卡片、阶段格、待处理项、任务项都携带稳定目标，不复用模糊“最近位置”。
- Detail Drawer、Generation Sheet、Inspector 和高风险确认的职责已分离。
- Initial、Empty、Loading、Processing、Success、Error、Disabled、Partial、Stale、Unknown、Waiting External 均有可查看状态。
- 状态文案、图标和禁用原因共同表达，不只依赖颜色。

### 5.2 实施阶段仍需统一的横切合同

- 焦点回退、键盘路径、小屏全屏抽屉和拖拽替代操作需要在组件实现时统一验证；
- `dirty/saving/saved/save_failed/conflict` 应由同一保存状态组件表达；
- 多选范围、跨筛选全选、费用确认和部分成功应复用统一 Batch Preflight；
- 所有危险动作必须显示影响对象、写入边界、失败后的保留内容和唯一恢复动作；
- 所有百分比都必须带可信来源；无 Provider 进度时不得用前端计时伪造。

## 6. 完整制作链复核

```text
项目/空白剧集
  → 六类来源之一
  → 剧本草稿与 approved Script Revision
  → 本集设定选择与不可变 Asset Snapshot
  → 分镜/时段、图片、H3/Prompt、Reference Manifest
  → 逐镜正式视频任务 → Candidate → 用户采用
  → 短片镜头审核与 Timeline Revision
  → Picture Lock
  → Base Composite（基础合片母版）
  → Post Revision（技术匹配/Look/可选超分/字幕/混音）
  → 编码校验
  → Delivery Revision + manifest/hash
```

### 6.1 外部 AI 接缝

外部 AI 协作从项目设定或剧集来源进入：生成项目上下文，创建带 `package_id/assets_digest` 的任务包，用户在外部会话创作，选择 V2.1 Result JSON 后进入统一五步导入。导入只面向新剧集或空白剧集；资产匹配逐项确认；事务写入结构化草稿；不自动生成图片、视频或音频，也不产生远端费用。该流程与直接 Episode Package 共用目标保护和五步预览，但保留外部 package attempt 审计。

### 6.2 图片和资产接缝

项目资产负责人物状态、场景状态/视图、道具状态及图片/音色候选。生成或上传只追加候选；用户点击候选即设为该精确对象组合的 current，旧 current 留在历史。剧集设定只选择本集使用项，不复制项目资产编辑器；进入分镜时固定 version/hash。

### 6.3 分镜和视频接缝

分镜阶段承担首次正式逐镜视频生成：Shot/Segments、分镜图、H3 草稿、Prompt、引用、Provider capability、输出时长、费用和预计处理时间在提交前统一预检。生成成功只追加 Video Candidate，用户明确“使用这个候选”后才改变 adopted。短片读取同一候选事实源，负责整集审核、补救性重拍、时间线、后期和交付。

### 6.4 Gate 修正

- `6/9` adopted、存在运行中/失败的必需镜头时，Picture Lock 为禁用状态并列 blocker；
- Timeline clip 固定 candidate id，改 adopted 时必须选择是否替换时间线；
- Picture Lock 后任何画面修改派生新 revision；
- 编码校验为 waiting/failed 时导出禁用；
- Post 失败不删除 Base Composite；超分 skip/success/fallback 决策写入 Post Revision；
- 交付显示 Picture → Base Composite → Post → Delivery 的完整 lineage。

## 7. 52 项功能与 78 项 E2E

统一原型使用单一覆盖索引映射迁移矩阵中的 52 个唯一能力编号到 17 个注册页面，每项标记 `prototypeStatus=complete` 与 `productCodeStatus=not-developed`。高风险流程提供完整交互；普通功能至少提供入口、前置、正常/异常状态、恢复动作和成功落点。

52 项功能覆盖与 78 项 E2E 不是同一计数：一个页面可承载多个能力，一个能力可对应多个验收项；迁移、事务、并发、hash 和断电恢复等规则不应被伪造成独立 UI 页面。进入实施计划前应保持 52 个能力引用和 78 个唯一验收项的现有语义对应，不用“页面可点击”替代后端验收。

## 8. 实施优先级

规格与原型层面已无 P0 阻断。产品实现仍应按六阶段计划设置硬性准入：

1. **Phase 1：领域模型、数据库与迁移基础**——Revision、Candidate、Artifact、引用、任务 owner、journal、备份与恢复。
2. **Phase 2：项目/剧集/导入**——17 页 Shell 中的项目、剧集、六来源、外部 AI 与五步导入。
3. **Phase 3：剧本与资产**——剧本 revision、项目资产、个人库、剧集 snapshot/Gate。
4. **Phase 4：分镜与生成**——Shot/Segment、图片、H3、Reference Manifest、任务与候选。
5. **Phase 5：短片与交付**——审核、时间线、声音、Picture/Base/Post/Delivery 链。
6. **Phase 6：正式迁移与切换**——冻结、备份、journal、事务迁移、对账、路由切换、删除旧实现、失败恢复。

自由创作和高级画布可在核心四阶段稳定后实现，但属于已确认范围，不需要运行期 V1/V2 feature flag。完整 2D、完整 3D 和视频重绘不得混入这六阶段。

## 9. 准入标准与最终判定

进入 `writing-plans` 的条件现已满足：

- 17/17 注册页面均有页面级原型，不存在“路由有名但只有评审占位”的页面；
- 52/52 能力具有唯一覆盖映射；
- 六来源、外部 AI、五步导入、剧本确认、资产快照、逐镜生成、合片、超分和交付形成可操作链；
- Cut 的 Video/Picture/Delivery Gate 与默认 UI 一致；
- 基础合片和超分决策可追溯；
- 迁移口径与最新架构母稿一致，不再把旧渐进双轨假设作为阻断；
- 自由创作/Canvas 与排除的完整 2D/3D/重绘边界明确；
- 原型状态和产品代码状态始终分开表述。

最终判定：**架构方向通过；规格执行关口通过；统一原型评审通过；可以重写可执行的 V2.1 六阶段实施计划；产品代码开发尚未开始。**
