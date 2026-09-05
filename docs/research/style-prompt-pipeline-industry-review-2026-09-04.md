# LocalMiniDrama 风格确认、提示词与成熟短剧流程对照调查

> 调查日期：2026-09-04
> 调查范围：当前代码、项目内 LibTV/关键帧/H3 调查文档、Runway/Adobe/Luma/Pixar/ASC/Blackmagic 官方或一手资料。
> 本次工作仅输出调查与落地建议，不改动业务代码。

## 1. 执行摘要

当前项目已经不是“只有几条提示词的生成器”，而是具备了风格预设、角色/场景/道具资产、三帧分镜、Omni 多参考、H3 结构化编译、候选审核、连续性锚点、整集合片、字幕/音频混合和基础后期的短剧生产雏形。

总体判断如下：

1. **风格注入主干合理，但“选择风格”不等于“确认风格”**。现有 UI 是预设/自定义文本选择器，选择变化会直接保存；没有风格样片、批准版本、场次级 look 和变更影响提示。
2. **存在两个高优先级风格断链**：H3 编译草稿没有把项目风格及版本/hash 纳入输入和 freshness 指纹；切换项目风格也不会让既有角色/场景/道具 prompt 失效，重新生成可能继续复用旧风格或叠加新旧风格。
3. **人物、场景、道具、分镜提示词总体方向正确**。人物参考表、场景多视图、道具干净资产照、首/关键/尾帧与布局合同都具备实际生产价值；主要问题是状态/版本/色彩职责还未成为统一的结构化数据。
4. **视频提示词不能一概而论**。Omni/H3 的格式约束和可追溯性较强；经典模式存在当前代码缺失函数；图生视频仍有“静态描述过载”风险，应按 T2V/I2V/FL2V/Ref2V 分别编译，而不是共用同一种长文本。
5. **自定义能力属于“中上但不完整”**。9 个 System Prompt 可覆盖，产物级 prompt 可编辑，自定义风格可保存；但若干关键生成/润色/视频模板仍硬编码，覆盖没有项目作用域、不可变版本和回滚。
6. **项目不是缺少合片，而是缺少完整的色彩流水线**。已有 FFmpeg 合片、字幕、水印、音频和 Director 的亮度/对比度/饱和度、Lanczos 放大；缺的是输入/时间线/输出色彩管理、镜头匹配、场次分组、LUT/CDL/可审计节点和目标设备复检。
7. **色卡值得做，但要分清三类概念**：美术调色板、按剧情推进的 Color Script、实拍校准用 ColorChecker。纯 AI 短剧优先做前两者，不应把 ColorChecker 当风格图，也不应认为“一张 LUT 能统一所有镜头”。
8. **LibTV 最值得吸收的是职责分离**：长期资产锚点（人物/场景/道具/色彩/音色）与上一镜即时状态锚点并列；不值得照搬的是超长提示词、裸 `Mixed N` 位置契约和生成后立即自动续下一镜。

推荐顺序：先修风格与引用正确性（P0），再补 Look Bible/场次 Color Key/状态卡（P1），然后做 Picture Lock 后的镜头匹配与统一调色（P2），最后才做自动续镜、原生多段 H3 和片段重拍（P3）。

## 2. 当前风格确认业务逻辑

### 2.1 现有链路

当前风格数据由两部分组成：

- `dramas.style`：短 key，例如某个预设值或 `custom`；
- `dramas.metadata.style_prompt_zh / style_prompt_en`：实际长提示词。

前端 `frontweb/src/constants/styleOptions.js` 负责预设与中英文文案，`StylePickerButton.vue` 提供预设卡片和最多 500 字的自定义输入。保存时把长文案写入 metadata。后端 `backend-node/src/utils/dramaStyleMerge.js` 优先读取 metadata，缺失时回退到后端预设，再把风格合并到角色、场景、道具、分镜图和非 H3 视频配置中。

这套“双存储 + 后端统一展开”的优点是：

- 老项目只保存短 key 也能回退；
- 自定义风格在非 H3 常规主链基本贯通；
- 单次请求仍可覆盖项目默认；
- 中英文模型可选择对应文案。

注意：自定义风格的 zh/en 当前直接保存同一段文本，并未翻译或按模型重写；英文生成器可能收到中文风格，自定义内容也只有长度限制，没有结构、冲突和 Provider 适配校验。

### 2.2 “合理”与“不足”的边界

