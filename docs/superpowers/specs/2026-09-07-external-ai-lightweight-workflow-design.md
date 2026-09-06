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

### 本集制作任务包

无论是否继续旧会话，剧情确认后都生成任务包。任务包包含：

- `任务说明.md`：要求外部 AI 根据当前会话已确认剧情只输出 JSON，并说明引用和新增规则。
- `当前项目资产.json`：当前角色、角色状态、场景、道具及生产合同。
- `返回格式.schema.json`：严格的 `local-mini-drama.external-ai-result` 结果合同。

后端同时保存任务记录，下载文件为 ZIP。前端还可复制任务说明和剧情上下文。

## 数据合同

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
- `version` 固定为 `1`。
- `package_id` 必须对应当前项目已经生成的任务。
- 可选 `generator` 和 `audio_plan`。
- 必填 `episode`、`new_assets`、`storyboards`。

`new_assets` 只允许声明：

- 新人物及其状态。
- 既有人物的新状态。
- 新场景。
- 新道具。

分镜引用可以指向任务包中现有资产的 `source_key`，也可以指向本结果的 `local_ref`。已有资产不能在结果中重复定义或覆盖。

新人物必须提供 `name`、`role`、`description`、`personality`、`appearance`、`image_prompt`、`negative_prompt`、`voice_profile` 和至少一个状态。这样人物编辑页依赖的性格和外貌不会因为外部导入而缺失。

### 导入适配

新增结果先经过严格结构校验和引用校验，再由适配器转换成现有 `local-mini-drama.episode-package` 完整投影：

- 从任务快照和当前数据库展开被引用的既有资产。
- 将 `local_ref` 转换为当前任务命名空间内唯一的 `source_key`。
- 合并既有人物的新状态。
- 复用现有制作包的业务校验、差异预览和原子写入事务。

导入时重新计算当前资产摘要：摘要未变化正常导入；发生变化但所有引用仍存在时给出警告；引用已不存在或不属于目标项目时阻止导入。第一阶段不实现自动重放或复杂三方合并。

## API

- `GET /dramas/:dramaId/external-ai/context`：返回新会话剧情上下文和建议文件名。
- `POST /dramas/:dramaId/external-ai/tasks`：生成并持久化任务，接收可选目标集 ID 或目标集号。
- `GET /external-ai/tasks/:packageId/download`：下载任务 ZIP。
- 现有预览和导入接口识别新结果协议，并返回任务来源和资产变化警告。
- `GET /episodes/:id/import-source` 继续返回原始与规范化 JSON，并增加任务包摘要。

## 页面交互

剧集管理页的分集列表区域增加“外部 AI 协作”入口。对话框提供：

1. 新会话：生成并复制剧情上下文。
2. 剧情已确认：选择目标集，生成制作任务，复制说明或下载 ZIP。
3. 导入结果：复用现有三步预览，并接受新结果 JSON。

每个外部导入剧集继续显示“查看来源 JSON”，来源弹窗增加任务包 ID、任务生成时间和资产摘要。

## 错误处理

- 无效项目或目标集返回 404/400。
- 未知或不属于项目的 `package_id` 返回 `PACKAGE_TASK_NOT_FOUND`。
- 结果结构错误返回 `PACKAGE_INVALID`，错误包含字段路径。
- 引用不存在返回 `PACKAGE_REFERENCE_INVALID`。
- 任务资产变化产生 `PACKAGE_ASSETS_CHANGED` 警告；关键引用丢失则阻止导入。
- 正式导入成功后在同一事务中关联任务和 `episode_imports`，避免一方成功另一方失败。

## 不在本次范围

- 多个外部 AI 并行结果自动合并。
- 结构化剧情事实账本和自动伏笔追踪。
- 剧情分支、重启、平行世界管理。
- 外部 AI 修改已有资产。
- 默认打包所有图片、音频或视频。
- 旧 1.0/1.1 协议的新增兼容开发；现有内部能力可保留，但新入口只生成和推荐当前结果协议。

## 验证标准

- 同会话流程能够生成任务 ZIP、导入增量结果并复用项目资产。
- 新会话上下文包含剧情讨论所需的当前项目信息。
- 新角色缺少性格或外貌时预览明确失败。
- 既有角色在结果中只通过引用使用，导入不会覆盖其资料。
- 已删除引用、错误人物状态归属和重复本地引用会被阻止。
- 单集来源页可以查看任务包关联信息和原始外部 JSON。
- 后端相关测试、前端测试及前端构建通过。
