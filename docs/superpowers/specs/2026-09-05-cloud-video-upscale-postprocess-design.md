# 云端视频超分适配器与生成后处理设计规格

日期：2026-09-05
状态：已实现并完成本地验收、RTX 5090 云端短片及跨段真机验收
适用项目：`E:\project\LocalMiniDrama`

## 1. 背景与结论

LocalMiniDrama 当前通过本地 ComfyUI 生成 H3 视频片段，再将选中的片段合并为单集视频。项目当前 H3 配置及已生成素材为 `1312×736`，成片阶段通过云端 FlashVSR 或 SeedVR2 放大 2 倍到 `2624×1472`。`1312×736` 是满足节点 32 像素步长的项目自定义尺寸；H3 官方 0.98 MP 预设为 `1344×768`，不能再把 `1280×736` 写成官方 0.98 MP。

推荐采用“独立云端超分适配器 + 可恢复的后处理作业”方案，并把超分放在：

```text
镜头生成 → 镜头选择 → 基础视频合并 → 云端 2× 超分 → 字幕/水印/最终混音 → 成片校验与发布
```

关键决定：

- 默认使用 FlashVSR（M20），作为日常性价比方案；SeedVR2（M19）作为可选高质量方案。
- 只对已经选定并合并的最终素材超分，不对候选镜头逐条超分，避免浪费云端算力。
- 超分默认关闭，由单集生成选项显式开启；开启后失败不会静默交付低清版本。
- 长视频统一走分段工作流；M18 只保留为短片诊断或人工对照，不进入生产主链路。
- 先超分、后烧字幕和水印，避免字幕边缘被生成式超分重绘，同时让叠加元素保持最终分辨率下的清晰度。
- 原始合并视频始终保留。云端不可用时任务进入可恢复的等待状态，而不是重做 H3 生成。

## 2. 目标与非目标

### 2.1 目标

1. 在 LocalMiniDrama 中配置一个与现有视频生成提供商解耦的云端超分服务。
2. 支持 `1312×736 → 2624×1472` 的 FlashVSR、SeedVR2 两种策略。
3. 支持两分钟及更长视频，通过固定时长/帧数分段、边界去重、无损时间线拼接完成处理。
4. 支持服务离线、ComfyUI 未启动、排队、断网、超时、显存不足、进程重启等异常后的安全恢复。
5. 让用户能看到“合并、等待云端、上传、超分分段、拼接、叠加、校验”的真实进度。
6. 不把面板实现细节泄漏到业务层，并为未来更换算力平台保留统一接口。

### 2.2 非目标

- 不修改 H3/Sage 生成工作流本身。
- 不在本轮实现云端机器的自动购买、开机或续费；这些动作涉及费用，必须由平台能力和用户授权另行接入。
- 不并行提交多个显存密集型分段；第一版以稳定、可恢复为优先。
- 不自动在 FlashVSR 和 SeedVR2 之间降级切换，因为两者视觉结果不同，自动切换会造成同一成片画风不一致。
- 不通过公网裸露的原生 ComfyUI `/prompt` 作为生产接口；使用控制面板的工作流 API。

## 3. 已确认的外部接口约束

### 3.1 服务入口

- 控制面板：`https://uu1119133-7885b7b94296.bjb2.seetacloud.com:8443`
- 原生 ComfyUI：`https://u1119133-7885b7b94296.bjb2.seetacloud.com:8443`

项目只配置控制面板地址。原生 ComfyUI 地址仅用于人工调试，不由业务代码直接调用。

### 3.2 工作流

| 模式 | 工作流 | 视频节点 | 默认分段帧数 | 跳帧字段 | 用途 |
|---|---|---:|---:|---|---|
| SeedVR2 | `M19-视频高清放大-SeedVR2-2倍-分段工作节点` | `25` | 240 | `skip_first_frames` | 高质量、较慢 |
| FlashVSR | `M20-视频高清放大-FlashVSR-2倍-分段工作节点` | `195` | 240 | `skip_first_frames` | 默认、性价比高 |

M18 是 SeedVR2 短视频工作流，不支持长视频调度所需的分段参数，因此不作为主路径。

