# 分镜视听信息无损传递与 H3 音频策略设计

**状态：** 已确认
**日期：** 2026-09-05
**范围：** 外部 AI JSON 单集包导入、故事梗概生成分镜、全能提示词、H3 Ref2VA 编译、视频生成入口、整集合成与混音

## 1. 背景

项目已有单集制作包导入、故事生成、全能提示词、H3 草稿、候选视频和最终合成能力，但这些环节没有共享一份完整的视听数据合同。当前可验证的问题包括：

- 单集包导入能够把 `audio_description`、`transition` 和 `composition` 写入数据库，但剧集页面返回的分镜对象没有完整投影这些字段。
- 通用分镜更新接口允许更新 `layout_description`，但不允许更新 `audio_description` 和 `transition`。
- 全能提示词上下文读取布局和视觉信息，但不读取分镜声音、剧集 BGM 策略和转场。
- H3 草稿服务只读取 `universal_segment_text`、`video_prompt` 和 `duration`；存在全能提示词时，`video_prompt` 中原有的音效描述会被旁路。
- H3 编译只收到参考图 URL 数组，没有收到参考图的实体类型、角色、状态、构图说明和来源语义。
- 故事分镜 AI 已输出 `layout_description`、`bgm_prompt`、`sound_effect`、`emotion_intensity` 和 `is_primary`，但普通入库路径未完整保存。
- 场景提取返回 `atmosphere`，创建场景时未保存。
- 导入 Schema 接受 `voice_profile`，但导入实现明确忽略。
- H3 草稿门禁只在候选面板链路完整生效；部分单镜快捷生成、批量生成和一键生成仍可能直接调用视频接口而缺少草稿 ID。
- 合成后处理加入对白或旁白时把新音轨映射成唯一输出音轨，覆盖 H3 原有环境声、音效和逐段 BGM。

这些问题的共同原因是：每个环节都从数据库临时挑选自己关心的字段并拼成字符串，而不是消费统一的结构化生成上下文。

## 2. 与现有设计的关系

本设计增量扩展下列既有设计：

- `2026-09-02-single-episode-production-package-import-design.md`
- `2026-08-30-storyboard-generation-flow-design.md`
- `2026-08-27-h3-director-r2v-sage-workflow-design.md`
- `2026-08-25-unified-video-generation-provider-design.md`
- `2026-09-05-canonical-storyboard-reference-pipeline-design.md`

既有的导入原子性、参考图权威来源、H3 六段结构、H3 草稿门禁、Provider 选择和工作流治理保持不变。发生冲突时，本设计仅在以下方面覆盖旧规则：

1. H3 草稿来源指纹扩展到完整视听上下文。
2. 所有生产入口统一经过 H3 草稿准备服务。
3. 最终混音必须保留输入视频已有音轨。
4. 新增剧集级 BGM 模式和分镜级音乐提示。

## 3. 目标

1. 外部 JSON 和故事梗概两条流程最终生成同一种标准剧集/分镜对象。
2. `layout_description`、声音、配乐、转场、连戏、引用语义、负面约束和对白在任一环节都不静默丢失。
3. 支持无 BGM、整集后期 BGM、每段 H3 原生 BGM 三种策略。
4. 全能提示词继续作为可编辑业务提示词，但不承担全部结构化数据的持久化职责。
5. H3 编译器消费完整结构化上下文，并执行结构与语义双重校验。
6. 所有 H3 视频生成入口均使用有效、未过期的 H3 草稿。
7. 最终合成同时保留 H3 原声、对白、旁白和按策略启用的 BGM。
8. 兼容旧数据库、旧制作包、经典分镜模式和非 H3 视频 Provider。

## 4. 非目标

- 本阶段不接入新的第三方音乐生成 Provider。
- 不保证各个独立 H3 片段生成的音乐在音高、调性或节拍上达到完整作曲音轨级别的连续性。
- 不把多个分镜改为单次 H3 连续多段推理；仍使用现有单分镜候选模型。
- 不重构全项目所有资产和提示词体系，只统一本设计覆盖的两条主流程及其下游。
- 不自动修改既有用户数据的语义；旧文本只做可逆、无损的读取时归一化。

## 5. 核心架构

