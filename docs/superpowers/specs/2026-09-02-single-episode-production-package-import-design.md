# 单集制作包导入与多参考图 H3 视频生成设计

日期：2026-09-02  
状态：已确认设计，待实施计划

修订记录：

- 2026-09-03：依据代码评审修订。澄清人物双实体（`characters` 与 `character_libraries`）的消歧；补充 `characters.stages` 存量字段的处置；补充结构化分镜字段到现有列的映射（`action`/`dialogue`/`shot_type`/`movement`/`layout_description`/`angle_*`）；明确 `summary` 映射到 `episodes.description`；新增统一参考图解析器的查询 API；补充 ZIP 项目导出/导入扩展；补充存量万能提示词 `@图片N` 漂移的警告规则；补充 `field_overrides` 死代码修复、视频抽屉配置键控、集号生成规则。

## 1. 背景

LocalMiniDrama 已具备以下独立能力：

- 按章节拆分 TXT，并把章节正文写入剧集。
- 从剧本文本提取人物、场景和道具。
- 生成分镜、资产图片、分镜图片和视频。
- 在全能分镜模式下，为单个分镜关联场景、人物和道具参考图。
- 在分镜区域生成、润色并编辑 `universal_segment_text`。
- 在视频生成抽屉中预览 H3 Ref2VA 提示词并生成多个视频候选。

但当前没有一个完整入口，可以把其他 AI 应用生成的“单集故事梗概 + 详细分镜 + 资产定义”直接导入为可编辑、可关联、可继续生产的单集。现有 TXT 批量导入只保存正文；项目 ZIP 导入只接受 LocalMiniDrama 自身导出的项目结构；一键流水线又包含自动生图和自动生视频，不符合本需求的人工控制方式。

用户提供的 Markdown 示例包含故事梗概、详细分镜和资产提示词，但其中嵌入的 JSON 存在未转义引号等语法问题。直接把任意 Markdown 当作稳定导入协议，会引入章节识别、字段语义、引用匹配和错误恢复方面的不确定性。

本设计采用“严格单集 JSON 制作包 + 确定性导入”的主方案。Markdown 只作为人类阅读文档；任意历史文档的 AI 转换器不属于第一阶段。

## 2. 目标

第一阶段实现以下目标：

1. 导入一份严格 JSON 格式的单集制作包。
2. 创建新剧集，或填充一个严格空白的既有剧集。
3. 导入故事梗概、可选剧本、人物、人物状态、场景、道具和详细分镜。
4. 在导入预览中复用现有资产、处理冲突，不静默覆盖数据。
5. 让一个人物拥有多个独立状态图，并让每个分镜精确关联所需状态。
6. 导入完成后只建立数据和关联，不自动提取、不自动生图、不自动生视频。
7. 用户继续在每集页面手动生成或上传资产图片。
8. 用户在分镜区域生成和编辑万能提示词。
9. 对 ComfyUI H3 视频配置，强制在视频抽屉内先生成并确认 H3 提示词，再生成候选。
10. 保证实际提交给 ComfyUI 的提示词和参考图顺序可复现、可审计。

## 3. 非目标

第一阶段不包含：

- 任意 Markdown、Word、PDF 或自然语言文档的一键 AI 解析。
- 导入后自动调用文本模型补全缺失字段。
- 导入后自动生成任何图片或视频。
- 自动覆盖已有剧集内容或已有资产描述、提示词、图片。
- 以人物多状态拼图代替独立状态图。
- 为场景建立类似人物状态的复杂变体表。
- 改造成首尾帧视频流程。本设计面向多参考图 Ref2VA。

后续可增加独立的“旧文档转换器”，通过文本模型把非标准文档转换成同一份标准 JSON，再进入完全相同的预览、校验和导入流程。该转换器不得绕过标准协议。

## 4. 核心决策

### 4.1 导入协议

- 一个文件只描述一集。
- 文件必须是 UTF-8 JSON，扩展名为 `.json`。
- 禁止 Markdown 代码围栏、注释、尾随逗号和未转义引号。
- 协议具有固定名称和显式版本。
- 人物、状态、场景、道具、分镜均使用稳定的 `source_key`，不能以数组下标或显示名称作为外键。
- 人物、场景和道具的 `source_key` 在所属项目内唯一；人物状态键在所属人物内唯一；分镜键在所属剧集内唯一。
- JSON Schema 负责结构和类型校验；业务校验器负责跨字段引用、顺序、唯一性和项目状态校验。
- 上游同时获得三份材料：JSON Schema、合法示例文件、用于约束上游 AI 输出的提示词模板。

