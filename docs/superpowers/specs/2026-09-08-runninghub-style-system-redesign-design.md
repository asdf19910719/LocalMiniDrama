# RunningHub 风格体系重构设计

> 状态：Production Studio V2.1 的风格体系专项规格，不是平行总体架构。
> 上位设计：`2026-09-05-production-studio-v2-design.md`；如有范围冲突，以上位设计为准。

**日期：** 2026-09-08

**实施状态：** 统一风格目录、图片/视频编译、Reference Registry、生成快照和主要 UI 已完成首版实现；阶段批准和 Look stale 投影由 V2.1 继续建设

**范围：** 项目风格库、图片/视频提示词编译、模型能力预检、外部 AI JSON v2、自由创作、生成快照和风格 UI

## 1. 背景

本专项启动前，LocalMiniDrama 维护 39 个静态风格，前端 `styleOptions.js` 与后端 `generationStylePresets.js` 各有一份风格定义。项目同时保存短风格值和 `metadata.style_prompt_zh/en`，图片链路已有高优先级风格注入，普通视频链路主要使用 `. Style: ...` 追加，H3 则使用独立的不可变草稿编译流程。

登录态 RunningHub 调研导出了 169 个真实系统风格，并通过真实图片和视频任务确认了以下模式：

- 项目/剧集风格作为生成上下文持续作用于资产和镜头；
- 风格提示词不仅是名称，还包含色彩、光影、材质、镜头、环境和执行规则；
- 视频最终提示词按“全局风格 → 参考图 → 时间轴 → 台词/声音 → 禁止项”编译；
- 任务保存逐字最终提示词和模型参数快照；
- 模型能力门禁与提示词编译相互独立；
- 画风库采用大缩略图、粗分类、搜索和工作台常驻风格摘要。

本专项不保留旧风格 key 映射，也不允许外部 AI JSON v1 继续写入风格字段，以减少长期双轨。Production Studio V2.1 仍须保证旧项目可打开且内容不丢失：遇到无法解析的旧风格时显示迁移阻断并要求用户选择正式 `style_id`，不得静默映射或令整个项目不可访问。

## 2. 已确认的产品决策

1. 使用 RunningHub 调研所得的 169 个风格替换当前 39 个风格。
2. 不提供旧风格 key 的静默映射或 metadata 回填；旧项目缺少有效 `style_id` 时进入显式选择/修复流程，其他项目内容保持可读。
3. 每个系统风格必须具有中文说明和真实英文生成提示词；不得把中文复制到 `promptEn`。
4. 项目 `style_id` 是项目内唯一权威风格来源。
5. 所有剧集、角色、人物状态、场景、道具、分镜图片和视频继承项目风格，不允许局部风格覆盖。
6. 外部 AI JSON 不允许选择、修改或覆盖项目风格。
7. 外部 AI 返回协议直接升级为 v2，不兼容 v1。
8. 外部 JSON 只提供业务描述与基础提示词，最终提示词由本项目编译。
9. 保留用户自定义风格，但自定义风格必须是正式、结构化并带版本的 `StyleSpec`。
10. 风格只声明推荐模型能力，不绑定或强制切换具体厂商模型。
11. 模型根据能力使用中文、英文或混合语言提示词，用户可查看实际提交文本。
12. 独立自由创作任务可选择正式 `style_id`；绑定项目时必须继承项目风格。
13. RunningHub 风格预览图本地化保存，运行时不热链 RunningHub。
14. 导入外部 JSON 不触发图片或视频生成，不产生生成费用。
15. V2.1 只建设 Provider 提交前的 `PromptStyleGate`；不建设图片视觉理解、视频抽帧或结果级 `StyleConformanceGate`。

## 3. 目标与非目标

### 3.1 目标

- 建立后端唯一的系统风格目录和统一查询 API。
- 将系统风格与用户自定义风格归一为 `StyleSpec`。
- 让图片、视频、H3、自由创作和外部 JSON 共享同一个风格解析器。
- 建立可测试、可版本化的图片和视频提示词编译器。
- 建立稳定的 `@图片N` / `@ImageN` 参考图注册表。
- 在调用模型前完成语言与能力预检。
- 对成功和失败任务保存不可变的逐字最终提示词快照。
- 在提交前逐字验证风格正向块、负向条款、H3 结构内注入和请求快照一致性。
- 让用户在中文 UI 中理解风格，并能按需查看真实中英文生成提示词。

