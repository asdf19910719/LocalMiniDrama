# 云端视频超分运维手册

日期：2026-09-05
适用范围：LocalMiniDrama 单集成片的 FlashVSR / SeedVR2 云端 2× 超分

## 1. 当前生产路径

```text
H3 镜头生成（当前项目配置为 1312×736）
  → 选定镜头并合并基础视频
  → 云端分段超分（Flash M20 或 Seed M19）
  → 本地按帧去除重叠并拼接、恢复源音频
  → 字幕、水印、最终混音
  → 输出 2624×1472 成片
```

超分是独立后处理，不修改 H3/Sage 工作流。前端开关默认关闭；打开后默认使用 FlashVSR。只有开启该开关并执行单集合成时才可能产生云端 GPU 使用。

## 2. 配置

仓库默认配置位于 `backend-node/configs/config.yaml` 的 `video_upscale`：

```yaml
video_upscale:
  enabled: true
  provider: zealman
  base_url: https://uu1119133-7885b7b94296.bjb2.seetacloud.com:8443
  default_method: flash
  workflows:
    flash: M20-视频高清放大-FlashVSR-2倍-分段工作节点
    seed: M19-视频高清放大-SeedVR2-2倍-分段工作节点
  expected_source_width: 1312
  expected_source_height: 736
  scale: 2
  segment_frame_cap: 240
  overlap_frames: 4
  auto_start_comfy: true
  offline_wait_hours: 24
```

若数据库中存在已启用的 `service_type=video_upscale` 配置，它优先于 YAML。API 密钥不会写入任务快照或返回给前端。

尺寸不是靠工作流文件名约定，而是在每次提交前写入完整模板副本：M20 节点 192 固定 `value=2`；M19 节点 29 固定 `resolution=1472/max_resolution=2624`。2026-09-05 已把云端 ComfyUI 用户目录中的 M19 副本同步更新为 `1472/2624` 并回读通过。控制面板内置模板没有更新接口，执行“初始化 ComfyUI”可能再次把该用户副本覆盖成旧默认值，因此生产端的提交前强制覆盖不能删除。

禁用功能有两层：

1. 将单集页面的“2× 云端超分”开关关闭，只影响本次合成；
2. 将服务配置的 `enabled` 改为 `false`，禁止创建任何新超分作业。已有作业不会被删除。

## 3. 无费用健康检查

项目提供：

```text
GET /api/v1/video-upscale/capabilities
```

该接口只检查面板健康状态、ComfyUI 状态和 M19/M20 模板，不调用 `/api/workflow/generate`，不会提交推理。

2026-09-05 的检查记录分为两个时点：实例关机时 `/api/health`、`/api/comfy/status` 和原生 `/system_stats` 均返回 HTTP 404；用户开机后再次检查均恢复正常，当前设备识别为 RTX 5090 32 GiB，M19/M20 真机验收已通过。以后仍应以 capabilities 的实时结果为准，不要把某次在线状态当作长期保证。

## 4. 云端关机或不可达

作业会进入 `waiting_provider`：

- 基础合并视频保留；
- 已取得的 `prompt_id`、已下载的分段和进度保留；
- 按 1、5、15、30 分钟退避重试；
- 后端重启后从数据库恢复；
- 连续等待达到 24 小时后转为 `waiting_manual` 阶段并停止自动请求，但状态仍是 `waiting_provider`，前端继续显示“重试/跳过”。

设备恢复后的推荐操作：

1. 先调用 capabilities，确认 `provider_online=true`、`comfyui_running=true`，M19/M20 对应的 `available=true`；
2. 在进度卡点击“重试超分”；
3. 不要重新执行 H3 镜头生成，也不要重新创建同一集的合并任务。

项目只能调用面板的 ComfyUI 启动接口，不能替用户购买、启动或续费 SeetaCloud 实例。平台开机涉及费用，必须在平台侧明确操作。

## 5. 长视频行为

