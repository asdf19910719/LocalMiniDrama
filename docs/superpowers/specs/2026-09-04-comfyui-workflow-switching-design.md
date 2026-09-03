# 同通道 ComfyUI 工作流切换设计

日期：2026-09-04

## 1. 背景

项目已通过统一视频生成 Provider 架构（见 `2026-08-25-unified-video-generation-provider-design.md`）把本地 ComfyUI 接入为标准视频通道。当前一条 ComfyUI 通道同一时刻只实际使用一个工作流（官方 MiniMax H3 Director R2V）。用户需要在**同一条通道**内方便地切换不同的 ComfyUI 视频工作流，例如从官方生成工作流切换到社区"二采"（二次采样/多阶段采样，如 Zealman U06 lightX2v、latent upscaler 变体）工作流。

## 2. 现状分析（业务逻辑链路）

### 2.1 通道与工作流的关系

- **通道** = `ai_service_configs` 表中 `service_type='video'` 且 `is_default=1` 的唯一配置行。ComfyUI 通道的字段：
  - `provider='comfyui'`，`base_url` 指向本机 ComfyUI（默认 `http://127.0.0.1:8188`）。
  - `model`：JSON 数组，语义上是"该通道声明的工作流 ID 列表"。
  - `default_model`：默认工作流 ID。
  - `settings`：width/height/frame_rate/seed/vram_budget_mb 等。
- **工作流注册表** `configs/director-workflows.json`（`loadRegistry`）：每个工作流 = ComfyUI API 格式 JSON 文件 + 治理元数据（status `verified/configured/invalid`、workflowSha256、requiredNodes、modelFiles、customNodes、inputSchema、provenance、runtimeLock、verifiedEvidence；可选 adapter 元数据 family/adapter/variant/capabilities/inputSchemaVersion）。`selectWorkflow` 强制状态门禁（invalid 拒绝；configured 需 `allow_experimental`）。
- **适配器** `src/director/adapters/`：把统一输入映射为具体工作流图的 prompt。注册表 entry 的 `adapter` 字段指向适配器 ID；无 adapter 的 entry 走 `buildStructuredWorkflowPrompt` 通用路径（要求图中有 `MiniMaxH3Director` 节点）。

### 2.2 生成链路

```text
前端视频面板（普通/画布共用）
  → POST /api/videos（或 director 候选路由 → 同一服务）
  → createVideoGeneration
      resolveDefaultVideoConfig：唯一默认通道；input.model 必须在通道 model 列表内
      selectWorkflow：按 requestedWorkflowId(=显式 workflow_id || model) 取注册表 entry
      buildVideoGenerationPlan：生成 planHash
      buildVideoConfigSnapshot：快照（workflowId/workflowSha256/variant/adapter/sage/planHash/settings，不含密钥）
      → INSERT video_generations（状态 waiting）→ 异步 submit
  → comfyuiVideoProvider.submit
      workflowIdFor(context)：快照 workflowId || model || settings.workflow_id || default_model
      readWorkflowTemplate → （有 adapter：参考图 staging → adapter.validate/buildPrompt；
                              无 adapter：buildStructuredWorkflowPrompt）
      → GPU 互斥租约 → POST ComfyUI /prompt → promptId
  → 轮询 getPromptStatus → completed 时 downloadOutput + ffprobe → persistReview（候选组挂产物）
```

取消/重试/恢复全部基于创建时快照，通道或工作流后续变更不影响运行中任务。

### 2.3 H3 专属链路（草稿门禁）

- `isH3VideoConfig`（unifiedVideoGenerationService）：按**硬编码模型名**判定（`h3-continuity-v1`、`minimax_h3_director_r2v`、名字含 `minimaxh3`/`minimax-h3`，或协议 `minimax_h3`）。前端 `videoModeCompatibility.isH3ComfyUiConfig`、`useVideoGenerationPanel` 重复同一硬编码。
- H3 配置的候选生成必须先有提示词草稿（`storyboard_h3_prompt_drafts` 表，按 `(storyboard_id, video_config_id)` 配对存取）。草稿源指纹包含 `workflowSha`；失效评估 `evaluateDraftFreshness` 重解析 runtime 时**只用通道 default_model**，不感知请求级别的工作流。
- 草稿三个端点（`/storyboards/:id/h3-prompt-draft*`）只接收 `video_config_id`。

