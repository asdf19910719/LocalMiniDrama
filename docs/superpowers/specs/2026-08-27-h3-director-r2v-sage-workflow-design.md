# H3 Director R2V 工作流与视频模式设计

日期：2026-08-27
状态：已确认，V1 后端、前端契约与 ComfyUI 主机验收已完成
范围：V1 官方多参考图 + Sage 加速；连续多段仅完成设计，不在 V1 实现

## 1. 背景

项目已经将普通视频生成和 Director 候选生成统一到 `video_generations` 生命周期中。统一服务负责配置解析、任务创建、状态转换、取消、重试、恢复、产物持久化和错误规范化；ComfyUI Provider 负责把统一请求转换为 ComfyUI 任务。

当前实现仍有三个与目标不一致的限制：

1. 工作流 registry 只接受 ComfyUI API 格式，并且结构化注入逻辑只识别 `MiniMaxH3Director`。
2. 默认模板 `h3-continuity-v1` 是项目已有的 Director 工作流，不能表达官方 R2V + Sage 的能力契约。
3. 请求模型只有单个 prompt 和单个视频参数，尚未将 Director 的参考图、timeline 和连续性抽象为统一视频生成计划。

官方 `minimax_h3_director_r2v.json` 是 Director 插件的 R2V 工作流。它使用 `ref2va` 权重，支持多参考图、原生音频和 timeline；当 timeline 只有一个 segment 且关闭连续性时，行为等价于单段多参考图生成。官方加速示例包含 Sage 节点，但本项目基于现有 RTX 5070 Ti 测试结果只采用 `PathchSageAttentionKJ`，不把有崩溃风险的 `MiniMaxH3MemoryEfficientSageAttentionPatch` 作为默认方案。

## 2. 目标与非目标

### 2.1 V1 目标

- 将 `minimax_h3_director_r2v` 设为新的默认 ComfyUI 视频工作流。
- 默认使用“单段多参考图”模式：一个分镜对应一个 `s0` segment，关闭段间连续性。
- 将 SageAttention 内置在该工作流中，用户不配置独立 Sage Provider 或独立 Sage AI 服务。
- 支持 1 到 9 张参考图，并将应用本地素材安全地桥接到 ComfyUI。
- 通过能力声明和适配器封装 Director 工作流，避免 Provider 继续依赖某个固定节点名称。
- 保留统一视频任务、候选审核、质量检查、选用、重试和恢复语义。
- 为未来“连续多段”保留计划数据结构和适配器扩展点，但不在 V1 暴露或执行该模式。

### 2.2 非目标

- V1 不实现 `MiniMaxH3ReferenceToVideo` 独立节点工作流。
- V1 不实现 FL2V、V2V、RV2V、Refine 或外部 Director Groups。
- V1 不实现跨多个分镜的连续视频生成接口和时间线编辑器。
- V1 不允许用户任意修改 ComfyUI 节点参数或上传任意 workflow JSON。
- V1 不改变其他云端视频 Provider 的协议和路由。

## 3. 产品决策

### 3.1 工作流与生成模式分离

工作流表示“使用哪套 ComfyUI 图和运行时依赖”；生成模式表示“如何组织本次视频的内容”。两者不能共用一个含义模糊的 `model` 字段。

V1 的用户可见工作流只有：

```text
官方多参考图（Sage 加速）
```

其稳定 ID 仍为：

```text
minimax_h3_director_r2v
```

V1 的唯一可执行模式为：

```text
single_reference
```

它表示单段 R2V，而不是“只能有一张参考图”。参考图数量为 1 到 9 张。实现内部同时接受
`single_segment_r2v` 作为规范化输入别名，但快照和能力接口统一输出 `single_reference`，以兼容已有客户端。

`workflowId` 是运行时唯一的工作流选择字段；`model` 仅作为旧 API 的兼容投影，二者同时提供且不一致时请求必须拒绝。

### 3.2 Sage 是工作流实现细节

Sage 不创建新的 Provider、AI 配置或用户级 API Key。官方工作流模板在注册表中以 `official_sage` 变体登记，模板包含：