```text
外部 AI JSON ─→ Package Adapter ─┐
                                 ├→ Canonical AV Contract → Repository
故事梗概 ─→ Storyboard Adapter ──┘             ↓
                                      Generation Context Builder
                                                ↓
                               Universal Prompt / H3 Prompt Compiler
                                                ↓
                                  Prepared Video Generation Service
                                                ↓
                                        Merge + Audio Mix
```

`Canonical AV Contract` 是唯一业务数据合同；`Generation Context Builder` 是全能提示词和 H3 编译的唯一上下文来源；`Prepared Video Generation Service` 是 UI 所有视频生成操作的唯一入口。

## 6. 数据模型

### 6.1 剧集字段

给 `episodes` 增加两个 JSON TEXT 字段：

- `audio_plan`：剧集 BGM 与母带策略。
- `production_profile`：导入的生成模式、目标时长、参考图上限和顺序、制作备注等。

`audio_plan` 标准结构：

```json
{
  "version": 1,
  "bgm": {
    "mode": "per_segment",
    "prompt": "冷峻悬疑弦乐，低频持续音，整体逐步增强",
    "planning": "ai",
    "continuity_key": "episode_main_theme",
    "source_type": "generated",
    "local_path": null,
    "volume_db": -22,
    "ducking_db": -8,
    "fade_in_ms": 800,
    "fade_out_ms": 1200,
    "crossfade_ms": 500
  },
  "mastering": {
    "target_lufs": -14,
    "true_peak_db": -1
  },
  "provenance": {
    "source": "story_audio_planner",
    "updated_at": "2026-09-05T00:00:00.000Z"
  }
}
```

`bgm.mode` 只允许：

- `none`：H3 和后期均不生成非叙事配乐。
- `episode_track`：H3 的 `non_diegetic_music` 必须为 `N/A`；最终合成叠加一条剧集 BGM。
- `per_segment`：每个 H3 分镜按剧集母题和分镜 `music_cue` 生成配乐；最终合成不再叠加整集 BGM。

`source_type` 当前支持 `none`、`local_file`、`media_library` 和 `generated`。本阶段仅执行 `local_file`、`media_library` 与 H3 `per_segment`；`generated` 在 `episode_track` 下只保存意图，不自动调用不存在的音乐 Provider。

### 6.2 分镜声音字段

沿用 `storyboards.audio_description` JSON TEXT，但统一为：

```json
{
  "version": 1,
  "ambience": ["持续雨声", "远处偶尔传来雷声"],
  "sound_effects": ["急促脚步声", "金属门摩擦声"],
  "dialogue_treatment": "人物喘息明显，对白贴近收音",
  "diegetic_music": null,
  "silence": false,
  "music_cue": {
    "mode": "inherit",
    "prompt": null,
    "intensity": 0.7,
    "start": "continue",
    "end": "continue"
  },
  "raw_description": null,
  "extensions": {},
  "provenance": {
    "source": "package_import"
  }
}
```

`music_cue.mode` 允许：

- `inherit`：继承剧集母题。
- `override`：使用当前分镜明确提示。
- `mute`：当前分镜无非叙事配乐。
- `stinger`：当前分镜只生成明确的短促音乐强调。

`diegetic_music` 属于画面世界内声音，进入 `overall_soundscape` 或逐镜正文，不进入 `non_diegetic_music`。

### 6.3 分镜转场字段

沿用 `storyboards.transition` JSON TEXT，统一为：

```json
{
  "version": 1,
  "type": "cut",
  "duration": 0,
  "visual_description": null,
  "audio_bridge": {
    "mode": "carry",
    "duration_ms": 300
  },
  "extensions": {}
}
```

`cut`、`dissolve` 和 `fade` 由最终合成器执行。H3 只消费人物/构图结束状态和声音延续要求，避免生成端与后期重复转场。

### 6.4 其他增量字段

- `storyboards.is_primary INTEGER DEFAULT 0`：保存故事分镜 AI 已输出的主镜头标记。
- `scenes.atmosphere TEXT`：保存场景提取结果，避免只能把氛围隐式拼入图片提示词。

人物、场景、道具已有 `negative_prompt`；本设计修复映射和读取，不新建重复列。`characters.voice_style` 接收制作包的 `voice_profile`。

