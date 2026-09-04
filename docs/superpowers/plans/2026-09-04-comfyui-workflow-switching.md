# ComfyUI 同通道工作流切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一 ComfyUI 视频通道可保存多个注册表工作流并按次选择，同时让执行规则、实验状态、H3 草稿、快照和前端状态严格绑定实际工作流。

**Architecture:** 注册表 `execution` 是工作流运行契约；统一选择 helper 解析请求别名、白名单和实验门禁；Provider 按契约校验参数。草稿通过 workflow ID 与 SHA 绑定，前端完全消费目录/capabilities 元数据。

**Tech Stack:** Node.js 22、Express、better-sqlite3、node:test、Vue 3、Element Plus、Vite。

**Spec:** `docs/superpowers/specs/2026-09-04-comfyui-workflow-switching-design.md`

## Global Constraints

- 所有开发位于 `codex/comfyui-workflow-switching-v2` worktree，禁止修改 main checkout。
- 纯 JavaScript，无 TypeScript；无 ESLint。
- 后端测试统一运行 `npx --yes node@22 --test ...`，避免 Node 24 与 better-sqlite3 teardown 崩溃。
- 用户可见文案使用中文；错误码使用 `UPPER_SNAKE_CASE`。
- 新生产行为严格执行 RED → GREEN → REFACTOR。
- 快照和恢复不得重新解析当前默认工作流。
- `adapter` 不参与 H3 判定。
- 不伪造社区工作流、模型、许可证或 runtime lock。

---

### Task 1: 注册表 execution 契约

**Files:**
- Create: `backend-node/src/director/workflowExecutionPolicy.js`
- Modify: `backend-node/src/director/workflowRegistry.js`
- Modify: `backend-node/configs/director-workflows.json`
- Test: `backend-node/test/workflowExecutionPolicy.test.js`
- Test: `backend-node/test/directorWorkflowRegistry.test.js`

**Interfaces:**
- `validateWorkflowExecution(execution, workflowId)` 返回规范化副本，非法时抛 `WORKFLOW_EXECUTION_INVALID`。
- `workflowRequiresDraft(workflow)` 只读取 `execution.requiresPromptDraft`。
- `resolveWorkflowParameters(workflow, input, config)` 返回 `{ width, height, durationSeconds, frameRate, seed }`。
- `validateWorkflowReferences(workflow, references)` 按 execution.references 校验。

- [x] 写测试：H3 与 free-text execution 均可规范化；缺字段、非法 promptContract、非法范围被拒绝；adapter 存在不会自动要求草稿。
- [x] 运行测试并确认因模块不存在失败。
- [x] 实现最小策略 helper，错误对象带稳定 code。
- [x] 给两个真实注册表条目补 execution，并在 loader 中强制校验、返回规范化 execution。
- [x] 更新受影响 registry 测试夹具。
- [x] 运行 `npx --yes node@22 --test test/workflowExecutionPolicy.test.js test/directorWorkflowRegistry.test.js`。
- [x] 提交 `feat: add explicit ComfyUI workflow execution contracts`。

### Task 2: 唯一工作流选择与快照一致性

**Files:**
- Create: `backend-node/src/services/videoWorkflowSelection.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/src/services/videoGenerationSnapshot.js`
- Test: `backend-node/test/videoWorkflowSelection.test.js`
- Test: `backend-node/test/comfyuiWorkflowSwitching.test.js`

**Interfaces:**
- `resolveRequestedWorkflow({ input, resolved, registry, allowExperimental })` 返回 `{ selectedWorkflowId, workflow, resolved }`。
- ComfyUI 的三个别名冲突抛 `VIDEO_WORKFLOW_CONFLICT`；列表外抛 `VIDEO_WORKFLOW_NOT_ALLOWED`。
- 选择成功后 `resolved.model === selectedWorkflowId`。

- [x] 写选择 helper 测试：缺省、三个同值别名、冲突别名、列表外、configured 开关、非 ComfyUI workflow 字段拒绝。
- [x] 运行并确认失败。
- [x] 实现 helper，复用 `selectWorkflow` 与 `resolveVideoProtocol`。
- [x] 写生命周期测试：非默认工作流写入 row.model、snapshot.model、snapshot.workflowId；重试继续使用快照。
- [x] 运行并确认旧生命周期实现失败。
- [x] 在 create 路径使用 helper，并把 `allowExperimental` 注入统一服务。
- [x] 运行相关测试及 `test/unifiedVideoGenerationService.test.js`。
- [x] 提交 `feat: resolve one canonical workflow per video request`。

### Task 3: 目录与可降级 capabilities