尺寸不是通过 `VHS_LoadVideo` 强制改写：M19 节点 25、M20 节点 195 的 `custom_width/custom_height` 都保持 0，沿用上传文件的实际尺寸。每个分段提交前，适配器根据作业目标显式改写尺寸节点：M20 节点 192 的 `value=2`；M19 节点 29 的 `resolution=1472`、`max_resolution=2624`。因此真正提交到云端队列的完整工作流是 `1312×736 → 2624×1472`，不依赖远端模板中的旧示例文件名或旧上限。

### 3.3 正确的提交协议

控制面板并不接受只包含 `workflow_id` 和 `input_values` 的简化请求。适配器必须执行以下步骤：

1. `GET /api/workflow/config/{workflowId}`；
2. 复制响应中的 `workflow_template`；
3. 删除模板根级 `_api_config` 元数据；
4. 只修改已知节点的 `inputs`：视频路径、`frame_load_cap`、`skip_first_frames`、输出前缀，以及 M20 的 2× 倍率或 M19 的目标短边/长边上限；
5. `POST /api/workflow/generate`，请求体为：

```json
{
  "source": "quick",
  "workflow_template": {},
  "client_id": "local-mini-drama:<job-id>:<segment-index>"
}
```

6. 使用返回的 `prompt_id` 轮询 `GET /api/workflow/result?prompt_id=...`；
7. 从完成结果中选择视频输出并下载。

适配器必须严格校验节点和字段是否存在。平台工作流发生变化时应返回 `WORKFLOW_SCHEMA_CHANGED`，不能猜测节点或继续提交。

## 4. 总体架构

```text
Episode Finalize API
        │
        ▼
VideoMergeService ──生成──> base_merged.mp4
        │
        ▼
VideoUpscaleJobService（持久化状态机）
   ├── VideoUpscalePlanner（探测、分段、尺寸/fps 约束）
   ├── ZealmanUpscaleClient（健康检查、启动、上传、模板、提交、查询、下载）
   └── VideoUpscaleStitcher（边界裁切、拼接、音频恢复、校验）
        │
        ▼
upscaled_2x.mp4
        │
        ▼
MergedEpisodePostProcess（字幕、水印、最终音频）
        │
        ▼
final_episode.mp4
```

### 4.1 职责边界

`VideoMergeService` 只负责编排阶段，不直接理解控制面板协议。它生成基础合并视频后创建超分作业，等待作业进入终态，然后把成功的超分文件或用户明确选择跳过后的基础文件传给现有后处理。

`VideoUpscaleJobService` 是状态机和恢复中心。所有会跨进程、跨分钟或跨小时的状态都写入数据库，不能依赖内存 Promise。

`ZealmanUpscaleClient` 是唯一知道平台 HTTP 细节的模块。将来更换平台时，只需实现同一适配器接口。

`VideoUpscalePlanner` 与 `VideoUpscaleStitcher` 是纯本地模块，便于使用小型测试视频做确定性测试，无需消耗 GPU。

## 5. 在现有生成流程中的插入点

当前 `videoMergeService.processVideoMerge()` 在合并后直接选择是否进入 `mergedEpisodePostProcess`，而 Director timeline 分支存在提前返回。实施时应把两条分支收敛到共同的“最终化”函数：

```text
普通镜头合并 ─┐
              ├─> finalizeMergedVideo(basePath, mergeOptions)
Director 合并 ─┘
```

`finalizeMergedVideo` 顺序固定为：

1. 用 ffprobe 校验基础合并视频；
2. 若 `merge_options.upscale.enabled=true`，创建或恢复超分作业；
3. 超分完成后再次校验尺寸、帧率、时长和可解码性；
4. 使用超分结果执行字幕、水印和最终音频处理；
5. 原子移动为最终输出并将 merge 标记为 completed。

这样普通合并和 Director timeline 都不会绕过超分，也不会重复实现后处理顺序。

### 5.1 为什么不在镜头生成后立即超分

- 候选镜头可能被重新生成或放弃，逐镜头超分会浪费费用和时间。
- 镜头交界处经合并后统一分段，更容易保持帧率和音轨连续。
- 云端离线不会阻塞 H3 镜头继续生成，只影响最终成片阶段。

### 5.2 为什么字幕和水印放在超分之后