### 3.2 非目标

- 不支持剧集、资产或镜头级风格覆盖。
- 不支持风格混合或权重混合。
- 不自动切换具体模型、厂商或计费渠道。
- 不建设在线风格市场、审核发布和灰度分发系统。
- 不依赖 RunningHub 在线服务运行。
- 不为旧风格 key 或外部 JSON v1 风格字段提供静默兼容；旧项目本身仍须可读，并通过显式选择完成修复。
- 不在导入 JSON 后自动启动高资源或外部计费生成。
- 不对生成图片或视频做风格视觉评分、视频抽帧、VLM 检查或自动拒绝结果。

## 4. 总体架构

```text
System Style Catalog ─┐
                      ├─ StyleRegistryService ── /api/styles
Custom Style Store ───┘              │
                                     ▼
                               StyleResolver
                                     │
                          PromptLanguageResolver
                                     │
                              ReferenceRegistry
                          ┌──────────┴──────────┐
                          ▼                     ▼
                ImagePromptCompiler    VideoPromptCompiler
                          └──────────┬──────────┘
                                     ▼
                         ModelCapabilityValidator
                                     ▼
                         GenerationSnapshotService
                                     ▼
                                  Provider
```

### 4.1 模块职责

| 模块 | 唯一职责 |
| --- | --- |
| `StyleRegistryService` | 加载、校验、分类和查询系统/自定义风格 |
| `StyleResolver` | 根据项目或独立任务解析唯一 `ResolvedStyle` |
| `PromptLanguageResolver` | 根据模型能力选择 `zh`、`en` 或 `mixed` |
| `ReferenceRegistry` | 建立提示词引用与实际素材数组的稳定映射 |
| `ImagePromptCompiler` | 编译角色、状态、场景、道具和分镜图片提示词 |
| `VideoPromptCompiler` | 编译普通视频、Omni 和 H3 共享的镜头语义 |
| `ModelCapabilityValidator` | 在提交前校验模型、素材和参数兼容性 |
| `GenerationSnapshotService` | 在 Provider 调用前保存不可变生成证据 |
| `ExternalAiResultContract v2` | 只接收风格无关的业务内容和 base prompt |

## 5. StyleSpec

系统风格和自定义风格向消费者暴露相同结构：

```json
{
  "id": "cn-90s-realism",
  "type": "system",
  "version": 1,
  "enabled": true,
  "source": "runninghub-research",
  "runningHubId": "258",
  "category": "realistic",
  "sortOrder": 228,
  "labelZh": "90年代写实电影风格",
  "labelEn": "1990s Realistic Cinema",
  "descriptionZh": "强调胶片颗粒、年代色偏、生活化场景和真实抓拍感。",
  "promptZh": "完整中文风格生成指令",
  "promptEn": "Genuine English style instruction for generation models.",
  "keywords": {
    "color": [],
    "lighting": [],
    "material": [],
    "camera": [],
    "environment": [],
    "quality": [],
    "negative": []
  },
  "suitableAssetTypes": [
    "character",
    "character_variant",
    "scene",
    "prop",
    "storyboard",
    "video"
  ],
  "recommendedCapabilities": {
    "renderType": "realistic",
    "supportsTextToImage": true,
    "supportsImageToImage": true,
    "characterConsistency": "recommended",
    "multiReference": "recommended",
    "preferredPromptLanguage": "auto"
  },
  "preview": {
    "localPath": "/style-thumbs/runninghub/258-cn-90s-realism.webp",
    "fallbackColor": "linear-gradient(135deg,#6f5a3d,#29313a)"
  }
}
```

### 5.1 系统风格

- 169 个系统风格存放在后端单一静态目录。
- 前端不再内置完整风格提示词。
- 系统风格只读，启停由目录字段控制。
- 启动时必须完成完整 Schema 校验。

### 5.2 自定义风格

- ID 使用 `custom:<uuid>`。
- 存储完整 StyleSpec 和所有者信息。
- 用户可输入中文说明，由文本模型辅助生成中英文提示词和结构化关键词。
- 保存前必须允许用户查看和编辑。
- 每次编辑使 `version + 1`。
- 被项目使用的自定义风格不得删除。

## 6. 项目风格模型

项目只保存：

```text
dramas.style_id
```

不再使用：

```text
dramas.style
metadata.style_prompt_zh
metadata.style_prompt_en
```