### 4.2 人物状态和参考图

- 一个角色对应一个人物实体。
- 服装、年龄阶段、受伤状态、身份伪装等视觉差异对应独立的人物状态实体。
- 每个状态独立生图或上传，形成独立参考图。
- 分镜关联“人物 + 确切状态”，不能只关联人物名称。
- 同一分镜可以关联同一人物的多个状态，但必须显式声明用途和顺序。
- 手部特写、脚部特写、背影、侧脸等镜头构图不是人物状态，写入分镜的 `framing_note`。
- 场景的昼夜、整洁/破败、室内布置差异作为不同场景资产记录，并使用 `state` 描述，不新增场景变体表。
- 道具保持独立资产图。
- 默认使用多张独立参考图，不自动制作人物状态拼图。

### 4.3 三层视频提示词

系统明确区分三层内容：

1. **分镜结构数据**：动作、镜头、构图、对白、旁白、声音、转场及资产引用，是导入的主要内容。
2. **万能提示词**：保存在 `storyboards.universal_segment_text`，由用户在分镜区域点击“全能提示词 → 生成全能提示词”生成，可继续润色或手工编辑。它使用与实际参考图顺序一致的 `@图片N`。
3. **H3 提示词**：在视频生成抽屉中，由 H3 技能把当前万能提示词和参考图快照编译为 Ref2VA 六段式结构。用户可编辑并确认，候选生成使用最后确认的文本。

打开视频生成抽屉不会自动调用 AI 生成万能提示词。抽屉只加载万能提示词和参考图、校验二者关系、管理 H3 草稿，并提交候选任务。

### 4.4 导入中的万能提示词

`storyboards[].universal_segment_text` 是可选字段，只视为上游草稿，不是最终可直接生产的 H3 提示词。

- 上游不需要生成 H3 六段式提示词。
- 上游即使提供万能提示词草稿，用户仍应在真实资产图就绪后，在分镜区域重新生成或确认。
- 导入器不得在导入阶段调用 AI 编译万能提示词或 H3 提示词。
- 参考图缺失时，不得为了迁就 `@图片N` 而静默跳过槽位并重排剩余引用。
- 草稿中若存在 `@图片N`，导入预览按“逻辑资产槽位”校验编号，而不是要求图片此时已经生成；缺图只在后续 H3 编译和视频生成阶段成为阻塞错误。

### 4.5 人物实体消歧

代码库中存在两套“人物”概念，本设计只作用于其中一套：

- **`characters`（剧目级演员表，`drama_id` 作用域）**：人物状态（`character_variants`）和分镜状态关联（`storyboard_character_variants`）只挂在这套实体上。制作包导入创建、复用和匹配的“人物”均指它。
- **`character_libraries`（全局角色库）**：不在本设计范围内。现有 `storyboard_characters` 关联表（指向角色库）及其四视图参考（`four_view_image_url`）保持现状不动；统一参考图解析器不纳入角色库来源，角色库四视图只继续参与既有分镜图片生成链路。
- `storyboards.characters` JSON（指向演员表）按 6.2 的约定继续作为兼容投影存在，由统一同步服务维护。

## 5. 标准 JSON 制作包

### 5.1 顶层结构

```json
{
  "schema": "local-mini-drama.episode-package",
  "version": "1.0",
  "generator": {
    "name": "upstream-ai-name",
    "model": "model-name",
    "generated_at": "2026-09-02T12:00:00+08:00"
  },
  "generation_profile": {
    "video_mode": "multi_reference_r2v",
    "uses_first_last_frame": false,
    "max_reference_images": 9,
    "reference_order": ["scene", "character_variant", "prop"]
  },
  "episode": {},
  "characters": [],
  "scenes": [],
  "props": [],
  "storyboards": []
}
```

`schema`、`version`、`episode` 和 `storyboards` 必填。其余资产数组允许为空，但所有被分镜引用的资产必须存在。

### 5.2 剧集

`episode` 包含：

- `source_key`：必填，文件内稳定标识。
- `episode_number`：必填，正整数。
- `title`：必填。
- `summary`：必填，写入剧集简介。现有 `episodes` 表没有 `summary` 列，简介落点是 `episodes.description`。
- `script`：可选，完整剧本文本，写入 `episodes.script_content`。
- `duration_target_seconds`：可选，写入 `episodes.duration`。
- `notes`：可选。

如果 `script` 缺失，导入器根据分镜顺序，以确定性模板拼接场景、动作、对白、旁白和声音，生成可读的 `script_content`。这个过程不调用 AI。

### 5.3 人物及人物状态

每个人物包含：