| 判断项 | 结论 | 说明 |
|---|---|---|
| 单一入口 | 合理 | 用户不必在人物、场景、分镜、视频处重复填写全剧画风。 |
| 自定义文本 | 可用 | 500 字足够表达媒介、线条、材质、光线、色彩和禁项。 |
| 真正确认 | 缺失 | 当前是“选择即自动保存”，没有 Style Test、候选对比、批准/冻结门禁。 |
| 粒度 | 不足 | 只有全剧风格；缺场次/情绪段落 look，无法自然表达现实、回忆、梦境、昼夜的受控变化。 |
| 版本治理 | 不足 | 没有 `style_version`、批准人/时间、变更原因、派生资产清单和影响评估。 |
| 缓存失效 | 缺失 | 角色/场景已有 `polished_prompt` 会直接复用；风格变化不会标 stale。 |
| H3 贯通 | 缺失 | H3 draft 由 storyboard business prompt 编译，未解析项目 style，也未纳入 draft fingerprint。 |
| 配置来源 | 可控但不理想 | 前后端风格表双份硬编码；已有同步测试能发现不一致，但仍需双处改动。 |
| 可扩展预设 | 不足 | 用户只能切到 `custom`，不能保存多个命名预设、锁定字段或团队复用。 |

因此，项目需要把“风格选择器”升级为“Look Approval”：

1. 全剧 Look Bible：媒介、写实度、镜头语言、材质、总体色域、肤色策略、禁项；
2. 场次 Look Profile：时间、天气、曝光、主辅色、主光方向、对比度、允许偏移；
3. 固定测试镜头生成 2～4 张 Style Test；
4. 用户选定并冻结版本；
5. 后续改动显示受影响的角色、场景、分镜和视频，允许“仅新镜头生效”或“重生成受影响资产”；
6. H3 预览、编译和提交共用一个 `resolvedStyle`，并把 style version/hash 纳入草稿 freshness；
7. 每个生成 prompt 保存 `source_fingerprint + style_fingerprint + origin(manual/auto)`。风格变化时自动 prompt 可重编，人工 prompt 必须让用户选择保留或重编。