**Files:**
- Create: `backend-node/src/director/workflowCatalog.js`
- Modify: `backend-node/src/routes/videos.js`
- Modify: `backend-node/src/routes/index.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Test: `backend-node/test/workflowCatalog.test.js`
- Test: `backend-node/test/unifiedVideoCapabilitiesWorkflows.test.js`

**Interfaces:**
- `listWorkflowCatalog(registry, { allowExperimental })` 保留 verified/configured/invalid，返回 selectable 与 unavailableReason。
- capabilities 的 `workflows[]` 只按通道白名单映射；默认项不可用时接口仍成功。

- [x] 写目录测试覆盖三种状态与 execution 透传。
- [x] 写 capabilities 测试覆盖缺失默认项、configured 默认项与正常多项。
- [x] 运行并确认失败。
- [x] 实现 helper、路由和注入，不在构造列表前调用严格 select。
- [x] 运行两个测试文件及现有 capabilities 测试。
- [x] 提交 `feat: expose workflow catalog and resilient capabilities`。

### Task 4: ComfyUI 配置后端约束与逐项连接检查

**Files:**
- Create: `backend-node/src/services/comfyuiWorkflowConfig.js`
- Modify: `backend-node/src/services/aiConfigService.js`
- Modify: `backend-node/src/routes/aiConfig.js`
- Modify: `backend-node/src/routes/index.js`
- Test: `backend-node/test/aiConfigComfyuiVideo.test.js`
- Test: `backend-node/test/comfyuiWorkflowConfig.test.js`

**Interfaces:**
- `normalizeAndValidateComfyuiWorkflowConfig(candidate, registry, { allowExperimental })` 返回去重后的 model/default_model。
- create/update 对 partial update 与现有行合并后校验，失败不写库。
- test connection 使用 body.workflow，而非 model[0]。

- [x] 写纯 helper 测试覆盖空列表、重复、default 不在集合、缺失/invalid/configured 条目。
- [x] 运行并确认失败。
- [x] 实现 helper。
- [x] 写路由/服务测试证明 create/update 原子拒绝非法配置，连接检查选择显式 workflow。
- [x] 运行并确认失败。
- [x] 注入 registry/allowExperimental，在写库前校验；ComfyUI 平铺 settings 不再无条件执行 H3 专用尺寸校验。
- [x] 运行 AI 配置相关测试。
- [x] 提交 `feat: validate ComfyUI workflow channel configuration`。

### Task 5: Provider 按 execution 分派

**Files:**
- Modify: `backend-node/src/services/videoProviders/comfyuiVideoProvider.js`
- Modify: `backend-node/src/services/videoProviders/referenceAssetStaging.js`
- Test: `backend-node/test/comfyuiVideoProvider.test.js`
- Test: `backend-node/test/referenceAssetStaging.test.js`

**Interfaces:**
- Provider 通过 Task 1 helper 解析/校验参数与参考图。
- H3 prompt/VRAM 校验只在 execution 明确要求时运行。
- 无 adapter 的 free-text 图在连接检查返回 `WORKFLOW_ADAPTER_REQUIRED`。

- [x] 写 free-text adapter fixture 测试：非 32 倍数按自身 multipleOf 规则通过、不调用 H3 prompt/VRAM 校验、允许其声明的参考图数量。
- [x] 写无 adapter free-text 连接检查失败测试。
- [x] 运行并确认当前无条件 H3 校验导致失败。
- [x] 实现最小分派；reference staging 接受 workflow max 参数，不再硬编码 9。
- [x] 运行 provider/staging/director registry 测试。
- [x] 提交 `feat: dispatch ComfyUI validation by workflow contract`。

### Task 6: H3 草稿绑定、迁移与 SHA 归属

**Files:**
- Create: `backend-node/migrations/32_h3_draft_workflow_id.sql`
- Modify: `backend-node/src/db/migrate.js`
- Modify: `backend-node/src/services/h3PromptDraftService.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/src/routes/storyboards.js`
- Test: `backend-node/test/h3DraftMigration.test.js`
- Test: `backend-node/test/h3DraftWorkflowBinding.test.js`
- Test: `backend-node/test/h3DraftGating.test.js`
- Test: `backend-node/test/h3PromptDraftService.test.js`

**Interfaces:**
- compile/get routes 接受 workflow_id。
- 精确 workflow_id 优先；NULL 行只有 source_fingerprint.workflowSha 与请求 workflow SHA 相同时懒回填。
- 无法识别的 NULL 行返回 `{ draft: null, freshness: { stale: true, reasons: ['legacy_workflow_unknown'] } }`。
- 跨工作流门禁抛 `H3_DRAFT_WORKFLOW_MISMATCH`。

- [x] 写迁移测试，确认旧行保留且新增索引。
- [x] 写绑定测试：精确匹配、SHA 匹配懒回填、换默认不误绑、未知 legacy 拒绝、每工作流保留 10 条。
- [x] 写门禁测试：实际工作流不一致 409；requiresPromptDraft=false 不要求草稿。
- [x] 运行并确认失败。
- [x] 实现迁移、服务查询/清理、路由透传和门禁。
- [x] 运行所有 H3 draft/gating 测试与生命周期测试。
- [x] 提交 `feat: bind H3 drafts to verified workflow identity`。

### Task 7: 前端工作流元数据与生成面板

**Files:**
- Modify: `frontweb/src/api/h3Draft.js`
- Modify: `frontweb/src/api/videos.js`
- Modify: `frontweb/src/utils/videoModeCompatibility.js`
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue`
- Test: `frontweb/test/videoModeCompatibility.test.js`
- Test: `frontweb/test/videoGenerationPanel.test.js`
- Test: `frontweb/test/videoGenerationPanelRestore.test.js`