### 6.5 读写边界

新增 `storyboardAvContractService` 负责：

- `normalizeEpisodeAudioPlan(value)`
- `normalizeStoryboardAudioDescription(value)`
- `normalizeStoryboardTransition(value)`
- `parseJsonTextLosslessly(value)`
- `serializeCanonicalJson(value)`

数据库层统一序列化和反序列化。页面和提示词服务不得自行 `JSON.parse` 数据库原始值。

无法识别的对象字段存入 `extensions`。无法可靠拆分的旧字符串存入 `raw_description`；不得删除或猜测原义。

## 7. 来源优先级与覆盖规则

字段来源优先级固定为：

```text
用户手动修改
  > 外部 JSON 明确值
  > 故事流程 AI 明确输出
  > 剧集默认策略
  > 系统安全默认值
```

重新生成分镜时默认保留手工音频计划、分镜音乐提示、转场和参考槽位。只有显式选择“重新规划声音”或“重新生成全部制作数据”才覆盖对应字段。

AI 不得仅根据 `atmosphere`、`emotion`、题材或视觉描述自行开启 BGM。需要 AI 判断时，必须由整集音频规划器生成结构化结果、保存来源，再由 H3 消费。

## 8. 外部 AI JSON 流程

### 8.1 新入口结构

```text
validatePackage
  → normalizeEpisodePackage
  → mapPackageToCanonical
  → saveCanonicalEpisode
  → saveCanonicalStoryboards
  → verifyImportedProjection
  → buildImportReport
```

### 8.2 字段映射

| 制作包字段 | 权威落点 |
|---|---|
| `generation_profile` | `episodes.production_profile` |
| 顶层 `audio_plan` | `episodes.audio_plan` |
| `episode.duration_target_seconds`、制作备注 | `episodes.production_profile` |
| `characters[].voice_profile` | `characters.voice_style` |
| 人物/状态 `negative_prompt` | 对应人物或状态字段 |
| 场景 `atmosphere` | `scenes.atmosphere` |
| 场景 `negative_prompt` | `scenes.negative_prompt` |
| 道具 `negative_prompt` | `props.negative_prompt` |
| `composition` | `storyboards.layout_description` |
| `audio_description` | 规范化后写 `storyboards.audio_description` |
| `transition` | 规范化后写 `storyboards.transition` |
| `reference_role`、`framing_note` | 关联表原字段并进入参考槽位快照 |
| `is_primary` | `storyboards.is_primary` |

旧包中的 `audio_description.non_diegetic_music` 转换成当前分镜 `music_cue.override`。如果顶层没有 BGM 模式但至少一个分镜明确提供非叙事音乐，则确定性地把剧集设为 `per_segment`：提供音乐的镜头使用 `override`，其余镜头使用 `mute`。这只是执行包内显式要求，不根据情绪猜测；导入预览同时说明该兼容转换。只有完全没有显式音乐信息时才默认 `none`。

### 8.3 导入后验证

导入事务提交前用正常读取 API 的投影逻辑回读并比较：

- 分镜数量和顺序。
- 布局、声音、转场、对白和旁白。
- 人物状态、参考角色和构图说明。
- 人物声音风格。
- 剧集音频与制作策略。

验证失败则整个导入回滚。可兼容但未识别的字段进入导入报告，不作为成功日志静默略过。

## 9. 故事梗概生成流程

### 9.1 新流程

```text
故事梗概
  → 生成剧集剧本
  → 提取当前集人物/场景/道具
  → 生成标准分镜
  → 整集音频规划
  → 保存 Canonical AV Contract
  → 生成/润色全能提示词
```

故事分镜 AI 的输入必须包含当前集剧本、当前剧情段落、资产详细描述、负面提示、人物状态、声音风格、剧集画面风格、制作策略和前一镜头结束状态。避免把全剧所有无关资产以 ID/名称列表无差别塞入。

### 9.2 AI 分镜映射

`mapAiStoryboardToCanonical()` 必须保存：

- `layout_description`
- `bgm_prompt` → `audio_description.music_cue.prompt`
- `sound_effect` → `audio_description.sound_effects`
- `emotion`
- `emotion_intensity`
- `is_primary`
- `lighting_style`
- `depth_of_field`
- 人物和道具关联