Adobe Firefly 的 Style Kits 已经产品化了“保存 prompt/内容/结构/风格设置，并隐藏或锁定部分设置”的思路；本项目可以复刻这种批准模板，而不依赖某个特定模型。[Adobe Style Kits](https://helpx.adobe.com/firefly/web/work-with-enterprise-features/collaborate-using-style-kits/style-kits-overview.html)

## 3. 四类生图提示词评估

### 3.1 人物

当前格式的核心是：角色事实 → 身份锚点 → 工业角色参考表版式 → 面部/多角度/服装材质 → 排除海报、拼贴和错误时代服装 → 画风。

优点：

- 不是只写“英俊、冷酷”，而是把抽象气质落到可见的脸型、发型、材质和服装细节；
- 参考表、多角度和局部特写适合反复作为人物身份源；
- `identity_anchors` 能形成机器可读的身份描述，并在后续帧提示词复用；
- 与《青城夜巡人》的三/四视图高频人物资产做法一致。

问题：

- 角色身份、服装、年龄、受伤、伪装等“状态”在不同流程中已有零散设计，但主演主流程尚未统一为可选择、可版本化的角色状态资产；
- 当前角色参考表明确取消色板条/调色块，作为干净身份表是合理的，但也意味着它不能承担全剧或场次色彩规则；
- `characters.color_palette` 已由 `characterGenerationService.js` 写入，当前检索不到该字段的直接下游消费；帧提示词会使用 `identity_anchors.color_anchors`，两者不能混称；
- 不应把角色参考图一路迭代覆盖。Luma 建议以 Master Reference Asset 作为单一事实来源，每次编辑重新锚定原始主参考，避免比例、颜色和标志物逐代漂移。[Luma References](https://lumalabs.ai/learning-center/articles/how-to-use-references-properly)

推荐可替换格式：

```yaml
character_asset:
  identity_ref: CHAR_LIN_v3
  immutable: [face_shape, eye_shape, hairstyle, signature_accessory]
  state_ref: CHAR_LIN_WARDROBE_NIGHT_INJURED_v2
  variable: [expression, pose, camera_angle]
  palette: [skin_range, hair_color, wardrobe_primary, wardrobe_accent]
  output_views: [face_closeup, front, three_quarter, side, back]
  exclusions: [poster_layout, duplicate_person, text, watermark]
```

### 3.2 场景

当前格式支持单图和 2×2 多视图，强调纯背景、空间层次、全景/中景/特写/另一角度和全局画风。这个方向合理，能比单张氛围图更好地支撑后续换机位。

需要补足：

- 场景结构与场景状态分离：同一地点的日/夜、晴/雨、完好/破败、有人/无人；
- 从指定摄像机位置面向地标的 `scene_view`，而不只是随机“另一角度”；
- 可识别地标、门窗、通道、家具坐标与不可移动物；
- 场次级主光方向、曝光保护对象、色温和禁用色；
- 多视图必须切片或具名选择后再进视频，不能把一整张九宫格当成唯一空间真相。

推荐格式：

```yaml
scene_asset:
  geometry_ref: LOC_RESTAURANT_v4
  state: night_rain_open
  landmarks: [entrance_left, counter_back, window_right, aisle_center]
  views: [establishing, camera_a_to_counter, reverse_to_entrance]
  look_ref: LOOK_RESTAURANT_WARM_ISLAND_v2
  lighting: practical_tungsten_inside_cool_rain_outside
  exclusions: [people, changed_floorplan, moved_landmarks, signage_gibberish]
```

### 3.3 道具

现有“单一主体 + 纯色无缝背景 + 棚拍光 + 正确物理尺度 + 禁止人物地名泄漏”的资产照提示词是正确的。它适合建立标准道具，而不是直接生成剧情截图。

真正的缺口是道具状态。对于香烟、刀、信件、伤药、手机、钥匙等叙事道具，单张标准图无法约束跨镜头变化。《秋人》对香烟的持有者、左右手、方向、完整度和文字面做了明确规定，这是非常值得产品化的状态机。

```yaml
prop_state:
  asset_ref: PROP_RED_FOLDER_v2
  holder: CHAR_LIN
  hand: right
  orientation: logo_toward_camera
  completeness: closed_intact
  position: chest_height
  allowed_transition: [open, place_on_table]
  forbidden_transition: [switch_hand_without_action, change_color, duplicate]
```

### 3.4 分镜图与首/关键/尾帧

当前三帧体系是项目的强项：每帧包含镜头设计、光线、内容焦点、氛围、视觉风格；`layout_description` 作为空间合同；角色白名单、身份锚点和 `continuity_snapshot` 用于降低串角、换装和左右翻转。

但还需从“描述一张好图”升级为“定义一个可剪镜头”：

- `start_state`：人物位置、视线、手势、道具、运动方向；
- `end_state`：镜头结束时可传给下一镜的状态；
- `edit_handle`：开头/结尾留多少稳定帧；
- `axis/camera_side`：180 度轴线与正反打关系；
- `look_ref`：只引用当前场次色彩职责；
- `acceptance`：身份、手脸、文字、空间、光向和可剪性标准。

当前“尾帧衔接”与 Director 连续性锚点应并存：标准人物/场景/道具/色彩图负责长期真相，上一镜选定视频的稳定帧只负责姿态、构图、动作和即时状态，不能用一张可能模糊或变形的尾帧覆盖全部标准资产。

## 4. 生视频提示词评估

### 4.1 经典模式

经典模式的初稿主要是数据库字段串接，信息齐全但缺少清晰的“静态输入/动态指令/时间线/验收”分层；它依赖润色把字段改写成导演语言。

当前代码还有明确缺陷：`backend-node/src/routes/storyboards.js:1046` 调用 `promptI18n.getClassicVideoPromptPolishPrompt()`，但 `backend-node/src/services/promptI18n.js` 当前没有该函数的定义和导出。调用该润色流会发生运行时错误。应补齐并纳入 prompt override，或删除这条未实现路径。

### 4.2 Omni 多参考模式

Omni 的强项包括：

- `IMAGE_SLOT_MAP` 明确场景、角色状态和道具的槽位；
- `@图片N` 与真实 API 顺序绑定，并禁止虚构槽位；
- `TOTAL_CLIP_SECONDS` 与内部子分镜时长和相等；
- `DIALOGUE_VERBATIM` 保证台词逐字；
- 邻镜上下文和连续性快照参与编译；
- 单条数据库分镜与一次视频 API 时长的关系表达清楚。

它比 LibTV 裸 `Mixed N` 更接近可审计系统，但仍需把“位置序号”升级为“资产 ID + reference role + 编译后位置快照”，否则增删一张图仍可能导致错锚。

### 4.3 H3 模式

H3 编译器要求结构化的多模态描述、整体声景、非叙事音乐、镜头时间线，并根据是否有首/尾帧和多参考资产确定生成模式；草稿保存原始/AI/final、hash、技能版本和引用快照，提交前还会做 freshness 检查。这是正确的工程方向。

但当前主路径有风格断链：`unifiedVideoGenerationService` 在 H3 分支以 `draft.final_compiled_prompt` 覆盖前端普通提交的 prompt；`h3PromptDraftService` 编译输入没有查询 `dramas.style/metadata`，草稿 source fingerprint 也没有 style。结果是：项目自定义风格不会可靠进入 H3，改变风格也不会让旧 H3 草稿 stale。必须让 H3 预览、编译和提交共用统一风格 resolver，并把 style version/hash 纳入指纹。

同时，当前已确认的 V1 能力仍是单分镜、多参考图，不能把历史实验中的 overlap 或 sequence 设计当成已经交付的原生多段连续生成。应先稳定单镜镜头包和状态链，再扩展 sequence。

### 4.4 与成熟模型提示实践的冲突

Runway 官方明确：图生视频的输入图已经定义构图、主体、光线和风格，文本应主要描述运动、镜头和时间推进；先从简单运动开始，再迭代加细节。[Runway Image-to-Video Guide](https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide)

因此项目应按模式分别编译：

| 模式 | 文本应重点描述 | 不应重复堆叠 |
|---|---|---|
| T2V | 主体、环境、构图、风格、动作、镜头、节奏 | 无参考时可以完整，但仍应控制单镜复杂度 |
| I2V | 动作、表演、镜头运动、环境运动、时间推进 | 输入图中已经明确的脸、服装、构图和光线 |
| 首尾帧 FL2V | 起点到终点的可实现变化、运动路径、节奏 | 再要求互相冲突的构图/风格控制 |
| Ref2V/Omni | 每个参考的唯一职责 + 动作/镜头 | 多张参考同时定义同一属性 |
| V2V 修改 | 保留项、只修改的时间区间/属性、强度 | 重新描述整段并造成非目标区域漂移 |

Adobe Firefly 的视频界面也说明首/尾帧、构图参考、运动参考、景别/角度/风格等控制存在能力组合和互斥关系。项目应为 Provider 建“能力矩阵”，自动禁用不兼容字段，而不是把所有控制同时塞给 API。[Adobe Firefly Video](https://helpx.adobe.com/firefly/web/firefly-video-editor/generate-videos/generate-video-using-firefly-models.html)

推荐的统一镜头包：

```yaml
shot_id: EP01_SC03_SH012
intent: 女主得知真相后压住情绪并作出决定
locked_refs:
  identity: CHAR_LIN_v3
  character_state: CHAR_LIN_NIGHT_v2
  scene_geometry: LOC_OFFICE_NIGHT_v4
  prop_state: PROP_RED_FOLDER_CLOSED_RIGHT_HAND_v2
  look: LOOK_NOIR_BLUE_AMBER_v2
  continuity_state: FRAME_SH011_SELECTED_238
dynamic_direction:
  framing: medium_close_up
  action: slowly closes the folder, holds breath, looks toward the door
  camera: subtle_push_in
  timing: "0-2s close folder; 2-4s pause; 4-6s look to door"
audio:
  dialogue_verbatim: "我知道是谁了。"
  voice_ref: VOICE_LIN_v1
generation:
  provider: ...
  model_version: ...
  mode: I2V
  duration: 6
  seed: ...
  source_hashes: [...]
acceptance:
  - identity and wardrobe unchanged
  - folder remains in right hand
  - gaze and screen direction match SH011
  - no extra speech or duplicate person
```

## 5. 自定义与可替换性

| 层级 | 当前能力 | 判断 |
|---|---|---|
| 全剧风格 | 预设 + 自定义文本 + metadata 中英文 | 非 H3 可用，但无命名版本、批准和回滚 |
| 9 个 System Prompt | `prompt_overrides` 可编辑/重置 | 可用，但全局生效、覆盖面有限、无历史版本 |
| 资产最终 prompt | 多处 UI 可在生成前手改并持久化 | 灵活，但自由文本改动难审计，风格变化不失效 |
| 视频表单 | prompt、参考图、首尾帧、时长等可调 | 可用，应按 Provider 能力矩阵约束 |
| 角色/场景资产版式模板 | 多数硬编码 | 不便按模型替换 |
| 分镜图润色、Omni、H3 等系统模板 | 多数硬编码 | 关键模型升级时需改代码 |
| 风格预设 | 前后端双份常量 + 同步测试 | 能防不一致，但不可由项目/用户增删改和版本化 |

`prompt_overrides` 当前本质是全局 key/content/updated_at，写入覆盖、删除重置；没有 global/project/style-profile 作用域、变量 schema、审计人、不可变 revision、diff/revert。H3 草稿虽保存最近记录和 hash，但前端/API 没有完整历史列表、对比和回滚，且旧记录会被裁剪。故不能把“可编辑”误判为“可版本治理”。

推荐把模板拆为：

1. `global_style`：全剧批准版本；
2. `scene_look`：场次级可复用增量；
3. `asset_contract`：人物/场景/道具不可变字段；
4. `shot_direction`：镜头可变动作；
5. `provider_adapter`：模型专属格式与互斥能力；
6. `negative/acceptance`：生成禁项与验收项；
7. `compiled_snapshot`：实际提交文本、参考 ID/顺序/hash、模型版本、seed。

用户替换风格、人物或场景时只替换 ID/版本，由编译器重组；不要把人物身份复制在每条自由文本里。Luma 把 Master Reference Assets 定义为项目的单一事实来源；Adobe Style Kits 则说明可锁定批准设置，这两者共同支持这种设计。[Luma Character Reference](https://lumalabs.ai/learning-hub/character-reference)

## 6. 相对成熟流程缺少什么

### 6.1 色卡到底要不要做

需要，但应拆成三类：

| 名称 | 用途 | 本项目建议 |
|---|---|---|
| Palette Swatches / 美术调色板 | 主色、辅助色、禁用色、肤色和材质色范围 | 写进 Look Bible/场次 Look Profile，机器可读 |
| Color Key / Color Script | 用按剧情顺序的小图规划情绪、地点、时间和视觉高潮的色彩变化 | 每个重要场次 1 张 Color Key；全剧串成 Color Script |
| ColorChecker | 实拍/混合拍摄的技术校准 | 纯 AI 素材通常不作为风格参考；真人素材或合成时才用 |

Pixar RenderMan 的制作案例把 Color Script 描述为规划摄影和整体美术风格的方法；它适合情绪跨度明显的短剧，但不等于每个镜头必须单独生一张色板。[Pixar RenderMan: Bourdonnement](https://renderman.pixar.com/stories/bourdonnement)

《秋人》把独立色卡与场景图并列引用，验证了“场景是什么”与“如何曝光/着色”分开的价值。推荐新增 `look` 参考职责，而不是把色卡伪装成普通场景图：

```yaml
look_profile:
  id: LOOK_HOSPITAL_COLD_WHITE_v2
  primary_colors: ["#DDE4E6", "#AEB9BD"]
  accent_colors: ["#8B1E25"]
  forbidden_colors: ["#F2B35D"]
  exposure_priority: protect_window_highlights
  subject_vs_background: subject_minus_1_5_stop
  contrast: restrained_high_key
  skin_policy: neutral_not_magenta
  reference_image_id: COLORKEY_HOSPITAL_v2
```

### 6.2 生成后要不要统一调色

需要，但应在两个阶段工作：

1. **生成前/前期**：建立可预览的 show look，作为参考和审核目标，不把重 LUT 不可逆烘焙到所有源片；
2. **Picture Lock 后**：技术归一/色彩空间变换 → 按场次分组的基础平衡与镜头匹配 → 创意 look/LUT/CDL → 单镜修复 → 输出变换与目标设备复检。

Blackmagic 的官方资料强调先平衡画面，再做创意 grade；Shot Match 是起点，仍需人工评估；色彩管理包含输入、时间线、输出变换。[DaVinci Resolve Color](https://www.blackmagicdesign.com/uk/products/davinciresolve/color) [Resolve 20 Colorist Guide](https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Colorist-Guide.pdf)

当前项目已有：

- `videoMergeService.js` 的整集 FFmpeg concat；
- `mergedEpisodePostProcess.js` 的字幕、水印、对白/旁白音频处理；
- Director `timelineService.js` 的 concat/xfade；
- `directorPostproductionService.js` 的亮度、对比度、饱和度与 Lanczos 放大。

当前缺少：

- 输入/工作/输出色彩空间和素材标签；
- 波形、矢量示波器或可量化的亮度/色偏检测；
- 选基准镜头、自动初匹配、场次分组、人工复核；
- LUT/CDL/节点顺序、版本和旁路预览；
- 输出平台的 gamma/SDR/HDR 规则与目标设备复看。

所以不能写成“项目没有后期”，准确说法是“已有合片和基础标量校色，缺系统化镜头匹配与色彩管理”。Adobe 也提醒广播 2.4、Windows 常见 2.2、macOS/QuickTime 约 1.96 的观看差异会造成导出观感变化，交付必须按目标平台复检。[Adobe Premiere Gamma](https://helpx.adobe.com/premiere/desktop/troubleshooting/playback-issues/premiere-exports-look-washed-out.html)

### 6.3 其他缺口

| 能力 | 当前状态 | 建议 |
|---|---|---|
| Style/Bible Gate | 无批准门禁 | 先小样、批准、冻结再批量 |
| 场次 Look | 缺 | 全剧 + 场次 + 镜头三层 |
| 角色/服装/伤势状态 | 局部存在、未统一 | 版本化状态资产 |
| 道具状态机 | 缺 | 持有者/手/方向/完整度/位置/允许转移 |
| 参考职责 | Omni 有槽位，仍偏序号 | 资产 ID + role + 顺序快照 + 编译校验 |
| Provider 能力矩阵 | 不完整 | 管理首尾帧/构图/运动/风格互斥 |
| 候选生命周期 | Director 已有 selected 体系；传统制作页较弱 | 统一 experiment/usable/selected/rejected/in_timeline |
| 关键帧链 | 有手动尾帧和 Director 锚点 | 从用户选定 candidate 抽稳定帧并持久绑定目标镜 |
| 提示词预算 | 有时长求和，缺容量门禁 | 按秒数、镜头数、对白量和模型上限预警 |
| 质量审核 | Director 有黑帧/冻结/解码/时长等技术检测 | 增加风格、身份、色彩和跨镜连续性语义门禁 |
| 视频超分 | Director 有 Lanczos；另有验证过的 RTX VSR 工作流 | 区分插值放大与 AI 超分，按输出需求选择 |
| 剪辑包交付 | 有成片合并，缺专业交换包 | 可选 EDL/FCPXML、字幕、音频、look 元数据、LUT |

## 7. LibTV 文档逐项吸收

### 7.1 《青城夜巡人》

本地文档：`docs/LibTV青城夜巡人视频制作流程调查说明.md`。

可吸收：

- 人物三/四视图、场景九宫格/多机位、道具/怪物和音色组成长期资产库；
- `Mixed N` 之前先逐一声明每个输入的职责；
- 视频提示按“基础设定 → 强制项 → 画质 → 时间镜头块 → 连续性提醒”分层；
- 低清且高频使用的人物标准资产定稿后再 2×，而不是所有草稿都超分；
- V2V 片段重拍用于局部修片，不等于正常镜头自动续写。

吸收方法：

1. 场景增加轻量 `scene_view` 附件：建立、左/右反打、高/低机位、看向地标；仅复杂空间按需生成；
2. 角色变体以批准身份图做 img2img 局部替换，保留身份、修改服装/伤势；
3. 把图片/音频统一为具名 `reference_manifest`，编译后再映射到 `@图片N` 或 `Mixed N`；
4. 对白逐条绑定 `voice_ref`；
5. 把“最终标准资产才高清”作为成本门禁。

### 7.2 《秋人》

本地文档：`docs/LibTV秋人视频制作流程调查说明.md`。

可吸收：

- 独立色卡负责曝光/色域，场景图负责空间结构；
- 场次摄影圣经包含观察立场、光线、曝光、色彩、材质、表演、声音、剪辑条件和反风格项；
- 关键道具状态机；
- 每个镜头块明确起始状态、表演节拍、终态和切点；
- 前景遮挡、反应镜头、插入镜头可作为生成跳变的剪辑缓冲；
- 候选按镜头分组比较，允许外部候选回流。

不应照搬：

- 5 秒塞 5～8 个内部镜头、数千字 prompt 是过载反例；
- 画布连线仍在不代表模型真实消费了素材；
- `Mixed N` 裸序号容易因增删素材错位；
- “严格承接上一镜”的文字不能代替真实状态锚点。

### 7.3 关键帧衔接机制

本地文档：`docs/分镜视频关键帧衔接机制调查说明.md`。

项目已经有三种相关路径：制作页手动尾帧衔接、Director 任意帧连续性锚点、被隐藏的批量连贯模式。当前不宜直接开放自动生成下一镜，原因是：

- 尾帧服务按最新可播放记录选源，不等于用户选定 candidate；
- “尾帧”约为结束前 1 秒画面，并非智能稳定帧；
- Director 锚点未持久绑定目标分镜；
- 显式 `referenceImageUrls` 可能遮蔽新锚点；
- 隐藏批量模式有参考图优先级、CORS 和静默失败风险；
- 不同 Provider 对 first frame 和普通 reference 的语义不同。

应改为双层引用：

```text
长期真相：人物身份 + 角色状态 + 场景结构/机位 + 道具标准/状态 + Look
即时状态：上一镜“用户已选视频”中的稳定帧（姿态/视线/构图/动作）
                       ↓
reference_manifest → Provider 能力适配 → 实际槽位快照 → 下一镜
```

新增或扩展 `continuity_link` 时至少保存：源视频生成 ID、源帧号/时间、派生图片 ID/hash、目标分镜 ID、reference use（state/composition/motion）、Provider 绑定模式和版本历史。

### 7.4 Zealman MiniMax H3 U06

本地文档：`docs/Zealman-MiniMax-H3-U06工作流导出与RTX超分调查说明.md`。

可吸收：

- 记录每次真实提交的 ComfyUI API JSON，而不是只存画布模板；
- RTX VSR 2× 是真实 AI 超分，Director 的 FFmpeg Lanczos 是插值缩放，两者不可混称；
- 只对最终选择且源分辨率不足、需要裁切/平台交付的片段做 AI 超分；
- 超分不能修复身份漂移、错误手脸、错误构图，也不应在未锁片前浪费成本。

建议触发条件：源视频低于交付分辨率、将明显裁切/放大、细节重要且源画面本身正确；如果源视频已经达到交付分辨率、存在严重生成错误或只是低码率压缩问题，优先重生成/重编码而不是超分。

## 8. 推荐质量门禁

| 门禁 | 必须回答的问题 | 未通过 |
|---|---|---|
| Bible Gate | 角色、服装状态、场景、道具、镜头语言、色彩规则是否有唯一批准版本？ | 不允许批量生成 |
| Storyboard Gate | 每镜是否有叙事目的、起止状态、景别、动作、轴线和可剪时长？ | 回分镜/animatic |
| Generation Gate | 身份、服装、道具、手脸文字、光向、构图、动作物理是否通过？ | 返生成或局部修复 |
| Continuity Gate | 相邻镜的角色/道具状态、视线、运动方向、空间和色温是否接上？ | 重生、补反应镜/B-roll 或改剪辑 |
| Edit Gate | 节奏、表演、音画和字幕是否通过并 Picture Lock？ | 不进入高成本后期 |
| Color Gate | 是否先基础匹配，再场次/show look，并人工复核自动结果？ | 回到场次组/单镜调色 |
| Delivery Gate | 画幅、fps、色域/伽马、字幕、音频、黑帧、压缩和目标设备是否达标？ | 重导出并复检 |

## 9. 落地路线图

### P0：正确性与可追溯性

1. 修复 H3 项目风格断链：统一 resolver，并将 style version/hash 纳入草稿指纹和 stale 判断；
2. 修复风格变更后的旧资产 prompt 复用/新旧叠加：保存 prompt 来源与 style fingerprint，提供保留或重编选择；
3. 修复经典视频润色缺失函数，并加入可覆盖模板；
4. 风格预设改为单源，或继续用现有同步测试并建立自动生成流程；
5. 将当前 `color_palette` 接入可见的资产卡和编译上下文，但不要误作全剧 Color Script；
6. 连续性抽帧只使用用户选定 candidate，保存 source/target/frame/role/hash；
7. 建 Provider 能力矩阵与 reference manifest，解决显式参考遮蔽和槽位错位；
8. 隐藏批量连贯模式继续保持关闭，先让失败显式可见。

建议增加至少三类回归测试：`custom style → H3 draft/final prompt`；`style change → auto prompt stale/manual prompt decision`；`selected candidate → continuity source → Provider payload`。

### P1：Look 与状态资产

1. 新增 Look Bible、场次 Look Profile、Color Key/Color Script 和批准/版本机制；
2. 新增固定 Style Test，批准后再批量；
3. 统一人物状态/服装/伤势版本，新增道具状态机；
4. 场景增加按需多机位/多时段附件；
5. 分镜保存结构化 start/end state、轴线、剪辑点和验收条件；
6. 提示词改为全局、场次、镜头、Provider 四层编译，并提供容量预警；
7. 将 prompt override 改为有作用域、不可变 revision、diff/revert 的模板库。

### P2：成片收口

1. 在已有合片后增加色彩空间标签、技术归一、基准镜头和场次分组；
2. 自动 Shot Match 只做初始值，人工复核；
3. 支持可旁路的 LUT/CDL/节点顺序与版本；
4. Picture Lock 后按需做 RTX VSR 等 AI 超分，Lanczos 仅作缩放兜底；
5. 导出成片外，可选 EDL/FCPXML、字幕、音频、参考帧、look 元数据和 LUT 的剪辑包；
6. 加入目标平台与设备复检。

### P3：高阶连续生成

片段重拍、稳定帧智能选择、自动连续下一镜、原生多段 H3 sequence。前提是 P0/P1 的引用、状态、候选和 Provider 语义已经稳定。

## 10. 最终结论

当前项目最强的是“资产 + 三帧 + 结构化 Omni/H3 + 已有合片”的工程骨架；最弱的不是提示词文采，而是**批准、状态、引用和后期色彩这四类生产治理**，以及已经确认的 H3 风格/旧资产 prompt 失效断链。

最值得从 LibTV 吸收的不是更长的 prompt，而是：

- 《青城夜巡人》的长期多模态资产库、多机位场景和按需高清；
- 《秋人》的场次摄影圣经、独立色彩职责、道具状态、镜头起终态与降级剪辑；
- 与本项目已存在的用户选定视频稳定帧/Director 锚点组合成双层连续性。

实施后，用户替换自定义风格、人物、场景或模型时，不需要重写每条提示词；系统只需替换已批准资产 ID/版本，由编译器按当前 Provider 能力重建镜头包。这才是成熟、可控、可复现的短剧制作流程。

## 11. 关键代码证据索引

以下为本次判断使用的主要代码位置，便于后续实现时直接定位：

| 结论 | 代码位置 |
|---|---|
| 风格 metadata 优先、预设回退 | `backend-node/src/utils/dramaStyleMerge.js:19-77` |
| 自定义风格 zh/en 镜像保存 | `frontweb/src/constants/styleOptions.js:246-258` |
| 风格选择后立即保存 | `frontweb/src/views/FilmCreate.vue:380-385, 5262-5287` |
| 角色/场景旧 polished prompt 复用 | `backend-node/src/services/characterLibraryService.js:532-547`；`backend-node/src/services/sceneService.js:313-327, 389-405` |
| 生图风格字符串追加可能叠加旧风格 | `backend-node/src/services/imageService.js:521-529` |
| H3 draft 编译输入/指纹未含项目 style | `backend-node/src/services/h3PromptDraftService.js:269-319, 303-376` |
| H3 提交用 final compiled prompt 覆盖普通 prompt | `backend-node/src/services/unifiedVideoGenerationService.js:668-748` |
| 非 H3 视频追加项目 style | `backend-node/src/services/unifiedVideoGenerationService.js:785-793` |
| 经典润色调用缺失函数 | `backend-node/src/routes/storyboards.js:1046`；`backend-node/src/services/promptI18n.js` 当前无对应导出 |
| 9 个可覆盖 System Prompt | `backend-node/src/routes/promptOverrides.js:6-52` |
| Omni 时长与参考槽位合同 | `backend-node/src/services/universalSegmentPromptBundle.js:321-328, 376-393, 442-501` |
| H3 结构校验 | `backend-node/src/services/h3PromptCompiler.js:5-85` |
| 角色 color_palette 写入 | `backend-node/src/services/characterGenerationService.js:27` |
| 帧提示使用 identity anchor 色彩 | `backend-node/src/services/framePromptService.js:127-152, 265-369` |
| 尾帧服务按最新可播放记录取源 | `backend-node/src/services/tailFrameLinkService.js:9-18` |
| Director 依赖已选 candidate/artifact | `backend-node/src/director/sourceDependency.js:3-33` |
| Director 后期仅标量校色与 Lanczos | `backend-node/src/director/directorPostproductionService.js:16-56` |
| 整集合片与后处理 | `backend-node/src/services/videoMergeService.js:242-372`；`backend-node/src/services/mergedEpisodePostProcess.js:202-397` |
| Director 时间线 concat/xfade | `backend-node/src/director/timelineService.js:143-157` |

本次还执行了两组定向测试：前后端风格预设与 custom metadata 测试 11/11 通过；`backend-node/test/promptI18nClassicVideoPolish.test.js` 4/4 失败，失败原因与报告一致——函数未定义、编辑器元数据未注册。该失败用于确认现存缺陷，本次调查未授权也未修改业务实现。

## 12. 主要行业来源

1. [Runway：Image-to-Video Prompting Guide](https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide)
2. [Runway：Gen-4 Video Prompting Guide](https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide)
3. [Adobe Firefly：有效的视频提示词](https://helpx.adobe.com/firefly/web/work-with-audio-and-video/work-with-video/writing-effective-text-prompts-for-video-generation.html)
4. [Adobe Firefly：关键帧、构图和运动参考](https://helpx.adobe.com/firefly/web/firefly-video-editor/generate-videos/generate-video-using-firefly-models.html)
5. [Adobe Firefly：Style Kits](https://helpx.adobe.com/firefly/web/work-with-enterprise-features/collaborate-using-style-kits/style-kits-overview.html)
6. [Luma：How To Use References Properly](https://lumalabs.ai/learning-center/articles/how-to-use-references-properly)
7. [Luma：Visual Reference User Guide](https://lumalabs.ai/learning-hub/character-reference)
8. [Luma：Ray3 Modify User Guide](https://lumalabs.ai/learning-hub/ray3-modify-user-guide)
9. [Pixar RenderMan：Bourdonnement 制作案例](https://renderman.pixar.com/stories/bourdonnement)
10. [Disney Animation：Look Development](https://www.disneyanimation.com/process/look-development/)
11. [ASC：《John Wick Chapter 3》摄影采访](https://theasc.com/article/john-wick-chapter-3-slayin-in-the-rain/)
12. [ASC：《Killers of the Flower Moon》摄影采访](https://theasc.com/articles/killers-of-the-flower-moon-greed-hubris-and-homicide)
13. [Blackmagic：DaVinci Resolve Color](https://www.blackmagicdesign.com/uk/products/davinciresolve/color)
14. [Blackmagic：DaVinci Resolve 20 Colorist Guide](https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Colorist-Guide.pdf)
15. [Adobe Premiere：不同观看环境的 Gamma 差异](https://helpx.adobe.com/premiere/desktop/troubleshooting/playback-issues/premiere-exports-look-washed-out.html)
16. [Adobe Premiere：导出设置与字幕](https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/overview-of-export-settings.html)