**Interfaces:**
- `requiresH3Draft(workflowMeta)` 与 `slotReferenceFallbackPolicy(cfg, workflowMeta)` 只消费当前 workflow execution。
- 草稿 API 第三参数为 workflowId。
- 面板导出 `workflowOptions` 与 `onWorkflowChange`。

- [x] 写 helper 测试证明 adapter 不决定 H3、当前 workflow metadata 覆盖配置默认名。
- [x] 写面板测试覆盖默认选择、切换、草稿参数、非 H3 清理、旧请求竞态和请求 workflowId。
- [x] 运行并确认失败。
- [x] 实现 API 与 helper，删除请求构造和表单中的硬编码官方 workflow fallback。
- [x] 实现下拉与切换逻辑，让尺寸默认、H3 UI、时长锁定和参考图策略读取当前 metadata。
- [x] 运行三个测试文件。
- [x] 提交 `feat: switch ComfyUI workflows in video generation panel`。

### Task 8: AI 配置页多选与逐项健康状态

**Files:**
- Modify: `frontweb/src/utils/aiConfigVideoProvider.js`
- Modify: `frontweb/src/components/AIConfigContent.vue`
- Test: `frontweb/test/aiConfigVideoProvider.test.js`

**Interfaces:**
- `comfyuiWorkflowOptionsFromCatalog` 保留禁用项及原因。
- `normalizeComfyuiModelSelection` 保证 default 属于可选集合。
- 目录失败时保留原值并禁止覆盖保存。

- [x] 写 helper 测试覆盖 verified/configured/invalid、默认纠正、未知已有值保留。
- [x] 运行并确认失败。
- [x] 实现 helper 和多选 UI；删除硬编码目录作为保存回退。
- [x] 实现逐项连接检查结果模型，测试按钮逐个传 workflow。
- [x] 运行 helper 测试和 `npm run build`。
- [x] 提交 `feat: manage ComfyUI workflow allowlist from registry`。

### Task 9: 安全工作流分析脚本

**Files:**
- Create: `backend-node/scripts/registerComfyWorkflow.js`
- Test: `backend-node/test/registerComfyWorkflow.test.js`

**Interfaces:**
- `analyzeWorkflowFile(filePath, options)` 从原始文件字节生成 `{ entryDraft, diagnostics }`。
- CLI 只输出 JSON，不修改 registry 或复制文件。

- [x] 写测试：带格式化空白的文件 SHA 等于 `sha256File`；提取 class_type；family/adapter/adapterVersion/variant 不完整时拒绝；输出包含 execution 草案与 diagnostics。
- [x] 运行并确认模块不存在失败。
- [x] 实现分析函数和 CLI；不写占位字符串冒充有效治理数据。
- [x] 运行脚本测试，并对现有官方工作流执行一次只读冒烟。
- [x] 提交 `feat: add safe ComfyUI workflow analysis helper`。

### Task 10: 全量验证与文档收口

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-comfyui-workflow-switching-design.md`（仅在实现发现契约偏差时同步）
- Modify: `docs/superpowers/plans/2026-09-04-comfyui-workflow-switching.md`（勾选完成项）

- [x] 运行 `npx --yes node@22 --test test/*.test.js`。
- [x] 运行 `node --test test/*.test.js`（frontweb）。
- [x] 运行 `npm run build`（frontweb）。
- [x] 运行 registry load、目录与两个真实工作流的离线冒烟。
- [x] 运行 `git diff --check` 和 `git status --short`，确认无依赖安装噪声。
- [x] 更新计划复选框与最终测试数字。
- [x] 提交 `docs: complete ComfyUI workflow switching verification`。

## 最终验证记录（2026-09-05）

- 后端 Node 22 全量测试：623/623 通过。
- 前端全量测试：185/185 通过。
- 前端 Vite 生产构建：通过（1666 个模块）。
- 两个真实工作流离线冒烟：注册表加载、目录生成、SHA 校验和提示词构建均通过；`minimax_h3_director_r2v` 构建 8 个节点，`h3-continuity-v1` 构建 7 个节点。
- 两轮独立只读代码复审：最终未发现 Critical、Important 或 Minor 级可复现问题。
- 开发与验证仅在 `codex/comfyui-workflow-switching-v2` 隔离 worktree 完成，未合并主分支。
