# 外部 AI 轻量协作流程设计

## 目标

LocalMiniDrama 支持用户在外部 AI 会话中持续讨论剧情，并在每集剧情确认后，由项目生成包含当前资产事实和严格输出合同的制作任务包。外部 AI 返回增量结果，项目完成校验、差异预览、原子导入和来源留档。

## 角色边界

- 用户负责与外部 AI 讨论剧情并确认创作决定。
- 外部 AI 负责把会话中已确认的剧情整理为结构化结果。
- LocalMiniDrama 是项目资产和生产约束的唯一事实源，不承担完整的自动编剧记忆管理。

## 两阶段协作

### 新会话剧情上下文

用户仅在开启新的外部 AI 会话时使用。项目生成可直接复制的 Markdown，包含项目梗概、风格、连续性备注、既有分集摘要、最近一集剧本、角色完整设定以及场景和道具索引。

项目级连续性备注存入 `dramas.metadata.external_ai_continuity_notes`。第一阶段不增加结构化剧情事实表，也不自动推断伏笔。

上述项目梗概、人物背景/关系和连续性备注只作为外部 AI 的创作上下文，不作为图片或视频 Provider 的通用 Prompt 输入，也不构成生成 Gate。外部结果导入后，只有被归一化为人物/场景/道具当前生产状态、具体分镜或 Project Look 引用的有效字段，才可能进入后续生成任务快照并按实际引用范围参与 stale 计算。

### 本集制作任务包

无论是否继续旧会话，剧情确认后都生成任务包。任务包包含：

- `任务说明.md`：要求外部 AI 根据当前会话已确认剧情只输出 JSON，并说明引用和新增规则。
- `当前项目资产.json`：当前角色、角色状态、场景、道具及生产合同。
- `返回格式.schema.json`：严格的 `local-mini-drama.external-ai-result` 结果合同。

后端同时保存任务记录。用户可下载两种等价载体：

- ZIP：包含任务说明、当前项目资产和返回 Schema，适合支持多附件的外部 AI。
- 单文件任务 JSON：内嵌上述三部分和元数据，适合只接收一个文件的外部 AI。

两种载体使用同一个 `package_id/assets_digest`，不得形成两套任务协议。前端还可复制任务说明和剧情上下文。

## 数据合同

Production Studio V2.1 只生成、预览和导入当前 `2.1` 合同。机器合同以 [`external-ai-result-v2.1.schema.json`](./schemas/external-ai-result-v2.1.schema.json) 为唯一依据；规范化目标以 [`episode-package-v2.1.schema.json`](./schemas/episode-package-v2.1.schema.json) 为准。项目尚未上线，不建设 1.x/1.1 运行期适配器，也不在同一入口保留旧协议分支。

目标 `2.1` 顶层必填 `schema/version/package_id/assets_digest/episode/new_assets/story_scenes/shot_packages`。每条 Shot Package 必须提供 `story_scene_refs[]`、`planned_duration_seconds` 和至少一个 `timed_segments[]`；每个时段保存连续起止时间及 `scene_asset_refs[]/character_state_refs[]/prop_refs[]`。单时段完全合法；外部 AI 不得返回 Provider、模型、`request_duration_seconds`、Project Look 或最终提示词。

### 任务记录

`external_ai_package_tasks` 保存：

- `package_id`：项目生成的唯一标识。
- `drama_id`、可选的 `target_episode_id` 和目标集号。
- `assets_digest`：生成任务时公开资产清单的 SHA-256。
- `context_markdown`、`instructions_markdown`、`asset_manifest_json`、`response_schema_json`。
- `asset_snapshot_json`：只供导入器使用的公开引用到数据库实体的映射和生成时 `updated_at`。
- `created_at`、`imported_at`。

任务生成时为缺少 `source_key` 的现有资产补充分项目稳定键。人物、场景、道具和人物状态分别使用 `char_<id>`、`scene_<id>`、`prop_<id>`、`variant_<id>`；已有非空键保持不变。