- `source_key`：必填且唯一。
- `name`：必填。
- `description`：必填，人物身份和剧情功能。
- `voice_profile`：可选。
- `variants`：至少一个状态。

每个人物状态包含：

- `source_key`：在所属人物内必填且唯一。
- `name`：必填，例如“日常西装”“雨夜受伤”。
- `description`：必填，状态语义。
- `appearance`：必填，稳定外观特征。
- `image_prompt`：必填，用于后续手动生图。
- `negative_prompt`：可选。
- `is_default`：可选；同一人物最多一个默认状态。

人物状态的 `image_prompt` 必填，是因为导入后用户要直接在资产卡片上手动生图。它与视频提示词无关。

### 5.4 场景

每个场景包含：

- `source_key`：必填且唯一。
- `name`：必填。
- `state`：必填，例如“白天营业中”“深夜停电”。
- `description`：必填。
- `image_prompt`：必填。
- `negative_prompt`：可选。

场景参考图应尽量为空镜，不包含剧情人物。若上游要求四宫格或多视角资产，必须显式声明；视频提示词仍需强调最终视频为单镜头完整画幅、禁止分屏宫格。

### 5.5 道具

每个道具包含：

- `source_key`：必填且唯一。
- `name`：必填。
- `description`：必填。
- `image_prompt`：必填。
- `negative_prompt`：可选。

道具参考图应尽量是主体隔离、无人物、无复杂背景的资产图。

### 5.6 分镜

每个分镜包含：

- `source_key`：必填且唯一。
- `storyboard_number`：必填，正整数且集内唯一。
- `title`、`description`：必填。
- `duration_seconds`：必填，正数。
- `scene_ref`：必填，引用一个场景 `source_key`。
- `character_refs`：可为空；每项必须同时指定人物和状态。
- `prop_refs`：可为空。
- `shot_type`、`camera_angle`、`camera_movement`、`composition`：必填。
- `action`：必填，可包含 `start`、`progression`、`end`。
- `dialogue`：可为空的结构化数组，包含说话人、台词和表演提示。
- `narration`：可选。
- `audio_description`：可选，包含环境音、动作音、人物声和静音要求。
- `transition`：可选，描述与前后镜头的衔接方式。
- `image_prompt`：可选，仅用于需要单独生成分镜图时。
- `universal_segment_text`：可选，仅作为万能提示词草稿。
- `notes`：可选。

`character_refs` 每项包含：

- `character_ref`
- `variant_ref`
- `reference_role`，例如 `primary`、`supporting`、`appearance_only`
- `sort_order`
- `framing_note`

上游应提供完整动作过程，而不只是静态画面描述。对白保留原语言，不能把对白混进动作字段。

### 5.6.1 分镜字段到现有列的映射

`storyboards` 表已具备大部分结构化列（`action`、`dialogue`、`shot_type`、`movement`、`angle`、`angle_h`、`angle_v`、`angle_s`、`layout_description`、`narration`、`duration`、`title`、`description`、`image_prompt`），导入映射如下，不新建含义重复的列：

| 协议字段 | 落点 | 说明 |
| --- | --- | --- |
| `title` | `storyboards.title` | 原样 |
| `description` | `storyboards.description` | 原样 |
| `duration_seconds` | `storyboards.duration` | 数值 |
| `action` | `storyboards.action` | 存在 `start`/`progression`/`end` 时渲染为确定性多行纯文本（“开始：…\n推进：…\n结束：…”），单段时原样 |
| `dialogue` | `storyboards.dialogue` | 结构化数组渲染为确定性纯文本（“角色名（表演提示）：台词”逐行），同时保留原始结构于 `episode_imports.normalized_json` 供审计 |
| `shot_type` | `storyboards.shot_type` | 原样 |
| `camera_angle` | `storyboards.angle` | 原文本；不强行拆 `angle_h/angle_v/angle_s`（保留既有结构化三元组语义不动） |
| `camera_movement` | `storyboards.movement` | 原样 |
| `composition` | `storyboards.layout_description` | 画面布局与站位语义一致 |
| `narration` | `storyboards.narration` | 原样 |
| `image_prompt` | `storyboards.image_prompt` | 原样 |
| `audio_description` | `storyboards.audio_description` | 新增列，JSON 文本 |
| `transition` | `storyboards.transition` | 新增列，JSON 文本 |
| `scene_ref` | `storyboards.scene_id` | 经 `scenes.source_key` 解析后写入 |
| `character_refs` | `storyboard_character_variants`（权威）+ `storyboards.characters` JSON（投影） | 见 6.2 |
| `prop_refs` | `storyboard_props` | 经 `props.source_key` 解析后写入 |

