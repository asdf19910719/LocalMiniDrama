# ComfyUI 新增工作流注册与配置指南

本文面向后续接入、升级和下线 ComfyUI 视频工作流的开发与运维人员。当前系统支持在同一个 ComfyUI 视频通道中配置多个工作流，并在每次生成时选择其中任意一个；这里的“任意”有明确边界：工作流必须已经进入项目注册表、通过加载校验、被当前视频通道列入白名单，并满足对应的输入契约。生成接口不接受未注册的工作流，也不接受调用方直接传入本机 JSON 路径。

相关实现与设计：

- 注册表：`backend-node/configs/director-workflows.json`
- 工作流目录：`backend-node/configs/workflows/`
- 注册分析脚本：`backend-node/scripts/registerComfyWorkflow.js`
- 执行契约：`backend-node/src/director/workflowExecutionPolicy.js`
- adapter 目录：`backend-node/src/director/adapters/`
- 详细设计：`docs/superpowers/specs/2026-09-04-comfyui-workflow-switching-design.md`

## 1. 接入流程总览

完整链路为：

`ComfyUI API 工作流 JSON → 只读分析 → 补全注册表与治理信息 → 重启后端加载 → AI 配置选择允许集合和默认项 → 逐工作流连接检查 → 创作页按次选择 → 任务固化不可变快照`

注册表是唯一工作流来源。AI 配置中的 `model` 不是模型名，而是当前 ComfyUI 视频通道允许使用的工作流 ID 列表；`default_model` 是该列表中的默认工作流 ID。创作页可以在允许集合内切换，提交时最终使用 `workflow_id`。

## 2. 接入前准备

接入前应确认：

- 从 ComfyUI 导出的是 **API Format** 工作流，节点必须包含 `class_type`。界面保存的普通 workflow 格式不能直接注册。
- 工作流已经在目标 ComfyUI 实例上手工运行成功。
- 所需模型、VAE、文本编码器和自定义节点已经安装，并记录了准确文件名、版本、哈希、大小和来源。
- 工作流 JSON 不包含密钥、令牌或其他秘密信息。
- 已确定提示词绑定方式、参考图数量、尺寸范围、默认时长、帧率和随机种子。
- 已判断是否可以使用现有输入绑定，还是必须新增 adapter。判断规则见第 5 节。

新工作流建议复制到：

```text
backend-node/configs/workflows/<workflow-id>.json
```

注册表中的路径随后写为：

```json
"workflowPath": "workflows/<workflow-id>.json"
```

相对路径以 `backend-node/configs/director-workflows.json` 所在目录为基准。虽然注册表兼容绝对路径，但新工作流不建议使用绝对路径，否则换机器、换盘符或使用 Git worktree 时会失效。

## 3. 用脚本生成注册草稿

先把文件复制到项目受控路径，再在 `backend-node` 目录对最终文件执行只读分析。这样得到的 SHA 与注册表实际加载的字节完全一致：

```powershell
node scripts/registerComfyWorkflow.js "./configs/workflows/my_video_workflow_v1.json" `
  --id my_video_workflow_v1 `
  --prompt-contract h3_director_v1 `
  --requires-prompt-draft true
```

如果已经确定需要 adapter，四个 adapter 元数据必须一起提供：

```powershell
node scripts/registerComfyWorkflow.js "./configs/workflows/my_video_workflow_v1.json" `
  --id my_video_workflow_v1 `
  --family my_video_family `
  --adapter my_video_adapter `
  --adapter-version v1 `
  --variant production `
  --prompt-contract free_text_v1 `
  --requires-prompt-draft false
```

脚本会输出：

- 工作流原始字节的 `workflowSha256`；
- 从 `class_type` 提取的 `requiredNodes`；
- 从节点输入中启发式提取的 `modelFiles`；
- 尚未补齐的治理和执行字段。

脚本不会复制文件、修改注册表或注册 adapter。输出固定为 `status: "draft"`，生产注册表故意不接受该状态。`requiredNodes` 和 `modelFiles` 只是分析起点，必须人工核对；不要把普通内置节点误记为自定义节点，也不要根据文件名猜测许可证、哈希或运行时版本。

## 4. 补全注册表条目