- `PathchSageAttentionKJ`；
- `sage_attention = auto`；
- `allow_compile = false`；
- `ref2va` UNET、H3 CLIP、视频 VAE 和音频 VAE。

连接测试必须检查 Sage 节点存在。缺少 Sage 节点时任务失败并提示安装/配置问题，不得静默回退到未加速工作流。

### 3.3 默认值和覆盖

新任务默认使用：

```text
workflow_id = minimax_h3_director_r2v
generation_mode = single_reference
continuity_enabled = false
```

未来允许项目或分镜覆盖 workflow/mode 时，覆盖只能发生在同一 ComfyUI Provider 的已登记能力范围内。Provider 仍由唯一启用的默认视频配置决定，不允许请求通过 `provider` 字段切换云端服务。

## 4. 总体架构

```text
普通视频入口 / Director 候选入口
              |
              v
     UnifiedVideoGenerationService
              |
       resolve video config
       build generation plan
       compile H3 prompt
       save immutable snapshot
              |
              v
        ComfyUI Video Provider
              |
       select workflow registry entry
              |
        H3 Director R2V Adapter
          |       |        |
     validate  stage refs  build API prompt
              |
              v
          ComfyUI /prompt
              |
       poll / history / download / probe
```

统一服务继续负责任务状态和数据库事务。Provider 不创建候选组、不决定 Director 是否生效，也不读取新的默认配置来重试旧任务。

## 5. 工作流 registry 设计

### 5.1 注册条目

现有治理字段（状态、路径、SHA-256、模型文件、自定义节点、provenance、runtimeLock）继续保留。新增或明确以下字段：

```json
{
  "id": "minimax_h3_director_r2v",
  "status": "verified",
  "family": "h3_director",
  "adapter": "h3_director_r2v",
  "variant": "official_sage",
  "workflowFormat": "api",
  "capabilities": {
    "modes": ["single_reference"],
    "maxReferenceImages": 9,
    "supportsContinuity": false,
    "supportsAudio": true,
    "supportsSage": true
  },
  "inputSchemaVersion": 1,
  "inputSchema": {
    "common": ["prompt", "negativePrompt", "width", "height", "durationSeconds", "frameRate", "seed"],
    "references": ["referenceImageUrls"],
    "advanced": ["refMaxSize", "continuityOverlapFrames"]
  }
}
```

`supportsContinuity` 在 V1 为 false，表示当前可执行能力只包含单段；未来连续多段实现后，能力声明和模式 schema 一起升级，不能仅修改前端下拉选项。

### 5.2 模板格式

运行时只接受 ComfyUI API 格式：

```json
{
  "prompt": {
    "1": { "class_type": "UNETLoader", "inputs": {} }
  }
}
```

官方 UI 格式（`nodes/links/groups`）只能在离线导入/转换阶段使用。转换后的 API 文件、SHA-256 和运行时锁定信息必须一并登记；运行时不做隐式 UI-to-API 转换。

### 5.3 适配器接口

ComfyUI Provider 通过工作流的 `adapter` 字段选择适配器。适配器至少提供：

```text
validate(input, workflow)
buildPrompt(template, input, stagedAssets)
describeCapabilities(workflow)
```

`h3_director_r2v` 适配器负责识别并注入 Director 节点，设置 `task_type = r2v`，生成一个 segment 的 `timeline_data`，并保证 `continuityEnabled = false`。未来其他 H3 工作流通过新的适配器加入，不在当前函数中堆叠节点名称判断。

## 6. 统一生成计划

V1 即使只有一个 segment，也使用计划结构，避免未来连续多段时重新迁移任务模型：

```json
{
  "workflowId": "minimax_h3_director_r2v",
  "mode": "single_reference",
  "common": {
    "width": 864,
    "height": 480,
    "durationSeconds": 5,
    "frameRate": 24,
    "seed": 42
  },
  "segments": [
    {
      "id": "s0",
      "storyboardId": 101,
      "prompt": "...",
      "durationSeconds": 5,
      "referenceImages": [
        { "index": 0, "source": "...", "role": "subject" }
      ],
      "continuityFromPrev": false
    }
  ]
}
```