- 生成式超分可能改变小字、锐化字幕边缘或产生伪影。
- 在目标尺寸绘制字幕和水印可获得稳定字号和清晰边缘。
- 最终混音不需要上传到云端，减少隐私和传输体积。

## 6. 配置与业务 API

### 6.1 独立服务配置

不复用当前 `service_type=video_generation` 的默认 ComfyUI 配置。新增 `service_type=video_upscale`，推荐配置快照如下：

```json
{
  "provider": "zealman",
  "base_url": "https://uu1119133-7885b7b94296.bjb2.seetacloud.com:8443",
  "api_key": null,
  "settings": {
    "default_method": "flash",
    "workflows": {
      "flash": "M20-视频高清放大-FlashVSR-2倍-分段工作节点",
      "seed": "M19-视频高清放大-SeedVR2-2倍-分段工作节点"
    },
    "expected_source_width": 1312,
    "expected_source_height": 736,
    "scale": 2,
    "segment_frame_cap": 240,
    "overlap_frames": 4,
    "auto_start_comfy": true,
    "offline_wait_hours": 24,
    "max_poll_hours": 8,
    "tls_verify": true
  }
}
```

`api_key` 当前可为空，但客户端应预留 `Authorization: Bearer` 支持。密钥只从加密配置或环境变量解析，不能写入任务快照或日志。

提交超分前必须以实际文件的 ffprobe 结果为准：当前生产契约只接受 `1312×736`，目标为 `2624×1472`；不匹配时返回 `UNSUPPORTED_SOURCE_DIMENSIONS`，提示修正 H3 工作流或另建对应超分工作流，不能偷偷拉伸。云端读取节点保持 `custom_width=0`、`custom_height=0`，不会在上传时改画幅。

### 6.2 单集请求

现有 finalize 请求的 `merge_options` 增加：

```json
{
  "upscale": {
    "enabled": true,
    "method": "flash",
    "failure_policy": "wait_for_action"
  }
}
```

- `method`：`flash | seed`；缺省时取服务配置的 `default_method`。
- `failure_policy`：第一版只允许 `wait_for_action`。失败后保留基础视频，由用户选择重试或跳过。
- 未提供 `upscale` 时视为关闭，保持现有行为完全兼容。

### 6.3 管理端点

建议新增：

- `GET /api/v1/video-upscale/capabilities`：只读取平台健康、ComfyUI 状态和工作流配置，不提交推理。
- `GET /api/v1/video-upscale/jobs/:id`：返回作业、分段和可执行动作。
- `POST /api/v1/video-upscale/jobs/:id/retry`：从可恢复检查点继续。
- `POST /api/v1/video-upscale/jobs/:id/skip`：明确使用基础合并视频继续后处理。
- `POST /api/v1/video-upscale/jobs/:id/cancel`：取消未完成作业；若平台支持 prompt 取消则同步取消。

`skip` 和 `cancel` 语义不同：skip 会继续生成低清成片；cancel 会终止本次最终化，不把 merge 标为完成。

## 7. 长视频分段算法

### 7.1 规划

1. ffprobe 获取精确的有理数帧率、视频时长、帧数、尺寸、是否含音频。
2. 首段：`skip_first_frames=0`，`frame_load_cap=240`。
3. 后续段从“上一段理论结束帧减 4 帧”开始，请求 240 帧，形成 4 帧重叠。
4. 下载后裁掉后续段开头的 4 个重叠帧，再按帧顺序拼接。
5. 最后一段按剩余帧数提交；如果工作流只能固定上限，允许读取不足上限的尾段。

以 24 fps、两分钟视频为例，约 2880 帧，240 帧约等于 10 秒，需要约 12 个主分段；加入 4 帧重叠不会改变最终目标帧数。

### 7.2 拼接与音频

- 分段输出不依赖云端音频；最终音轨从基础合并视频恢复。
- 优先使用可无损 concat 的一致编码参数；不一致时统一转码为项目标准输出编码。
- 用帧级 trim 去除重叠，不使用浮点秒裁切，以免 23.976/29.97 fps 出现累积漂移。
- 音频以基础视频时间线为准，超出最终视频长度时裁切，不足时不循环补齐。
- 最终强制输出精确 `2624×1472`，但只有在云端结果与目标尺寸仅存在编码对齐误差时才允许缩放；明显错误应判定失败。