将工作流条目加入 `backend-node/configs/director-workflows.json` 的 `workflows` 数组。下面是一个不带 adapter、使用现有 H3 Director 通用绑定器的最小完整模板。尖括号内容必须替换为真实值，不能原样提交。

```json
{
  "id": "<workflow-id>",
  "status": "configured",
  "workflowPath": "workflows/<workflow-id>.json",
  "workflowSha256": "sha256:<64位工作流SHA256>",
  "requiredNodes": [
    "MiniMaxH3Director",
    "SaveVideo"
  ],
  "modelFiles": [
    "<model-file>.safetensors"
  ],
  "customNodes": [
    "MiniMaxH3Director",
    "SaveVideo"
  ],
  "inputSchema": {
    "prompt": "string",
    "seed": "integer",
    "referenceImageUrls": "array"
  },
  "execution": {
    "promptContract": "h3_director_v1",
    "requiresPromptDraft": true,
    "dimensions": {
      "minWidth": 32,
      "maxWidth": 4096,
      "minHeight": 32,
      "maxHeight": 4096,
      "multipleOf": 32
    },
    "references": {
      "min": 1,
      "max": 9
    },
    "vramPolicy": "h3_estimate",
    "defaults": {
      "width": 1312,
      "height": 736,
      "durationSeconds": 5,
      "frameRate": 24,
      "seed": 42
    }
  },
  "provenance": {
    "provider": "<provider>",
    "modelFamily": "<model-family>",
    "source": "<可追溯来源>",
    "license": {
      "status": "review_required",
      "evidence": "<许可证审查记录路径或引用>"
    }
  },
  "runtimeLock": {
    "comfyUIVersion": "<tested-version>",
    "models": [
      {
        "fileName": "<model-file>.safetensors",
        "relativePath": "diffusion_models/<model-file>.safetensors",
        "sha256": "<64位真实SHA256>",
        "fileSizeBytes": 123456789
      }
    ],
    "customNodes": [
      {
        "name": "<custom-node-package>",
        "files": [
          {
            "path": "__init__.py",
            "sha256": "<64位真实SHA256>"
          }
        ]
      }
    ]
  }
}
```

### 4.1 状态选择

| 状态 | 含义 | 是否可选择 |
| --- | --- | --- |
| `configured` | 配置已录入，但尚未完成生产验证 | 仅在 `director.allow_experimental: true` 时可选 |
| `verified` | 已完成验证并有证据文件 | 可选 |
| `invalid` | 明确禁用或已知不兼容 | 目录中可见，但不可选 |

工作流首次接入应先使用 `configured`。完成真实环境验证后，添加存在的 `verifiedEvidence` 文件并改为 `verified`：

```json
"status": "verified",
"verifiedEvidence": "docs/research/<workflow-id>-test-report.md"
```

不要为了使注册表通过而伪造证据、SHA、文件大小或运行时版本。注册表会校验字段形状、工作流文件 SHA、必需节点和证据文件是否存在，但治理记录中的哈希真实性仍由接入者和验证报告负责。

### 4.2 execution 运行契约

`execution` 决定草稿、参数、参考图和显存策略，不能照抄其他工作流后不验证。

| 字段 | 可用值或约束 |
| --- | --- |
| `promptContract` | `h3_director_v1` 或 `free_text_v1` |
| `requiresPromptDraft` | 是否必须先编译并保存 H3 草稿 |
| `dimensions` | 正整数范围；宽高必须是 `multipleOf` 的倍数 |
| `references.min/max` | 非负整数，且 `max >= min` |
| `vramPolicy` | `h3_estimate` 或 `none` |
| `defaults` | 合法的宽、高、正时长、正帧率和非负整数种子 |

草稿编译和正式生成都读取同一份 `references.min/max`，因此无参考图工作流可设置 `min: 0`；不要再使用固定的 `1..9` 假设。

参数优先级为：

`本次生成显式参数 > settings.workflow_overrides[workflowId] > 默认工作流的旧版平铺 settings > execution.defaults`

只有默认工作流会读取旧版平铺的 `settings.width/height/...`，避免切换工作流后错误继承另一张图的参数。

## 5. 判断是否需要 adapter

adapter 负责把统一生成输入写入具体 ComfyUI 节点。它是输入绑定协议，不是工作流标签。

