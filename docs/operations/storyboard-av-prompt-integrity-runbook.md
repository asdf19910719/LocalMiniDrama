# 分镜视听信息与 H3 音频策略实施说明

**实施状态：** 已完成

**实施日期：** 2026-09-06

**设计文档：** `docs/superpowers/specs/2026-09-05-storyboard-av-prompt-integrity-design.md`

**实施计划：** `docs/superpowers/plans/2026-09-05-storyboard-av-prompt-integrity.md`

## 1. 结论

原问题不应简单归因于“JSON 是外部 AI 生成的”。真正原因是两条主流程过去没有共享同一份视听数据合同：导入可以接收到部分 `audio_description`，但页面投影、全能提示词上下文、H3 草稿和合成器分别只读取自己的字段子集，信息会在中间边界静默丢失。

当前实现已经把两条流程统一到 `Canonical AV Contract → Generation Context → H3 Draft → Prepared Generation → Audio-aware Merge`。外部包明确提供的声音不会再因为进入项目而消失；故事流程也不会仅凭情绪临时猜测是否开启 BGM，而是先保存剧集级结构化策略，再由全能提示词和 H3 消费。

## 2. 两条主流程的最终字段流

### 2.1 外部 AI JSON 包

```text
JSON 校验/兼容迁移
  → episode.audio_plan / production_profile
  → storyboard.audio_description / transition / production_metadata
  → Canonical Repository 原子写入
  → 正常项目 API 回读校验
  → Generation Context
  → 全能提示词 + H3 草稿
```

关键映射：

| 外部字段 | 项目权威字段 | 后续使用 |
|---|---|---|
| `audio_plan` | `episodes.audio_plan` | H3 BGM 与语言所有权、最终混音 |
| `audio_description` | `storyboards.audio_description` | 全能提示词、H3 逐镜声音、混音审计 |
| `transition` | `storyboards.transition` | H3 连戏提示、视频 `xfade`、音频边界、字幕时间 |
| `composition` | `storyboards.layout_description` | 全能提示词和 H3 视觉上下文 |
| `voice_profile` | `characters.voice_style` | 人物声音语义 |
| 人物 `appearance/image_prompt/negative_prompt` | `characters.appearance/polished_prompt/negative_prompt` | 人物基础视觉锚点与负向约束 |
| 声音参考资产 | 有序参考槽位快照 | `<Audio N>` 与提交资产顺序校验 |
| `is_primary`、情绪、光线、景深 | 对应分镜字段 | 分镜规划和提示词上下文 |

旧包只有逐镜 `non_diegetic_music`、没有顶层策略时，兼容层确定性地转换为 `per_segment`；明确有音乐的镜头变为 `override`，其余镜头变为 `mute`。完全没有明确音乐信息时仍默认 `none`，不会因题材或情绪擅自生成 BGM。

### 2.2 故事梗概生成分镜

```text
故事梗概 → 剧集剧本 → 人物/场景/道具
  → AI 分镜适配器
  → Canonical Repository
  → 剧集级一次性音频规划
  → Generation Context
  → 全能提示词 + H3 草稿
```

AI 分镜返回的 `bgm_prompt`、`sound_effect(s)`、`layout_description/composition`、`transition`、`emotion_intensity`、`is_primary`、光线和景深统一经过同一个映射与保存入口。`per_segment + planning=ai` 时，规划器一次读取整集分镜并写入同一个主题连续键和每镜 cue；不会逐镜孤立判断 BGM。

## 3. 当前 BGM 模式

| 模式 | H3 每段 `non_diegetic_music` | 最终合成 |
|---|---|---|
| `none` | `N/A` | 不叠加整集 BGM，保留片段环境声/音效 |
| `episode_track` | `N/A` | 叠加一条项目媒体目录内的 BGM，执行淡入淡出、混音和响度标准化 |
| `per_segment` | 按整集母题和本镜 cue 生成 | 不再叠加整集 BGM；片段音频随视觉转场交叉淡化，硬切边界按配置淡入淡出 |

`episode_track` 当前需要可执行的本地/媒体库音频路径。项目不会假装已调用不存在的第三方音乐生成器；未配置或文件不存在会在合成阶段明确失败，而不是静默输出无 BGM 成片。

制作页“剧集音频策略”支持上述三种模式、主题提示、连续键、音量/淡入淡出、对白与旁白所有权，以及逐镜环境声、动作音效、剧情内音乐、对白处理、music cue 和逐镜所有权覆盖。

## 4. H3 编译机制

1. 从分镜、剧集、场景、道具、相邻镜头和有序参考槽位构建完整 Generation Context。
2. 视觉正文仍按 `universal_segment_text > video_prompt > polished/image prompt > description` 选择，但声音、转场和引用作为结构化侧车继续存在，不会被正文优先级裁掉。
3. 编译为 H3 官方结构；对白、旁白、剧情内音乐和同步声音桥进入逐镜正文，`overall_soundscape` 只汇总环境声、物理音效和非语言人声。
4. 确定性校验结构顺序、时长、BGM 策略、语言所有权、原文对白、引用标签和资产顺序；任何未提供资产对应的 `<Picture N>/<Video N>/<Audio N>` 都会失败，已提供的图像/音频标签必须同时出现在定义段和正文。
5. 跨语言环境声/音效通过 coverage manifest 评审，且证据只允许来自事件指定的 `target_field`。状态为 `covered / missing / uncertain`；`missing` 阻止生成，`uncertain` 进入 `needs_review`，必须用当前提示词哈希确认后才能生成。
6. 草稿指纹覆盖业务提示词、完整视听上下文、参考图/音频、尺寸时长、视频配置、工作流和技能版本；任一来源变化都会使旧草稿过期。