- 每段默认最多 240 帧，后续段包含 4 帧重叠；
- 分段在同一云端 provider 上串行提交，多个单集作业也串行占用该 provider，避免并发挤爆显存；
- OOM 时同一段先重试一次，再把未完成范围从 240 帧缩为 120 帧，必要时缩为 60 帧；
- 拼接按整数帧裁掉重叠，不使用浮点秒；
- 最终恢复基础视频音轨，并校验尺寸、fps、帧数、时长和音轨。

24 fps 的两分钟视频约 2880 帧，通常会拆为约 13 个带重叠的请求区间。实际耗时取决于云端显卡、排队、模型和网络，不能用单个 3 秒样本简单线性外推为承诺时间。

### 5.1 分段长度调优建议

当前生产默认值继续保持 **240 帧（24 fps 时约 10 秒）**。本次 RTX 5090 真机测试显示工作流存在明显的单次启动/卸载固定开销，因此加长单段通常能减少请求次数并提高两分钟视频的整体效率，但显存峰值、OOM 后重算成本和失败影响范围也会随之增大。

| 单段长度 | 两分钟视频预计请求数 | 本次样本推算总耗时 | 建议 |
| --- | ---: | ---: | --- |
| 240 帧（约 10 秒） | 约 13 次 | 约 52–60 分钟 | 当前默认，稳定性优先 |
| 480 帧（约 20 秒） | 约 6–7 次 | 约 39–46 分钟 | FlashVSR 下一步优先试验 |
| 720 帧（约 30 秒） | 约 4–5 次 | 约 35–43 分钟 | 仅在 480 帧连续稳定后试验 |

以上时间是根据本次单台 RTX 5090 样本和固定开销推算的容量区间，不是 SLA；实际结果必须以完整多段任务记录为准。

后续调优顺序：

1. FlashVSR 先以 480 帧跑完整多段样本，观察显存峰值、GPU 温度、OOM、段失败率和总耗时；
2. 480 帧连续稳定后，再把 720 帧作为可选对照，不直接跳到 720 帧作为默认；
3. SeedVR2 暂时保持 240 帧，必须单独完成 480 帧试验，不能直接套用 FlashVSR 的结论；
4. 若未来把 FlashVSR 默认值提高到 480 帧，应同步确认 OOM 回退链为 `480 → 240 → 120 → 60`；720 帧试验也应先补充明确的分级回退策略；
5. 重叠继续保持 4 帧，拼接与音频恢复逻辑不变。

因此，20 秒是当前最有性价比的下一档试验参数；30 秒可能更快，但收益已经缩小，且单段失败后的重算损失更大。

## 6. 管理 API

```text
GET  /api/v1/video-upscale/capabilities
GET  /api/v1/video-upscale/jobs/:id
POST /api/v1/video-upscale/jobs/:id/retry
POST /api/v1/video-upscale/jobs/:id/skip
POST /api/v1/video-upscale/jobs/:id/cancel
```

- `retry`：仅允许 `failed` 或 `waiting_provider`；复用已有 prompt 和下载检查点。
- `skip`：仅允许 `failed` 或 `waiting_provider`；用 1312×736 基础视频继续字幕/水印/混音。
- `cancel`：终止本地最终化，父合并任务标记失败，基础视频保留。若远端 prompt 已提交，当前面板协议没有已确认的 prompt 取消端点，远端计算可能继续到结束。

## 7. 常见错误码

