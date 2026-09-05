# LocalMiniDrama Production Studio V2 下一大版本设计

> 日期：2026-09-05
> 状态：设计提案，待评审；本文不包含业务代码变更
> 目标版本：LocalMiniDrama 下一个大版本
> 输入依据：当前代码、RunningHub RH剧场真实交互调查、LibTV 两个画布调查、关键帧衔接调查、风格与提示词行业对照调查

## 1. 设计结论

下一大版本不应继续向 `FilmCreate.vue` 追加功能。推荐把产品重构为四阶段 Production Studio：

```text
剧本 Script
   ↓  Script Gate
设定 Bible
   ↓  Look Gate + Asset Gate
分镜 Storyboard
   ↓  Shot Gate
短片 Film
   ↓  Picture Lock + Color Gate + Delivery Gate
交付 Delivery
```

对用户仍只显示“剧本、设定、分镜、短片”四个顶层入口；Picture Lock、调色和交付是短片阶段内部状态，不增加不必要的顶部复杂度。

核心不是页面拆分，而是建立三个唯一真相：

1. **Production Stage State**：当前集每个阶段处于草稿、待审核、已批准还是已失效；
2. **Shot Package**：每个镜头的结构化意图、引用清单、时长、声音和 Provider 编译快照；
3. **Artifact Lineage**：每张图、每段视频、每个截帧、每次超分和每版成片来自什么输入与版本。

当前项目已经具备大量可复用能力：角色状态、三帧提示词、canonical reference slots、Omni/H3 编译、视频候选、连续性锚点、Director 时间线、字幕/TTS/水印、基础调色和云超分。本设计的重点是**整合、门禁和可追溯性**，不是推倒重写生成能力。

## 2. 问题定义

### 2.1 当前用户流程问题

当前制作页 `frontweb/src/views/FilmCreate.vue` 超过 1.1 万行，把以下功能放在同一个滚动页面中：

- 剧本创建、选择和导入；
- 全局画风；
- 一键流水线；
- 角色、场景、道具；
- 分镜脚本、分镜图、首尾帧；
- 视频生成和候选；
- 视频配置和整集合成。

导航栏虽然显示“故事剧本、角色、道具、场景、分镜脚本、分镜图、分镜视频”，但完成状态主要由“是否有文字/图片/视频”推导。它不能回答：

- 这版剧本是否经过确认；
- 这张角色图只是生成成功，还是已批准的身份主图；
- 风格改变后哪些旧提示词、旧图片、H3 草稿已经失效；
- 某镜头使用的是哪个角色状态、场景视角、Look 和上一镜状态；
- 哪段视频是候选、已选片、被替换版本还是最终时间线素材；
- 当前成片是预览、Picture Lock、调色版还是交付版。

### 2.2 当前技术问题

1. `FilmCreate.vue` 同时承担布局、状态聚合、业务编排、生成和轮询，改动风险高；
2. `DramaCanvas.vue` 和 FilmCreate 是两套操作表面，尚未成为同一阶段状态的不同视图；
3. `dramas.style + metadata.style_prompt_*` 能注入多数生图链，但只是可变字符串；
4. H3 草稿指纹包含业务提示词、槽位、参数、配置和技能版本，却未包含项目 Look/style；
5. 风格变化不会统一令角色、场景、道具的自动 prompt stale；
6. Director candidate/anchor/timeline 能力存在，但普通制作主路径不以它为唯一选片和合片真相；
7. 一键流水线用 20/30 秒倒计时充当“浏览确认”，不是可审计批准；
8. 经典主路径和 Director 主路径都能合片，容易形成双重成片真相；
9. Provider 能力判断存在于多个局部模块，尚未成为统一能力契约；
10. 生成、候选、选用、衍生处理和交付版本的谱系不完整。

### 2.3 已确认的强项

本设计必须保留并放大这些能力：

- `character_variants` 和镜头人物状态关联；
- canonical reference slot 顺序和引用可用性；
- 首帧、关键帧、尾帧专业提示词；
- `layout_description` 和邻镜布局上下文；
- Omni 多参考和 H3 结构化编译；
- H3 草稿的 AI/人工/失效/结构校验状态；
- 1～3 个视频候选、质量检查、人工选用和理由；
- 任意时间截帧并派生超分/线稿连续性锚点；
- Director 时间线的排序、源偏移、时长、Cut/Fade/Dissolve；
- 字幕、旁白 TTS、对白音频、水印、基础色调和云超分；
- 持久化异步任务和生成进度聚合；
- 项目 ZIP 导入导出和媒体历史。

## 3. 设计目标与非目标

### 3.1 目标

1. 普通用户能按四个阶段完成一集，不必理解数据库、Provider 协议或节点图；
2. 高级用户能进入画布、H3 草稿、引用清单和 Director，而不制造第二套数据；
3. 每次昂贵生成前都能知道输入是否完整、为何失效、预计消耗和可降级项；
4. 风格、角色、场景、道具或模型替换后，由系统重编镜头包，不要求用户手改全部提示词；
5. 任何已批准资产和成片都可追溯、比较和回滚；
6. 连续性同时使用长期资产锚点和上一镜即时状态锚点；
7. 把选片、时间线、Picture Lock、调色、超分和交付变成单一成片主路径；
8. 保持现有数据和 API 可渐进迁移，已有项目打开后不丢内容。

### 3.2 非目标

- 不在本版本实现完整 Premiere/DaVinci 级非线编；
- 不自研视频生成模型；
- 不要求每个项目都使用 3D 导演台；
- 不强迫所有图片和视频都超分；
- 不把所有提示词改成用户不可编辑的黑盒；
- 不删除 FilmCreate/DramaCanvas 旧入口后再一次性迁移全部数据；
- 不让自动化跳过批准门禁直接花费大量资源，除非用户明确启用已批准的 Recipe。

## 4. 总体信息架构

### 4.1 路由

建议新增：

```text
/film/:dramaId/studio/:stage?episode=:episodeId

stage = script | bible | storyboard | film
```