| 工作流类型 | 处理方式 |
| --- | --- |
| API 图中包含兼容的 `MiniMaxH3Director`，且使用 `h3_director_v1` | 可使用现有通用 H3 绑定器，不写 adapter 元数据 |
| 与现有官方 Sage Ref2VA 图结构和约束完全一致 | 可使用 `h3_director_r2v` adapter v1 |
| `free_text_v1`、其他节点体系、不同输入槽位或不同生成语义 | 必须新增专用 adapter |

不能仅因为模型名称相似就复用 adapter。`h3_director_r2v` v1 还会检查 Ref2VA UNET、`PathchSageAttentionKJ` 参数、1 到 9 张参考图、不启用 continuity 且只有一个 segment；不满足这些约束就应新建 adapter。

新增 adapter 时：

1. 在 `backend-node/src/director/adapters/` 创建实现文件。
2. 导出稳定的 `id` 和 `version`。
3. 实现 `validate(input, workflow, stagedAssets)`、`buildPrompt(template, input, stagedAssets)` 和 `describeCapabilities(workflow)`。
4. 在 `backend-node/src/director/adapters/index.js` 注册。
5. 为 adapter 的图结构校验、输入边界和 prompt 构建补单元测试。
6. 在注册表中一次性补齐下列全部字段：

```json
{
  "family": "<family>",
  "adapter": "<adapter-id>",
  "adapterVersion": "v1",
  "variant": "<variant>",
  "workflowFormat": "api",
  "capabilities": {
    "modes": ["<mode>"],
    "maxReferenceImages": 9,
    "supportsContinuity": false,
    "supportsAudio": true,
    "supportsSage": false
  },
  "inputSchemaVersion": 1
}
```

只要其中任一 adapter 元数据出现，`family`、`adapter`、`adapterVersion`、`variant`、`workflowFormat`、`capabilities` 和 `inputSchemaVersion` 就必须全部存在。注册表中的 `adapterVersion` 必须与代码导出的版本完全一致；`capabilities.maxReferenceImages` 目前要求至少为 1，并应与 adapter 能力和 `execution.references.max` 保持一致。

## 6. 开发环境加载与实验门禁

后端启动时一次性加载注册表。修改工作流 JSON、注册表或 adapter 后必须重启后端：

```powershell
cd backend-node
npm run dev
```

开发阶段如需选择 `configured` 工作流，在 `backend-node/configs/config.yaml` 中临时启用：

```yaml
director:
  workflow_registry_path: ./configs/director-workflows.json
  allow_experimental: true
```

生产环境建议保持 `allow_experimental: false`，只允许 `verified` 工作流。注册表、工作流文件或 adapter 任一项不合法时应修复根因，不应绕过加载校验。

## 7. 在 AI 配置中允许并默认选择工作流

启动前后端后，在“AI 配置”中新建或编辑视频服务：

1. 服务类型选择“视频”，提供商选择 `comfyui`。
2. Base URL 填目标 ComfyUI 地址，默认是 `http://127.0.0.1:8188`。
3. 在“允许的工作流”中多选当前通道可使用的工作流。
4. 在“默认工作流”中选择其中一个可用项。
5. 设置默认画面尺寸并保存。
6. 点击列表中的“测试”，确认每一个已选工作流的队列、必需节点和模型检查均通过。

目录中的 `configured` 或 `invalid` 项会显示不可用原因。连接检查逐工作流执行，不会提交推理任务，因此“连接检查成功”不等于真实生成已经验收。

对应的配置数据形状如下：

```json
{
  "service_type": "video",
  "provider": "comfyui",
  "base_url": "http://127.0.0.1:8188",
  "model": [
    "workflow_a_v1",
    "workflow_b_v1"
  ],
  "default_model": "workflow_a_v1",
  "settings": {
    "width": 1312,
    "height": 736,
    "workflow_overrides": {
      "workflow_a_v1": {
        "width": 1312,
        "height": 736,
        "durationSeconds": 5,
        "frameRate": 24,
        "seed": 42
      },
      "workflow_b_v1": {
        "width": 864,
        "height": 480,
        "durationSeconds": 6,
        "frameRate": 24,
        "seed": 7
      }
    }
  }
}
```