| 错误码 | 含义 | 推荐处理 |
|---|---|---|
| `PROVIDER_UNAVAILABLE` | 云端关机、端口未映射、网关 404/5xx 或连接失败 | 开机并用 capabilities 复检，然后重试 |
| `COMFYUI_NOT_RUNNING` | 面板在线但 ComfyUI 未运行，且未允许自动启动 | 启动 ComfyUI 或启用 `auto_start_comfy` |
| `COMFYUI_START_TIMEOUT` | 自动启动后 10 分钟仍未 ready | 查看云端启动日志，修复后重试 |
| `WORKFLOW_NOT_FOUND` | M19/M20 没有导入面板 API 库或名称变化 | 重新以 API 格式导入并保持配置中的名称一致 |
| `WORKFLOW_SCHEMA_CHANGED` | 工作流节点或输入字段变化 | 对照节点 192/195/204（Flash）或 25/27/29（Seed）修正工作流/适配器 |
| `UNSUPPORTED_SOURCE_DIMENSIONS` | 输入不是 1312×736 | 修正 H3 基础工作流；不要让适配器偷偷拉伸 |
| `REMOTE_OOM_MIN_SEGMENT` | 60 帧分段仍显存不足 | 使用更大显存实例或降低工作流显存需求 |
| `DOWNLOAD_FAILED` | 推理结果下载中断 | 直接重试；系统会查询原 prompt，不重新提交已完成段 |
| `SEGMENT_VALIDATION_FAILED` | 单段尺寸/帧数/fps 不符合预期 | 检查云端输出节点和工作流版本 |
| `FINAL_VALIDATION_FAILED` | 成片尺寸、帧率、帧数、时长或音轨错误 | 保留现场文件，检查 ffprobe 和拼接日志 |
| `UPSCALE_OUTPUT_MISSING` | 完成状态缺少本地输出路径 | 不继续字幕阶段，检查下载/数据库记录 |

## 8. 如何确认没有重复计费

1. 查询 job 的 `segments[].prompt_id`；同一分段恢复时 prompt 应保持不变。
2. 下载失败后，`prompt_id` 不应变化，且适配器只再次调用结果查询/下载。
3. 每个分段的 `client_id` 固定为 `<job-id>:<segment-index>`，输出前缀也包含 job 和分段编号。
4. 工作流 schema 校验发生在 generate 之前，节点不匹配不会提交 GPU 任务。
5. 注意一个无法被本地完全消除的边界：若 generate 请求已被平台接受，但连接在返回 `prompt_id` 前断开，平台又不提供按 `client_id` 对账/幂等查询，则人工重试可能重复提交。遇到 `REMOTE_SUBMISSION_UNKNOWN` 时应先在云端队列/历史中按 `client_id` 或输出前缀核对，不要盲目多次点击重试。

## 9. 文件保留与清理

- 基础视频记录在 `video_merges.base_merged_url`，不会因超分失败、取消或后处理而删除。
- 分段位于最终输出文件旁的 `.upscale-<job-id>/segments/`。
- 最终超分文件名包含 `_flash_2x` 或 `_seed_2x`。
- 当前实现优先保证恢复能力，不自动清理成功作业的分段。确认最终成片已备份且该作业不再需要恢复后，才可人工清理对应的精确 `.upscale-<job-id>` 目录；不要批量删除 storage 根目录。

## 10. 验收边界

本地自动化测试覆盖配置、模板修改、长视频分段、OOM 降段、云端停机等待、ComfyUI 自动启动、重启恢复、下载重试、并发串行、取消/跳过、拼接参数、API 和前端交互。用户明确授权后，真实 M19/M20 短片和 M20 的 241 帧跨段验收均已通过；具体耗时、job/prompt ID 和媒体结果见调研记录第 10 节。尚未直接跑完整两分钟正片，避免在边界已经验证后继续产生不必要费用。

## 11. 本地 ComfyUI 使用边界

- 云端 M19/M20 原版依赖本机未安装的旧版自定义节点和 FP16 Seed 模型，不能直接复制后运行。
- 本机工作流库已有 `10-视频超分-FlashVSR-2倍.json` 和 `11-视频超分-SeedVR2-2倍.json`，节点与 INT8 模型完整。
- 本地 10 使用低显存 streaming，适合优先尝试长片；本地 11 虽含 temporal chunk，但当前 `split_latent=false`，长片使用前需开启并做小样本显存验证。
- LocalMiniDrama 当前适配器只实现 Zealman 面板协议，不会自动调用 `http://127.0.0.1:8188`。要把本地 10/11 纳入项目自动后处理，需要另加 `local_comfyui` 适配器；手工在 ComfyUI 中运行不受此限制。