### 2.4 当前切换工作流的方式与痛点

切换 = 手工改注册表 JSON（算 SHA-256、数节点、写治理元数据）→ 改通道 `model`/`default_model`（前端下拉硬编码只有 `minimax_h3_director_r2v` 一个选项）→ H3 草稿全部失效需重编译。痛点：

1. 前端 ComfyUI 预设模型列表硬编码（AIConfigContent.vue），无法选择注册表中的其他工作流。
2. 注册新工作流全靠手工，SHA/节点清单易错。
3. 后端 `resolveDefaultVideoConfig` 其实已支持"input.model 取通道 model 列表内任意成员"，但 `createVideoGeneration` 的守卫要求显式 `workflow_id` 必须等于解析出的 model，且 `getVideoCapabilities` 只回报默认工作流——同通道"每次生成可选工作流"没有打通。
4. H3 判定与草稿门禁绑定"配置"维度，同通道多工作流时草稿无法区分工作流（存在草稿按默认工作流编译、却按另一工作流提交的缝隙）。
5. 测试连接只校验 `model[0]`。

## 3. 目标与非目标

**目标**

1. 同一条 ComfyUI 通道可声明多个工作流；生成时可在面板里下拉切换（缺省用 `default_model`）。
2. 工作流选项由注册表驱动，AI 配置页与生成面板不再硬编码。
3. H3 判定、草稿编译、门禁、失效评估全部感知工作流维度。
4. 新工作流（如二采）接入有辅助脚本生成注册表 entry 骨架。
5. 保持既有治理：快照隔离、状态门禁、SHA 校验、GPU 互斥、中文错误。

**非目标**

1. 不做跨 Provider 切换（ComfyUI ↔ 云端），维持"唯一默认配置"规则。
2. 不实现具体二采工作流的 adapter 本体（属于每个新工作流族的独立工作，本设计给出扩展指南）。
3. 不改运行中任务的快照语义。
4. 不引入注册表热重载（后端重启加载，与现状一致）。

## 4. 方案选择

**方案 A（采纳）：通道声明工作流集合 + 注册表驱动目录 + 每次生成可选 + 草稿按工作流绑定**

通道 `model` 列表即"本通道允许的工作流白名单"，`default_model` 为默认；生成请求可带 `workflow_id`（或 `model`）选择集合内成员；快照记录实际工作流；H3 草稿加 `workflow_id` 维度。

- 优点：完全符合既有架构规则（"model 只能选择默认配置自身声明的模型"），快照/重试/恢复天然正确；切换成本 = 面板下拉；通道级白名单保留审计控制。
- 缺点：草稿表需迁移；H3 面板切换工作流后需重编译草稿（正确性要求，非缺陷）。

**方案 B（不采纳）：每个工作流一条通道，切换默认通道。** 违背"唯一默认配置"规则，base_url/settings 重复维护，无法按次选择。

**方案 C（不采纳）：通道不管工作流，生成时任选注册表条目。** 失去通道级白名单与"model 只能选声明模型"的治理，注册表条目会直接暴露到所有入口。

## 5. 产品规则

1. 通道仍是唯一默认视频配置；`provider` 不参与请求路由。
2. ComfyUI 通道的 `model` 列表 = 允许的工作流 ID 集合（至少 1 项）；`default_model` 必须属于该集合。
3. 生成请求可携带 `workflow_id`/`workflowId`（或 `model`）：必须属于通道 model 列表、且通过注册表状态门禁；缺省用 `default_model`。非 ComfyUI 通道维持现状（不允许显式工作流）。
4. 运行中任务不受通道与工作流切换影响（沿用快照）。
5. H3 草稿按 `(storyboard, video_config, workflow)` 三元组存取；工作流不匹配的草稿不能用于提交（409，`H3_DRAFT_CONFIG_MISMATCH`）。
6. H3 判定优先取注册表元数据（entry 有 `adapter` 或 `family='h3_director'`），旧模型名匹配仅作回退兼容。

## 6. API 变更

### 6.1 新增 `GET /api/videos/workflows`（工作流目录）