项目创建必须选择有效风格。项目内生成请求提交与项目不同的 `style_id` 时返回 `PROJECT_STYLE_OVERRIDE_FORBIDDEN`。

项目更换风格后：

- 已有业务描述、基础提示词、图片和视频不自动修改或删除；
- 之后的新生成和重新生成使用新风格；
- 历史任务继续显示生成时的风格快照。

## 7. 提示词语言

语言模式为：

| 模式 | 行为 |
| --- | --- |
| `zh` | 中文视觉描述和中文台词 |
| `en` | 英文视觉描述，专有名词和中文台词保留原文 |
| `mixed` | 英文视觉描述与中文对白/旁白组合 |

选择优先级：

1. 模型配置显式 `prompt_language`；
2. 模型能力注册表；
3. StyleSpec 的 `preferredPromptLanguage`；
4. 未知模型回退为 `mixed`。

不得默认重复拼接完整中英文风格块。

## 8. 图片提示词编译

统一结构：

```text
任务类型
→ 最高优先级风格块
→ 资产基础描述
→ 生成模式模板
→ 参考图与身份一致性
→ 输出质量
→ 负向约束
→ 风格重申
```

### 8.1 编译模式

| 对象 | 模式 |
| --- | --- |
| 角色 | 三视图、人设图、单图 |
| 人物状态 | 变装/状态图，必须保留基础身份锚点 |
| 场景 | `NORMAL`、`MULTI_VIEW`、`PANORAMA`、`TOP_DOWN` |
| 道具 | 独立道具图，无人物、无文字、无遮挡 |
| 分镜 | 角色/场景/道具引用、景别、机位、构图和动作时刻 |

基础提示词不含项目风格和版式模板。编译器负责合并对象级负向词与风格负向词，并阻止重复风格注入。

## 9. 视频提示词编译

统一结构：

```text
视频任务声明
→ 全局风格块
→ ReferenceRegistry
→ 镜头目标
→ 分时间轴动作和运镜
→ 台词、旁白和声音
→ 连续性规则
→ 禁止项
```

普通视频、Omni 和 H3 必须共享同一个 `ResolvedStyle`、语言选择和 ReferenceRegistry。H3 只负责把统一生成上下文转换为 H3 专用多模态结构，不能拥有独立风格解析规则。

当前普通视频的 `. Style: ...` 追加方式在新系统中被统一编译器取代。

H3 必须在一次编译中把权威风格块写入 H3 正式结构；禁止先完成 H3 再使用普通视频编译器包裹整段 H3 文本。模型可以组织业务内容，但不能决定是否保留项目风格。

### 9.1 PromptStyleGate

所有图片和视频任务在快照与 Provider 调用前执行同一轻量门禁：

1. 项目风格 ID、版本和目标语言有效；
2. 当前语言的完整权威风格块在最终正向提示词中出现且只出现一次；
3. `keywords.negative` 的必选条款全部进入最终负向提示词；
4. H3 使用同一 StyleSpec，并在 H3 正式结构内完成确定性注入；
5. 编译结果、快照和即将提交的 Provider 请求逐字一致。

门禁输出 `{ ok, styleId, styleVersion, language, checks[], errors[] }`，错误必须定位到缺失、重复或不一致的具体条款。`ok=true` 只证明提示词合同正确，不对生成画面的实际风格质量作保证。

## 10. ReferenceRegistry

注册表项结构：

```json
{
  "index": 1,
  "type": "character_variant",
  "entityId": "...",
  "label": "周启·默认状态",
  "purpose": "identity",
  "image": {
    "url": "...",
    "localPath": "...",
    "sha256": "..."
  }
}
```

同一注册表同时生成：

- 提示词中的 `@图片N` 或 `@ImageN`；
- Provider 请求中的图片数组；
- UI 中的参考图映射；
- 生成任务快照。

任一层顺序不一致时禁止提交。

## 11. 模型能力预检

能力注册表至少覆盖：

- 中文/英文提示词；
- 文生图和图生图；
- 最大参考图数量；
- 真人素材模式；
- 角色一致性；
- 首尾帧；
- 视频时长、画幅和分辨率；
- 台词、音频和多模态；
- H3、Omni 和普通协议。

结果分为：

```text
PASS       可提交
WARNING    可提交但存在明确降级
BLOCKED    禁止提交并给出解决方式
```

风格只声明推荐能力，预检不自动切换厂商或模型。

## 12. 生成快照

在调用 Provider 之前保存：