`action` 和 `dialogue` 渲染为纯文本而不是 JSON，是因为现有消费方（万能提示词 bundle、TTS、前端分镜编辑器）都按纯文本读取这两个列（例如 `universalSegmentPromptBundle.js` 直接对 `action` 截断拼接）；JSON 会把原始结构泄进提示词。确定性渲染保证同一份制作包重复导入得到完全相同的文本。

## 6. 数据模型

### 6.1 新增 `character_variants`

主要字段：

- `id`
- `character_id`
- `source_key`
- `name`
- `description`
- `appearance`
- `image_prompt`
- `negative_prompt`
- `image_url`
- `local_path`
- `extra_images`
- `is_default`
- `created_at`
- `updated_at`

约束：

- `(character_id, source_key)` 唯一。
- 同一人物最多一个 `is_default = 1`。
- 删除人物时级联删除状态；已被分镜使用的状态不得在普通编辑流程中直接删除。

**存量 `characters.stages` 字段的处置**：迁移 17 已给 `characters` 表加了 `stages` JSON TEXT 列（“不同集不同外貌”设想），但当前是只写不读的死字段（后端唯一写点在 `characterLibraryService.updateCharacter`，全库无消费方；前端仅有一个手写 JSON 的 textarea）。本设计用 `character_variants` 表取代它：

- 迁移阶段将 `stages` 标记为废弃：停止一切读写，前端移除角色编辑弹窗中的 stages JSON textarea。
- 对存量非空 `stages`，导入默认状态创建流程时尝试解析，把可读的外观描述并入 default 状态的 `description` 备注；解析失败则原样保留列值不阻塞迁移。
- 不把 `stages` 内容自动升级为正式状态实体，避免引入无法验证的自动决策。

### 6.2 新增 `storyboard_character_variants`

主要字段：

- `storyboard_id`
- `character_id`
- `variant_id`
- `reference_role`
- `sort_order`
- `framing_note`

约束：

- `variant_id` 必须属于 `character_id`。
- 同一分镜内 `sort_order` 唯一。
- 关联表是视频参考解析的权威来源。

现有 `storyboards.characters` 继续保留，作为兼容旧页面、TTS 和旧接口的投影字段。新增统一服务负责从状态关联同步人物名称，业务代码不得各自拼装两套关系。

### 6.3 现有表增量字段

- `characters.source_key`
- `scenes.source_key`
- `scenes.state`
- `props.source_key`
- `storyboards.source_key`
- `storyboards.audio_description`
- `storyboards.transition`

`universal_segment_text`、`video_prompt` 等已有字段继续沿用，不创建含义重复的新提示词字段。

分镜其余结构化字段不再加列：`action`、`dialogue`、`shot_type`、`movement`、`angle`、`layout_description`、`narration`、`duration` 等列均已存在，按 5.6.1 的映射写入。场景字段映射为：`name` → `scenes.location`、`state` → `scenes.state`（新增列）、`image_prompt` → `scenes.prompt`、`description` → 拼接进 `scenes.prompt`（格式“{description}。{image_prompt}”，`description` 为空时只写 `image_prompt`），不新增 `scenes.description` 列；`negative_prompt` → `scenes.negative_prompt`（既有列）。道具 `image_prompt` → `props.prompt`、`negative_prompt` → `props.negative_prompt`（既有列）；人物状态 `image_prompt` 存于 `character_variants.image_prompt`，不动 `characters.polished_prompt`（人物本体生图提示词继续由现有润色链路维护）。

`audio_description`、`transition`、`reference_snapshot`、`generation_params`、`validation_errors` 等结构化值在 SQLite 中按项目现有约定保存为 JSON 文本，由数据访问层统一序列化和反序列化，页面组件不直接解析数据库原始字符串。

### 6.4 新增 `episode_imports`

保存每次成功导入的审计快照：

- `episode_id`
- `schema_name`
- `schema_version`
- `source_filename`
- `source_sha256`
- `raw_json`
- `normalized_json`
- `match_decisions`
- `generator_metadata`
- `imported_at`

相同文件哈希再次导入同一集时，预览阶段提示重复导入；因为目标集已经非空，正式导入仍会拒绝。

### 6.5 新增 `storyboard_h3_prompt_drafts`

H3 草稿按“分镜 + 视频配置”保存：

- `id`
- `storyboard_id`
- `video_config_id`
- `source_prompt`
- `source_fingerprint`
- `ai_compiled_prompt`
- `final_compiled_prompt`
- `compiled_prompt_hash`
- `prompt_format`
- `skill_version`
- `skill_provenance`
- `reference_snapshot`
- `generation_params`
- `manually_edited`
- `status`
- `validation_errors`
- `created_at`
- `updated_at`

