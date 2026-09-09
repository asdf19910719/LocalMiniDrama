# LocalMiniDrama 产品基线与 RunningHub 对标包

本目录把 2026-09-08 的代码、数据库结构、自动化测试和本地实机界面调查，整理为 Production Studio V2.1 的产品基线与设计输入。它回答四个不同问题：

1. 当前产品已经有什么，真实主流程如何工作；
2. 当前界面和交互具体是什么样，结论由哪些截图支撑；
3. 与 RunningHub RH剧场相比，逐项差在哪里、哪些应借鉴、哪些不应照搬；
4. V2.1 每个目标页面如何布局、交互、反馈和验收。

本目录不是新的架构母稿。唯一架构母稿仍是 [Production Studio V2.1 下一大版本设计](../../superpowers/specs/2026-09-05-production-studio-v2-design.md)。本包负责补齐其 As-Is、证据、竞品差异和页面级交互细节。

## 建议阅读顺序

1. [当前产品 As-Is PRD](./localminidrama-as-is-prd.md)：定位、信息架构、业务对象、业务流程、功能树、状态与已知限制。
2. [本地实机与目标态截图目录](./localminidrama-screenshot-catalog.md)：13 张 As-Is 实机截图、13 张 V2.1 目标态原型截图及其证据边界。
3. [RunningHub × LocalMiniDrama 全量差异矩阵](./runninghub-localminidrama-gap-matrix.md)：按完整生产链逐项对比，并映射到 V2.1 决策和优先级。
4. [Production Studio V2.1 交互与 UI 规格](./production-studio-v2.1-interaction-ui-spec.md)：应用壳、四阶段工作台、任务抽屉、候选对比、异常态和响应式规则。
5. [旧版功能迁移总表](../../superpowers/specs/2026-09-08-production-studio-v2.1-legacy-feature-migration-matrix.md)、[三层状态与 Gate 真值表](../../superpowers/specs/2026-09-08-production-studio-v2.1-state-gate-truth-table.md)、[作用域/版本/并发/失效规范](../../superpowers/specs/2026-09-08-production-studio-v2.1-scope-version-concurrency-invalidation.md)、[关键交互流程合同](../../superpowers/specs/2026-09-08-production-studio-v2.1-interaction-flow-contracts.md)、[E2E 验收矩阵](../../superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md)：开发前必须共同遵守的五份 P0 权威附件；协议实现同时必须使用 [Shot Package](../../superpowers/specs/schemas/shot-package-v2.1.schema.json)、[单集制作包](../../superpowers/specs/schemas/episode-package-v2.1.schema.json) 与[外部 AI 回流](../../superpowers/specs/schemas/external-ai-result-v2.1.schema.json)三份机器合同。
6. [项目与剧集中心可点击原型](./production-studio-v2.1-project-hub-prototype.html)：演示可审计阶段状态、六类项目/剧集来源、五步制作包导入、资产冲突和非空剧集拒绝。
7. [Production Studio V2.1 可点击原型](./production-studio-v2.1-prototype.html)：演示 `剧集 → 场次 → 分镜 → 时段`、单/多时段编辑、逐时段多资产绑定、计划/请求时长、Provider 能力阻断、PromptStyleGate、外部来源查看，以及“分镜只编译、短片正式生成视频”的阶段边界；原型状态模型见 [交互测试](./production-studio-v2.1-prototype.test.cjs)。
8. [Phase 0 正确性地基历史计划](../../superpowers/plans/2026-09-08-production-studio-v2.1-phase-0.md)：不可执行，待按六阶段直接替换方案重写。
9. [Phase 1 Studio Shell 与 Gate 历史计划](../../superpowers/plans/2026-09-08-production-studio-v2.1-phase-1.md)：不可执行，旧双轨与兼容前提已取消。
10. [项目中心与单集导入历史计划](../../superpowers/plans/2026-09-08-production-studio-v2.1-project-hub-and-episode-import.md)：不可执行，待按 V2.1 当前协议和外部 AI 主入口重写。
11. [RunningHub 产品设计参考包](../runninghub-product-design/README.md)：竞品逆向 PRD、UI 规范、截图和可交互参考原型。

## 文档权威关系

| 文档 | 回答的问题 | 权威范围 |
|---|---|---|
| V2.1 架构母稿 | 下一版本为何这样设计、核心领域模型与分期是什么 | 目标架构、数据模型、状态机、迁移原则 |
| As-Is PRD | 当前代码和界面实际是什么 | 当前事实基线 |
| 差异矩阵 | 为什么要改、优先改什么 | 竞品差异与产品决策追踪 |
| 交互与 UI 规格 | 目标页面具体如何工作和呈现 | 页面级交互、组件状态、视觉与验收 |
| 截图目录 | 结论由哪些本地实机证据支撑 | 调查时点的视觉证据 |

截图目录中的 13 张 As-Is 图片属于事实证据；13 张 V2.1 原型图片属于目标设计说明，不能据此宣称业务功能已经实现。

如内容冲突，当前事实以代码、迁移和最新实机复核为准；目标总纲以 V2.1 架构母稿为准；状态、作用域、迁移归属、并发、关键交互与验收以五份 P0 权威附件为准；页面细节以交互与 UI 规格为准，但不得绕过上述领域模型和批准/失效规则。三份 JSON Schema 是协议字段、类型和未知字段策略的唯一机器合同。

## 证据等级

- **A｜本地实机确认**：在本地运行页面直接看到或操作到，且有截图或可复现路径。
- **B｜代码与接口确认**：路由、组件、API、服务或数据迁移能直接证明能力存在。
- **C｜测试或数据样例确认**：自动化测试、样例项目或持久化数据能印证行为。
- **D｜设计推断**：根据现有能力和行业流程推导；只可作为设计输入，不能写成已实现事实。
- **U｜未验证**：需要真实 Provider、付费生成、多人账户或发布链路才能验证。

每项关键结论尽量标明证据等级。截图只能证明调查时点的可见界面，不证明模型质量、费用、并发稳定性或远端服务行为。

## 调查环境与边界

- 调查日期：2026-09-08。
- 本地前端：`http://localhost:3013`；本地后端：`http://localhost:5679`。
- 实机样例：项目 `7`、剧集 `7`，《凌晨两点的客房服务》，10 个分镜。
- 覆盖页面：项目列表、项目详情、制作页、画布、AI 配置、自由创作、媒体库、浅色与深色模式。
- 未触发会产生费用的图片、视频、TTS、超分或外部网页生成任务。
- 未删除项目、发布内容、修改账户配置或覆盖用户资产。
- 多人协作、云端审批、公开发布与商业计费不是当前本地产品的已实现范围。

## 使用方式

在开始实现某个阶段前，按以下顺序核对：

```text
V2.1 母稿中的领域规则
  → 差异矩阵中的决策与优先级
  → 页面级交互/UI 规格
  → As-Is PRD 中的复用点和兼容边界
  → 对应截图中的当前问题
```

计划、调研和原型不写入根目录 `CHANGELOG.md`。只有功能已经实现并验证后，才在 `[未发布]` 中记录用户可感知的变化。