```json
{
  "compilerType": "video",
  "compilerVersion": "1.0.0",
  "language": "en",
  "style": {
    "id": "cn-90s-realism",
    "version": 1,
    "promptZh": "...",
    "promptEn": "..."
  },
  "source": {
    "basePrompt": "...",
    "structuredContext": {}
  },
  "references": [],
  "model": {
    "configId": "...",
    "provider": "...",
    "model": "...",
    "capabilities": {}
  },
  "parameters": {},
  "finalPrompt": "...",
  "negativePrompt": "...",
  "promptStyleValidation": {
    "ok": true,
    "checks": ["style_block_once", "negative_complete", "request_snapshot_exact"]
  }
}
```

快照保存失败时不得调用 Provider。失败任务也保留完整快照。重试默认复制原快照；输入、风格或模型发生变化时创建新任务。

## 13. 外部 AI JSON V2.1

### 13.1 顶层协议

本节只约束外部协作中的风格边界；完整机器合同以 [`external-ai-result-v2.1.schema.json`](./schemas/external-ai-result-v2.1.schema.json) 为准，规范化目标以 [`episode-package-v2.1.schema.json`](./schemas/episode-package-v2.1.schema.json) 为准。

```json
{
  "schema": "local-mini-drama.external-ai-result",
  "version": "2.1",
  "package_id": "PKG-20260908-001",
  "assets_digest": "0000000000000000000000000000000000000000000000000000000000000000",
  "episode": {},
  "new_assets": {
    "characters": [],
    "character_states": [],
    "scene_assets": [],
    "props": []
  },
  "story_scenes": [],
  "shot_packages": []
}
```

协议不再设置 `prompt_contract` 字段。`base_image_prompt/base_video_prompt` 的语义由 Schema 固定为不含项目 Look 的对象/镜头基础描述；最终文本只由本地编译器生成。

### 13.2 资产字段

角色、人物状态、场景和道具统一使用：

```json
{
  "description": "业务和语义说明",
  "base_image_prompt": "不含项目风格和版式模板的视觉描述",
  "negative_prompt": "对象自身的特殊禁止项"
}
```

`shot_packages[]` 可以提供 `base_video_prompt`，但最终视频提示词仍由结构化时段、引用和项目 Look 在本地重新编译。

禁止字段包括：

```text
image_prompt
polished_prompt
style
style_id
style_prompt
style_override
final_prompt
final_video_prompt
compiled_prompt
```

### 13.3 任务 ZIP

任务 ZIP 提供只读风格上下文：

```json
{
  "project": {
    "style_id": "cn-90s-realism",
    "style_label": "90年代写实电影风格",
    "style_description_zh": "用于理解世界观的中文说明"
  }
}
```

任务说明必须明确：风格由项目控制；返回 JSON 不得复制或覆盖完整风格提示词。

### 13.4 导入流程

```text
Schema 2.1 校验
→ package_id/assets_digest/项目/目标集绑定
→ 任务资产快照和引用校验
→ 禁止字段与风格污染检测
→ 只读预览
→ 单事务创建资产、场次、Shot Package、base prompt 和来源记录
→ 生成本地编译预览
```

导入不调用图片或视频模型。

## 14. 自由创作

- 绑定项目的自由任务继承项目 `style_id`，不能修改。
- 完全独立的自由任务必须选择正式系统或自定义 `style_id`。
- 不再接受任意自由文本风格。
- 独立结果回灌项目时，只能作为普通参考素材；需要在项目中生成时，使用项目风格重新编译。

## 15. UI 设计

### 15.1 风格选择器

吸收 RunningHub 的视觉优先模式：

- 接近全屏的大弹窗；
- “我的风格 / 全部 / 真人 / 3D / 2D”粗分类；
- 搜索；
- 四列大比例缩略图；
- 风格名称覆盖在图片底部；
- 卡片明确的边框、勾选和“当前项目风格”状态；
- 按需打开详情抽屉，不使用永久三栏压缩网格。

详情抽屉展示：

- 中文名称和说明；
- 色彩、光影、镜头、材质和环境关键词；
- 适用资产；
- 推荐模型能力和本机匹配模型；
- 高级区域中的中文/英文生成提示词；
- 风格来源和版本。

### 15.2 工作台常驻摘要

设定、分镜和自由模式顶部持续显示：

```text
项目风格：90年代写实电影风格
胶片颗粒、年代色偏、生活化场景……
```