旧路由兼容：

```text
/film/:id          → /film/:id/studio/script
/film/:id/canvas   → /film/:id/studio/bible?mode=advanced
```

过渡期保留旧页面，通过 feature flag 决定默认进入 V1 或 V2。

### 4.2 Studio Shell

页面固定区域：

```text
┌ 项目名 ─ 集数 ─ 保存状态 ─ 任务/费用 ─ 设置 ┐
├ 剧本 ─ 设定 ─ 分镜 ─ 短片 ───────────────┤
│ 左：阶段导航/问题列表 │ 中：主工作区 │ 右：检查器 │
└ 全局任务抽屉 / 版本历史 / 错误详情 ─────────┘
```

顶部阶段轨道每项显示：

- `draft` 草稿；
- `ready_for_review` 待确认；
- `approved` 已确认；
- `stale` 上游已变化；
- `blocked` 缺必要输入；
- `processing` 正在生成；
- `failed` 有失败任务。

可以浏览后续阶段，但付费生成和最终确认使用硬门禁。若用户从 URL 进入被锁阶段，页面保留正确路由并展示“缺少什么”的 blocker 面板，不静默显示另一个阶段。

### 4.3 标准模式与高级模式

四个阶段都遵守同一原则：

| 标准模式 | 高级模式 |
|---|---|
| 卡片、表格、向导 | 画布、结构化 JSON、编译预览 |
| 自动建议和安全默认值 | 细粒度引用、模型和参数控制 |
| 面向完成任务 | 面向调试和复杂制作 |

两种模式调用同一套 API，使用同一 entity ID、revision 和 approval。切换模式不复制数据。

## 5. 生产状态机

### 5.1 阶段状态

每一集每一阶段保存独立状态：

```text
draft
  → ready_for_review
  → approved
  → stale
  → ready_for_review
  → approved
```

辅助状态 `processing/failed/blocked` 由任务和门禁聚合，不取代内容 revision。

### 5.2 批准语义

批准不是“有文件”或“任务成功”：

- Script Gate：批准剧本 revision；
- Look Gate：批准 Look Bible revision；
- Asset Gate：批准本集使用的角色/场景/道具版本；
- Shot Gate：批准镜头列表、时长、引用和预演；
- Video Gate：每镜至少有一个已选候选，或明确标记跳过；
- Picture Lock：批准剪辑顺序、入出点、时长和转场；
- Color Gate：批准技术匹配和创意 Look；
- Delivery Gate：批准分辨率、帧率、音频、字幕、水印和文件校验。

### 5.3 软门禁和硬门禁

| 操作 | 未批准时 |
|---|---|
| 查看下游页面 | 允许，显示 stale/blocked |
| 编辑下游草稿 | 允许，但记录基于哪个上游 revision |
| 生成低成本预览 | 可配置允许 |
| 批量生图/生视频 | 默认禁止，需上游批准 |
| 导出交付母版 | 禁止，需 Picture/Color Gate |

### 5.4 变更失效矩阵

| 变化 | 必须失效 | 保留但标记风险 |
|---|---|---|
| 剧本场次内容改变 | 受影响场次的提取结果、镜头包、编译提示词 | 已生成媒体保留为历史 |
| 全剧 Look 改变 | 自动资产 prompt、分镜图 prompt、H3/Omni 编译快照、Color Gate | 人工 prompt/已批准媒体保留，要求选择保留或重编 |
| 场次 Look 改变 | 该场次镜头包和自动 prompt | 其他场次不动 |
| 角色主版本改变 | 引用该角色的镜头包 | 不引用该角色的镜头不动 |
| 角色状态改变 | 引用该状态的镜头包 | 角色主版本仍有效 |
| 场景视角/状态改变 | 引用该版本的镜头包、构图预演 | 场景实体不删除 |
| 道具状态改变 | 相关镜头包、连续性检查 | 道具主版本仍有效 |
| 镜头时长改变 | 时码、H3 草稿、Provider 编译快照、时间线 | 已生成候选保留但标时长不匹配 |
| Provider/工作流改变 | Provider 编译快照 | 业务意图和引用绑定不变 |
| 选中视频候选改变 | 下游连续性帧、Picture Lock | 其他候选保留 |
| 重新选择上一镜稳定帧 | 直接依赖的下一镜编译/候选 | 更后镜头按依赖图传播 |

失效计算必须基于 fingerprint 和依赖关系，不能靠前端临时布尔值。

## 6. 剧本阶段设计

### 6.1 页面组成

左侧：分场大纲；中间：正文编辑器；右侧：结构检查和版本历史。

分场大纲至少保存：

```json
{
  "sceneKey": "EP01_SC03",
  "heading": "洞穴出口",
  "interiorExterior": "EXT",
  "timeOfDay": "黄昏",
  "characters": ["CHAR_LINFAN", "CHAR_SUWANER"],
  "storyPurpose": "揭露真相并建立告别动机"
}
```

### 6.2 操作

- 保存草稿；
- AI 润色选中段落；
- 重新切分场次；
- 对比上一版；
- 导入/导出；
- 提交确认；
- 重新打开已确认版本。

### 6.3 修改影响

提交确认前显示：

```text
本次修改影响：
- 2 个角色出场关系
- 1 个场景描述
- 3 个分镜
- 3 个 H3 草稿
- 已生成视频不删除，将移入历史并标记“基于旧剧本”
```

允许三种应用范围：

- 只保存文字，不刷新下游；
- 刷新受影响场次；
- 整集重新提取。

## 7. 设定阶段设计

### 7.1 分类

设定页包含五个标签：

```text
Look｜角色｜场景｜道具｜声音
```

Look 放在第一位，因为它会约束后续所有视觉资产；角色、场景和道具沿用现有数据；声音集中管理角色音色、环境底噪和音乐意图。

### 7.2 Look Approval

当前 `StylePickerButton` 升级为 Look 工作台，不再把“点击预设”直接等同于项目画风生效。

Look Bible 字段：

