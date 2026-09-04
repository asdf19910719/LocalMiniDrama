# 同通道 ComfyUI 工作流切换设计（修订版）

日期：2026-09-04

## 1. 目标与范围

一条 ComfyUI 视频通道可以声明多个经过注册表治理的工作流，用户在每次生成时选择其中一个。切换不改变默认通道，不影响已创建任务；运行、重试和恢复始终使用创建时快照。

本次同时消除原方案中四类风险：

1. 不再用 `adapter` 或工作流名称猜测 H3 行为；
2. `configured` 工作流是否可提交与全局实验开关保持一致；
3. 存量 NULL 草稿不再被解释为“当前默认工作流”；
4. ComfyUI Provider 的尺寸、显存、参考图和提示词校验按工作流执行契约分派，不再无条件执行 H3 规则。

本次交付工作流切换基础设施，并以现有两个注册表工作流完成真实切换回归。新社区二采工作流仍需提供其 API JSON、模型和自定义节点锁定信息；若图结构不同，还需提供对应 adapter。缺少这些外部材料时不得伪造生产注册表条目。

## 2. 已确认的现状与痛点

- 默认视频通道由 `ai_service_configs` 中唯一的活动 `service_type='video' AND is_default=1` 行解析。
- `model` 已是数组，resolver 已支持请求模型属于数组成员，但显式 `workflow_id` 仍被限制为等于解析出的 model。
- AI 配置页把 ComfyUI 工作流硬编码为 `minimax_h3_director_r2v`，生成面板也存在相同硬编码默认值。
- capabilities 只报告默认工作流；测试连接只取 `model[0]`。
- H3 判定在前后端重复使用名称匹配，草稿只按 `(storyboard_id, video_config_id)` 区分。
- ComfyUI Provider 与配置保存当前无条件使用 H3 尺寸/显存规则，不能正确承载一般 adapter 工作流。
- 当前注册脚本方案若对解析后的对象做 `JSON.stringify` 再计算 SHA，会与注册表按文件原始字节校验的口径不一致。

## 3. 方案选择

采用方案 A：通道工作流白名单 + 注册表目录 + 请求级选择 + 工作流级草稿。

- 通道 `model` 是允许集合，`default_model` 是集合内默认项。
- 注册表是工作流定义、执行契约和治理状态的唯一来源。
- 请求只选择通道允许且当前可提交的注册表成员。
- 快照同时记录实际 `model` 与 `workflowId`，两者在 ComfyUI 场景必须一致。

不采用“每个工作流一个通道”作为主路径。它技术上仍可维持唯一默认通道，但会重复维护 base URL/凭据/连接设置，而且不能满足按次选择。也不允许绕过通道白名单直接选择任意注册表条目。

## 4. 注册表执行契约

每个工作流新增必填 `execution`：

```json
{
  "promptContract": "h3_director_v1",
  "requiresPromptDraft": true,
  "dimensions": {
    "minWidth": 32,
    "maxWidth": 4096,
    "minHeight": 32,
    "maxHeight": 4096,
    "multipleOf": 32
  },
  "references": { "min": 1, "max": 9 },
  "vramPolicy": "h3_estimate",
  "defaults": {
    "width": 1312,
    "height": 736,
    "durationSeconds": 5,
    "frameRate": 24,
    "seed": 42
  }
}
```

支持的首版契约值：

- `promptContract`: `h3_director_v1` 或 `free_text_v1`；
- `vramPolicy`: `h3_estimate` 或 `none`；
- `dimensions.multipleOf`: 正整数，允许普通工作流声明自己的网格；
- `references.min/max`: 工作流自己的参考图边界。

`adapter` 只表示“如何把统一输入绑定到工作流图”，不再参与 H3 判定。声明 adapter 时必须同时声明 `adapterVersion`，且注册表加载阶段必须与已注册实现的版本严格一致。H3 草稿门禁只看 `execution.requiresPromptDraft`，H3 结构校验只看 `execution.promptContract`。

现有 `minimax_h3_director_r2v` 与 `h3-continuity-v1` 都补齐显式 H3 执行契约。注册表加载时拒绝缺少或非法的 execution；测试夹具也必须声明契约，避免隐式行为重新出现。

## 5. 唯一工作流解析

新增统一解析 helper，供生成、草稿、capabilities 和测试连接复用：

```text
resolveRequestedWorkflow({ input, resolvedConfig, registry, allowExperimental })
  -> { selectedWorkflowId, workflow, resolved }
```

规则：