V1 的计划校验规则：

- `segments` 必须恰好一个元素；
- 参考图数量为 1 到 9；
- 宽高为正整数且为 32 的倍数；
- 时长、帧率和 Seed 在统一服务中先完成类型和范围校验；
- `continuityFromPrev` 必须为 false；
- `continuityOverlapFrames` 仅为未来连续模式预留，V1 请求不得启用或修改该字段；
- 不接受未经 schema 允许的任意节点参数。

H3 prompt 编译仍由现有 skill agent 完成。单段模式要求保留 H3 结构字段和 `[Shot 1]`，参考图模式要求存在 `<Picture N>` 等标签。适配器将编译后的 prompt 写入 `global_prompt` 和单个 segment 的 prompt 字段。

当请求同时包含首帧字段和多张参考图时，参考图数量优先决定 `Ref2VA` 模式；首帧字段不得把多参考图请求误判为 `I2VA`。

## 7. 参考图素材桥接

### 7.1 问题

项目数据库中的图片可能是应用 storage 相对路径、绝对路径或 `/static/...` URL。Director 节点读取的是 ComfyUI 可见的输入文件名。直接把应用路径写入 `timeline_data` 会在目录隔离、远程 ComfyUI 或路径包含特殊字符时失败。

### 7.2 V1 方案

在 ComfyUI Provider 前增加受控的素材桥接步骤：

1. 解析并验证参考图来源，只允许项目 storage 和已登记的本地产物根目录。
2. 计算内容 hash，生成不含路径信息的安全文件名。
3. 本地 ComfyUI 使用复制到 input 目录的方式；远程 ComfyUI 使用 `/upload/image`。
4. 返回 `{ source, comfyFilename, sha256, role, index }` 清单。
5. 适配器只把 `comfyFilename` 写入 timeline 的 `refs`。
6. 任务完成、取消或失败后按引用计数清理临时素材；清理失败只记录告警，不覆盖任务结果。

素材桥接必须防止路径穿越、任意文件读取和把 API URL/API Key 写入任务快照。快照只保存来源标识、hash 和 ComfyUI 文件名。

## 8. 配置、快照与兼容性

### 8.1 AI 配置

V1 使用现有唯一默认视频配置：

```text
service_type = video
provider = comfyui
default_model = minimax_h3_director_r2v
```

ComfyUI 的 `settings` 保存尺寸、帧率、VRAM 预算、工作流注册信息等默认值。Sage 参数属于工作流模板和能力，不单独保存为另一条 AI 配置。

### 8.2 任务快照

`video_generations.config_snapshot` 扩展为不可变运行快照，至少包含：

```json
{
  "configId": 7,
  "provider": "comfyui",
  "model": "minimax_h3_director_r2v",
  "workflowId": "minimax_h3_director_r2v",
  "workflowSha256": "sha256:...",
  "workflowVariant": "official_sage",
  "adapter": "h3_director_r2v",
  "adapterVersion": "v1",
  "generationMode": "single_reference",
  "sage": {
    "node": "PathchSageAttentionKJ",
    "attention": "auto",
    "allowCompile": false
  },
  "planHash": "sha256:..."
}
```

重试、恢复和服务重启后的轮询都使用该快照。默认配置变化、工作流文件变化或 Sage 节点变化不得改变运行中任务的语义。只有明确的“按当前配置重新生成”操作才创建新任务并解析新的默认配置。ComfyUI 本地任务在原配置记录被停用或删除后仍可依据快照恢复；云端 Provider 仍要求原始凭据记录存在。

### 8.3 历史任务

已有 `h3-continuity-v1` 任务不重跑、不伪造为新工作流。旧任务继续按已有快照读取和恢复；新默认只影响新任务。必要时保留 registry 别名或历史状态标记，但不把旧 hash 替换成新 hash。

## 9. UI 设计

### 9.1 V1 交互

视频生成面板保持现有候选、审核、质量检查和锚点交互，只增加清晰的运行信息：

```text
工作流：官方多参考图（Sage 加速）
生成模式：单段多参考图
```