所有项目分镜生成入口（制作页、Canvas、批量与 Director 候选）都调用 prepared API：非 H3 直接保持原流程；H3 复用新鲜草稿或自动编译，再把草稿 ID 和已校验资产顺序交给严格底层。自由创作没有项目分镜，因此会明确拒绝必须绑定分镜的 H3 工作流，不影响非 H3 Provider。

## 5. 声音所有权与最终混音

对白和旁白分别支持：

- `h3_native`：由 H3 原声负责，后期不重复叠加对应 TTS。
- `post_tts`：H3 不生成可闻的对应语言内容，后期只添加一次 TTS。
- `none`：两端均不生成该语言层。

普通合成和 Director 合成都保留输入视频已有音轨。每个片段都建立成对的视频/音频链；无音轨片段补等长静音；视觉叠化使用同一边界的 `xfade`/`acrossfade`。后期对白、旁白和整集 BGM 在基轨上混合并进行动态压低与响度标准化，不再用 TTS 替换 H3 环境声。字幕起点和后期语言轨都按转场重叠后的输出时间线放置。

页面上的“烧录对白/旁白”只表示启用对应后处理能力，不再隐式取得声音所有权。合成器逐镜解析剧集默认值和 `speech_override`：只有实际 owner 为 `post_tts` 的片段才读取或生成该层 TTS；`h3_native` 与 `none` 始终不叠加。普通硬切只有在片段音轨拓扑一致且没有声音桥/淡化时才使用复制快路径；`audio_bridge`、逐段 BGM 淡化或有声/无声混合都会进入滤镜时间线。

## 6. 字段锁定和重新规划

用户 PATCH 的叶子字段写入 `field_state`，标记 `source=manual, locked=true` 并增加 revision。故事分镜重新生成会先按 `source_key`、其次按镜号匹配原行，保留行 ID 并只刷新未锁定叶子；最终才软删除本次结果中不存在的旧镜头。“恢复 AI 管理”只解除指定字段锁，不删除当前值。旧标量字段继续支持显式 `field: null` 清除，缺失字段不更新；结构化临时 `field_overrides` 支持音频和转场的深合并。

## 7. API

- `PATCH /api/episodes/:id/audio-plan`：部分更新剧集音频策略，可携带 `unlock_fields`。
- `POST /api/episodes/:id/audio-plan/plan`：用户明确触发整集 AI 音频规划。
- `POST /api/videos/prepared`：统一准备并创建一个视频任务。
- `POST /api/videos/prepared/batch`：保持输入顺序并隔离单项失败。
- `POST /api/storyboards/:id/h3-prompt-draft/confirm-semantic-review`：按提示词哈希确认不确定语义评审。

BGM、对白和旁白本地路径在保存和 FFmpeg 执行前都限制在项目媒体存储根目录内，并在文件存在时检查符号链接解析后的真实路径。

## 8. 验证范围

- 外部包导入、正常 API 投影、导出再导入往返。
- 故事 AI 分镜映射、整集规划、人工字段锁和重新规划。
- 全能提示词上下文、结构化临时覆盖和上下文指纹。
- H3 六段结构、BGM 三模式、语言所有权、参考图/音频和跨语言 coverage。
- 所有项目生成入口与自由创作边界。
- 普通/Director 视频音频时间线、缺失音轨静音、转场重叠与字幕时间。
- 真实 FFmpeg 频谱测试：基轨 220 Hz、后期对白 440 Hz、整集 BGM 880 Hz 均保留；`per_segment` 不误加整集 BGM；`h3_native` 不重复添加 TTS。

本地验证命令：

```powershell
cd backend-node
npx -y node@22 --test test/*.test.js

cd ..\frontweb
node --test test/*.test.js
npm run build
```

当前机器系统 Node 24 与已安装的 `better-sqlite3` ABI 不一致，因此后端测试固定使用 Node 22；这属于本地运行时约束，不是业务测试失败。

2026-09-06 最终验收结果：后端 746 项、前端 209 项全部通过，前端生产构建通过，`git diff --check` 无空白错误。测试未调用外部付费 AI、TTS、BGM 或视频生成服务。

## 9. 实施前审查吸收结论

附件审查提出的 3 个阻断问题和 4 个回归风险均成立并已吸收，不是仅修改文档：

- 对白/旁白所有权分别持久化并由 H3 编译、严格门禁和最终混音共同执行，消除 H3 原声与后期 TTS 双声。
- Director 与普通合成都建立音视频成对时间线，保留 H3 基轨，覆盖视觉叠化、音频交叉淡化、混合音轨拓扑和字幕重叠时间。
- `field_state` 提供叶子级来源、锁、revision；重新生成分镜也遵守锁，而非只在音频规划器中遵守。
- H3 声音分类按逐镜正文/声景/非剧情配乐分区，跨语言内容由目标字段受限的模型评审处理，确定性校验不假装理解翻译等价性。
- 制作页、Canvas、批量和 Director 候选全部使用 prepared 入口；FreeCreate 明确限制无分镜 H3。
- 旧标量显式 `null` 清除语义保留，并有回归测试。

后续代码复审发现的角色级负向提示词投影、H3 悬空引用、分镜再生成锁丢失、语音路径穿越和 Direct postproduction `audioPolicy` 形同虚设，也已在同一轮修复。