### 外部 AI 结果

顶层严格字段：

- `schema` 固定为 `local-mini-drama.external-ai-result`。
- `version` 固定为 `2.1`；其他版本明确返回 `PACKAGE_VERSION_UNSUPPORTED`。
- `package_id` 必须对应当前项目已经生成的任务。
- `assets_digest` 必须等于任务包携带的 64 位 SHA-256，用于绑定生成时的资产快照。
- 可选 `generator` 和 `audio_plan`。
- 必填 `episode`、`new_assets`、`story_scenes`、`shot_packages`。

`new_assets` 固定包含 `characters/character_states/scene_assets/props` 四个数组，没有新增项时传空数组，只允许声明：

- 新人物及其状态。
- 既有人物的新状态；必须放在 `character_states[]`，通过 `character_ref` 指向任务快照中的人物 `source_key`，且 `is_default` 固定为 `false`。
- 新场景。
- 新道具。

分镜引用统一使用 `source_key`，既可以指向任务包中的现有资产，也可以指向本结果 `new_assets` 中声明的新资产。新资产的 `source_key` 必须在任务命名空间中唯一；已有资产不能在结果中重复定义或覆盖。

新人物必须提供 `name`、`role`、`description`、`personality`、`appearance`、`base_image_prompt`、`negative_prompt`、`voice_profile` 和至少一个状态；新人物状态、新场景和新道具也必须提供对象自身的 `base_image_prompt/negative_prompt`。`base_*` 只描述对象或镜头语义，不含项目 Look 和最终模板。这样人物编辑页依赖的性格、外貌和后续生图输入不会因为外部导入而缺失。

### 导入适配

新增结果先经过严格结构校验和引用校验，再由确定性适配器转换成 V2.1 单集制作包：

- 验证 `package_id`、项目归属和 `assets_digest`，解析任务快照中的既有资产。
- 将 `new_assets.characters/scene_assets/props` 与被引用的既有资产合并；再把 `new_assets.character_states` 按 `character_ref` 追加到对应人物的 `states`，生成直接制作包的 `assets`；所有 `source_key` 不改变。
- 保持 `episode/story_scenes/shot_packages/audio_plan/extensions` 的语义与顺序不变。
- 输出规范化 `local-mini-drama.episode-package@2.1`，复用其业务校验、五步差异预览和原子写入事务。
- 适配器禁止调用模型、补写缺失剧情或猜测引用；无法确定时返回结构化错误。

协议识别固定读取根级 `schema + version`。错误码只使用本文“错误处理”表中的唯一命名；未知业务字段一律拒绝，厂商扩展只能放在显式 `extensions` 对象。

导入时重新计算当前资产摘要：摘要未变化正常导入；发生变化但所有引用仍存在时给出警告；引用已不存在或不属于目标项目时阻止导入。不实现自动重放或复杂三方合并。

### 导入目标限制（V2.1 已确认）

外部 AI 结果和完整单集制作包均只允许“创建新剧集”或“填充空白剧集”。非空剧集一律返回 `TARGET_NOT_BLANK`，不支持合并、覆盖或追加；即使任务包最初绑定了某个目标剧集，只要该集在任务生成后变为非空，正式导入也必须拒绝。用户可改为创建新剧集，不能强制继续。

“导入结果”只表示创建结构化草稿和引用，不表示自动生成资产图、分镜图、视频或音频。导入过程不得启动远端 Provider，也不得产生生成费用。

## API

- `GET /dramas/:dramaId/external-ai/context`：返回新会话剧情上下文和建议文件名。
- `POST /dramas/:dramaId/external-ai/tasks`：生成并持久化任务，接收可选目标集 ID 或目标集号。
- `GET /external-ai/tasks/:packageId/download?format=zip|json`：下载任务 ZIP 或单文件任务 JSON；默认 `zip`。
- V2.1 预览和导入接口识别外部 AI 结果协议，并返回任务来源和资产变化警告。
- `GET /episodes/:id/import-source` 返回原始与规范化 JSON、任务包摘要和导入报告。

