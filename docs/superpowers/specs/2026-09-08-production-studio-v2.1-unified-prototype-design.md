# Production Studio V2.1 统一可交互原型设计

日期：2026-09-08
状态：已确认，作为逐页交互评审与原型实施的权威输入

逐页确认的结论、理由和落实状态持续记录在[逐页交互评审决策记录](./2026-09-08-production-studio-v2.1-page-review-decision-log.md)。该记录用于追踪评审决定，不取代本文、架构母稿或交互规格。

## 1. 目标

将现有“项目与剧集中心原型”和“Production Studio 原型”合并为一个单入口、单状态模型、可直接定位页面与场景的完整交互原型。原型必须让所有用户可见功能都可到达、可查看，并能演示主操作和关键异常状态；评审从项目列表开始，按页面和业务流程逐项确认。

统一原型用于确认信息架构、页面职责、操作反馈、状态呈现和流程衔接，不连接真实 API、SQLite、文件系统、浏览器自动化或付费 Provider，也不代表产品代码已经实现。

## 2. 已确认的设计决策

1. 权威入口为单个 HTML，不使用 iframe 拼接。
2. 使用同一全局应用壳、hash 路由和内存状态模型。
3. 原有两份原型保留为历史设计证据，但 UI 规格、截图目录和评审入口统一指向新原型。
4. 迁移矩阵中的 52 项产品功能分别绑定稳定 `data-feature-id`，每项至少关联一个可达页面或浮层，以及一个可直接打开的演示场景。
5. 高风险或多状态能力必须能切换正常、空、阻断、失败和恢复状态；纯说明性能力可以使用只读详情页。
6. 场景位置编码进 URL hash，复制地址即可复现相同页面和状态。
7. 全局任务中心、来源查看、历史、生成 Sheet 和确认对话框属于统一壳，不为每个页面重复实现。
8. 不在原型中伪造真实生成、迁移、删除、费用扣除或数据库写入；所有执行结果明确标注“原型模拟”。

## 3. “每个功能可展示查看”的完成定义

一个用户可见功能只有同时满足以下条件才算被原型覆盖：

- 能从正常导航、页面动作或“功能覆盖导航器”到达；
- 页面显示功能入口、前置条件、主动作、取消或返回动作；
- 执行动作后有明确的进行中、成功或失败反馈；
- 存在阻断条件时，展示原因和至少一个安全恢复动作；
- 能通过固定 URL 场景复现；
- 在覆盖清单中关联产品功能编号、交互合同章节和 E2E 验收编号；52 个功能编号必须全部覆盖且不得重复；
- 原型测试验证路由、覆盖关联和关键状态转换，而不只验证静态文案存在。

“可展示查看”不等于实现真实后端。媒体生成、文件读写、任务调度、迁移、清理和外部网页协作均使用确定性模拟数据。

## 4. 信息架构与路由

统一入口文件：

```text
docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html
```

路由使用 `#/...`：

| 路由 | 页面职责 |
|---|---|
| `#/projects` | 项目列表、搜索、筛选、排序、空状态和继续工作 |
| `#/projects/new` | 新建项目壳与六类首集来源 |
| `#/projects/import` | 当前协议项目归档导入 |
| `#/projects/:projectId/overview` | 项目级下一步、四阶段聚合、Project Look 和可操作待处理项 |
| `#/projects/:projectId/bible` | 世界观、连续性事实、项目级角色/场景/道具 |
| `#/projects/:projectId/episodes` | 剧集列表、六类来源、外部来源和单集导入 |
| `#/projects/:projectId/assets` | 项目资产、跨集使用位置与个人库往返 |
| `#/projects/:projectId/data` | 归档、导入记录、审计、回收站、迁移和清理 |
| `#/projects/:projectId/episodes/:episodeId/script` | 剧本草稿、差异、确认和失效提示 |
| `#/projects/:projectId/episodes/:episodeId/assets` | Project Look、角色状态（含条件使用的人物音色）、场景资产和道具 |
| `#/projects/:projectId/episodes/:episodeId/storyboard` | 场次、分镜、时段、图片候选、连续性和 Prompt 编译 |
| `#/projects/:projectId/episodes/:episodeId/cut` | 整集镜头审核、候选修复/重拍、稳定帧、时间线、声音和交付 |
| `#/library` | 本地个人资产库 |
| `#/quick-create` | 自由创作/快速创作 |
| `#/canvas` | 高级画布入口与上下文恢复 |
| `#/settings/ai` | Provider、模型映射、凭据、并发和导入导出配置 |
| `#/settings/general` | 常规设置、存储位置和外观 |