```json
{
  "medium": "3D国潮动漫",
  "realism": 0.65,
  "rendering": ["PBR材质", "柔和全局光"],
  "cameraLanguage": ["35mm-65mm", "克制推拉", "避免鱼眼"],
  "lighting": ["低调布光", "轮廓冷光"],
  "palette": {
    "dominant": ["#183047", "#6F8A9B"],
    "accent": ["#D86B3C"],
    "skinStrategy": "肤色保持中性偏暖",
    "forbidden": ["高饱和荧光绿"]
  },
  "texture": ["轻胶片颗粒", "潮湿石材"],
  "negativeAesthetic": ["塑料皮肤", "过锐HDR", "海报式摆拍"],
  "promptZh": "...",
  "promptEn": "..."
}
```

确认流程：

1. 选择预设或自定义；
2. 系统用同一固定测试主体生成 2～4 张低成本 Style Probe；
3. 用户并排比较；
4. 可锁定媒介、色域、人物肤色、镜头语言等字段；
5. 选中候选并填写可选理由；
6. 保存不可变 Look revision；
7. 后续生成引用 `look_profile_id + version + fingerprint`。

### 7.3 场次 Look 与 Color Script

全剧 Look 之下允许场次覆盖：

```text
全剧 Look Bible
  ├─ SC01 日/压抑/冷灰
  ├─ SC02 洞穴/冰蓝/高反差
  ├─ SC03 黄昏/橙蓝过渡
  └─ SC04 告别/低饱和暖金
```

Color Script 不是必须为每镜生一张色卡。第一版用场次卡即可：主色、辅色、禁色、曝光、对比度、主光方向、材质和情绪。镜头级覆盖只在闪回、梦境、主观镜头等特殊情况使用。

色卡图片的引用角色必须是 `look`，不能伪装成 `scene`。

### 7.4 资产统一模型

角色、场景、道具共用以下概念：

```text
Entity（语义实体）
└─ Version（不可变版本）
   ├─ description revision
   ├─ prompt revision
   ├─ reference bindings
   ├─ generation candidates
   ├─ selected artifact
   └─ approval
```

角色版本类型：`identity_master / costume / injury / age / pose_reference`。
场景版本类型：`master / view / time / weather / damage_state / zone`。
道具版本类型：`master / held / opened / damaged / depleted / transformed`。

### 7.5 资产详情抽屉

所有资产详情统一显示：

- 名称、描述、出场集/场次；
- 当前批准版本；
- 候选和历史；
- 主参考图和辅助参考图；
- 自动 prompt 与人工覆盖；
- 模型、布局、画幅、成本预估；
- 跟随哪个 Look revision；
- 依赖它的镜头列表；
- 生成、上传、比较、批准、派生版本和下载。

### 7.6 标准/高级共用数据

标准模式显示资产卡；高级模式使用现有 DramaCanvas 节点。节点中的 prompt、模型和引用更新同一 asset version，不能写回 `metadata.workflow_groups` 形成另一套半结构化真相。

## 8. 分镜阶段设计

### 8.1 页面结构

```text
左：场次/镜头轨道
中：故事板、分镜图、2D/3D预演、视频预览
右：镜头检查器
底：整集时长轨、问题和批量操作
```

镜头检查器分为：

- 基本：镜号、时长、场次、叙事目的；
- 画面：景别、机位、镜头运动、构图和光线；
- 表演：角色、动作 beat、对白、情绪；
- 状态：服装、伤势、道具持有、进入/离开位置；
- 引用：canonical reference manifest；
- 声音：对白、旁白、环境、音效、音乐；
- Provider：模式、模型、能力和参数；
- 质量：时长、引用、连续性和冲突检查。

### 8.2 Shot Package

每镜保存 Provider 无关的业务包：

```json
{
  "schema": "shot_package_v2",
  "shotId": "EP01_SC01_SH01",
  "revision": 3,
  "duration": 8,
  "storyIntent": "林凡决定接下任务，压住伤势",
  "visual": {
    "shotSize": "medium_close_up",
    "cameraAngle": "eye_level",
    "cameraMovement": "slow_push_in",
    "composition": "林凡右三分位，苏婉儿左后景",
    "lighting": "冷环境光，脸侧微暖"
  },
  "beats": [
    { "start": 0, "end": 3, "action": "林凡咳嗽并握紧药瓶" },
    { "start": 3, "end": 6, "dialogue": "别担心，我没事" },
    { "start": 6, "end": 8, "action": "转身向山林走去" }
  ],
  "continuity": {
    "entry": { "facing": "left", "propHand": "right" },
    "exit": { "facing": "away", "propHand": "right" },
    "axis": "AXIS_SC01_A"
  },
  "lookRef": { "id": "LOOK_SC01", "version": 2 },
  "references": [
    { "role": "scene_view", "entityId": 31, "version": 2 },
    { "role": "character_state", "entityId": 8, "version": 4 },
    { "role": "prop_state", "entityId": 12, "version": 1 },
    { "role": "continuity_frame", "artifactId": "...", "optional": true }
  ],
  "audio": {
    "dialogue": [{ "characterId": 8, "text": "别担心，我没事" }],
    "ambience": "风吹松林",
    "musicIntent": "不进入旋律，只保留低频悬念"
  }
}
```

用户编辑的是 Shot Package；Provider 文本只是编译结果。

### 8.3 Reference Manifest

延续现有 canonical slot 设计，数据库真相使用稳定 ID 和职责：

```json
{
  "bindingId": "ref_...",
  "role": "character_state",
  "entityType": "character_variant",
  "entityId": 88,
  "artifactId": "img_...",
  "required": true,
  "sortOrder": 20,
  "framingNote": "只参考身份和服装，不参考三视图拼版构图"
}
```

提交给 Provider 时才生成 `@图片1` 或 `Mixed 1`。保存编译快照：

```text
bindingId → Provider slot index → URL/hash → prompt label
```

增删引用时只令编译结果 stale，不改业务引用 ID。

### 8.4 预演产物