设定页提供项目级“更换风格”，资产卡片只显示“继承项目风格”，不提供局部画风。

### 15.3 资产编辑

统一显示三层：

```text
业务说明
基础图片提示词（可编辑）
最终编译提示词（只读、按需展开）
```

### 15.4 分镜视频面板

显示：

- 项目风格；
- 镜头业务描述；
- `@图片N` 参考图注册表；
- 模型和参数；
- 模型能力预检；
- 最终提示词预览；
- 任务与历史。

### 15.5 外部 JSON 导入预览

显示协议、项目/集数绑定、只读项目风格、基础提示词、预计编译模式、资产引用和错误报告。用户不能在导入弹窗中修改风格。导入目标只允许新建剧集或填充空白剧集；非空目标必须显示 `TARGET_NOT_BLANK` 并提供“选择空白剧集/创建新剧集/取消”，不提供合并或覆盖。

## 16. RunningHub 预览图本地化

直接使用 RunningHub 真实预览图，但下载到项目本地，不在运行时热链。

目录约定：

```text
frontweb/public/style-thumbs/runninghub/
```

采集 manifest：

```json
{
  "runningHubId": "258",
  "styleId": "cn-90s-realism",
  "sourceUrl": "...",
  "localPath": "/style-thumbs/runninghub/258-cn-90s-realism.webp",
  "sha256": "...",
  "width": 640,
  "height": 360,
  "collectedAt": "2026-09-08",
  "status": "downloaded"
}
```

采集流程为：提取登录态原始地址、下载临时文件、校验 MIME 和尺寸、转换 WebP、计算哈希、写入最终目录。失败风格使用本地渐变兜底。运行时不请求 RunningHub。

## 17. 错误模型

主要错误码：

```text
STYLE_NOT_FOUND
STYLE_DISABLED
STYLE_SCHEMA_INVALID
STYLE_ENGLISH_PROMPT_MISSING
STYLE_PREVIEW_MISSING
CUSTOM_STYLE_IN_USE
PROJECT_STYLE_REQUIRED
PROJECT_STYLE_OVERRIDE_FORBIDDEN
LEGACY_SCHEMA_UNSUPPORTED
STYLE_OVERRIDE_FORBIDDEN
FINAL_PROMPT_FORBIDDEN
BASE_PROMPT_REQUIRED
BASE_PROMPT_CONTAINS_STYLE_BLOCK
PROMPT_COMPILATION_FAILED
STYLE_PROMPT_MISSING
STYLE_PROMPT_DUPLICATED
STYLE_NEGATIVE_INCOMPLETE
STYLE_SNAPSHOT_MISMATCH
PROMPT_LANGUAGE_UNSUPPORTED
REFERENCE_MISSING
REFERENCE_ORDER_MISMATCH
REFERENCE_LIMIT_EXCEEDED
REAL_PERSON_MODE_REQUIRED
MODEL_CAPABILITY_UNSUPPORTED
SNAPSHOT_PERSIST_FAILED
```

缩略图缺失是可降级警告；风格定义、参考图映射、模型能力和快照错误必须阻止提交。

## 18. 一致性与事务

- 后端启动时校验 169 个系统风格的数量、唯一性、中英文、Schema 和预览 manifest。
- 项目创建必须引用有效风格。
- 自定义风格删除执行引用保护。
- 外部 JSON 先只读预览，确认后单事务写入；失败完整回滚。
- 生成顺序固定为“解析 → 编译 → PromptStyleGate → 能力预检 → 快照 → 请求逐字复核 → 任务 → Provider”。
- Provider 已调用但没有快照的状态在新系统中不得发生。

## 19. 测试策略

### 19.1 风格目录

- 恰好 169 个系统风格；
- ID、key 和 RunningHub ID 唯一；
- 中文说明和真实英文提示词完整；
- `promptEn` 与中文不相同；
- 分类、关键词和能力枚举有效；
- manifest 与预览文件对应；
- 自定义风格 CRUD、版本和引用保护。

### 19.2 项目规则

- 新项目必须选择风格；
- 所有项目内对象解析同一 `style_id`；
- 请求级覆盖被拒绝；
- 更换风格不修改历史快照；
- 绑定项目和独立自由任务规则正确。

### 19.3 图片 Golden Tests

覆盖角色三视图、人设图、单图、人物状态、场景普通/多视图/全景/俯视、道具和分镜图。逐字验证风格块、语言、base prompt、负向词、版式和无重复注入；缺失、重复、负向遗漏和快照不一致必须在 Provider 调用前失败。