所有增量 INSERT、最终覆盖 UPDATE 和降级保存路径调用同一个 `saveCanonicalStoryboard()`，不得继续维护多份字段数量不同的 SQL。

### 9.3 整集音频规划

`ensureEpisodeAudioPlan()` 在批量全能提示词生成前运行。单镜生成全能提示词时若计划缺失，也调用同一服务，但规划单位仍是整集。

当 `bgm.mode=per_segment` 且 `planning=ai` 时，规划器一次读取全剧集分镜顺序、时长、对白、旁白、情绪、静默和已有音效，输出一个剧集母题与每镜 `music_cue`。规划结果先持久化，再生成任何单镜提示词。

## 10. Generation Context

新增 `buildStoryboardGenerationContext(db, storyboardId, options)`，作为全能提示词和 H3 草稿的唯一上下文源。输出包括：

```json
{
  "version": 1,
  "storyboard": {
    "id": 101,
    "number": 3,
    "duration": 6,
    "visual_prompt": "...",
    "dialogue": "...",
    "narration": null,
    "layout_description": "...",
    "atmosphere": "...",
    "continuity_snapshot": {}
  },
  "episode": {
    "script_excerpt": "...",
    "production_profile": {},
    "audio_plan": {}
  },
  "audio": {},
  "transition": {},
  "references": [],
  "neighbors": {
    "previous": {},
    "next": {}
  },
  "negative_constraints": []
}
```

视觉正文优先级保持：

```text
universal_segment_text > video_prompt > description
```

该优先级只选择 `visual_prompt`，不得裁掉其余结构化侧车信息。

## 11. 全能提示词

全能提示词继续负责视觉、表演、相机、对白、旁白和 `@图片N` 的自然语言表达。声音、BGM、转场、引用语义仍作为结构化数据独立保存。

全能提示词生成器需要看到声音和配乐计划，以避免写出与音频策略冲突的内容，但输出不要求复制完整音频 JSON。用户手工编辑全能提示词不能删除或覆盖结构化声音计划。

`field_overrides` 扩展到 `audio_description` 和 `transition`，且只覆盖请求明确携带的键。空值是否清除必须通过显式 `clear_fields` 表达，避免未加载字段被回写成 `null`。

## 12. H3 编译

### 12.1 编译输入

H3 编译器接收完整 Generation Context，不再只接收：

```json
{
  "prompt": "...",
  "durationSeconds": 5,
  "referenceUrls": []
}
```

参考槽位同时携带 `entity_type`、`entity_id`、`entity_name`、`reference_role`、`variant`、`framing_note`、URL 和版本标识。实际发送图片顺序、`@图片N` 与 `<Picture N>` 必须一一对应。

有真实参考音频时生成 `<Audio N>`；仅有文字声音描述时使用稳定 `(Sx)` 说话人描述，不伪造音频引用。

### 12.2 H3 音频映射

`overall_soundscape` 汇总环境声、物理音效、对白处理、剧情内音乐和跨镜声音桥。

`non_diegetic_music` 映射规则：

| 条件 | 输出 |
|---|---|
| `audio_enabled=false` | `N/A` |
| `bgm.mode=none` | `N/A` |
| `bgm.mode=episode_track` | `N/A` |
| `bgm.mode=per_segment` + `music_cue=mute` | `N/A` |
| `bgm.mode=per_segment` + `inherit` | 剧集母题 + 当前强度与起止方式 |
| `bgm.mode=per_segment` + `override` | 当前镜头明确音乐提示 |
| `bgm.mode=per_segment` + `stinger` | 明确的短促音乐强调 |

### 12.3 语义校验

在六段结构校验之外增加：

- BGM 模式与 `non_diegetic_music` 一致。
- 环境声和标记为关键的音效没有遗漏。
- 对白与旁白原文完整保留，允许标记格式变化，不允许翻译或改写。
- 每个启用的参考槽位在定义和正文中引用正确。
- 不出现未提供的 `<Picture N>`、`<Video N>` 或 `<Audio N>`。
- 时间点单调递增，最后时间不超过请求时长。
- 后期转场不被重复描述为 H3 内部画面转场。
- `audio_enabled=false` 时不生成对白、环境声、音效和 BGM。