`status` 至少包含：`valid`、`stale`、`invalid`。

`source_fingerprint` 覆盖万能提示词、参考图资产 ID 及顺序、图片版本或地址、时长、尺寸、音频设置、视频配置、工作流和 H3 技能版本。`compiled_prompt_hash` 只表示当前最终 H3 文本。人工编辑只更新最终文本、哈希和 `manually_edited`，不会改变来源指纹。

## 7. 统一参考图解析器

新增后端共享服务，作为分镜参考图槽位的唯一规则来源。前端通过接口结果展示，不再自行维护一套可能不同的排序逻辑。

固定顺序为：

1. 场景。
2. 人物状态，按分镜关联的 `sort_order`。
3. 道具，按分镜关联顺序。

规则：

- H3 Ref2VA 最多 9 张参考图。
- 一个状态对应一个槽位和一张图片。
- 每个逻辑槽位具有稳定编号、资产类型、业务名称、资产 ID、状态 ID、图片地址和图片版本信息。
- 槽位已被万能提示词引用但图片缺失时，阻止 H3 编译和候选生成。
- 不允许因中间资产缺图而跳过该槽位并重排后续 `@图片N`。
- 超过 9 张时显示具体超限项，由用户删除关联或调整分镜；不静默截断。
- `reference_snapshot` 固化编译时使用的槽位，最终提交顺序必须与快照完全一致。

分镜区域生成万能提示词和视频抽屉生成 H3，都调用同一解析器。

**解析器查询 API**：`GET /api/storyboards/:id/reference-slots?video_config_id=...`，返回该分镜解析后的逻辑槽位列表（编号、资产类型、业务名称、资产 ID、状态 ID、图片地址与可用性、图片版本信息、超限提示）。前端分镜区域的参考图缩略行、万能提示词生成预览和视频抽屉的一致性检查都消费这个接口的结果展示，不再各自维护排序逻辑；后端内部调用同一服务函数。

**范围边界**：本解析器只服务万能提示词生成、H3 编译和视频候选提交三条链路。既有分镜图片生成链路（`imageService` 的参考图组装，含首帧锚位、四宫格降级、角色库四视图、文本补扫和 kling/其它协议的 1–4 张上限）保持现状不动，不在本设计范围；后续如需统一，作为独立设计另行处理。

## 8. 导入交互

### 8.1 入口

在剧集管理页面（DramaDetail，即“剧集管理”路由页）新增独立入口“导入单集制作包”，与现有 TXT 批量导入和项目 ZIP 导入并列但不混用。项目 ZIP 导入入口在项目列表页，三者互不影响。

只接受 `.json`。文件读取后先进入预览，不直接写数据库。

“创建新剧集”指在当前剧（drama）下新建一集：`episode_number` 取该剧现有最大集号 + 1，与手动“新增一集”的行为一致；协议里的 `episode.episode_number` 仅用于展示和校验提示，不直接决定落库集号，避免与现有集号冲突。“填充空白剧集”时按目标集已有集号落库。

### 8.2 三步预览

第一步：文件和基础信息

- 展示协议版本、生成器、集号、标题、梗概和统计数量。
- 校验 JSON 语法、Schema、版本和文件大小。
- 选择“创建新剧集”或“填充空白剧集”。

第二步：资产匹配

- 展示人物、人物状态、场景和道具。
- 对每项标记“创建”“复用”“冲突”。
- 优先按 `source_key` 精确匹配；没有稳定键时只提供名称候选，不自动决定。
- 复用现有资产时，不覆盖其描述、提示词和图片。
- 冲突必须由用户明确选择复用现有项或创建新项。

第三步：分镜预览

- 按镜号展示场景、人物状态、道具、动作、对白、声音、转场和时长。
- 展示所有跨引用解析结果。
- 错误阻止导入；警告允许用户确认后继续。

### 8.3 空白剧集定义

可被填充的既有剧集必须满足：

- 没有 `script_content`。
- 没有故事梗概正文。
- 没有分镜。
- 没有分镜媒体或视频生成记录。
- 没有成功的制作包导入记录。

集号、标题占位和创建时间不影响空白判定。目标在预览后被其他操作写入时，正式导入阶段重新检查并拒绝。

### 8.4 原子写入

正式导入按以下顺序在一个数据库事务中完成：