V1 不显示未实现的连续多段选择器。参考图区域显示 1 到 9 个槽位，并允许来源为场景、角色、道具、锚点或用户上传素材。提交前显示实际参考图数量和角色。

H3 专属字段由后端能力声明驱动，不再在 Vue 中通过 `model.includes('minimax-h3')` 判断。非 H3 Provider 继续使用现有通用面板。

### 9.2 配置页

ComfyUI 视频配置页将默认工作流显示为注册表返回的工作流名称和状态。连接测试结果应展示：

- 工作流 ID 和 hash；
- `MiniMaxH3Director`、Sage 节点等必需节点；
- `ref2va`、CLIP、VAE 模型；
- H3 尺寸校验和 VRAM 预算；
- 未启动真实推理的声明。

不在配置页增加 Sage API Key、Sage Provider 或重复的 Sage 工作流配置项。

## 10. 连续多段设计（B，V1 不实现）

连续多段的业务入口是“同一集选择多个分镜”，而不是在单个分镜中手动拆分。未来流程为：

```text
Episode -> ordered storyboards -> sequence plan -> Director R2V
```

每个分镜转换为一个 segment，包含自己的 prompt、时长和参考图。第一个 segment 的 `continuityFromPrev=false`，后续 segment 为 true；默认 overlap 为 22 帧。一个候选对应一个完整序列视频，候选审核和选用逻辑不变。

未来需要新增：

- 分镜序列选择和排序接口；
- sequence plan 校验；
- 多段 H3 prompt 编译（要求 `[Shot 1]`、`[Shot 2]` 等）；
- 按段显示进度和错误；
- 是否导出分段产物的设置。

V1 不创建这些接口，不在 UI 暴露 `continuous_sequence`，但计划结构、快照和适配器接口必须保持向后兼容。

## 11. API 与数据流

### 11.1 V1 现有入口

`POST /videos` 和 `POST /director/shots/:shotId/generate` 继续作为入口。请求可在统一结构中携带 `workflow_id` 和 `generation_mode`，但 V1 后端只接受默认的 `minimax_h3_director_r2v` 与 `single_reference`，不接受任意工作流 ID。

Director 路由仍负责收集分镜、场景、角色和道具参考图，并将其交给统一视频服务；它不直接调用 ComfyUI。

### 11.2 能力接口

建议增加只读能力接口（具体路径可在实现计划中确定）：

```text
GET /videos/capabilities
```

返回当前默认视频配置可用的工作流、模式、参数 schema、连接状态和 Sage 能力。前端据此决定显示哪些控件。

### 11.3 运行时数据流

```text
load default config
  -> resolve workflow entry
  -> collect and stage references
  -> compile and validate H3 prompt
  -> save video_generation + snapshot
  -> acquire GPU lease
  -> submit ComfyUI API prompt
  -> poll history
  -> download and probe output
  -> persist review candidate
```

失败不得自动切换到旧工作流、云端 Provider 或无 Sage 模板。错误需要指出阶段：配置、素材桥接、提示词、ComfyUI 提交、轮询、产物下载或媒体探测。

## 12. 安全、资源与错误处理

- registry 文件、模板 hash、模型 hash 和自定义节点治理继续 fail-closed。
- 参考图路径必须经过允许根目录校验；禁止任意本地路径和远程 URL 直接写入 ComfyUI prompt。
- 任务提交前继续执行 H3 尺寸和 VRAM 预算检查。
- GPU lease 生命周期覆盖提交、轮询和恢复；终态释放 lease。
- Sage 节点缺失、模型缺失、工作流 hash 变化、素材上传失败均拒绝提交。
- ComfyUI 失败不触发 Provider fallback。
- API Key 不写入 plan、workflow snapshot、`extra_data` 或日志。

## 13. 测试与验收

### 13.1 单元测试