1. 收集非空 `workflow_id`、`workflowId`、`model`。
2. ComfyUI 请求中多个字段若值不相同，返回 400 `VIDEO_WORKFLOW_CONFLICT`。
3. 缺省使用 `default_model`。
4. 选中值必须属于通道 `model`，否则返回 `VIDEO_WORKFLOW_NOT_ALLOWED`。
5. 工作流必须存在且状态可提交；`configured` 仅在 `allowExperimental=true` 时可提交。
6. 返回的 `resolved.model`、数据库 `video_generations.model`、快照 `model` 与 `workflowId` 全部写实际选中 ID。
7. 非 ComfyUI 通道继续允许 `model` 走既有 resolver，但拒绝 `workflow_id/workflowId`。

所有入口都使用同一 helper，不再各自拼接 `explicit || model || default`。

## 6. 参数与 Provider 分派

工作流有效参数按以下优先级合并：

```text
请求显式参数
  > settings.workflow_overrides[selectedWorkflowId]
  > 仅当 selectedWorkflowId == default_model 时的旧版平铺 settings
  > workflow.execution.defaults
```

通道级 `base_url`、显存预算和连接信息继续共享。尺寸、时长、帧率、seed 等生成参数按工作流取值并写入任务行与快照。

Provider 提交和测试连接按 execution 执行：

- 使用通用参数校验器校验尺寸范围和倍数；
- 仅 `vramPolicy='h3_estimate'` 调用现有 H3 显存估算；
- 仅 `promptContract='h3_director_v1'` 校验 H3 提示词格式；
- 参考图数量使用 `execution.references`；
- 有 adapter 时调用 adapter；无 adapter 只保留现有 `MiniMaxH3Director` 通用绑定路径。

一个非 H3 且图中没有 `MiniMaxH3Director` 的工作流必须注册 adapter；系统应在注册或连接检查阶段给出 `WORKFLOW_ADAPTER_REQUIRED`，不能等生成后才失败。

## 7. API 与可用性状态

### 7.1 `GET /api/videos/workflows`

返回配置页目录，不隐藏 invalid/configured 项，而是提供可解释状态：

```json
{
  "workflows": [{
    "id": "...",
    "status": "verified",
    "selectable": true,
    "unavailableReason": null,
    "variant": "...",
    "family": "...",
    "adapter": "...",
    "execution": {},
    "capabilities": {}
  }]
}
```

- `verified`: selectable；
- `configured`: 仅全局实验开关开启时 selectable，否则禁用并返回 `WORKFLOW_EXPERIMENTAL_REQUIRED`；
- `invalid`: 禁用并返回 `WORKFLOW_INVALID`。

### 7.2 `GET /api/videos/capabilities`

返回当前通道每个白名单成员的状态、执行契约和能力。构造列表时不先强制解析默认项；默认项缺失、invalid 或实验禁用时，接口仍返回完整诊断：

```json
{
  "provider": "comfyui",
  "model": "default-id",
  "workflow": null,
  "defaultWorkflowStatus": "unavailable",
  "workflows": []
}
```

注册表本身无法加载（JSON、文件或 SHA 治理错误）仍保持启动失败；`unavailable` 指通道白名单引用了注册表中不存在的 ID，而不是掩盖注册表损坏。

### 7.3 配置保存

后端在 create/update 时原子校验合并后的 ComfyUI 配置：

- model 去空、去重且至少一项；
- default_model 必须属于 model；
- 每项必须存在于注册表；
- invalid 永远拒绝；configured 在实验开关关闭时拒绝；
- 错误不写入数据库。

前端校验仅改善体验，不能替代后端约束。

### 7.4 连接检查

测试连接支持明确的 `workflow`。配置页对所有已选工作流逐项检查并显示 ready/failed/experimental_disabled；保存不强制 ComfyUI 在线，但生成面板只允许选择目录上可提交的项。测试连接不得启动推理。

## 8. H3 草稿绑定与存量迁移

`storyboard_h3_prompt_drafts` 新增 `workflow_id TEXT`，新草稿必须写实际工作流 ID，并按 `(storyboard_id, video_config_id, workflow_id)` 保留最新 10 条。

读取顺序：

1. 优先精确匹配 workflow_id；
2. 对 NULL 存量行解析 `source_fingerprint.workflowSha`；
3. 只有 SHA 与请求工作流的 `workflowSha256` 唯一匹配时才允许复用，并懒回填 workflow_id；
4. 缺少 SHA、SHA 不匹配或无法唯一匹配时返回无可用草稿，并报告 `legacy_workflow_unknown`，要求重编译；
5. 永远不使用当前 default_model 推断 NULL 行的历史工作流。