1. 重新解析原始 JSON并校验 SHA-256。
2. 重新检查目标剧集仍为空白。
3. 创建或更新剧集基本内容。
4. 创建或复用人物。
5. 创建或复用人物状态。
6. 创建或复用场景和道具。
7. 创建分镜。
8. 创建人物状态、场景、道具关联。
9. 同步兼容字段。
10. 写入 `episode_imports`。

任意一步失败则全部回滚。导入接口不启动 AI 任务、图片任务或视频任务。

## 9. 导入 API

### 9.1 预览

`POST /api/episodes/import-package/preview`

输入包含原始 JSON 和可选目标剧集 ID。返回：

- `normalized_package`
- `source_sha256`
- `target_status`
- `asset_matches`
- `errors`
- `warnings`
- `stats`

预览接口只读，不创建临时数据库实体。

### 9.2 正式导入

`POST /api/episodes/import-package`

输入包含：

- 原始 JSON。
- 预览返回的 `source_sha256`。
- 目标选择。
- 用户确认的资产匹配决策。

服务端不信任客户端的规范化结果，必须重新解析、校验和计算哈希。成功后返回剧集 ID、创建/复用统计和非阻塞警告。

## 10. 导入后的人工生产流程

1. 用户进入新导入的单集页面。
2. 在人物区域逐个查看人物状态卡片，手动生图或上传图片。
3. 在场景和道具区域手动生图或上传图片。
4. 在每个分镜检查关联资产和具体人物状态。
5. 必要时调整关联顺序、镜头字段、对白、声音和转场。
6. 在分镜区域点击“全能提示词 → 生成全能提示词”。
7. 系统使用当前分镜字段和共享参考图解析器，生成带 `@图片N` 的万能提示词并保存。
8. 用户可继续润色或手工编辑万能提示词。
9. 点击“打开视频生成”进入抽屉。
10. 抽屉加载万能提示词和参考图快照，并执行一致性检查。
11. 对 ComfyUI H3 配置，用户点击“生成 H3 提示词”。
12. 用户审核或编辑 H3 后，点击“生成候选”。
13. 用户从候选中选择需要的结果并绑定到分镜。

## 11. H3 视频抽屉

H3 草稿按“分镜 + 视频配置”键控（见 6.5），因此抽屉必须在会话中持有明确的 `video_config_id`。现状是抽屉只加载“默认视频配置”，用户不在抽屉里选择配置；实施时抽屉需在顶部展示当前生效的配置标识（名称/ID），默认配置变化时视为来源变化触发失效检查，但不要求本阶段开放多配置切换。

### 11.1 提示词生成按钮

当前“预览 H3 提示词”调整为明确的“生成 H3 提示词”。该按钮：

1. 校验万能提示词非空。
2. 调用共享参考图解析器并校验缺图、数量和 `@图片N`。
3. 固化参考图快照和生成参数。
4. 调用 H3 技能生成 Ref2VA 提示词。
5. 校验 H3 六段结构和引用标签。
6. 保存 AI 原始结果和当前最终结果。
7. 把可编辑 H3 区域状态设为 `valid`。

H3 Ref2VA 结果必须包含：

- `subject_definitions`
- `summary`
- `retention_analysis`
- `detailed_description`
- `overall_soundscape`
- `non_diegetic_music`

引用标签必须与参考图快照对应；对白保留原语言并按 H3 约定标记。

### 11.2 编辑和自动保存

- H3 文本区允许手工编辑。
- 编辑采用防抖自动保存；离开抽屉前立即补一次保存。
- 页面显示“AI 生成”“已人工修改”“来源已变化”“结构校验失败”等状态。
- 自动保存后重新进行确定性结构校验，不调用 AI。
- 关闭抽屉再打开时，按分镜和视频配置恢复最新草稿。
- 人工修改后的文本保留 AI 初始版本，便于对比和审计。

### 11.3 失效规则

以下任一输入变化时，已有 H3 草稿标记为 `stale`：

- 万能提示词。
- 参考图资产、图片内容版本或顺序。
- 分镜时长、画幅、分辨率或音频设置。
- 视频配置或 ComfyUI 工作流。
- H3 技能版本。

失效后保留旧文本供查看，但禁用“生成候选”。用户必须重新点击“生成 H3 提示词”。系统不自动覆盖用户曾编辑的旧 H3。

### 11.4 生成候选门禁

对 ComfyUI H3 配置，“生成候选”仅在以下条件全部满足时可用：

- H3 草稿状态为 `valid`。
- 自动保存已完成。
- 当前来源指纹与草稿一致。
- H3 六段结构校验通过。
- 引用标签与参考图快照一致。
- 参考图数量不超过 9，且所有必要图片可用。