失败草稿保存 `validation_errors` 并标记 `invalid`，不得进入视频生成。

### 12.4 草稿指纹

来源指纹覆盖：

- 视觉正文、时长、尺寸和音频开关。
- 布局、对白、旁白、声音、配乐、转场和连戏。
- 剧集 `audio_plan` 与 `production_profile`。
- 参考槽位的顺序、语义、状态、资源版本和地址。
- 负面约束。
- 视频配置、工作流哈希和 H3 技能版本。

任何变化都会使旧草稿 `stale`。

## 13. 视频生成入口统一

保留底层 `createVideoGeneration()` 的严格 H3 草稿门禁，并新增高层 `prepareAndCreateVideoGeneration()`：

1. 解析唯一视频配置和能力。
2. 非 H3 配置直接构建现有请求。
3. H3 配置读取最新草稿并计算新指纹。
4. 草稿不存在或过期时，调用草稿编译服务。
5. 草稿无效时返回结构化错误。
6. 使用草稿 ID 调用严格的底层生成服务。

下列入口全部调用高层服务：

- 视频候选面板。
- 单镜快捷生成。
- 批量生成视频。
- 一键生成整集。
- Director 单镜候选入口。

批量操作按分镜独立返回 `prepared/generated/failed` 状态；一个分镜失败不允许让其他分镜错误地共享其草稿或参考快照。相同幂等键和相同来源指纹不得重复编译或重复提交。

## 14. 最终合成与混音

### 14.1 音频层

最终音频至少包含：

1. `base_audio`：H3 视频原始环境声、音效和 `per_segment` BGM。
2. `dialogue_audio`：已有对白 TTS。
3. `narration_audio`：旁白 TTS。
4. `episode_bgm`：仅 `bgm.mode=episode_track` 启用。

输入视频无音轨时创建等长静音基轨。加入对白或旁白时不得把 `base_audio` 替换掉。

### 14.2 模式行为

- `none`：保留 H3 环境声和音效，不叠加音乐。
- `episode_track`：H3 应无非叙事音乐；循环或裁剪剧集 BGM 至总时长，并执行首尾淡化。
- `per_segment`：保留每段 H3 自带音乐；镜头连接处按 `crossfade_ms` 处理音频，不叠加剧集 BGM。

对白和旁白出现时对基轨/BGM 做侧链压低，结束后平滑恢复。最终执行响度归一化与峰值限制，默认目标 `-14 LUFS`、真峰值 `-1 dBTP`。

### 14.3 转场与音频桥

- `audio_bridge.mode=carry`：前一镜声音延续指定毫秒。
- `crossfade`：相邻基轨交叉淡化。
- `cut`：音频硬切。
- `silence`：当前边界插入明确静默。

视觉转场和音频桥使用同一条规范化时间线计算，不能各自累加时长。

## 15. 前端交互

在剧集制作页增加“声音与配乐”区域：

- BGM 模式：无 BGM、整集 BGM、逐段 H3 BGM。
- 剧集音乐母题和连续性标识。
- 整集 BGM 文件/媒体库选择、音量、压低量和淡入淡出。
- 分镜环境声、音效、剧情内音乐、音乐提示模式与强度。
- 转场及声音桥。
- 音频规划状态：未规划、AI 规划、手工修改。

用户从 `episode_track` 切换到 `per_segment` 时，不删除已选择的整集音乐文件，只停止使用并保留配置；反向切换同理。所有受影响的 H3 草稿显示“音频策略已变化，需要重新编译”。

## 16. API

新增或扩展：

- `PATCH /api/episodes/:id/audio-plan`
- `POST /api/episodes/:id/audio-plan/plan`
- `PATCH /api/storyboards/:id` 支持 `audio_description`、`transition`、`is_primary` 和显式清除字段。
- 剧集详情和分镜详情完整返回规范化后的 JSON 对象。
- `POST /api/storyboards/:id/h3-prompt-draft/compile` 内部使用 Generation Context。
- 视频生成 UI 调用统一准备入口；底层候选接口仍要求有效草稿 ID。
- 项目 ZIP 导出/导入包含新增剧集字段和场景氛围。

错误码至少包括：