### 7.3 输出校验

完成条件必须同时满足：

- 视频可由 ffprobe/ffmpeg 完整读取；
- 宽高为 `2624×1472`；
- 最终帧数与源视频相差不超过 1 帧；
- 时长差不超过 `max(1/fps, 50ms)`；
- 帧率与源视频的有理数表示一致，或等价误差小于 0.01 fps；
- 源视频有音频时最终视频也有音频；
- 文件非零且落在项目允许的磁盘目录内。

## 8. 持久化状态模型

新增迁移 `33_video_upscale_jobs.sql`，包含两个表。

### 8.1 `video_upscale_jobs`

建议字段：

- `id`, `episode_id`, `video_merge_id`, `async_task_id`；
- `provider`, `method`, `workflow_id`, `config_snapshot_json`；
- `source_path`, `source_fingerprint`, `source_width`, `source_height`, `source_fps_num`, `source_fps_den`, `source_frame_count`；
- `target_width`, `target_height`, `output_path`；
- `status`, `progress`, `current_stage`, `error_code`, `error_message`；
- `retry_count`, `next_retry_at`, `waiting_since`, `cancel_requested_at`；
- `created_at`, `started_at`, `completed_at`, `updated_at`。

### 8.2 `video_upscale_segments`

建议字段：

- `id`, `job_id`, `segment_index`；
- `start_frame`, `requested_frame_count`, `overlap_frames`；
- `remote_input_name`, `client_id`, `prompt_id`, `filename_prefix`；
- `status`, `progress`, `remote_result_json`, `local_output_path`；
- `retry_count`, `error_code`, `error_message`；
- `created_at`, `submitted_at`, `completed_at`, `updated_at`。

唯一约束：`(job_id, segment_index)`；索引：`status/next_retry_at`、`prompt_id`、`video_merge_id`。

### 8.3 状态机

```text
pending
  → waiting_provider → starting_provider → uploading
  → queued → running → downloading
  → stitching → validating → completed

任意活动状态 → failed / cancelled
waiting_provider 或 failed → retry → 最近的安全检查点
failed → skipped（用户明确选择后）
```

每次状态转换和外部请求结果先落库再进入下一阶段。重启恢复时根据 `prompt_id` 查询已有任务，不能盲目重复提交。

## 9. 异常场景与处理策略

| 场景 | 判定 | 自动行为 | 用户可见状态 |
|---|---|---|---|
| 云端机器未开机、域名不可达、502/504 | 健康检查失败 | 进入 `waiting_provider`；按 1、5、15、30 分钟退避，之后每 30 分钟；最长等待 24 小时 | 等待云端设备，保留基础视频，可手动重试或跳过 |
| 面板在线但 ComfyUI 未运行 | `/api/comfy/status` 非 running | 若配置允许，调用启动接口并轮询最多 10 分钟；否则等待 | 正在启动云端 ComfyUI |
| 自动开机需要计费或平台无接口 | 无已授权启动能力 | 绝不尝试购买/开机，只等待 | 需要先在算力平台启动机器 |
| 工作流不存在 | 配置接口 404 | 非重试 `WORKFLOW_NOT_FOUND` | 云端工作流配置错误 |
| 节点 ID/字段变化 | 模板严格校验失败 | 非重试 `WORKFLOW_SCHEMA_CHANGED` | 工作流已变化，需要重新适配 |
| 源分辨率不是 1312×736 | 本地预检失败 | 不上传、不计费 | 当前工作流不支持该源尺寸 |
| 本地磁盘不足 | 估算空间不足 | 不上传；清理临时产物后仍不足则失败 | 本地磁盘空间不足 |
| 上传中断 | 网络错误/校验失败 | 同一源文件重试最多 3 次；使用指纹避免业务侧重复记录 | 上传重试中 |
| 远端临时文件丢失 | 提交返回文件不存在 | 重新上传一次后再提交 | 云端输入已恢复 |
| 云端排队 | prompt 已存在但未执行 | 继续查询，不重复提交 | 云端排队中，显示已等待时长 |
| 请求超时但结果未知 | HTTP 超时 | 先按 `prompt_id/client_id` 对账，再决定是否重试 | 正在确认云端任务状态 |
| 显存不足 | 结果含 OOM/CUDA out of memory | 清理显存后重试一次；仍失败则将后续分段上限依次降为 120、60 帧并重新规划未完成部分 | 自动降低分段长度后重试 |
| 推理失败 | 明确错误 | 当前分段最多重试 2 次；不自动换模型 | 第 N 段失败，可重试或跳过整个超分 |
| 下载中断 | 已有完成结果 | 只重试下载，不重新推理 | 下载重试中 |
| 输出损坏/尺寸错误 | 本地校验失败 | 重下 1 次，再重跑该段 1 次 | 云端输出校验失败 |
| 后端进程重启 | 存在活动作业 | 启动时扫描并按 prompt 状态恢复 | 自动恢复中 |
| 用户取消 | `cancel_requested_at` | 尝试取消平台 prompt；清理本地临时分段，保留基础视频 | 已取消，可重新发起 |
| 用户选择跳过 | failed/waiting 状态下调用 skip | 使用基础合并视频继续字幕/水印/混音 | 已跳过超分，输出基础分辨率 |
| 字幕/水印阶段失败 | 超分已完成 | 保留超分中间文件，只重试后处理 | 后处理失败，不重复超分 |