2D画板、3D导演台和 AI 分镜图都属于构图预演，但职责不同：

| 类型 | 作用 | 是否直接作为身份参考 |
|---|---|---:|
| `composition_previs_2d` | 站位、轴线、运动箭头 | 否 |
| `composition_previs_3d` | 机位、焦段感、空间透视 | 否 |
| `storyboard_frame` | 叙事构图和角色外观联合参考 | 可选 |
| `first_frame` | 视频起点 | 是，适用于 I2V/FL2V |
| `key_frame` | 动作高潮/中间状态 | 取决于 Provider |
| `last_frame` | 设计终点 | 是，适用于 FL2V |
| `continuity_frame` | 上一段真实生成状态 | 是，适用于相邻镜 |

LocalMiniDrama 首版不必实现完整 3D 引擎。可先将外部/内置 2D 草图、站位 JSON、相机参数和截图作为版本化预演产物；3D 作为高级可插拔工具。

### 8.5 时长预算器

每次修改镜头时实时计算：

- 总集时长；
- 场次时长；
- 本镜 beat 数；
- 对白预计时长；
- Provider 可选时长；
- 相邻镜头合并后是否超上限；
- 生成实际时长与目标偏差。

默认规则建议：

```text
单一清晰动作 beat：2～4 秒
动作 + 反应：4～8 秒
含一句短对白：按 TTS 估算 + 0.5～1 秒表演余量
每 5 秒超过 3 个显著动作：警告
镜头内超过 3 个机位变化：建议拆镜
```

规则是可配置警告，不替代导演判断。

### 8.6 Shot Gate

批准分镜前检查：

- 镜号唯一且顺序连续；
- 时长与 beat 时间码闭合；
- 必要角色/场景/道具已绑定批准版本；
- Prompt 中无越界引用；
- 构图和人物状态与邻镜不冲突；
- Provider 支持请求模式；
- 首尾帧或参考图数量在模型上限内；
- 台词时长不超过镜头；
- 2D/3D预演若存在，版本未失效；
- 显示预计任务数、费用/资源和批量策略。

## 9. Prompt Compiler V2

### 9.1 分层

```text
Look Bible / Scene Look
        +
Asset facts / state facts
        +
Shot Package / timed beats
        +
Reference Manifest
        +
Provider Capability
        ↓
Provider-specific compiled prompt + request snapshot
```

不要把人物外貌、场景和风格复制到每条可编辑长文本中。文本编辑器提供三层：

1. 业务意图：用户主要编辑；
2. 自动编译预览：可查看；
3. 人工 Provider 覆盖：高级可编辑，必须记录来源和 stale 策略。

### 9.2 按模式编译

| 模式 | 编译重点 | 避免 |
|---|---|---|
| T2V | 主体、场景、构图、风格、动作、镜头、节奏 | 无参考却缺主体信息 |
| I2V | 动作、镜头运动、时间推进、环境动态 | 重复描述输入图中所有静态细节 |
| FL2V | 从首帧到尾帧的可实现变化和路径 | 同时要求互相冲突的构图 |
| Ref2V/Omni | 每个引用职责、主体关系、动作/声音 | 只靠裸位置序号 |
| H3 | H3 固定结构、多模态说明、声景、音乐和时间线 | 编译后再拼普通 style 尾巴 |
| V2V/重拍 | 保持区间、修改区间、参考视频和替换意图 | 把整段当全新视频生成 |

### 9.3 统一 fingerprint

所有 prompt revision 的 source fingerprint 至少包含：

```text
shot_package_hash
reference_manifest_hash
look_profile_hash
asset_version_hashes
duration / dimensions / audio
provider_config_snapshot
workflow_hash
compiler_version / skill_hash
manual_override_policy
```

H3 必须补入 `look_profile_hash`，并让预览、编译、提交使用同一个 resolved Look。风格变化后 H3 draft 必须显示 `stale: look`。

### 9.4 人工覆盖策略

自动 prompt：上游变化后自动 stale，可一键重编。
人工覆盖：不自动覆盖，提供：

- 保留人工内容并更新引用快照；
- 用新输入重编后显示 diff；
- 放弃人工覆盖；
- 锁定某些段落，重编其余段落。

## 10. 短片阶段设计

### 10.1 页面结构

```text
上：生成/选片状态、场次筛选、批量策略、费用
左：镜头轨和版本状态
中：当前候选/已选视频预览
右：提示词、引用、模型、质量和处理工具
下：成片时间线、音轨和 Picture Lock
```

### 10.2 镜头生成与候选

直接复用并升级 `VideoGenerationPanel.vue`：

- 当前 Provider 和工作流；
- 业务 prompt 与 H3 编译 prompt 分层；
- 参数和能力检查；
- 1～3 个候选；
- 队列、取消、重试；
- 候选元数据和错误；
- 技术质量检查；
- 选用理由；
- 候选组历史。

候选选用是 Video Gate 的事实来源。`storyboards.video_url` 只作为兼容投影，不再是唯一真相。

### 10.3 批量策略

批量生成不是固定并发数，而是依赖图调度：

```text
无相邻连续性依赖的镜头 → 可并行
使用上一镜 continuity_frame → 串行链
同一 Provider/GPU 的资源限制 → 按队列串行或限流
需要用户选片后才能继续 → 暂停在 review
```

提供三种用户策略：

- 快速预览：独立镜头并行，暂不使用真实上一镜帧；
- 连续性优先：每镜选片/自动质量门通过后生成下一镜；
- 自定义：画布中编辑依赖。

任何自动选片必须满足预设质量阈值，并保留“为什么选它”和回滚能力。

### 10.4 连续性锚点统一

当前“尾帧衔接”和 Director 任意帧锚点合并为一个入口：**创建下一镜状态参考**。

流程：

1. 从已选候选读取真实视频；
2. 默认在结尾 0.2～1.0 秒范围寻找清晰稳定帧；
3. 可人工拖动选择；
4. 执行人脸清晰、运动模糊、遮挡和构图检查；
5. 可选原图、2× 超分或线稿派生；
6. 保存 source artifact、时间/帧号、hash、用途和参数；
7. 绑定到下一镜 `continuity_frame`；
8. 下一镜 Provider 不支持时明确降级为构图参考或不使用。