- `AUDIO_PLAN_INVALID`
- `EPISODE_BGM_SOURCE_MISSING`
- `H3_AUDIO_POLICY_MISMATCH`
- `H3_CONTEXT_STALE`
- `H3_REFERENCE_SEMANTICS_INVALID`
- `MERGE_BASE_AUDIO_MISSING`（只有策略明确要求输入音轨时阻塞）

## 17. 兼容策略

- 迁移只增加可空列，不重写旧行。
- 旧 `audio_description` 字符串读取时包装进 `raw_description`。
- 旧 `transition` 字符串读取时映射已知类型，未知值保留在 `visual_description`。
- 旧剧集没有 `audio_plan` 且没有任何显式分镜音乐时默认 `bgm.mode=none`，避免系统突然生成音乐；存在显式分镜音乐时按 8.2 的兼容规则转为 `per_segment`。
- 经典模式和非 H3 Provider 保持原提示词优先级，不强制六段 H3 格式。
- 旧 H3 草稿因指纹版本升级变为 `stale`，不删除历史文本。
- 导出格式版本递增；导入仍接受旧版本。

## 18. 测试策略

### 18.1 数据合同

- 字符串、对象、空值和未知字段的无损归一化。
- 三种 BGM 模式与四种 `music_cue` 的组合验证。
- JSON 序列化稳定，字段顺序不影响指纹。

### 18.2 外部 JSON

- 导入后通过正常剧集 API 回读布局、声音、转场、音色和制作策略。
- 导入 → 项目 ZIP 导出 → 再导入保持字段一致。
- 未识别字段进入 `extensions` 和导入报告。

### 18.3 故事流程

- 场景氛围被保存。
- AI 分镜的布局、BGM、音效、情绪强度和主镜头标记全部入库。
- 增量、最终覆盖和降级保存结果一致。
- 整集音频规划只调用一次，并为所有分镜生成稳定提示。

### 18.4 全能提示词与 H3

- 存在全能提示词时仍保留结构化音效和转场。
- 三种 BGM 模式得到正确 `non_diegetic_music`。
- 参考槽位语义、对白、时长和声音保留校验。
- 修改任一视听字段后草稿变为 `stale`。

### 18.5 生成入口

- 单镜、候选、批量、一键和 Director 均先准备 H3 草稿。
- 非 H3 Provider 不触发 H3 编译。
- 批量并发不串用草稿、参考图或配置。

### 18.6 合成

使用 FFmpeg 生成不同频率的合成测试音轨，验证输出频谱中同时存在：

- H3 基轨。
- 对白或旁白轨。
- `episode_track` 模式下的 BGM 轨。

同时验证 `per_segment` 不重复叠加整集 BGM、`none` 不新增 BGM、无输入音轨时仍可正确生成输出。

## 19. 验收标准

1. 外部 JSON 中明确提供的声音、转场、音色、引用语义和制作策略，在导入、页面编辑、全能提示词、H3 草稿和导出后均可追溯。
2. 故事流程 AI 返回的所有生产字段均有明确落点，没有只存在于临时 `video_prompt` 的字段。
3. `bgm.mode=none` 和 `episode_track` 的 H3 草稿始终为 `non_diegetic_music: N/A`。
4. `bgm.mode=per_segment` 的非静默分镜均得到受剧集母题约束的音乐描述。
5. 所有 H3 视频入口不再出现缺少 `h3_prompt_draft_id` 的路径。
6. 添加对白或旁白后，输出视频仍保留 H3 原始环境声和音效。
7. `episode_track` 能在普通剧集制作页配置，并进入最终成片。
8. 后端测试、前端测试和前端构建全部通过。

## 20. 实施边界与顺序

按以下独立可验收阶段实施：

1. 数据库增量与规范化服务。
2. 剧集/分镜完整读取和 PATCH 语义。
3. 外部制作包适配与往返测试。
4. 故事分镜标准映射与整集音频规划。
5. Generation Context、H3 编译、语义校验和指纹。
6. 所有视频生成入口统一准备草稿。
7. 保留基轨的最终混音与普通剧集 BGM UI。
8. 两条端到端回归测试和文档同步。

每个阶段先补失败测试，再做最小实现。不得用一次大规模重写替换现有稳定流程。