24 小时是自动等待上限，不是数据删除期限。超过后作业停留在 `waiting_provider` 并停止定时请求，用户手动重试即可恢复。

## 10. 幂等、恢复与资源控制

### 10.1 幂等键

每个分段的 `client_id` 和 `filename_prefix` 包含 `job_id + segment_index + source_fingerprint`。提交前后都持久化这些值：

- 已有 `prompt_id`：查询，不重新提交；
- 已完成但未下载：继续下载；
- 已下载并通过校验：直接复用；
- 只有远端明确不存在且本地未完成时才重新提交。

### 10.2 并发

- 一个云端服务配置默认只允许一个活动推理分段。
- 多集同时完成时在数据库队列中串行执行，不能依赖单进程内 mutex。
- 上传可在当前推理期间准备下一段，但第一版默认关闭预取，降低远端磁盘占用。

### 10.3 临时文件

目录建议：

```text
storage/video-upscale/<job-id>/
  source.json
  segments/0000.mp4
  segments/0001.mp4
  concat/
  upscaled_2x.mp4
```

只有 final_episode 已原子落盘且数据库标记完成后，才清理分段文件。清理失败只记录告警，不把成片回滚为失败。

## 11. 进度与前端体验

将单集最终化进度映射为：

| 区间 | 阶段 |
|---:|---|
| 0–30% | 基础视频合并 |
| 30–35% | 云端检查与上传 |
| 35–85% | 分段排队、推理、下载，按完成帧数加权 |
| 85–92% | 去重、拼接、音频恢复 |
| 92–98% | 字幕、水印、最终混音 |
| 98–100% | 完整性校验与原子发布 |

前端最终化选项增加：

- “2× 云端超分”开关，默认关闭；
- 模式：FlashVSR（推荐/较快）、SeedVR2（更慢/偏质量）；
- 目标尺寸只读显示 `2624×1472`；
- 云端等待时显示“检查云端”“手动重试”“跳过超分并继续”；
- 错误展示稳定的中文摘要和可复制的错误码，不展示密钥、完整模板或堆栈。

## 12. 安全与运维

- 当前控制面板从现有网络可直接访问，不能把“长且随机的域名”当作认证。
- 上线前优先通过反向代理增加 API Key、IP 白名单或平台鉴权；客户端已预留 Bearer token。
- `tls_verify` 生产环境必须为 true。项目现有全局 `NODE_TLS_REJECT_UNAUTHORIZED=0` 不应被新客户端继承；若测试环境确需自签名证书，只为该连接配置专用 agent 并显示安全警告。
- 上传内容属于成片素材，日志只能记录文件指纹、大小和任务 ID，不能记录完整模板中的敏感值。
- 健康检查、模板检查是免费只读操作；任何可能触发 GPU 推理的测试按钮必须明确标注。
- 服务配置快照用于恢复，但快照必须移除 api_key。

## 13. 可观测性

