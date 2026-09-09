# RunningHub 参考下的 LocalMiniDrama 制作工作台重构设计

> 状态：竞品调研增量摘要，已并入 `2026-09-05-production-studio-v2-design.md` 的 V2.1 架构母稿。
> 使用方式：用于查阅 RunningHub 证据和快速理解；如有冲突，以 V2.1 架构母稿为准。

## 1. 目标

在不牺牲 LocalMiniDrama 本地优先、多 Provider、画布、H3、音频与可导出优势的前提下，将当前功能密集的制作体验重组为“剧本—设定—分镜—短片”四阶段工作台，使上游批准、资产版本、镜头引用、生成任务与成片版本可见、可恢复、可追溯。

本设计不要求复制 RunningHub 的品牌、素材、模型名、钱包或社区。参考对象是其生产流程和交互分层。

## 2. 研究依据

- [逆向产品需求](../../research/runninghub-product-design/runninghub-reverse-prd.md)
- [交互与 UI 规范](../../research/runninghub-product-design/runninghub-interaction-ui-spec.md)
- [LocalMiniDrama 改造蓝图](../../research/runninghub-product-design/localminidrama-transformation-roadmap.md)
- [截图目录](../../research/runninghub-product-design/screenshot-catalog.md)
- [既有全流程调查](../../research/RunningHub-RH剧场短剧制作全流程交互调查-2026-09-05.md)
- [全站与商业化补全调查](../../research/RunningHub-RH剧场全站功能与商业化补全调查-2026-09-08.md)

## 3. 设计原则

1. 项目和剧集是导航上下文，镜头是生成上下文，任务快照是审计上下文。
2. 保存草稿、确认基线、创建任务、选用候选和导出成片是五种不同业务动作。
3. 标准列表与自由画布是同一数据的视图，不拥有独立真相。
4. 模型能力和输入完整性在任务创建前校验，不能依赖 Provider 失败后解释。
5. 历史生成结果永不被配置变更静默覆盖；过期通过状态表达。
6. 迁移必须兼容旧 URL、旧项目和现有生成链路。

## 4. 目标架构

```text
EpisodeStudioShell
├─ ScriptStage
│  └─ ScriptRevision + Confirmation
├─ AssetStage
│  ├─ StandardAssetView
│  ├─ CanvasAssetView
│  └─ AssetDetailDrawer
├─ StoryboardStage
│  ├─ StorySceneRail
│  ├─ ShotInspector
│  ├─ TimedSegmentEditor
│  ├─ CandidateStage
│  └─ ShotRail
└─ CutStage
   ├─ EpisodePlayer
   ├─ EpisodeTimeline
   └─ FinalCutExport

共享领域服务
├─ StageProjection
├─ RevisionImpact
├─ AssetVersionResolver
├─ ReferenceRegistry
├─ ProviderCapabilityRegistry
├─ PromptCompiler
└─ GenerationSnapshotRepository
```

每个阶段只负责其视图和业务命令；生成任务、引用、风格和资产版本通过共享服务解析。

分镜阶段采用母稿已确认的方案 B：场次是剧本结构，现有 scene 是“场景资产”，分镜是一条 Provider 生成业务单元，内部包含 1～N 个时段，视频只是候选结果。15 秒等值只来自 Provider 能力，不作为固定拆分长度或必须填满的目标。

## 5. 数据设计

### 5.1 剧本修订

新增 `episode_script_revisions`，字段至少包含 episode、revision、content、scene_index、status、content_hash、confirmed_at。旧 `episodes.script_content` 在迁移期作为当前修订投影。

### 5.2 资产版本

新增统一版本接口，但首期不强制合并所有表。`character_variants`、场景图片和道具图片通过适配器投影为：assetType、assetId、versionId、kind、label、businessState、approvalStatus、selectedGenerationId。

### 5.3 引用绑定

以现有 canonical reference 为底层，为每个镜头保存稳定 slot、role、assetVersionId、status、displayIndex 与 snapshot。`@图片N` 只由任务创建时的注册表生成。