### 19.4 视频 Golden Tests

覆盖普通视频、多参考图、首尾帧、Seedance/Omni、H3、三种语言模式、时间轴、对白/旁白/环境声、真人模式和能力失败。普通视频与 H3 必须使用相同 StyleSpec 和 ReferenceRegistry；H3 风格必须在正式结构内一次完成，不再测试或允许外层普通提示词包裹。

### 19.5 外部 JSON v2

- v1、旧字段、风格覆盖和最终提示词被拒绝；
- 合法 base prompt 可导入；
- 完整风格模板污染被识别；
- 普通颜色和灯光描述不误判；
- 失败事务回滚；
- 来源 JSON 和导入报告可回读；
- 导入后生成使用项目风格。
- 创建新剧集和填充空白剧集成功；非空剧集在预览与正式事务中均被 `TARGET_NOT_BLANK` 阻止；
- 导入只写结构化草稿，不自动生成图片、视频或音频。

### 19.6 前端

- 169 个风格支持虚拟滚动、分类和搜索；
- 卡片选中态和详情抽屉正确；
- 中文说明与高级中英文内容正确；
- 工作台常驻项目风格；
- 外部导入风格只读；
- 模型能力错误定位到具体参数；
- 最终提示词可查看但不能覆盖业务字段。

## 20. 实施分解

实施计划应按以下顺序拆分：

1. 规范化 169 个 StyleSpec、真实英文提示词和预览图 manifest；
2. 下载并本地化 RunningHub 预览图；
3. 建立 StyleRegistry、自定义风格存储和 API；
4. 修改项目 `style_id` 与风格选择 UI；
5. 建立语言、图片、视频、参考图和能力编译服务；
6. 将普通视频、Omni 和 H3 接入统一编译；
7. 将外部 JSON、Schema、任务 ZIP、导入器和 UI 升级为 v2；
8. 修改自由创作规则；
9. 删除旧双份风格表、旧兼容逻辑和 v1 测试；
10. 运行后端测试、前端测试、构建和关键路径手工验收；
11. 更新业务文档和根目录 `CHANGELOG.md`。

每个功能阶段遵循测试先行，完成前必须用实际测试输出验证。

## 21. 验收标准

- 新项目必须从 169 个系统风格或用户自定义风格中选择一个。
- 设定、分镜和自由模式能够持续显示项目风格中文摘要。
- 所有系统风格都能查看中文说明和真实英文提示词。
- 169 个 RunningHub 预览图已本地化，缺失项有明确兜底。
- 项目内不存在资产或镜头级风格覆盖入口和 API。
- 图片、普通视频、Omni 和 H3 使用同一 StyleResolver。
- `@图片N` 的 UI、提示词、请求和快照顺序完全一致。
- 模型不支持真人、参考图、语言、时长或分辨率时，在调用前阻止并说明原因。
- 外部 JSON v1 被拒绝，v2 不能携带任何风格覆盖或最终提示词。
- 外部 JSON 导入不触发生成、不产生费用。
- 外部 JSON 不能合并、覆盖或追加到非空剧集；完整导入入口位于项目详情/剧集列表，Studio 只查看来源。
- 每个图片和视频任务都能回读实际提交的逐字最终提示词、风格版本、引用和模型参数。
- PromptStyleGate 对缺失、重复、负向遗漏和请求/快照不一致进行阻断；系统不执行结果级风格视觉分析。
- 后端测试、前端测试和前端构建全部通过。

## 22. 设计证据

- `业务整理/RunningHub真实风格提示词与模型映射.json`
- `业务整理/RunningHub真实生成案例分析.md`
- `业务整理/RunningHub与当前项目风格模块全链路分析.md`
- `docs/research/RunningHub-RH剧场全站功能与商业化补全调查-2026-09-08.md`
- `docs/research/_artifacts/runninghub-survey-2026-09-08/01-画风库-预设画风面板.png`
- `docs/research/_artifacts/runninghub-survey-2026-09-08/02-设定页-角色三视图卡片.png`
- `docs/research/_artifacts/runninghub-survey-2026-09-08/03-分镜页-三栏编辑器.png`
- `docs/research/_artifacts/runninghub-survey-2026-09-08/04-短片页-镜头时间线.png`
- `docs/research/_artifacts/runninghub-survey-2026-09-08/05-设定页-自由模式节点画布.png`