不允许“生成完成立即不可逆覆盖下一镜首帧”。已有首帧进入历史，新锚点先作为候选引用，用户或 Recipe 决定采用。

### 10.5 局部重拍

第一版局部重拍应基于支持 V2V/segment edit 的 Provider：

- 在时间线上选择区段；
- 固定区段前后上下文；
- 引用原视频和必要资产；
- 描述只需要修改的表演/动作/物体；
- 新结果作为候选片段，不直接覆盖已选视频；
- 选用后建立父子 artifact lineage。

若 Provider 不支持，UI 应建议：重新生成整镜、裁掉问题区间或用相邻镜头遮挡，不显示无效按钮。

### 10.6 时间线和 Picture Lock

升级现有 `DirectorTimelinePanel.vue`：

- 镜头拖拽排序；
- 多区段拆分/删除/恢复；
- 入点、出点、变速；
- Cut/Fade/Dissolve；
- 视频、对白、旁白、环境、音乐轨；
- 全片播放；
- 时间码和总时长；
- 时间线版本；
- 保存草稿与 Picture Lock 分开。

Picture Lock 后：

- 仍可创建新时间线版本；
- 当前锁定版本不可就地修改；
- 调色、字幕、混音和超分绑定此版本；
- 重新选片或改剪辑会令后期版本 stale，但不删除旧输出。

### 10.7 后期处理分层

不要把所有操作都叫“高清”。分为：

#### 技术修复

- 解码/黑帧/冻结/时长检测；
- 去字幕/去水印（在有合法素材和适用模型时）；
- 人声增强；
- 伴奏提取；
- 降噪和响度；
- 超分。

#### 镜头匹配

- 曝光；
- 白平衡；
- 对比度；
- 饱和度；
- 肤色和黑位；
- 相邻镜差异检测。

#### 创意 Look

- 应用批准的 show/scene Look；
- LUT/曲线/色彩变换；
- 强度和例外镜头；
- 人工预览与批准。

正确顺序建议：

```text
选片 → 剪辑/Picture Lock
→ 技术校正和镜头匹配
→ 创意 Look
→ 合片后按需超分
→ 字幕/水印/最终混音
→ 编码与交付验证
```

现有云超分设计要求“合片后、字幕和水印前”应保留。若调色会明显改变画面，通常先做颜色处理再超分；具体顺序由处理模型和性能测试固化成 recipe。

### 10.8 何时超分

自动建议条件：

- 源分辨率低于交付分辨率；
- 时间线存在明显裁切/放大；
- 参考细节重要且画面内容本身正确；
- Provider 输出柔软但无结构错误。

不建议条件：

- 人物身份、手指、动作或构图本身错误；
- 严重闪烁或帧间变形；
- 只是码率低；
- 源文件已达到交付规格且细节足够。

前三类问题应重生成、局部重拍、稳定或重编码，超分不会修复语义错误。

## 11. 数据模型

### 11.1 新增表

#### `production_stage_states`

```text
id, drama_id, episode_id, stage,
content_revision, status,
source_fingerprint, blocker_json,
approved_revision, approved_by, approved_at,
created_at, updated_at
```

唯一键：`episode_id + stage`。

#### `look_profiles`

```text
id, drama_id, scope_type, scope_id, name, active_version_id, created_at
```

#### `look_profile_versions`

```text
id, look_profile_id, version, parent_version_id,
definition_json, prompt_zh, prompt_en, fingerprint,
status, selected_artifact_id, approved_by, approved_at, created_at
```

#### `production_asset_versions`

```text
id, entity_type, entity_id, version, version_role,
parent_version_id, description_snapshot, prompt_revision_id,
look_version_id, selected_artifact_id, fingerprint,
status, approved_at, created_at
```

不立即替代 `character_variants`。迁移期为现有角色状态建立映射，后续再统一。

#### `shot_packages`

```text
id, storyboard_id, revision, schema_version,
package_json, source_fingerprint, status,
approved_at, created_at, updated_at
```

#### `reference_bindings`

```text
id, owner_type, owner_id, owner_revision,
reference_role, entity_type, entity_id, asset_version_id,
artifact_id, required, sort_order, framing_note,
source_fingerprint, created_at
```

#### `prompt_revisions`

```text
id, owner_type, owner_id, purpose, provider_key,
source_text, compiled_text, negative_text,
source_fingerprint, look_fingerprint, compiler_version,
manual_policy, status, validation_json, created_at
```

#### `quality_reports`

```text
id, artifact_id, gate, analyzer_version,
status, metrics_json, issues_json, created_at
```

#### `timeline_versions`

若现有 `director_timelines` 不便扩展，再新增：

```text
id, episode_id, version, parent_id, state,
timeline_json, source_fingerprint,
picture_locked_at, output_artifact_id, created_at
```

优先评估直接扩展 `director_timelines`，避免双表。

### 11.2 复用和扩展现有表

- `director_artifacts`：继续作为视频/派生产物谱系中心，扩展 `artifact_type`、`owner_type/id`、`look_fingerprint`；
- `director_candidate_groups/candidates`：作为视频候选唯一主路径；
- `director_anchors`：作为 continuity frame；扩展目标镜头绑定；
- `storyboard_h3_prompt_drafts`：逐步迁移到通用 `prompt_revisions`，短期补 look fingerprint；
- `image_generations/video_generations`：保留 Provider 作业记录，不承担批准状态；
- `storyboards`：保留兼容字段，同时把新 `shot_package_id` 作为 V2 入口；
- `video_merges` 和 `video_upscale_jobs`：继续作为执行记录。

### 11.3 兼容投影

V2 选中资产/视频后继续回写旧字段：

- 角色/场景/道具 `image_url/local_path`；
- `storyboards.video_url`；
- 首/尾帧字段；
- `episodes.video_url`。