返回注册表全部可选用工作流（供 AI 配置页与面板选择器）：

```json
{ "workflows": [ { "id", "status", "variant", "family", "adapter", "capabilities", "experimental" } ] }
```

`invalid` 条目不返回；`configured` 条目带 `experimental: true`。

### 6.2 增强 `GET /api/videos/capabilities`

在现有 `workflow`（默认工作流）基础上新增 `workflows[]`：通道 model 列表中能通过注册表解析的每个工作流（含 id/status/variant/adapter/capabilities、`default: true/false` 与 `h3: true/false`——按注册表元数据 adapter/family 判定）。解析失败（如已删档）的成员带 `status: 'unavailable'` 原因说明。

### 6.3 生成请求（`POST /api/videos` 与 director 候选路由）

- 显式 `workflow_id` 校验规则由"必须等于 resolved.model"放宽为"必须属于通道 model 列表"（仅 ComfyUI；非 ComfyUI 保持拒绝）。
- 快照 `workflowId/workflowSha256/variant/adapter` 记录实际选中工作流（现有 `buildVideoConfigSnapshot` 已支持，无需改结构）。

### 6.4 H3 草稿端点

`GET/POST /storyboards/:id/h3-prompt-draft*` 增加可选 `workflow_id`（query/body）；缺省 = 通道 default_model。返回体 draft 增加 `workflow_id`。

## 7. 数据迁移

- `storyboard_h3_prompt_drafts` 新增列 `workflow_id TEXT`（`ensureColumns` 自动补列）。
- 存量行 `workflow_id IS NULL` 的语义 = "通道当时的默认工作流"：
  - `getLatestDraft(storyboardId, configId, workflowId)` 查询优先精确匹配 `workflow_id = ?`；无结果且请求工作流 = 通道 `default_model` 时回退匹配 `workflow_id IS NULL`（兼容存量）。
  - 门禁 `requireH3PromptDraft`：`draft.workflow_id` 为 NULL 时按通道默认工作流解释，与请求工作流不一致 → `H3_DRAFT_CONFIG_MISMATCH`。
- 新索引 `idx_h3_draft_lookup_wf (storyboard_id, video_config_id, workflow_id, updated_at DESC)`。

## 8. 后端实现要点

1. `unifiedVideoGenerationService.createVideoGeneration`：
   - 守卫改为成员校验：`explicitWorkflowId ∈ config.model`（ComfyUI）；`input.model` 路径不变（resolver 已校验成员）。
   - `isH3VideoConfig` 增加注册表感知：传入已选 workflow entry，`entry.adapter != null || entry.family === 'h3_director'` → H3；无 entry 时回退旧名匹配。导出独立 helper `isH3WorkflowEntry(workflow)`。
   - `getVideoCapabilities` 按 6.2 增强。
2. `h3PromptDraftService`：
   - `compileDraft({ ..., workflowId })`：`resolveVideoRuntime` 已支持 `{ workflowId }`，落行写 `workflow_id`；按 `(storyboard, config, workflow)` 保留最新 10 条。
   - `getLatestDraft(db, storyboardId, configId, workflowId)`：按 §7 兼容策略。
   - `evaluateDraftFreshness`：用 `draft.workflow_id ?? 通道 default_model` 重解析 runtime（消除"按默认工作流评估、按其他工作流提交"的缝隙）。
   - `requireH3PromptDraft`（unified）：校验草稿 workflow 与请求实际工作流一致，不一致 → `H3_DRAFT_CONFIG_MISMATCH`（409，details 带两侧 workflow）。
3. 路由：
   - `videos.js` 新增 `workflows` 目录端点（数据来自 `workflowRegistry`，经 lifecycle 或直接注入 registry）。
   - `storyboards.js` 三个草稿端点透传 `workflow_id`。
   - `aiConfig.js` ComfyUI 测试连接：body 可带 `workflow`（默认用 `default_model`）——测试连接按指定工作流校验 SHA/节点/模型/显存。

## 9. 前端实现要点

