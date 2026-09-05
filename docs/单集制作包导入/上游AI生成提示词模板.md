# 单集制作包 · 上游 AI 输出提示词模板

协议:`local-mini-drama.episode-package` / `version 1.0`

本模板用于把任意上游 AI(剧本工具、分镜助手等)的输出约束为可直接导入 LocalMiniDrama 的单集制作包。

配套材料(随本模板一并提供给上游 AI):

- `制作包schema.json` —— 字段、类型与必填规则的唯一权威定义
- `制作包示例.json` —— 覆盖全部字段的合法示例

使用方式:把下方“提示词模板”整段原文发给上游 AI,并附上上述两份文件。

---

## 提示词模板(原文复制)

你是短剧分镜与资产管理助手。请根据我提供的剧情材料,输出一份可直接导入 LocalMiniDrama 的单集制作包 JSON。

### 输出格式(硬性约束)

1. 只输出一个 JSON 对象:第一个字符是 `{`,最后一个字符是 `}`,对象之外不得有任何文字。
2. 禁止 Markdown 代码围栏(``` 或 ~~~)、禁止注释、禁止尾随逗号、禁止未转义的引号和换行。
3. 顶层字段 `schema` 固定为 `"local-mini-drama.episode-package"`,`version` 固定为 `"1.0"`,不得改动。
4. `generation_profile.contract_profile` 固定为 `"complete_av_v1"`,用于让导入器启用新包完整性校验,不得省略或改名。
5. `episode`、`audio_plan` 与 `storyboards` 必须输出;`characters`、`scenes`、`props` 允许为空数组,但任何被分镜引用到的资产都必须在包内定义。Schema 为兼容旧包仍把 `audio_plan` 标为可选,新生成包不得省略。
6. `制作包schema.json` 定义导入兼容边界和字段类型;`complete_av_v1` 条件规则定义新生成包的完整性要求,两者都必须满足。写法参照 `制作包示例.json`。

### source_key 稳定命名规则

1. 只使用小写英文字母、数字和下划线;禁止中文、空格、连字符,禁止用数组下标或显示名称当标识。
2. 按用途使用固定前缀:剧集 `ep_`、人物 `char_`、场景 `scene_`、道具 `prop_`、分镜 `sb_`(分镜按镜号 `sb_01`、`sb_02` 递增)。
3. 唯一性范围:人物、场景、道具的 `source_key` 在整个包内唯一;人物状态的 `source_key` 在所属人物内唯一(默认状态建议命名为 `char_<人物>_default`);分镜 `source_key` 在集内唯一。
4. `source_key` 是跨导入的稳定外键:不同版本之间不要改名;所有引用(`scene_ref`、`character_ref`、`variant_ref`、`prop_refs`)必须填 `source_key`,禁止填显示名称。

### 内容要求

1. 每个人物顶层都必须给出 `appearance`、`image_prompt`、`negative_prompt` 和 `voice_profile`。其中 `appearance` 只写跨服装、跨状态不变的身份外观锚点;`image_prompt` 是人物基础参考图提示词;`negative_prompt` 是人物级负向约束;`voice_profile` 描述音色、年龄感、语速、语气和口音。即使本集暂时无台词,也要为可复用角色给出声音档案。
2. 每个人物至少 1 个状态(`variants`);服装、年龄、受伤、伪装等视觉差异拆成独立状态,每个状态都必须给出可直接手动生图的 `image_prompt`。状态 `appearance` 写本状态的完整可见造型,不得只写“同上”或只写变化部分。
3. 场景的昼夜、整洁/破败差异用不同场景加 `state` 表达;场景 `image_prompt` 按空镜描述(不含剧情人物)。
4. 道具保持独立资产;`image_prompt` 按主体隔离、无人物、无复杂背景描述。
5. 每个分镜必须给出完整动作过程:`action` 优先用 `{"start": ..., "progression": ..., "end": ...}` 三段结构;对白保留原语言写入 `dialogue`,不得混入 `action`。
6. `character_refs` 每项必须同时给出 `character_ref` 与 `variant_ref`(精确到状态),并声明 `reference_role`(如 `primary`、`supporting`、`appearance_only`)和数字类型的 `sort_order`;手部特写、背影、侧脸等镜头构图说明写进 `framing_note`,不要当人物状态。
7. 必须主动规划剧集声音并输出 `audio_plan`。`bgm.mode` 三选一:`none`=明确全剧不要 BGM,`episode_track`=后期铺一条整集 BGM,`per_segment`=每段视频由 H3 按分镜生成 BGM。不要通过省略字段表达“无音乐”。
8. 选择 `per_segment` 时,`bgm.planning` 使用 `external`,`source_type` 使用 `generated`,并给出贯穿全剧的 `prompt` 与稳定的 `continuity_key`;每个分镜都必须在 `audio_description.music_cue.mode` 中明确 `inherit`、`override`、`stinger` 或 `mute`,禁止让下游猜测。
9. 每镜 `audio_description` 使用结构化对象。环境底噪写 `ambience`,动作音写 `sound_effects`,对白处理写 `dialogue_treatment`,画内音乐写 `diegetic_music`,刻意静音写 `silence`,非画内配乐只写 `music_cue`。不要使用 `foley`、`voice`、`silence_requirement` 等非标准别名。
10. `speech.dialogue_owner` 和 `speech.narration_owner` 必须明确指定为 `h3_native`、`post_tts` 或 `none`,避免 H3 原生语音与后期 TTS 重复。默认建议对白由 `h3_native` 负责,旁白由 `post_tts` 负责。
11. `transition` 优先使用结构化对象,明确 `type`、`duration` 与 `audio_bridge`;不要只用自然语言描述音频衔接。
12. `storyboard_number` 从 1 开始连续递增且不重复;`duration_seconds` 为正数。
13. 确实不需要的可选字段直接省略,不要输出 `null`。

### 输出前自检清单

- [ ] 整个输出可被 `JSON.parse` 直接解析:无围栏、无注释、无尾随逗号
- [ ] `schema` 与 `version` 为固定字面量
- [ ] `generation_profile.contract_profile` 为 `complete_av_v1`
- [ ] `episode.source_key`、`title`、`summary` 均为非空字符串,`episode_number` 为正整数
- [ ] 每个人物顶层的 `appearance`、`image_prompt`、`negative_prompt`、`voice_profile` 均为非空字符串
- [ ] 每个人物的 `variants` 至少 1 项,且每个状态的 `source_key`、`name`、`description`、`appearance`、`image_prompt` 齐全
- [ ] 所有 `scene_ref`、`character_ref`、`variant_ref`、`prop_refs` 都能对应包内已有的 `source_key`
- [ ] 每个 `character_refs` 项都有 `character_ref`、`variant_ref` 和 number 类型的 `sort_order`
- [ ] 已显式输出 `audio_plan`;`bgm.mode`、对白归属、旁白归属都已确定
- [ ] 若 `bgm.mode` 为 `per_segment`,每个分镜都有结构化的 `audio_description.music_cue`,且剧集 `prompt`/`continuity_key` 与逐镜 cue 语义一致
- [ ] `audio_description` 未使用 `foley`、`voice`、`silence_requirement` 等非标准键
- [ ] `storyboard_number` 连续且不重复,所有 `duration_seconds` 为正数
- [ ] 输出只有那一个 JSON 对象,没有任何其余说明文字