门禁比较实际请求工作流、草稿 workflow_id 和 workflow SHA。跨工作流返回 409 `H3_DRAFT_WORKFLOW_MISMATCH`；配置 ID 不匹配继续使用 `H3_DRAFT_CONFIG_MISMATCH`，避免一个错误码承担两种语义。

`evaluateDraftFreshness` 使用草稿绑定的工作流解析 runtime。切换到 `requiresPromptDraft=false` 的工作流时，前端清除当前草稿 UI 状态且不发送 draft ID。

## 9. 前端行为

### AI 配置页

- 从目录接口加载多选项；禁用项保留显示并解释原因；
- 默认工作流下拉只包含已选且 selectable 的项；
- 目录加载失败时保留现有配置值并切换为只读错误态，不用单个硬编码选项覆盖已有列表；
- 保存前规范化选择，最终约束仍由后端保证；
- 对每个已选工作流显示连接检查结果。

### 生成面板

- 工作流列表来自 capabilities；多于一项时显示下拉；
- 初始化使用服务端 default 标记，不再硬编码官方 ID；
- 切换时应用该工作流默认参数/覆盖、更新提示词契约、重新加载对应草稿；
- H3 UI、时长锁定、参考图失败策略和请求构造都读取当前 workflow metadata；
- 异步加载使用版本号，旧工作流返回结果不能覆盖新选择；
- unavailable/invalid/实验禁用项不可提交并显示原因。

## 10. 工作流分析脚本

`scripts/registerComfyWorkflow.js` 是只读分析/骨架生成工具，不直接修改注册表：

- 从输入文件原始字节计算 SHA-256；
- 解析 API JSON 并提取 class_type 集合；
- `customNodes` 表示 ComfyUI class_type，第三方包锁定位于 `runtimeLock.customNodes`，两者不混用；
- adapter 元数据（family、adapter、adapterVersion、variant）必须成组提供；缺少任一项立即报错；
- 输出 execution 骨架与缺失治理项诊断；
- 输出明确标记为 draft，补齐并通过正式 registry loader 后才能加入注册表。

脚本测试必须使用带空白/换行的源文件，证明输出 SHA 与 `sha256File(sourcePath)` 完全相同，并验证不完整 adapter 元数据会失败。

## 11. 快照与恢复不变量

任务创建时快照记录实际工作流：

- `model == workflowId == selectedWorkflowId`；
- workflow 文件路径（仅内部执行使用）、SHA、variant、adapter/version、execution；
- 最终有效尺寸、时长、帧率、seed 和 planHash；
- 不包含密钥。

submit/retry/recover 只从快照恢复工作流和参数；通道白名单、默认值或注册表随后改变不重路由已有任务。若快照工作流文件/SHA 已不可用或 adapter 版本漂移，任务明确失败而不是换用当前默认工作流。内部 `workflowPath` 不通过视频 API 返回。

版本化快照新增字段不能让历史 H3 草稿无故失效。对没有 `workflowSnapshotVersion` 的旧草稿，freshness 使用旧字段投影比较，同时继续严格比较工作流 SHA 和原有生成参数；只有业务输入、参数、配置语义或 SHA 真正变化才标记 stale。

## 12. 验收标准

1. 同一 ComfyUI 通道可保存多个 verified 工作流，默认项必须属于集合。
2. 每次生成可选择非默认成员，任务行和快照均记录实际 ID。
3. 冲突别名、列表外工作流、非 ComfyUI 显式 workflow 均返回稳定中文错误。
4. configured 在实验开关关闭时处处禁用；开启时目录、草稿、生成和 Provider 行为一致。
5. capabilities 在默认成员不可用时仍返回每项诊断。
6. H3 与 free-text fixture 分别只执行自己的提示词、尺寸、显存和参考图规则。
7. NULL 存量草稿只在 SHA 唯一匹配时复用；更换默认工作流不会导致误绑定。
8. 前端切换工作流后 H3 UI、草稿请求、参考图策略和参数默认值同步切换，无异步串写。
9. 注册脚本的 SHA 与原文件字节一致，生成骨架不能伪装成已验证条目。
10. 现有两个真实注册表工作流均能通过目录、capabilities、连接检查构造和生成请求回归；实际调用 ComfyUI 的在线验收在服务可用时执行，离线时保留明确的手工验收清单。
11. 后端 Node 22 全量测试、前端全量测试与 Vite build 全部通过。

## 13. 实施顺序

1. 修复并锁定干净基线；
2. 注册表 execution 契约与统一工作流解析；
3. 配置后端约束、目录和 capabilities；
4. Provider 参数策略分派；
5. 草稿迁移、SHA 归属和门禁；
6. 前端配置页与生成面板；
7. 安全的工作流分析脚本；
8. 全量回归、构建和离线冒烟。