点击后，客户端只提交草稿 ID和必要的幂等信息。后端重新计算来源指纹，读取数据库中的 `final_compiled_prompt`，验证哈希后原样提交给 ComfyUI。候选生成接口不得再次调用 H3 技能，也不得重新编译或润色提示词。

非 H3 视频配置继续沿用现有生成行为，不被错误地强制要求 H3 六段结构。

### 11.5 H3 草稿 API

建议接口：

- `GET /api/storyboards/:id/h3-prompt-draft?video_config_id=...`
- `POST /api/storyboards/:id/h3-prompt-draft/compile`
- `PUT /api/storyboards/:id/h3-prompt-draft`
- 候选生成接口增加 `h3_prompt_draft_id`。

编译接口调用 AI；保存接口只保存并校验用户文本；候选接口只消费已确认草稿。

## 12. 错误和警告

### 12.1 阻塞导入的错误

- JSON 语法错误或协议版本不支持。
- 必填字段缺失、类型不正确或稳定键重复。
- 分镜引用不存在的人物、状态、场景或道具。
- 状态不属于指定人物。
- 镜号重复或时长非法。
- 目标剧集非空。
- 正式导入时文件哈希或目标状态发生变化。
- 未处理的资产冲突。

### 12.2 可确认的警告

- 可选剧本缺失，将从分镜确定性生成。
- 可选声音或转场字段缺失。
- 未提供万能提示词草稿。
- 名称相似但 `source_key` 不同的现有资产。
- 上游声明的参考图上限与系统当前上限不一致。
- **存量万能提示词编号漂移**：统一解析器上线后，逻辑槽位固定编号、缺图不再重排；此前按“仅有图资产连续编号”生成的存量 `universal_segment_text`，其 `@图片N` 可能与当前槽位错位。视频抽屉的一致性检查发现“提示词引用编号与当前槽位语义不符”时显示明确警告（“提示词中的 @图片N 与当前参考图顺序可能不一致，建议重新生成万能提示词”），只警告不阻塞——由用户决定重新生成或忽略。

### 12.3 阻塞视频生成的错误

- 万能提示词为空。
- 必需参考槽位缺图。
- 引用超过 9 张。
- `@图片N` 越界、重复语义冲突或与快照不一致。
- H3 草稿不存在、失效或结构非法。
- H3 中的 `<Subject N>` 无法对应参考图。
- 候选提交前来源指纹发生变化。

错误信息必须指出具体分镜、具体资产和建议修复动作，不能只返回“参数错误”。

## 13. 兼容和迁移

- 所有数据库变化使用增量迁移。
- 为既有人物创建或懒加载一个 `default` 状态，并复用现有人物图片和提示词字段。
- 既有分镜的人物关联映射到默认状态。
- 旧字段继续可读写，直到所有调用点完成迁移；统一同步服务避免数据漂移。
- 当前 TXT 导入、项目 ZIP 导入、经典分镜模式和非 H3 视频配置保持可用。
- **项目 ZIP 导出/导入同步扩展**：`dramaExportService`/`dramaImportService` 需要搬运 `character_variants`、`storyboard_character_variants`、各表 `source_key`、`scenes.state`、`storyboards.audio_description/transition`，否则 ZIP 往返会静默丢失新数据。ZIP 导出的分镜资产关联继续用下标记录，导入端映射到新表。
- **修复 `field_overrides` 死代码**：前端生成/润色万能提示词时随请求发送未保存的字段编辑（`field_overrides`），后端从未消费，实际使用的是库内旧值。统一解析器改造波及此处，一并处理：后端要么消费覆盖字段，要么前端停止发送并在生成前提示未保存修改，二选一，不允许继续维持“看起来生效”的现状。
- 当前全能提示词区域仍是万能提示词的唯一生成和编辑入口。
- 视频抽屉不复制一套万能提示词生成按钮。
- 当前前端最多收集 10 张、H3 适配器最多接受 9 张的不一致，统一修正为共享规则中的 9 张，并取消静默截断；同时为 `VIDEO_REFERENCE_COUNT_INVALID` 补充前端友好文案（现走兜底文案）。
- 前端新增逻辑按现有 composables 模式落点（`frontweb/src/composables/filmCreate/`）：导入向导和人物状态卡片各自拆出组件/组合函数，不继续向已约 1.1 万行的 FilmCreate.vue 内联。

## 14. 测试策略

### 14.1 后端单元测试