每个分镜的时段可分别绑定场景资产、人物状态和道具；分镜级 manifest 是各时段引用的稳定并集。旧 `scene_id` 在迁移期只投影为默认单时段的第一个场景资产引用。

### 5.4 生成快照

普通图片、普通视频和 H3 使用同一外壳：compiler/version、source、styleSnapshot、referenceSnapshot、finalPrompt、negativePrompt、provider/model/parameters、inputHash。H3 的不可变草稿继续作为严格子类型。

### 5.5 成片版本

新增 `final_cuts` 或等价投影，保存镜头候选清单、排序、裁剪、转场、音频计划、字幕、水印、渲染参数、任务和输出媒体。

## 6. 关键数据流

### 6.1 剧本确认

```text
保存草稿
 → 比较当前确认版本
 → 生成场次/资产/分镜影响摘要
 → 用户确认
 → 建立新 confirmed revision
 → 将受影响下游标记 stale
```

### 6.2 生成任务

```text
用户选择目标与模型
 → 解析项目/剧集/资产/镜头上下文
 → 编译风格和业务提示词
 → PromptStyleGate 校验风格块、负向条款和提交文本一致性
 → 建立引用注册表
 → 能力与输入预检
 → 固化不可变快照
 → 创建 Provider 任务
 → 轮询并保存候选
 → 用户选用/确认
```

本流程不增加结果级风格视觉检查，不对图片做 VLM 判断，也不对视频抽帧验证色彩、材质、光照或角色渲染方式。

### 6.3 成片导出

```text
读取每镜选用候选
 → 验证缺失、过期和音频策略
 → 固化 FinalCut 输入清单
 → 合成/字幕/混音/水印
 → 保存版本与媒体
```

## 7. 错误处理

- 修订冲突：拒绝覆盖，返回当前版本和待合并差异。
- 引用缺失：任务创建前阻止；只有用户明确接受时可使用 text fallback。
- 模型不支持：指出不兼容参数和可选模型/规格。
- Provider 失败：保存输入快照、外部任务 ID、失败阶段和是否计费。
- 轮询超时：标记 unknown/running，不直接当作失败；后台继续协调。
- 结果保存失败：与生成失败分开，允许从 Provider 结果恢复。
- 导出缺口：列出具体镜号并支持跳转。

## 8. 兼容与迁移

1. 旧项目启动时生成 revision 0 和隐式 master asset version，不改原始内容。
2. `/film/:id` 与 `/film/:id/canvas` 保留一个版本周期，按 episode 参数跳转新阶段。
3. 第一阶段只记录 shadow snapshot，不改变 Provider 请求；对照测试通过后再切换编译器。
4. 画布布局数据保留，节点查询改为共享领域投影。
5. 导入导出协议新增可选版本字段；旧包继续兼容。

## 9. 测试策略

- 阶段投影：旧/新项目在各缺口下的阶段与禁用原因。
- 修订：保存不传播、确认传播、冲突和 stale 计算。
- 资产版本：主版本/派生版本、删除保护和跨集复用。
- 引用：确定性顺序、状态、显示编号和 Provider 输入一致性。
- 能力预检：真人、参考数量、首尾帧、时长、分辨率和音频。
- 快照：golden prompt、哈希、不变性和重试模式。
- 短片：缺失候选、未选用、排序、裁剪、音频和导出版本。
- 兼容：旧 URL、旧数据库、项目 ZIP 和现有 H3 草稿。

## 10. 范围边界

首轮实现不包括团队权限、云端钱包、社区发布、完整 3D 编辑器和第三方模型价格同步。轻量站位/构图预演可以复用现有 Director 与画布能力，真实计费只在 Provider 配置明确提供时显示。

## 11. 验收结果

完成后，用户无需查看数据库或日志即可回答：当前集在哪个阶段；为什么下一阶段不可用；当前剧本哪个版本驱动下游；每个资产与镜头引用哪一版本；生成前使用什么模型与参数；生成后提交的最终提示词和参考映射；任务为何失败；成片由哪些候选组成。