当前 AI 配置界面直接编辑的是允许集合、默认项和通用宽高；已有 `workflow_overrides` 会在编辑保存时被保留。需要首次写入逐工作流高级覆盖时，应通过 `PUT /api/v1/ai-configs/:id` 提交 `settings`，不要直接修改 SQLite 数据库。所有覆盖值仍会受该工作流 `execution` 契约校验。

保存时必须满足：

- `model` 至少包含一个工作流 ID；
- `default_model` 必须属于 `model`；
- 所有 ID 必须存在且在当前实验策略下可选；
- 非 ComfyUI 视频提供商不能携带 `workflow_id`。

## 8. 在创作页切换工作流

打开视频生成面板后，可以在当前视频通道白名单内选择工作流。选择结果随请求以 `workflow_id` 提交；`model`、`workflow_id` 和 `workflowId` 等兼容别名如果同时出现，必须指向同一工作流，否则请求会以 `VIDEO_WORKFLOW_CONFLICT` 拒绝。

对于 `requiresPromptDraft: true` 的工作流：

- 草稿按 `storyboard + videoConfig + workflowId` 隔离；
- 切换工作流后会读取或编译对应草稿；
- 草稿内的工作流 ID、SHA 或生成参数不匹配时不能复用；
- 正式生成会再次校验草稿与所选工作流一致。

因此，配置完成后可以在同一通道选择任意一个已允许工作流，但不能把 A 工作流的草稿或参数静默用于 B 工作流。

## 9. 验证清单

### 9.1 注册表离线加载

在 `backend-node` 目录执行：

```powershell
node -e "const {loadRegistry}=require('./src/director/workflowRegistry'); const r=loadRegistry('./configs/director-workflows.json'); console.table(r.workflows.map(w=>({id:w.id,status:w.status,sha:w.workflowSha256,adapter:w.adapter||'-'})))"
```

这一步应成功列出全部工作流，且不能出现路径、SHA、证据、节点或 adapter 校验错误。

### 9.2 针对性测试

```powershell
npx --yes node@22 --test test/registerComfyWorkflow.test.js test/directorWorkflowRegistry.test.js test/workflowExecutionPolicy.test.js test/workflowCatalog.test.js test/comfyuiVideoProvider.test.js
```

如果新增了 adapter，还必须运行对应 adapter 测试。完成后执行全量验证：

```powershell
cd backend-node
npx --yes node@22 --test test/*.test.js

cd ../frontweb
node --test test/*.test.js
npm run build
```

本项目后端测试统一使用 Node.js 22，避免其他 Node 版本与 `better-sqlite3` teardown 的兼容问题。

### 9.3 连接和真实生成

1. 在 AI 配置中对已选工作流逐项执行连接检查。
2. 用每个工作流的最小合法参考图数量生成一次。
3. 用最大边界或关键参数组合生成一次。
4. 确认 ComfyUI 收到的节点输入、尺寸、帧数、种子和参考图槽位正确。
5. 将实际环境、模型和自定义节点信息写入验证报告，再把状态升级为 `verified`。

真实生成会占用 GPU 和时间，不属于连接检查的一部分，应在明确的验证窗口执行。

## 10. 工作流升级

不要在存在待提交、失败可重试或运行中任务时直接覆盖原工作流文件。任务快照会固定以下关键数据：

- `workflowId`、绝对解析路径和工作流 SHA；
- `adapter` 与 `adapterVersion`；
- `execution`、`capabilities` 和最终生成参数。

旧任务需要重新提交时，如果文件内容或 adapter 版本已经改变，系统会明确报快照不匹配，而不会退回当前注册表重新选择。

推荐采用版本化升级：

1. 新文件使用新路径，例如 `my_workflow_v2.json`。
2. 新注册表条目使用新 ID，例如 `my_workflow_v2`。
3. 先以 `configured` 验证，再升级为 `verified`。
4. 将新 ID 加入通道白名单并切换默认项。
5. 等旧任务完成或不再需要恢复后，再按第 11 节下线旧 ID。

如果只是重新导出且确认语义完全不变，也必须重新计算 `workflowSha256`、重启后端并重新执行验证；SHA 不一致属于安全失败，不应手工绕过。