旧页面可继续读取，但 V2 的批准和历史以新表为准。

## 12. API 设计

### 12.1 阶段

```text
GET  /api/v2/episodes/:episodeId/stages
GET  /api/v2/episodes/:episodeId/stages/:stage
POST /api/v2/episodes/:episodeId/stages/:stage/submit-review
POST /api/v2/episodes/:episodeId/stages/:stage/approve
POST /api/v2/episodes/:episodeId/stages/:stage/reopen
GET  /api/v2/episodes/:episodeId/impact?fromRevision=...
```

所有批准端点要求 `expected_revision`，防止用旧页面批准新内容。

### 12.2 Look 和资产

```text
GET/POST /api/v2/dramas/:dramaId/look-profiles
POST     /api/v2/look-profiles/:id/versions
POST     /api/v2/look-versions/:id/probes
POST     /api/v2/look-versions/:id/approve

GET      /api/v2/assets/:type/:id/versions
POST     /api/v2/assets/:type/:id/versions
POST     /api/v2/asset-versions/:id/generations
POST     /api/v2/asset-versions/:id/select
POST     /api/v2/asset-versions/:id/approve
```

### 12.3 镜头包和编译

```text
GET  /api/v2/storyboards/:id/package
PUT  /api/v2/storyboards/:id/package
GET  /api/v2/storyboards/:id/references
PUT  /api/v2/storyboards/:id/references
POST /api/v2/storyboards/:id/preflight
POST /api/v2/storyboards/:id/compile
POST /api/v2/storyboards/:id/approve
```

`preflight` 返回：

```json
{
  "ready": false,
  "blockers": [],
  "warnings": [],
  "providerCapabilities": {},
  "compiledReferenceSnapshot": [],
  "estimatedTasks": 3,
  "estimatedCost": null,
  "estimatedGpuSeconds": 180
}
```

本地模型无法精确折算货币时，显示预计 GPU 时间和任务数，不伪造费用。

### 12.4 视频和时间线

现有 Director API 可保留，新增面向产品的聚合层：

```text
POST /api/v2/storyboards/:id/video-candidate-groups
POST /api/v2/video-candidates/:id/select
POST /api/v2/video-artifacts/:id/continuity-frames
POST /api/v2/video-artifacts/:id/retakes

POST /api/v2/episodes/:id/timelines
POST /api/v2/timelines/:id/picture-lock
POST /api/v2/timelines/:id/render-preview
POST /api/v2/timelines/:id/color-match
POST /api/v2/timelines/:id/deliver
```

## 13. 前端模块拆分

建议结构：

```text
frontweb/src/views/productionStudio/
  ProductionStudio.vue
  ScriptStage.vue
  BibleStage.vue
  StoryboardStage.vue
  FilmStage.vue

frontweb/src/components/production/
  StageRail.vue
  StageGatePanel.vue
  RevisionHistoryDrawer.vue
  DependencyImpactDialog.vue
  CostPreflight.vue

frontweb/src/components/look/
  LookApprovalWorkbench.vue
  LookProbeCompare.vue
  SceneLookCard.vue
  ColorScriptBoard.vue

frontweb/src/components/assets/
  AssetGrid.vue
  AssetDetailDrawer.vue
  AssetVersionHistory.vue
  AssetReferenceEditor.vue

frontweb/src/components/storyboard/
  ShotRail.vue
  ShotInspector.vue
  ReferenceManifestEditor.vue
  TimedBeatEditor.vue
  PrevisWorkspace.vue

frontweb/src/components/film/
  ShotGenerationWorkspace.vue
  CandidateReview.vue
  ContinuityFramePicker.vue
  FilmTimeline.vue
  PictureLockPanel.vue
  ColorMatchPanel.vue
  DeliveryPanel.vue
```

现有 `StylePickerButton` 变为 Look 工作台中的 preset browser；`VideoGenerationPanel` 拆出可复用表单、候选和锚点组件；`DirectorTimelinePanel` 升级为 FilmTimeline；`DramaCanvas` 成为各阶段的高级视图容器。

## 14. 后端服务拆分

建议新增：

```text
productionStageService.js
productionRevisionService.js
dependencyInvalidationService.js
lookProfileService.js
assetVersionService.js
shotPackageService.js
referenceManifestService.js
promptCompilerRegistry.js
providerCapabilityService.js
productionPreflightService.js
filmTimelineService.js
qualityGateService.js
deliveryService.js
```

复用：

- `referenceSlotService` → reference manifest 兼容解析；
- `h3PromptCompiler/h3PromptDraftService` → H3 adapter；
- `unifiedVideoGenerationService` → 统一生成执行器；
- `candidateGroupService` → 候选审核；
- `continuityAnchorService` → 稳定帧衔接；
- `timelineService/videoMergeService` → 时间线和渲染；
- `directorQualityService` → 技术质量门；
- `mergedEpisodePostProcess/directorPostproductionService` → 声音、字幕、颜色；
- `videoUpscale` → 可恢复云超分作业。

## 15. Provider 能力契约

统一能力对象建议：

```json
{
  "provider": "minimax",
  "model": "h3",
  "modes": ["i2v", "fl2v", "ref2v"],
  "reference": {
    "min": 1,
    "max": 9,
    "image": true,
    "video": false,
    "audio": true,
    "semanticLabels": true
  },
  "duration": { "kind": "range", "min": 5, "max": 15, "step": 1 },
  "resolution": ["864x480", "1280x704"],
  "features": {
    "firstFrame": true,
    "lastFrame": true,
    "nativeAudio": true,
    "videoContinuation": false,
    "segmentRetake": false,
    "cameraControl": false
  },
  "incompatibilities": [
    ["lastFrame", "cameraControl"]
  ]
}
```

前端表单、preflight、编译器和提交服务全部读取同一能力对象。隐藏、禁用、降级和错误必须来自同一个判定函数。

## 16. 质量门

### 16.1 Look Gate

