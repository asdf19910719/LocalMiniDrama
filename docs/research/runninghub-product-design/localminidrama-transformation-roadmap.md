# LocalMiniDrama 对标 RunningHub 的改造蓝图

## 1. 结论

LocalMiniDrama 不需要复制 RunningHub 的云端计费外观，也不应推翻已经形成的生成能力。真正需要改造的是产品骨架：把当前“功能很多的超长制作页 + 独立画布 + 分散任务面板”收敛为以剧集阶段、资产版本、镜头引用和生成快照为核心的生产工作台。

当前项目已有明显优势：本地 SQLite、完整项目导入导出、多 Provider、自定义 API、角色状态、画布工作流、首尾帧、H3 不可变草稿、统一任务状态、Director 候选、TTS/BGM/字幕/合片、云端超分与外部 AI 制作包。改造重点是让这些能力在一个一致的信息架构中可见、可理解、可恢复。

## 2. 能力对照

| 维度 | RunningHub 成熟做法 | LocalMiniDrama 现状 | 目标 |
|---|---|---|---|
| 顶层流程 | 剧本/设定/分镜/短片阶段工作台 | FilmCreate 长页 + 独立 Canvas | 四阶段路由与共享阶段头部 |
| 批准语义 | 保存与确认分离 | 多以内容存在判断完成 | 修订、确认、stale 传播 |
| 资产 | 主版本 + 变装/衍生 | 角色状态较强，场景/道具较弱 | 统一 AssetVariant 模型 |
| 标准/自由 | 卡片和节点画布同源 | 列表/画布已有但导航割裂 | 同一 API、同一状态、可互换视图 |
| 镜头编辑 | 三栏检查器 + 时间轨 | 分镜卡中叠加多个面板 | 镜头聚合工作台 |
| 引用 | `@` 芯片 + 素材槽 + 状态 | canonical reference 已有底层 | 在 UI 暴露用途、版本和健康状态 |
| 提示词 | 分时码、引用、快照 | 普通/H3 路径并存 | 统一 compiler + snapshot |
| Provider | 控件随能力变化 | 已有模型配置，能力校验分散 | capability registry + preflight |
| 候选历史 | 每镜历史与选用 | Director candidate groups | 主流程统一候选/选用语义 |
| 成片 | 独立短片审片阶段 | 合片入口分散 | 全集审片、缺口定位、导出版本 |
| 任务 | 价格、状态、任务 ID、消费 | 任务状态已统一，无统一成本 | 本地成本/资源预估与输入审计 |
| 素材复用 | 官方/项目/我的素材 | 全局/本剧素材库已有 | 统一来源、快照和版本 |

## 3. 目标信息架构

建议保留现有 URL 兼容跳转，新增：

```text
/
├─ /projects                         项目列表
├─ /projects/:projectId              项目详情/剧集与媒体
├─ /projects/:projectId/episodes/:episodeId/script
├─ /projects/:projectId/episodes/:episodeId/assets
├─ /projects/:projectId/episodes/:episodeId/storyboard
├─ /projects/:projectId/episodes/:episodeId/cut
├─ /projects/:projectId/episodes/:episodeId/assets/canvas
├─ /library                          全局/项目/本剧素材
├─ /toolbox                          自由生成
└─ /settings/ai                      AI 配置
```

路由只表达工作上下文，不表达某个弹窗。角色/场景/道具详情使用可深链接的抽屉状态或子路由，刷新后仍能恢复。

## 4. 目标业务对象

### 4.1 EpisodeRevision

新增剧本修订与确认，不直接替换现有 `episodes.script_content`：

```json
{
  "id": "rev_...",
  "episode_id": 12,
  "revision": 4,
  "content": "...",
  "scene_index": [],
  "status": "draft|confirmed|superseded",
  "confirmed_at": null,
  "content_hash": "sha256:..."
}
```

过渡期继续投影到旧字段，现有生成服务先只读使用“当前确认版本”。

### 4.2 AssetVersion

角色状态、场景变体和道具状态统一抽象：

```json
{
  "id": "av_...",
  "asset_type": "character|scene|prop",
  "asset_id": 21,
  "kind": "master|costume|time|weather|damage|pose|custom",
  "label": "雨夜湿发",
  "parent_version_id": null,
  "business_state": {},
  "approval_status": "draft|approved|stale",
  "selected_generation_id": null
}
```

兼容现有 `character_variants`，先通过适配器统一读取，不急于一次迁表。

### 4.3 ReferenceBinding

把现有 canonical reference slot 产品化：

```json
{
  "shot_id": 88,
  "slot_id": "ref_...",
  "role": "identity_master|character_state|scene_view|prop_state|look|composition_previs|continuity_frame|motion_reference|voice",
  "asset_version_id": "av_...",
  "status": "ready|stale|missing|text_fallback|incompatible",
  "display_index": 2,
  "snapshot": {}
}
```

### 4.4 GenerationSnapshot

统一图片、普通视频和 H3：

```json
{
  "compiler": "image|video|h3",
  "compiler_version": "1.0.0",
  "source": {},
  "style_snapshot": {},
  "reference_snapshot": [],
  "final_prompt": "...",
  "negative_prompt": "...",
  "provider": "...",
  "model": "...",
  "parameters": {},
  "input_hash": "sha256:..."
}
```

H3 草稿继续保持不可变；普通路径改为同样的快照契约。

## 5. 分期路线

### P0：导航与只读阶段状态