场景通过查询参数表达，例如：

```text
#/projects?scenario=empty
#/projects/7/episodes?scenario=external-ai-waiting
#/projects/7/episodes/1/storyboard?scenario=provider-blocked
#/projects/7/episodes/1/cut?scenario=retake-failed
#/settings/ai?scenario=credential-expired
```

## 5. 全局应用壳

所有页面共享：

- 左侧全局导航：项目、个人资产库、快速创作、高级画布、设置；
- 顶部上下文：项目、剧集、当前位置、离线/本地状态；
- 全局任务按钮：运行、排队、需要处理、失败、完成；
- 主题切换和原型帮助；
- 功能覆盖导航器：按页面、业务流程、能力编号和验收编号检索；
- 场景切换器：正常、空、加载、阻断、失败、恢复和成功；
- 原型标识：始终说明当前数据为模拟数据，不会调用远端服务或写入本地项目。

功能覆盖导航器不是产品功能，使用与产品 UI 不同的“原型工具”视觉标识；截图时允许折叠。

## 6. 页面覆盖范围

### 6.1 Project Hub

- 项目列表、卡片/列表视图、搜索、状态筛选、排序；
- 最近工作位置、四阶段可审计进度、任务和阻塞；
- 新建项目、项目归档导入、空项目恢复；
- 项目详情五个固定分区；
- 剧集列表、来源、空白集、恢复最近位置；
- 六类项目/剧集来源的完整入口和成功落点。

### 6.2 导入与外部协作

- 当前协议项目归档导入/导出及历史 ZIP 拒绝；
- 直接 V2.1 单集 JSON 五步导入；
- 非空目标拒绝、资产匹配冲突、事务失败恢复和幂等重复提交；
- 外部 AI 的 `context_ready → package_ready → waiting_external → validating_result → importing`；
- ZIP/单文件任务 JSON、资产摘要变化和只读来源记录；
- 想法/剧本 AI、小说分章、已有视频来源的完整向导状态。

### 6.3 Production Studio

- 剧本：编辑、保存、差异、确认、失效和恢复；
- 设定：Project Look、角色及状态（含人物音色）、场景资产、道具、候选点击使用和本集资产集合确认；音色只有被本集音频策略实际要求时进入 Gate；
- 分镜：场次、Shot、Timed Segment、资产绑定、图片候选、连续性、能力预检、PromptStyleGate、正式逐镜视频生成、候选比较/采用和批量操作；
- 短片：整集镜头审核、候选修复/局部重拍、稳定帧、Picture Lock、时间线、声音所有权、后期和交付；
- 标准模式和高级画布的明确切换与返回位置。

### 6.4 全局与维护能力

- 任务中心全部状态和 `canPause/canResume/canSkip/canCancel/canReorder` 动作；
- ChatGPT 网页生成会话的登录、等待、恢复、结果回填和重绑；
- AI 基础/高级配置、连接测试、导入导出、批量换 Key、模型映射和调度；
- 个人资产库双向复制、固定版本、更新比较和发布；
- 首次升级、备份、迁移 journal、失败恢复和人工恢复；
- 软删除、恢复、候选归档、空间清理和迁移备份清理。

## 7. 状态与交互模型

统一模型至少提供：