- 测试图是否使用同一可比较主体；
- 媒介、色域、肤色和材质是否一致；
- 是否存在禁用美学；
- 中英文 prompt 是否语义一致；
- 是否保存 fingerprint 和批准版本。

### 16.2 Asset Gate

- 主图是否清晰；
- 角色身份特征是否稳定；
- 三/四视图是否没有宫格文字污染；
- 场景多视角是否属于同一空间；
- 道具比例和状态是否明确；
- 参考图是否达 Provider 最低尺寸；
- 状态派生是否有父版本。

### 16.3 Shot Gate

- 时间码闭合；
- 动作和对白密度合理；
- 引用可用且未错位；
- 轴线、朝向、持物、伤势和服装连续；
- Look 与场次一致；
- Provider 能力兼容。

### 16.4 Video Gate

现有技术检查之外增加：

- 人物身份相似度；
- 服装/道具状态；
- 相邻镜首尾帧构图差异；
- 亮度、色温、饱和度差异；
- 明显人脸/手部/文字伪影；
- 对白口型/音色存在性（可选）；
- 选择理由和人工覆盖。

### 16.5 Color Gate

- 先做镜头匹配，再做创意 Look；
- 自动结果必须可预览和逐镜例外；
- 关键肤色不被 LUT 推出安全范围；
- 相邻镜头没有突兀曝光/白平衡跳变；
- 输出色彩空间和编码标记一致。

### 16.6 Delivery Gate

- 分辨率、帧率、时长；
- 音频轨、响度、峰值；
- 字幕同步和安全区；
- 水印和片尾；
- 黑帧、冻结、缺帧、解码；
- 文件 hash 和 manifest；
- 实际输出不是旧时间线/旧 Look 版本。

## 17. 一键流程重设计

当前倒计时式一键流程改为 Recipe：

```text
Recipe = 已批准输入 + 执行策略 + Provider 配置快照 + 停止条件
```

默认 Recipe：

1. 生成文本框架；
2. 停在 Script Gate；
3. 批量生成 Look Probe 和资产低成本候选；
4. 停在 Look/Asset Gate；
5. 生成分镜文本和预览图；
6. 停在 Shot Gate；
7. 按快速预览或连续性优先策略生成视频；
8. 停在候选 review；
9. 所有镜头选片后构建时间线；
10. Picture Lock 后执行后期和交付。

高级用户可以启用自动批准条件，例如“技术质量通过且相似度高于阈值时自动选片”，但系统仍保存自动决策和原因。

暂停和恢复必须由后端持久化 job graph 驱动，不能依赖前端倒计时或内存 Promise。

## 18. 从 RunningHub 与 LibTV 吸收的具体点

| 来源 | 吸收点 | 如何落地 | 不照搬之处 |
|---|---|---|---|
| RH剧场 | 四阶段轨道 | ProductionStudio 路由与 stage state | URL/可见阶段必须一致 |
| RH剧场 | 主资产 + 派生资产 | production asset versions | 派生版本必须有角色和父版本 |
| RH剧场 | 标准/自由模式 | 同 API 的卡片/画布双视图 | 不保存两套数据 |
| RH剧场 | 时码镜头 prompt | TimedBeatEditor + duration gate | 不鼓励超长过载文本 |
| RH剧场 | 2D/3D导演台 | versioned composition previs | 不在首版自研完整 3D DCC |
| RH剧场 | 动态 Provider 参数 | capability service | 不把所有模型映射成相同表单 |
| RH剧场 | 生成后工具 | FilmStage action registry | 工具按素材状态和能力显示 |
| 青城夜巡人 | 场景多视图和长期资产锚点 | scene version roles | 不用多视图拼图直接控制成片布局 |
| 青城夜巡人 | 多模态图片+声音引用 | reference manifest | 不用裸 Mixed N 作数据库真相 |
| 秋人 | 独立色卡/摄影圣经 | Look/Color Script reference | 不复制五千字固定提示词到每镜 |
| 秋人 | 轴线/动作结束状态 | continuity entry/exit schema | 不仅写“承接上一镜” |
| 关键帧调查 | 任意稳定帧优于编码尾帧 | ContinuityFramePicker | 不自动不可逆覆盖下一镜首帧 |
| H3/超分调查 | 编译可追溯、成片后按需超分 | fingerprint + recoverable upscale | 不对语义错误使用超分 |

## 19. 迁移与实施阶段

### Phase 0：正确性基线

目标：在换 UI 前先保证数据真相正确。

- H3 编译和 freshness 纳入项目/场次 Look hash；
- 风格变化令自动资产 prompt stale；
- 修复/补齐经典视频提示词润色缺口；
- canonical reference slots 成为所有生图/生视频引用主路径；
- 统一 Provider capability contract；
- 为选中候选 → 锚点 → 时间线建立端到端测试；
- 解决测试 Node ABI 基线，锁定 `.nvmrc` 版本。

### Phase 1：Studio Shell 与阶段状态

- 新路由和四阶段壳；
- `production_stage_states`；
- 旧 FilmCreate 数据只读适配；
- Script Gate 和影响预览；
- 任务抽屉和 blocker 面板；
- feature flag 双轨运行。

### Phase 2：Look 与资产版本

- Look Bible、Style Probe、批准版本；
- 场次 Look/Color Key；
- 资产候选、版本、批准和依赖镜头；
- 标准设定页；
- DramaCanvas 改为高级视图。

### Phase 3：Shot Package 与分镜工作台

- shot package schema；
- timed beats；
- reference manifest editor；
- 时长预算和 Provider preflight；
- 2D预演/站位产物；
- Shot Gate；
- H3/Omni/经典编译 adapter。

### Phase 4：短片与成片收口

- 视频候选作为唯一选片主路径；
- 稳定帧选择；
- 局部重拍；
- 完整时间线和音轨；
- Picture Lock；
- 镜头匹配/创意 Look；
- 云超分、字幕、混音、水印和 Delivery Gate；
- 成片版本和 manifest。

### Phase 5：旧入口退役