1. **AI 配置页（AIConfigContent.vue）**：ComfyUI 通道表单从 `GET /api/videos/workflows` 拉取工作流目录；`model` 改为多选（至少 1 项），`default_model` 下拉跟随所选集合；移除硬编码预设列表（保留回退：目录接口失败时显示手工输入）。
2. **生成面板（useVideoGenerationPanel + VideoGenerationPanel.vue）**：
   - `capabilities.workflows.length > 1` 时显示"工作流"下拉（默认 default_model）；切换后 `form.workflowId` 更新。
   - 提交请求带 `workflowId`（现有 `buildVideoCandidateRequest` 已透传，`generationInput` 已映射 `workflow_id`）。
   - H3 草稿拉取/编译参数带 `workflow_id`；切换工作流即按新工作流重新取草稿（草稿不存在时提示重新编译）。
   - H3 判定优先 `capabilities.workflow.adapter/family`（`videoModeCompatibility` 扩展可选参数，保留旧名回退）。
3. `h3Draft.js` API 客户端：三个方法增加可选 `workflowId` 参数。

## 10. 新工作流接入指南（以二采为例）

1. 准备 ComfyUI API 格式工作流 JSON（从 ComfyUI 网页"导出（API）"或社区模板，如 Zealman U06 V5）。
2. 运行 `node scripts/registerComfyWorkflow.js <workflow.json> --id <workflow_id> [--family h3_director] [--adapter <id>]`：
   - 自动计算 SHA-256、提取 `class_type` 节点清单（requiredNodes/customNodes 候选）、生成 entry 骨架（status=`configured`，需补 provenance/runtimeLock/verifiedEvidence 后手工改 `verified`）。
3. 将 entry 加入 `configs/director-workflows.json`，重启后端。
4. AI 配置页把新工作流 ID 加入通道 model 列表（可设为默认或保留官方为默认）。
5. 测试连接（选定工作流）→ 生成面板下拉切换 → 生成。
6. 若工作流图不含 `MiniMaxH3Director` 节点（拆散的二采图），需实现新 adapter：`adapters/<id>.js` 导出 `{ id, version, validate, buildPrompt, describeCapabilities }` 并在 `adapters/index.js` 注册；entry `adapter` 字段指向它。现有 `h3_director_r2v` 是参照实现。

## 11. 测试与验收

后端（`node --test`）：

1. 工作流目录端点：返回注册表条目、过滤 invalid、configured 标 experimental。
2. capabilities.workflows：通道多工作流清单、default 标记、失效成员标记 unavailable。
3. 每次生成选择：`workflow_id` ∈ model 列表 → 创建成功且快照 workflowId 正确；∉ 列表 → `VIDEO_WORKFLOW_NOT_ALLOWED`；非 ComfyUI 显式工作流仍拒绝。
4. H3 判定：adapter/family 命中；无元数据回退旧名。
5. 草稿工作流绑定：按 workflow 编译/取草稿；跨工作流提交 → 409 `H3_DRAFT_CONFIG_MISMATCH`；NULL 存量行回退语义；freshness 按草稿工作流解析。
6. 现有 comfyui/h3/unified 测试全部保持通过。

前端（`node --test`）：

1. 工作流选项派生（capabilities.workflows → 下拉选项、默认值）。
2. H3 判定 helper 的 capabilities 优先/名称回退。
3. 草稿请求参数带 workflow_id。
4. 现有 videoGenerationPanel/videoModeCompatibility 测试保持通过；`npm run build` 通过。

## 12. 风险与兼容

1. **存量草稿**：NULL workflow_id 回退策略保证老数据在默认工作流下继续可用；换工作流自然要求重编译（正确性）。
2. **注册表条目失效**（文件被移动/删除导致 `loadRegistry` 抛错）：现状即启动失败，不因本设计改变；capabilities 对单个成员解析失败只标记该成员，不拖垮整个接口。
3. **非 H3 工作流混入 H3 通道**：门禁按工作流维度判定，二采（无 adapter、非 h3 family）不会误走 H3 草稿链路。
4. **provider.submit 的 H3 prompt 校验**：`comfyuiVideoProvider.submit` 中 H3 校验按 `selected.id === 'h3-continuity-v1' || model 名含 h3` 触发——改为按 `selected.adapter` 存在与 `isH3WorkflowEntry` 判定，与新目录一致。