每个日志事件至少包含：`upscale_job_id`、`video_merge_id`、`segment_index`、`prompt_id`、`stage`、`duration_ms`、`error_code`。

建议指标：

- 等待云端时长、上传时长、单段排队/推理/下载时长；
- 每种方法的处理帧数/秒；
- OOM 降段次数、分段重试率、下载重试率；
- 最终帧数/时长偏差；
- 云端在线率和连续不可达时长。

日志不以 HTTP 200 作为任务成功依据；必须解析业务状态和输出列表。

## 14. 备选方案及取舍

### 方案 A：LocalMiniDrama 直接调用原生 ComfyUI

改动少，但需要项目自己持有完整 prompt、上传/历史/下载协议，并绕过面板的工作流管理。原生入口当前也缺少可靠鉴权，不推荐。

### 方案 B：独立脚本作为外部命令

能快速跑通，但状态只存在进程和文件中，后端重启、云端离线数小时、前端查询和取消都难以正确处理。适合作为诊断工具，不适合作为产品主路径。

### 方案 C：面板 API 适配器 + 持久化后处理作业

初始开发量较大，但能复用平台工作流、支持长视频恢复、明确隔离视频生成和超分配置，并能处理机器离线。选用此方案。

## 15. 验收标准

1. 未开启超分的单集生成行为与现状一致。
2. 开启 FlashVSR 时，`1312×736` 基础合并视频最终得到 `2624×1472` 成片，字幕/水印在超分后添加。
3. 开启 SeedVR2 时走 M19，不能意外调用 M20 或 M18。
4. 两分钟测试视频被拆为多个分段；最终帧数、fps、时长和音频符合第 7.3 节。
5. 云端完全离线时，基础视频保留，作业进入等待；后端重启后仍能继续等待并恢复。
6. ComfyUI 停止但面板在线时，允许配置的情况下自动启动并继续。
7. HTTP 超时后不会产生不可控的重复 GPU 任务。
8. 下载失败只重下，不重新推理；字幕失败只重跑本地后处理。
9. 工作流节点发生变化时在提交前失败并给出 `WORKFLOW_SCHEMA_CHANGED`。
10. 源尺寸为 `1280×736` 或其他非 `1312×736` 尺寸时在本地阻止上传，并明确说明当前生产契约只支持 `1312×736`。
11. 所有核心状态机、模板变换、分段边界、恢复路径均有自动化测试；云端真实推理测试单独标记，默认测试套件不产生费用。

## 16. 实施顺序

实施应严格按以下顺序推进：先纯函数与数据库，再 HTTP 适配器，再持久化作业，随后接入合并流程，最后做前端和真实云端小样本验收。具体文件、测试和提交粒度见配套实施计划：`docs/superpowers/plans/2026-09-05-cloud-video-upscale-postprocess.md`。

## 17. 实施偏差与最终约束

- 拼接、探测和校验集中实现于 `videoUpscaleMedia.js`，没有机械拆成 Stitcher/Validator 两个文件；职责和测试边界保持不变。
- 当前面板没有已确认可用的 prompt 取消/按 `client_id` 对账接口。因此取消一定会停止本地最终化，但已提交的远端 prompt 可能继续；generate 在收到 `prompt_id` 前断线仍是需要人工核对云端历史的残余风险。
- 当前按单个 Node 进程、单个 provider 队列串行化作业，并防止恢复扫描重入。若未来部署多个后端进程，需要再增加数据库租约或分布式锁。
- 成功作业的分段暂不自动删除，以恢复可靠性优先；清理规则见 `docs/operations/cloud-video-upscale-runbook.md`。
- 云端关机时只读复检曾返回 404；用户开机并明确授权后，M19/M20 短片和 M20 241 帧跨段真机验收均通过，详见调研记录第 10 节。
- 240 帧仍是当前生产默认值。后续性能调优先对 FlashVSR 试验 480 帧（约 20 秒），连续稳定后再试 720 帧（约 30 秒）；SeedVR2 保持 240 帧并单独验收 480 帧。任何默认值调整都必须同时验证显存、温度、OOM 回退、失败重算成本和完整多段输出，具体记录见调研记录第 10.1 节及运维手册第 5.1 节。
