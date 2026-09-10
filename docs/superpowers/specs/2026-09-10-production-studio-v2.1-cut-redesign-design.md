# Production Studio V2.1 短片页重设计（审片 + 合片单屏工作台）

日期：2026-09-10
状态：已确认（替代 2026-09-08 交互规格第 9 章与 STORY-CUT-001 中的三标签 NLE 方案）
范围：`production-studio-v2.1-full-prototype.html` + `-model.js` + `.test.cjs`，及交互规格第 9 章、决策记录、E2E 验收矩阵 §H/§I、设计评审的同步。产品代码（frontweb）不在本次范围。

## 1. 背景与定位

短片页的本质是**成片前的"验收间" + 一键合片出口**，不是精剪工作台：

- **看**：逐镜审看（大播放器）+ 连续播放（观众视角检查节奏与衔接）；
- **补**：发现坏镜头 → 回分镜页修复（沿用 `secondary-repair` 定位）；
- **合**：按分镜顺序一键合成整集（带声音策略：保留原声 + 整集 BGM + 旁白 TTS——这是本项目强于 RunningHub 的能力）；
- **出**：导出 MP4（可选 SRT）。

旧方案把成片页当成专业 NLE + 交付流水线（四轨时间线、声音归属矩阵、字幕编辑器、七步后期链、Picture/Post/Delivery 三层版本、17 种异常场景），与个人创作者"剪辑决策已在分镜阶段完成"的工作流不符，是用户判定"功能复杂"的根源。RunningHub 短片页实测（`docs/research/_artifacts/runninghub-survey-2026-09-08/04-短片页-镜头时间线.png`）验证了"审片 + 合片"单屏即可承载该阶段。

## 2. 单屏布局（无标签页）

```
┌ 页头：阶段导航（剧本 → 设定 → 分镜 → 短片）＋ 异常状态条（仅异常场景显示）
├ 工具栏：场次 ▾ · 镜头 x/y · x/y 已完成 ‖ 连续播放 · 生成成片（主按钮，硬门禁）
├──────────────────────────────┬────────────────┤
│ 大播放器（整页最大区域）              │ 成片设置（右栏）      │
│ · 逐镜审看：上一镜/播放/下一镜          │ · 整集 BGM：关/开     │
│ · 连播模式：按镜头顺序连播已完成镜头      │ · 旁白 TTS：开/关     │
│ · 来源标注：候选 A · 用于本镜 /          │ · 字幕烧录：关/开     │
│   基于旧分镜图（沿用手语）              │ · 超分：关/开（可选）   │
│ · 「回分镜修复此镜」                  │ · 完成度与门禁说明     │
├──────────────────────────────┴────────────────┤
│ 成片结果条：生成中进度(可取消) | 成片 vN 预览播放器 · 导出 MP4 / SRT · 历史版本 │
├───────────────────────────────────────────────┤
│ 底部镜头时间线：复用分镜页镜头轨（缩略 + 状态着色 + 场次筛选），点击切镜          │
└───────────────────────────────────────────────┘
```

## 3. 保留的契约

- **软进入 + 硬门禁**：镜头未全部完成也能进页审片；「生成成片」要求全部镜头"用于本镜"或有效豁免，否则禁用并展示 x/y 与缺失/失败清单。
- **候选指针在分镜页**：短片页只读消费分镜的采用结果，本页不提供改选候选；镜头来源变化（基于旧分镜图）在播放器与时间线上沿用"需确认旧视频"手语。
- **合成是可恢复任务**：提交后显示进度、可取消（`cancel-requested` 保留记录）；失败保留设置与中间结果，按原设置重试。
- **成片版本**：每次合成产生新版本（成片 v1、v2…），历史可回看；页面不展示 Picture/Post/Delivery 谱系。
- **默认输出 MP4**；SRT 为可选项。

## 4. 移除与降级

| 移除项 | 处理 |
|---|---|
| 三标签（检查镜头/剪辑成片/导出） | 单屏工作台 |
| 四轨时间线剪辑（裁剪/变速/转场/拖拽重排/撤销修订） | 整体移除；镜头顺序调整回分镜页（结构更新/导入） |
| 声音归属矩阵（逐段原声/AI 配音/静音 + 冲突阻断） | 简化为合片设置：保留原声 + 整集 BGM 开关 + 旁白 TTS 开关；归属冲突降为设置内一条提示 |
| 字幕编辑器 | 移除；字幕 = 烧录开关 + 导出 SRT |
| 七步后期链展示（调色/规格/水印/响度/编码） | 内部执行；UI 只显示"生成成片"任务进度；超分为设置可选开关 |
| Picture Lock / Picture/Post/Delivery revision 谱系 | 页面只见"成片版本 vN"；门禁语义并入「生成成片」按钮状态 |
| 导出向导（清单/QC 报告） | 内联导出 MP4 + 可选 SRT |
| 场景 17 种 → 7 种 | 保留 loading、empty、blocked、stale、composing、compose-failed、exported |

## 5. 模型层要点

- `page.layout = ['review-player', 'compose-settings']`；
- `page.review`：mode（single/play-all）、playbackState、shots（含 status/tone/candidateId/stale）、currentShot（来源标注）、completed/total；
- `page.compose`：settings（bgmStrategy: none/episode-track、narrationTts、subtitleBurn、upscale）、gate（canCompose/blockers）、activeTask、result（version/fileName/durationLabel/resolution/canExport/exported）、history；
- 新命令：`selectCutScene` / `selectCutShot` / `selectCutShotByStep` / `toggleCutPlayAll` / `updateCutComposeSetting` / `composeEpisode` / `completeEpisodeCompose` / `cancelEpisodeCompose` / `exportCutResult`；
- 删除命令与状态机分支：`adopt-cut-candidate` / `edit-cut-clip` / `save-cut-timeline` / `decide-upscale-failure`；
- 修复入口为导航：跳转 `studio-storyboard?shot=<id>`，不在本页改写分镜数据。

## 6. 验收口径（同步到 E2E 矩阵 §H/§I）

- 短片页 HTML 不再出现：多轨时间线/变速/转场、声音归属矩阵、字幕编辑器、Picture Lock、后期链步骤、Delivery Gate、清单/QC 报告。
- 短片页必须出现：大播放器 + 上一镜/下一镜、连续播放、镜头时间线（全镜平铺、状态着色）、成片设置（BGM/旁白/字幕烧录/超分）、生成成片（门禁）、成片版本与历史、导出 MP4/SRT、回分镜修复。
- A-T01（时间线编辑）整体移除；A-T03/T04 后期链内部化（只验任务语义）；A-AU02 归属矩阵简化为混音策略；A-AU04 混音参数降为后续 P2。
