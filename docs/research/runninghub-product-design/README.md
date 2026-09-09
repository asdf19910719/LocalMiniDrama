# RunningHub RH剧场产品设计参考包

本目录把 2026-09-05 至 2026-09-08 的 RunningHub RH剧场实机调查，整理成可直接服务于 LocalMiniDrama 产品迭代的参考材料。

LocalMiniDrama 自身的现状 PRD、13 张本地实机截图、逐项对标矩阵、V2.1 页面级交互规范和可点击目标原型，统一收录在 [LocalMiniDrama 产品基线与 RunningHub 对标包](../localminidrama-product-baseline/README.md)。本目录只描述竞品，不作为 LocalMiniDrama 的目标架构。

## 建议阅读顺序

1. [RunningHub 逆向产品需求文档](./runninghub-reverse-prd.md)：平台定位、信息架构、业务对象、状态机、全站模块与验收标准。
2. [RunningHub 交互与 UI 规范](./runninghub-interaction-ui-spec.md)：页面骨架、四阶段工作台、组件行为、视觉语言与状态反馈。
3. [LocalMiniDrama 对标改造蓝图](./localminidrama-transformation-roadmap.md)：哪些能力可复用、哪些需要重构，以及建议的分期边界。
4. [截图目录](./screenshot-catalog.md)：本地截图编号、对应页面、可验证事实与使用边界。
5. [可交互流程原型](./runninghub-workflow-prototype.html)：桌面端四阶段工作台的可点击参考原型。

完成竞品阅读后，继续查看：

6. [RunningHub × LocalMiniDrama 全量差异矩阵](../localminidrama-product-baseline/runninghub-localminidrama-gap-matrix.md)：逐项判断竞品领先、本项目领先、共同缺口和不采纳项。
7. [Production Studio V2.1 交互与 UI 规格](../localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md)：把对标结论落实到本项目页面和状态规则。
8. [Production Studio V2.1 可点击原型](../localminidrama-product-baseline/production-studio-v2.1-prototype.html)：本项目目标工作台，而非 RunningHub 复刻。

## 证据等级

- **A｜实机确认**：在登录态页面直接看见或操作到，且未触发付费、删除、发布或保存。
- **B｜多页面交叉确认**：由两个以上页面、任务记录或样例项目相互印证。
- **C｜前端资源佐证**：页面生产构建中的组件、事件、字段或接口能证明能力存在，但未验证最终服务效果。
- **D｜设计推断**：根据 UI、公开字段和行业流程推导，必须在实现前再次验证。

文档中的价格、模型名称、风格数量和能力开关均是调查时点快照，不应硬编码为长期业务规则。

## 2026-09-08 外部分析交叉核对

已再次对照《全站功能与商业化补全调查》和同目录 5 张截图。四阶段主流程、全站信息架构、商业化与合规能力此前已经覆盖；本次补强的是：

1. 在逆向 PRD 中增加输入格式、模型/画幅/分辨率、工具箱配额、重绘限制、任务账单字段等“实测约束快照”。
2. 在交互与 UI 规范中补齐开始创作、项目、资产库、工具箱、视频重绘、消耗看板和账户面板的页面规则。
3. 在截图目录中增加尺寸、文件大小、SHA-256 与单张截图的证据边界。

即时价格、模型名称、配额和水印文案仍只作为 A 级时点证据；LocalMiniDrama 的实现应从能力配置、计费服务或运行环境读取。

## 原始调查与专题材料

- [全站功能与商业化补全调查](../RunningHub-RH剧场全站功能与商业化补全调查-2026-09-08.md)
- [短剧制作全流程交互调查](../RunningHub-RH剧场短剧制作全流程交互调查-2026-09-05.md)
- [RunningHub 风格业务调研](../../../业务整理/RunningHub风格业务调研.md)
- [RunningHub 风格全链路分析](../../../业务整理/RunningHub与当前项目风格模块全链路分析.md)
- [RunningHub 真实生成案例分析](../../../业务整理/RunningHub真实生成案例分析.md)

## 调查边界

本轮未执行任何会扣费的图片、视频、音色、重绘或合成任务；未修改剧本、确认下游、删除资产、充值或发布作品。已验证的是产品结构、可见交互、字段、门禁、历史任务和既有生成结果，不是各模型的质量评测。