## 页面交互

“外部 AI 协作”是创建剧集和剧集管理的主流程来源之一，不是隐藏的专业工具。对话框提供：

1. 新会话：生成并复制剧情上下文。
2. 剧情已确认：选择目标集，生成制作任务，复制说明，或下载 ZIP/单文件任务 JSON。
3. 导入结果：进入统一五步预览（文件与目标、剧本与场次、资产匹配、分镜与时段、确认导入）。

完整导入入口固定在项目详情的剧集列表及其空状态；Production Studio 只显示“外部来源”只读入口，不在分镜阶段头部重复放置剧集级导入按钮。

每个外部导入剧集继续显示“查看来源 JSON”，来源弹窗增加任务包 ID、任务生成时间和资产摘要。

## 错误处理

| 顶层错误码 | 触发条件 | details/恢复 |
|---|---|---|
| `PACKAGE_SCHEMA_UNSUPPORTED` | 根级 `schema` 不是 `local-mini-drama.external-ai-result` | 返回收到的协议名和支持的协议名；重新选择文件 |
| `PACKAGE_VERSION_UNSUPPORTED` | `version` 是字符串但不是 `"2.1"` | 返回收到与支持版本；不尝试运行期升级 |
| `PACKAGE_SCHEMA_INVALID` | JSON 语法错误、`version` 不是字符串、必填/类型/未知字段不符合 Schema | `details[]` 提供 JSON Pointer、关键字和安全文案；修复文件后重试 |
| `PACKAGE_TASK_NOT_FOUND` | `package_id` 不存在或不属于当前项目 | 重新选择项目或使用正确任务结果 |
| `PACKAGE_HASH_MISMATCH` | 回流 `assets_digest` 与该 `package_id` 冻结摘要不一致 | 返回 expected/actual，不进入资产变化比较 |
| `PACKAGE_BUSINESS_INVALID` | 引用不存在、重复 `source_key`、时码未闭合、集号/顺序冲突、`character_ref` 非法等跨字段错误 | `details[]` 逐项返回稳定 detail code、JSON Pointer 和相关 `source_key` |
| `TARGET_NOT_BLANK` | 目标剧集在预览或事务提交时已非空 | 只允许选择空白集、创建新集或取消 |

此前笼统的“包无效”和“引用无效”顶层命名全部废止。引用不存在、时码错误和重复 `source_key` 统一归入 `PACKAGE_BUSINESS_INVALID.details[]`。无效项目仍使用标准 404；目标参数格式错误使用标准 400，不另造 Package 错误码。

当前项目资产相对任务快照发生变化但冻结摘要本身匹配时，返回非阻断 warning `PACKAGE_ASSETS_CHANGED`；若关键引用已丢失，同时返回顶层 `PACKAGE_BUSINESS_INVALID`。正式导入成功后在同一事务中关联任务和 `episode_imports`，避免一方成功另一方失败。

## 不在本次范围

- 多个外部 AI 并行结果自动合并。
- 结构化剧情事实账本和自动伏笔追踪。
- 剧情分支、重启、平行世界管理。
- 外部 AI 修改已有资产。
- 将结果合并、覆盖或追加到非空剧集。
- 默认打包所有图片、音频或视频。
- 旧 1.0/1.1 协议的读取、升级、生成或兼容开发。

## 验证标准

- 同会话流程能够生成内容等价的任务 ZIP/单文件任务 JSON、导入增量结果并复用项目资产。
- 新会话上下文包含剧情讨论所需的当前项目信息。
- 新角色缺少性格或外貌时预览明确失败。
- 既有角色在结果中只通过引用使用，导入不会覆盖其资料。
- 已删除引用、错误人物状态归属和重复本地引用会被阻止。
- 单集来源页可以查看任务包关联信息和原始外部 JSON。
- 非 2.1 结果明确拒绝，非空剧集零写入，导入不会启动任何媒体生成任务。
- 后端相关测试、前端测试及前端构建通过。