## 11. 工作流下线

按以下顺序执行：

1. 从所有 ComfyUI 视频通道的 `model` 白名单移除旧 ID，并将默认项切换到其他工作流。
2. 将注册表状态改为 `invalid`，保留不可用原因和历史记录。
3. 确认没有待提交、失败可重试或需要恢复的旧任务。
4. 最后再决定是否移除注册表条目和工作流文件。

不要先删除工作流文件。需要重新提交的历史任务依赖其不可变快照路径和 SHA；提前删除会得到 `VIDEO_WORKFLOW_SNAPSHOT_UNAVAILABLE`。

## 12. 常见错误排查

| 错误码 | 常见原因 | 处理方式 |
| --- | --- | --- |
| `WORKFLOW_REGISTRY_INVALID` | 注册表字段、路径、SHA、证据或治理信息不合法 | 从后端启动错误定位具体字段，修复后重启 |
| `WORKFLOW_NOT_FOUND` | ID 未注册或拼写错误 | 核对注册表 ID 和通道白名单 |
| `WORKFLOW_INVALID` | 条目状态为 `invalid` | 不要选择；修复并重新验证后再变更状态 |
| `WORKFLOW_EXPERIMENTAL_REQUIRED` | `configured` 工作流在关闭实验门禁时被选择 | 开发环境启用实验门禁，或完成验证后改为 `verified` |
| `WORKFLOW_ADAPTER_REQUIRED` | `free_text_v1` 或非通用 H3 图没有输入绑定 | 实现并注册专用 adapter |
| `ADAPTER_NOT_FOUND` | 注册表引用了未注册 adapter | 核对 adapter ID 和 `adapters/index.js` |
| `ADAPTER_VERSION_MISMATCH` | 注册表版本与 adapter 代码版本不同 | 同步版本并重新验证，不要只改字符串绕过 |
| `VIDEO_WORKFLOW_NOT_ALLOWED` | 工作流不在当前通道白名单，或非 ComfyUI 请求携带了工作流 | 更新正确的视频通道配置或移除非法参数 |
| `VIDEO_WORKFLOW_CONFLICT` | 多个工作流别名值不一致 | 请求中只保留统一的 `workflow_id` |
| `VIDEO_DIMENSIONS_INVALID` | 宽高越界或不是规定倍数 | 按 `execution.dimensions` 修正 |
| `VIDEO_PARAMETERS_INVALID` | 时长、帧率或种子不合法 | 使用正时长、正帧率和非负整数种子 |
| `VIDEO_REFERENCE_COUNT_INVALID` | 参考图少于 `min` 或多于 `max` | 按工作流引用契约调整 |
| `H3_DRAFT_WORKFLOW_MISMATCH` | 草稿属于另一个工作流 | 切回对应工作流或重新编译草稿 |
| `VIDEO_WORKFLOW_SNAPSHOT_LEGACY_UNSAFE` | 老任务缺少可安全重试的不可变快照 | 新建任务；不要让旧任务回退当前注册表 |
| `VIDEO_WORKFLOW_SNAPSHOT_MISMATCH` | 工作流文件或 adapter 已被改动 | 恢复快照对应版本，或新建任务使用新版本 |
| `VIDEO_WORKFLOW_SNAPSHOT_UNAVAILABLE` | 快照指向的文件已不存在 | 恢复原文件，后续采用版本化下线流程 |

## 13. 完成定义

一个新工作流只有同时满足以下条件才算接入完成：

- [ ] API Format JSON 已放入受控路径，且不含秘密信息。
- [ ] 分析脚本输出已人工核对。
- [ ] 注册表字段、SHA、治理信息和 execution 已补全。
- [ ] 输入绑定选择正确；需要时已新增并注册 adapter。
- [ ] 注册表离线加载通过。
- [ ] 后端针对性测试和全量测试通过。
- [ ] 前端全量测试与构建通过。
- [ ] AI 配置已加入白名单并设置合法默认项。
- [ ] 每个已选工作流的连接检查通过。
- [ ] 最小边界、关键边界和一次真实生成通过。
- [ ] 验证证据已落盘；生产工作流状态为 `verified`。
- [ ] 升级或下线没有破坏历史任务的不可变快照。