- registry 能加载 API 工作流并校验 hash、治理字段和必需节点；
- UI 格式工作流被拒绝，而不是运行时隐式转换；
- 适配器生成单个 `s0`，并设置 `r2v`、帧数、尺寸和 `continuityEnabled=false`；
- 1、9 张参考图通过，0、10 张拒绝；
- 非 32 倍数尺寸、负时长、非法 Seed 被拒绝；
- Sage 节点和 `ref2va` 模型缺失时连接测试失败；
- 快照包含 workflow hash、adapter version、mode 和 Sage 设置；
- 重试/恢复不读取新的默认配置。

### 13.2 集成测试

- mock ComfyUI 能接收 API prompt、返回 prompt ID、完成轮询并下载产物；
- Director 候选入口和普通视频入口都生成同样的统一任务结构；
- 参考图素材桥接产生安全文件名并在终态清理；
- 取消、超时、ComfyUI 错误和服务重启恢复保持统一状态。

### 13.3 主机验收

仅执行一个短时、单候选的真实本地任务：

- `864x480`；
- 约 5 秒；
- 1 到 3 张真实参考图；
- Sage KJ `auto`；
- 确认输出视频含视频和音频流；
- 确认任务进入 `review`，不会自动覆盖分镜结果。

不在自动测试中执行长时、多候选或连续多段推理。

## 14. 实施分期

### V1

1. 将官方 R2V UI 模板转换并登记为 API 模板。
2. 集成 KJ Sage 节点，完成模型/节点/runtime lock 治理。
3. 实现 H3 Director R2V 适配器和单段计划。
4. 实现参考图素材桥接。
5. 切换默认配置到 `minimax_h3_director_r2v`。
6. 更新能力接口、配置页和视频面板展示。
7. 完成测试和一次真实主机验收。

### 后续版本

- 实现 B 方案的多分镜序列选择和连续 timeline；
- 增加动态高级参数 schema；
- 增加官方 `MiniMaxH3ReferenceToVideo` 独立适配器（如仍有产品需求）；
- 评估 FL2V、V2V、RV2V 和 Refine。

## 15. V1 verification record

- Backend: Node 22 full suite from `backend-node` completed with 284/284 tests passing.
- Frontend: `frontweb` production build completed successfully.
- Host acceptance: ComfyUI 0.33.1 at `http://127.0.0.1:8188`; workflow `minimax_h3_director_r2v`; one local reference; 864x480; 24 fps; 5 seconds; seed 42. The task completed with workflow hash `sha256:f80969d8c86a1fbabb20fc0ce915a4fa494fe016a256ef47939ef8ce5d4599fe` and produced an H.264 video stream (864x480, 24 fps) plus AAC audio (5 seconds). The staged input was removed after completion.
- Browser user-flow acceptance: on `http://127.0.0.1:3013/film/3`, the video panel opened without the former `H3 Director R2V adapter requires an API-format workflow` error, showed the `minimax_h3_director_r2v` Sage workflow and disabled continuity mode, and a real DOM click on `生成候选` created two candidates for storyboard 5. Tasks 27 and 28 both reached `review` with local H.264/AAC artifacts (1280x704, 24 fps, 5 seconds). Evidence: `docs/research/_artifacts/h3-director-r2v-candidate-ui-smoke.json` and `.png`.
- Remote ComfyUI cleanup is capability-based. When a deployment does not expose `/delete/image`, cleanup emits a warning and does not alter the task result; operators must provide that endpoint or configure a shared input directory with local cleanup.
- `workflow_id` overrides that differ from the active default are rejected in V1. `single_segment_r2v` is accepted as an input alias; snapshots and capabilities expose `single_reference`.

## 16. V1 完成判定

V1 只有在以下条件全部满足时才算完成：

1. 新建视频任务默认使用官方 R2V + Sage 模板。
2. 单段多参考图任务在本地 ComfyUI 上真实完成并产出可播放音视频。
3. 参考图、工作流 hash、Sage 参数和适配器版本都进入任务快照。
4. 普通视频和 Director 候选都使用统一生命周期。
5. 缺少 Sage/模型/素材/显存时 fail-closed，且无静默 fallback。
6. 旧 `h3-continuity-v1` 任务仍可读取和恢复。
7. 连续多段未被错误地宣称为 V1 已支持；其 B 方案设计已保存在本文件中。