目标：先改变理解成本，不改变生成结果。

- 新增共享 `EpisodeStudioShell` 和四阶段路由。
- 从现有数据计算只读阶段状态与缺口。
- 旧 `/film/:id` 保持可用并跳转到默认阶段。
- 将任务抽屉、项目/剧集选择和生成环境状态放入共享壳。
- 为现有 E2E/单元测试增加路由和状态投影契约。

验收：用户进入任何阶段都能看到项目、集、阶段、缺口；旧链接不失效。

### P1：剧本修订与确认

- 新增 `episode_script_revisions` 和确认 API。
- 保存草稿不触发下游；确认生成差异与影响摘要。
- 给现有资产/分镜增加 `source_revision_id` 与 stale 计算。
- UI 明确区分保存、确认和重新提取。

验收：修改剧本后现有结果仍可查看，只有确认后才更新下游基线。

### P2：统一设定工作台

- 把角色、场景、道具卡片和详情抽屉抽为共享模块。
- 标准模式与 DramaCanvas 共用查询、选择和生成命令。
- 统一主版本/派生版本；复用现有角色状态迁移场景和道具。
- 风格选择器增加全局/局部来源、影响范围和版本信息。

验收：任一视图编辑后另一视图立即一致；资产结果可确认、过期和追溯。

### P3：镜头工作台与引用健康

- 将现有分镜卡重组为左检查器、中提示词、右结果、底轨道。
- 在 UI 展示 canonical reference role、来源版本、状态和 `@图片N` 映射。
- 把故事板、首/尾帧、站位/构图预演和视频候选分成明确产物角色。
- 增加模型能力注册表和生成前 preflight。

验收：用户无需查看日志即可知道某镜使用了哪些素材、为什么不能生成、生成后选用了哪一候选。

### P4：统一编译与任务快照

- 建立 `resolveStyle`、`compileImagePrompt`、`compileVideoPrompt` 和 `ReferenceRegistry`。
- 普通视频路径停止只追加 `Style:`，改为结构化编译。
- H3 与普通路径共享业务上下文与引用注册，只在 Provider 输出格式处分叉。
- 成功/失败任务均保存不可变输入快照、编译版本和错误阶段。

验收：相同快照可复现；重试时可明确选择原样重试或按当前配置重新编译。

### P5：短片审片与成片版本

- 新增短片阶段：播放器、完成度、连续播放、全片时间线和问题镜头定位。
- 复用 Director 的排序、裁剪、转场、候选与任意帧能力。
- 合片产生 `final_cut` 版本，保留片段清单、音频策略、字幕和渲染参数。
- 项目详情统一展示分镜视频、成片版本和下载。

验收：未完成/未选用镜头能阻止导出并一键定位；导出版本可回溯输入清单。

### P6：成本、素材与协作增强

- 本地 Provider 显示预计时间/显存/队列，云端 Provider 显示配置价格或未知提示。
- 统一全局/本剧/项目素材来源和导入快照。
- AI 项目助手复用现有外部 AI context，先只提供只读问答与差异草稿。
- 团队、发布和社区不属于本地版核心，除非后续产品战略明确需要。

## 6. 首批页面原型范围

建议第一轮只实现四个页面壳和一个共享抽屉：

1. 剧本页：分场大纲 + 正文 + 保存/确认。
2. 设定页：资产分类 + 标准/画布 + 资产卡。
3. 分镜页：检查器 + 分时码提示词 + 候选区 + 镜头轨。
4. 短片页：播放器 + 全集时间线 + 合片门禁。
5. 资产详情抽屉：版本、提示词、参考图、模型、任务和确认。

先用现有 API 投影数据，不在第一轮同时重写所有生成服务。

## 7. 不应照搬的内容

- 不引入云端钱包、充值和社区发布作为本地版主线。
- 不把 RunningHub 的模型名、价格和风格 ID 写死到本地代码。
- 不复制第三方视觉素材、文案和品牌；只吸收信息架构与交互原则。
- 不允许引用失效后静默退化为纯文本。
- 不用倒计时或自动推进替代真正的批准状态。
- 不建设完整 3D 编辑器作为首批需求；先把已有 layout/Director 能力产品化为轻量预演。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| FilmCreate 体量大、状态耦合 | 拆页时回归范围大 | 先抽共享 store/composable，再改路由和视图 |
| 旧数据没有修订/版本 | 无法直接套新状态机 | 迁移时生成 revision 0 与 master version |
| 普通/H3 编译规则不同 | 统一后可能改变提示词 | 先记录 shadow snapshot，对照 golden test 后切流 |
| 多 Provider 能力不完整 | 表单错误启用 | 未知能力默认保守禁用并允许管理员配置 |
| 画布和列表数据分叉 | 用户看到不一致 | 所有写操作收口命令 API，视图不保存私有副本 |
| 用户已有未提交改动 | 文档改造与当前开发冲突 | 分期按文件边界实施，避免一次性重写 |

## 9. 决策门槛

在进入实现计划前，应先确认：

1. 四阶段路由是否作为下一版默认主流程。
2. 是否以“剧本修订 + 确认”作为第一项数据迁移。
3. 角色状态、场景变体、道具变体是否接受统一 AssetVersion 抽象。
4. 是否保留当前 FilmCreate 为兼容视图一个版本周期。
5. 首批是否只实现只读成本/能力预检，不接云端真实计费。

确认这些边界后，再按 Superpowers `writing-plans` 拆成可独立验收的实施计划。