```js
buildPrototypeRouteRegistry()
buildFeatureCoverageIndex()
parsePrototypeLocation(hash)
formatPrototypeLocation(routeId, params, scenarioId)
getPageModel(routeId, params, scenarioId)
transitionPrototypeState(state, action)
```

`buildPrototypeRouteRegistry()` 返回路由、页面标题、导航归属、合法场景和渲染器标识。`buildFeatureCoverageIndex()` 返回功能编号、入口、场景、关联文档和 E2E。`transitionPrototypeState()` 只执行确定性内存转换，刷新页面可由 URL 恢复初始场景。

原有两个模型中的项目卡、剧集行、导入目标判断、时段拆分/合并/重排和 Provider 预检逻辑继续复用，不复制第二套规则。

## 8. 关键交互规则

1. 页面内只有一个主动作；次级动作进入菜单、抽屉或次级页面。
2. 弹窗中不再叠加弹窗；深层步骤在同一容器切换，或转为完整页。
3. 高风险确认不可点击遮罩关闭，必须明确取消和确认后果。
4. `waiting_external`、任务状态、内容状态、Gate 和 blocker 分开展示。
5. 直接 JSON 与外部 AI 结果复用同一五步导入组件，但保留不同来源说明和任务绑定。
6. 分镜页提交首次正式视频任务并管理唯一候选组；短片页只以修复入口补充候选，不反向修改已确认的剧情结构，也不建立第二套候选。
7. 导入、迁移、删除、清理和远端生成均在执行前显示写入/费用/影响摘要。
8. 原型中的删除和清理只能改变模拟状态，并提供一键恢复场景。

## 9. 逐页评审方式

每轮只确认一个页面或一条完整流程，固定检查：

1. 页面职责和目标用户；
2. 入口、出口和返回位置；
3. 信息层级与默认视图；
4. 主动作、次级动作和批量动作；
5. 空、加载、离线、阻断、失败、恢复和成功状态；
6. 与任务、Gate、版本、费用和数据写入的边界；
7. 键盘、焦点、关闭和危险操作规则；
8. 对应功能覆盖项和 E2E 验收。

评审顺序从项目列表开始，随后是新建项目与六类来源、项目详情五分区、剧集创建/导入、Studio 四阶段和全局/维护能力。每页确认后同步更新规格、统一原型、覆盖索引和相关测试。

## 10. 文件结构

| 文件 | 职责 |
|---|---|
| `production-studio-v2.1-full-prototype.html` | 单入口应用壳、页面模板、通用浮层和渲染绑定 |
| `production-studio-v2.1-full-prototype-model.js` | 路由、场景、覆盖索引和跨页状态转换 |
| `production-studio-v2.1-full-prototype.test.cjs` | 路由、覆盖完整性、状态转换和两份旧模型复用测试 |
| `production-studio-v2.1-project-hub-prototype-model.js` | 现有 Project Hub 领域演示规则，继续复用 |
| `production-studio-v2.1-prototype-model.js` | 现有分镜/Provider 演示规则，继续复用 |

HTML 不引入构建工具或远程依赖，保持双击可打开和静态截图能力。

## 11. 验收标准

- 只有一个权威原型入口；原有两份 HTML 标为历史证据；
- 所有产品页面均可通过产品导航到达；52 项产品功能均可通过覆盖导航器定位并绑定稳定 `data-feature-id`；
- 六类来源、十类交互合同、四阶段 Studio 和全局维护能力都有演示场景；
- 正常、空、阻断、失败和恢复场景可用 URL 直接复现；
- 任何按钮不再只显示无法继续验证的笼统 toast；说明性按钮必须打开对应只读详情；
- 自动覆盖检查为 52/52，且覆盖索引不存在未知功能编号、重复 `data-feature-id`、未知路由、未知场景或未知 E2E 编号；
- 原有 12 项模型测试继续通过，统一原型新增测试全部通过；
- UI 规格和截图目录明确区分“原型覆盖”与“真实产品实现”；
- 原型文件、测试和文档通过 `git diff --check`。