- 比较 V1/V2 项目输出；
- 将旧 FilmCreate 改为 V2 跳转；
- 删除重复编排逻辑；
- 保留项目导入导出兼容；
- 更新用户文档和迁移说明。

## 20. 验收标准

### 20.1 端到端用户验收

1. 新建项目后，用户能按四阶段完成一集；
2. 未批准输入可浏览下游，但不能误触高成本批量生成；
3. 修改剧本只失效受影响场次；
4. 切换 Look 后，所有自动 prompt/H3 草稿正确显示 stale；
5. 人工 prompt 不被静默覆盖；
6. 替换角色状态后，只重编引用它的镜头；
7. 每镜可生成多个候选、质量检查、选用并保留历史；
8. 能从已选视频选稳定帧作为下一镜引用；
9. Provider 不支持该引用时，UI 明确阻止或降级；
10. 时间线可裁剪、排序、变速、转场并保存版本；
11. Picture Lock 后后期绑定正确版本；
12. 超分失败可恢复或跳过，基础合片不丢失；
13. 导出 manifest 可追溯到剧本、Look、资产、prompt、候选和时间线版本。

### 20.2 自动化验收

- stage 状态机和乐观锁；
- dependency invalidation 矩阵；
- Look hash → H3 stale；
- asset version → affected shot package only；
- reference manifest → Provider slot snapshot；
- Provider capability 表单/后端同源；
- candidate select → current video projection；
- selected artifact → continuity frame → next shot payload；
- timeline Picture Lock immutability；
- color/post/upscale 顺序；
- 后端重启后的任务恢复；
- V1 项目迁移和回滚；
- 前端窄屏/长集性能，不能重新出现 1.1 万行页面级全量重渲染。

### 20.3 性能目标

- 200 镜项目切换阶段不加载所有视频二进制；
- 镜头轨虚拟列表；
- 单镜更新不触发整集深度 watch；
- 媒体缩略图懒加载；
- stage summary 使用聚合 API；
- 候选和历史分页；
- 任务轮询聚合为 episode/job stream，避免每卡独立轮询。

## 21. 风险与对策

| 风险 | 对策 |
|---|---|
| 新旧表双写不一致 | V2 事务内写主表和兼容投影，增加对账任务 |
| 抽象层过多导致开发慢 | Phase 0 只统一 resolver/fingerprint/capability，逐步扩展 |
| 用户被批准流程拖慢 | 允许软浏览、批量批准和已批准 Recipe |
| 高级画布再次形成旁路 | 所有写操作必须走 V2 API，不允许直接改 metadata |
| Prompt 编译黑盒 | 保存业务意图、编译输出、引用快照和 diff |
| 自动连续性造成错误传播 | 稳定帧作为候选引用；依赖链可见、可断开 |
| 自动调色损伤肤色 | 镜头匹配与创意 Look 分层，Color Gate 人工复核 |
| Provider 快速变化 | 能力契约由配置/适配器提供，UI 不硬编码 |
| 大项目状态计算慢 | 保存依赖边和 fingerprint，增量失效 |
| 测试环境不稳定 | 固定 Node 22.22.3，与 better-sqlite3 ABI 对齐 |

## 22. 备选方案

### 方案 A：继续扩展 FilmCreate

优点是短期快；缺点是状态、渲染和认知复杂度继续增长，无法形成明确批准和版本边界。否决。

### 方案 B：完全照搬 RH剧场四页 UI

优点是外观成熟；缺点是会丢掉 LocalMiniDrama 已有的 H3、canonical slots、Director artifact 和可恢复云超分优势。否决。

### 方案 C：以 DramaCanvas 为唯一主界面

优点是灵活；缺点是普通用户难以知道下一步和完成条件，节点图不天然等于生产状态机。画布应作为高级视图，不作为唯一入口。否决。

### 方案 D：四阶段壳 + 单一数据模型 + 高级画布

兼顾普通制作路径、复杂项目和现有能力复用，是推荐方案。

## 23. 首个可交付里程碑

第一个可独立上线的 V2 里程碑不是“把四个页面都画出来”，而是：

1. ProductionStudio Shell；
2. Script Stage + Script Gate；
3. Bible Stage 中的 Look Approval 和角色/场景/道具批准状态；
4. H3/自动资产 prompt 的 Look fingerprint 修复；
5. 旧 FilmCreate 的只读/跳转兼容；
6. 完整的 stage/approval/invalidation 自动化测试。

它上线后即可解决“选择不等于确认”“上游变化下游不失效”和“所有功能堆在一页”三类最核心问题，并为分镜和短片阶段迁移建立稳定地基。

## 24. 关联文档

- `docs/research/RunningHub-RH剧场短剧制作全流程交互调查-2026-09-05.md`
- `docs/research/style-prompt-pipeline-industry-review-2026-09-04.md`
- `docs/LibTV青城夜巡人视频制作流程调查说明.md`
- `docs/LibTV秋人视频制作流程调查说明.md`
- `docs/分镜视频关键帧衔接机制调查说明.md`
- `docs/Zealman-MiniMax-H3-U06工作流导出与RTX超分调查说明.md`
- `docs/superpowers/specs/2026-09-05-canonical-storyboard-reference-pipeline-design.md`
- `docs/superpowers/specs/2026-09-05-cloud-video-upscale-postprocess-design.md`

## 25. 最终建议

LocalMiniDrama 的下一大版本应该从“功能很多的生成页面”升级为“有批准、有版本、有引用、有成片状态的制作系统”。

推荐决策是：

```text
保留现有生成与 Director 能力
  + 修复 Look/H3/Prompt 失效正确性
  + 建立四阶段 Production Studio
  + 用 Shot Package 和 Reference Manifest 统一镜头输入
  + 用候选/时间线/Picture Lock 统一成片输出
  + 用 Color Gate 和 Delivery Gate 收口质量
```

完成这次改造后，替换自定义风格、人物、场景、道具或模型将成为“替换批准版本并增量重编”的操作，而不是人工追着每条提示词和每个旧缓存修改。这是该版本最关键的产品价值。