- JSON Schema 成功和失败样例。
- 稳定键唯一性及跨引用校验。
- 人物状态归属校验。
- 空白剧集判定。
- 资产匹配和冲突决策。
- 参考图稳定排序、缺图、去重和 9 张上限。
- 分镜字段映射（5.6.1）：结构化 `action`/`dialogue` 的确定性文本渲染，同一输入重复导入产出逐字节相同。
- 万能提示词 `@图片N` 校验。
- H3 六段结构和 `<Subject N>` 校验。
- 来源指纹和最终文本哈希。
- H3 人工编辑、自动保存和失效判定。
- `characters.stages` 废弃迁移：非空可解析、非空不可解析、空值三种存量形态。

### 14.2 后端集成测试

- 预览接口保持只读。
- 新建剧集导入成功。
- 空白剧集填充成功。
- 非空剧集拒绝导入。
- 事务中途失败后完全回滚。
- 复用资产时不覆盖现有内容。
- ZIP 导出后导入，人物状态、状态关联和各表 `source_key` 无损往返。
- 参考槽位查询接口与导入、万能提示词生成、H3 编译三处的槽位结果一致。
- 候选生成使用保存后的最终 H3 文本。
- 候选生成不再次调用 H3 编译器。
- 提交前输入变化时拒绝旧草稿。

外部文本模型和 ComfyUI 均使用测试替身，不依赖真实密钥。

### 14.3 前端测试

- JSON 文件选择、错误展示和三步预览。
- 资产冲突必须选择后才能继续。
- 人物多状态卡片和分镜状态选择。
- 分镜区域生成万能提示词后正确传入抽屉。
- 打开抽屉不会自动生成万能提示词。
- H3 配置下未生成或已失效时禁用候选按钮。
- H3 编辑触发自动保存并显示人工修改状态。
- 关闭重开后恢复相同配置的 H3 草稿。
- 抽屉展示当前配置标识；默认配置变化触发失效检查。
- `@图片N` 与当前槽位不一致时显示警告且不阻塞。
- 非 H3 配置保持现有流程。

### 14.4 人工验收

使用一份由上游 AI 按标准协议生成的单集文件，完成以下闭环：

1. 预览并导入。
2. 确认梗概、人物状态、场景、道具和全部分镜正确。
3. 手动为资产生图。
4. 检查每个分镜的具体状态关联。
5. 在分镜区域生成万能提示词。
6. 打开视频抽屉并生成 H3。
7. 人工修改 H3，关闭并重新打开抽屉。
8. 确认草稿恢复且标记为人工修改。
9. 修改一张参考图，确认旧 H3 失效。
10. 重新生成 H3 后生成候选。
11. 确认 ComfyUI 收到的参考图顺序和最终 H3 文本与界面完全一致。

## 15. 分阶段交付

### 第一阶段：标准导入和数据模型

- Schema、示例和上游生成提示词模板。
- 人物状态及分镜状态关联。
- 预览、冲突处理、原子导入和审计。
- 导入后每集页面的关联展示和手动资产生产。
- 存量 `characters.stages` 废弃与前端 textarea 移除。
- 项目 ZIP 导出/导入对新表和新增列的同步扩展。

### 第二阶段：统一参考解析和 H3 门禁

- 共享参考图解析器及其查询 API（`GET /storyboards/:id/reference-slots`）。
- 分镜万能提示词与状态引用适配，含 `field_overrides` 死代码处理和 9 张上限/截断行为统一。
- H3 草稿持久化、可编辑、失效检测；抽屉展示当前 `video_config_id`。
- 候选接口改为消费已确认的 H3 草稿。
- 存量万能提示词 `@图片N` 漂移的抽屉警告。

### 后续可选阶段：旧文档转换器

- 上传 Markdown、Word 或其他历史文档。
- 文本模型转换为标准 JSON。
- 显示字段置信度和转换问题。
- 转换结果仍必须经过相同 Schema、业务校验和人工预览。

## 16. 验收标准

该功能在以下条件全部满足时视为完成：

- 标准单集 JSON 可以稳定导入新剧集或严格空白剧集。
- 导入不会自动调用任何生成服务。
- 资产复用可见、冲突可控、失败可回滚。
- 同一人物的多个状态能够独立生图并被不同分镜准确关联。
- 视频参考图顺序在分镜区域、视频抽屉、H3 编译和 ComfyUI 请求中保持一致。
- 万能提示词只在分镜区域生成和编辑。
- H3 提示词只在视频抽屉生成、编辑和确认。
- ComfyUI H3 候选生成必须经过有效 H3 草稿门禁。
- 候选请求使用用户最后确认的 H3 文本，后台不会二次编译。
- 旧数据和现有非目标流程没有功能回退。
