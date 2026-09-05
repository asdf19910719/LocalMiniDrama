# 云端视频超分 API 接入调研与过程记录

日期：2026-09-05

## 1. 调研目标

本次调研回答三个问题：

1. Zealman/SeetaCloud 控制面板中的 M18、M19、M20 是否能被程序直接调用；
2. 默认参数分别适用于什么视频，长视频应如何处理；
3. LocalMiniDrama 现有架构能否直接接入，以及最合适的后处理位置。

本次只执行只读接口、配置同步和本地测试，没有提交任何 GPU 推理任务。

## 2. 已检查的云端入口

- 控制面板：`https://uu1119133-7885b7b94296.bjb2.seetacloud.com:8443`
- 原生 ComfyUI：`https://u1119133-7885b7b94296.bjb2.seetacloud.com:8443`

检查结果：

- `GET /api/health`：控制面板在线；
- `GET /api/comfy/status`：ComfyUI `running=true`、`reason=ready`；
- `GET /api/workflow/list`：M20、M19、M18 位于列表前三项；
- `GET /api/userdata?dir=workflows&recurse=true&split=false`：ComfyUI 工作流库可见 M18、M19、M20；
- `POST /api/workflows/initialize-comfyui`：已完成 42 个工作流同步，错误数为 0；
- `/object_info`：SeedVR2、FlashVSR、VideoHelperSuite、清理节点的 class type 均存在。

## 3. 云端工作流及默认参数

### M18：SeedVR2 短视频

`M18-视频高清放大-SeedVR2-2倍-短视频`

- 必填：`25:video`，默认值为空；
- 可选：`27:filename_prefix`，默认 `SeedVR2_2x_2560x1472`；
- 当时用于验收的固定样本为 `1280×736 → 2560×1472`；当前生产尺寸见第 12 节；
- 工作流自身保留音频；
- 适合一次完成的短视频。

### M19：SeedVR2 长视频分段节点

`M19-视频高清放大-SeedVR2-2倍-分段工作节点`

- 必填：`25:video`；
- 默认 `25:frame_load_cap=240`；
- 默认 `25:skip_first_frames=0`；
- 默认输出前缀 `SeedVR2_2x_segment`；
- 分段输出不带音频，最终拼接时恢复源音频。

### M20：FlashVSR 长视频分段节点

`M20-视频高清放大-FlashVSR-2倍-分段工作节点`

- 必填：`195:video`；
- 默认 `195:frame_load_cap=240`；
- 默认 `195:skip_first_frames=0`；
- 默认输出前缀 `FlashVSR_2x_segment`；
- FlashVSR-v1.1、tiny、bf16、sparse_sage_attention、scale=2；
- 分段输出不带音频，最终拼接时恢复源音频。

默认参数的适用边界：小于或等于 240 帧的视频可直接使用默认读取范围。超过 240 帧时，若只调用一次，只会处理第一段。24 fps 的两分钟视频共有 2880 帧，按 240 帧上限、4 帧外部重叠规划为 13 段。

## 4. API 协议核验与修正

最初按常见 API 封装假设为：

```json
{
  "workflow_id": "M19-...",
  "input_values": {}
}
```

用不存在的工作流 ID 做零推理协议探针后，面板返回：

```json
{"success":false,"error":"workflow_template is required"}
```

随后检查控制面板前端的真实调用实现，确认正确协议为：

1. `GET /api/workflow/config/{url_encoded_workflow_id}`；
2. 读取响应中的 `workflow_template`；
3. 删除模板顶层 `_api_config`；
4. 严格按节点 ID 修改已暴露参数；
5. `POST /api/workflow/generate`：

```json
{
  "source": "quick",
  "workflow_template": {},
  "client_id": "long-upscale-<uuid>"
}
```

6. 取得 `prompt_id` 后轮询 `GET /api/workflow/result?prompt_id=...`；
7. 从 `results[]` 选择 `type=video` 的 URL 下载。

`E:\AI\long_video_upscale.py` 已按上述协议修正，并增加回归测试。总计 18 项本地测试通过，包括模板替换协议、分段边界、24/1 和分数帧率、重叠帧裁剪、最终帧数、2× 分辨率与音频恢复。

## 5. LocalMiniDrama 实施前现状检查

### 已具备的能力

LocalMiniDrama 已有成熟的异步视频 Provider 架构：

- `src/director/comfyuiClient.js`
  - `POST /prompt` 提交原生 ComfyUI API prompt；
  - `GET /history/{prompt_id}` 查询状态；
  - `GET /view` 下载结果；
  - `/queue` 和 `/interrupt` 取消；
  - 下载后使用 ffprobe 验证媒体。
- `src/services/videoProviders/comfyuiVideoProvider.js`
  - Provider 提交、查询、取消、恢复；
  - GPU 互斥；
  - 运行时快照；
  - 节点、模型、显存的无推理连接检查。
- `src/services/unifiedVideoGenerationService.js`
  - 统一任务状态机；
  - 持久化 provider task ID；
  - 后端重启恢复；
  - 瞬时 ComfyUI/OOM 重试。
- `src/services/videoMergeService.js`
  - 将选定分镜视频合并为单集；
  - 合并后调用 `mergedEpisodePostProcess` 处理音轨、字幕和水印。

### 当前不能直接使用云端超分的原因

1. 当前 ComfyUI client 使用原生 `/prompt` 协议，控制面板使用 `/api/workflow/config`、`/api/workflow/generate`、`/api/workflow/result`，协议不同；
2. 现有上传函数只处理参考图片，没有视频流式上传接口；
3. 现有 Provider 面向“生成分镜视频”，没有“对既有视频做后处理”的任务模型；
4. `videoMergeService` 目前在合并后直接进行字幕/水印/音频后处理，尚无超分步骤；
5. 当前数据库默认视频配置仍是本机 `http://127.0.0.1:8188`，设置为 `1312×736`；当时方案错误地把本地超分契约写成了 `1280×736`，这一点已在第 12 节修正。

因此项目在实施前“支持通用 API 调用”，但尚不支持把 M19/M20 作为成片超分步骤直接启用。

## 6. 方案比较

### 方案 A：每个分镜生成完成后立即超分

优点：单段短，失败定位容易；合成阶段直接处理 2K 素材。

缺点：未被最终采用的候选也可能产生费用；上传和调用次数多；本地预览与编辑均承受 2K 存储和解码压力。

### 方案 B：单集合并并完成字幕/水印后再超分

优点：只处理最终作品，费用最低。

缺点：AI 超分可能改变字幕和水印边缘；两分钟视频需要拆分再拼接；失败发生在最后阶段。

### 方案 C：单集合并后、字幕/水印前超分（推荐）

流程为：选定分镜 → 合并基础视频 → 云端超分 → 本地恢复/替换音频 → 在 2K 视频上烧录字幕和水印 → 完成单集。

选择理由：

- 只处理最终采用的画面，控制成本；
- 字幕、水印在超分后生成，不会被模型重绘；
- 与现有 `videoMergeService → mergedEpisodePostProcess` 边界吻合；
- 源视频和已完成分段均可保留，云端不可用时可恢复；
- FlashVSR 可作为默认性价比模式，SeedVR2 作为高质量选项。

## 7. 推荐结论

在 `videoMergeService` 产出本地合并文件后、调用 `mergedEpisodePostProcess` 前插入一个独立的 `videoUpscaleJobService`。它不替换现有视频生成 Provider，也不把超分伪装成新的视频生成模型。

运行时默认规则：

- `upscale.enabled=false` 保持现有行为；
- 用户选择“导出 2K”时启用；
- 默认 `method=flash`；
- 用户选择“高质量 2K”时使用 `method=seed`；
- 当前生产输入为 `1312×736`，输出为 `2624×1472`；
- 云端设备关闭或不可达时进入持久化等待状态，不丢源视频、不静默输出低分辨率；
- 用户可明确选择“跳过超分并使用基础清晰度完成”，不能由系统悄悄降级；
- 后端重启后从数据库恢复未完成任务；
- 没有 SeetaCloud 实例管理 API 时，应用只能检测设备离线，不能自行开机。

详细设计见：`docs/superpowers/specs/2026-09-05-cloud-video-upscale-postprocess-design.md`。

## 8. 实施结果（2026-09-05）

推荐方案 C 已落地到 `codex/cloud-video-upscale` 分支：

- 新增 Zealman 面板 API 适配器，使用完整 `workflow_template` 协议；
- 新增 M20 FlashVSR / M19 SeedVR2 的 240 帧长视频分段与 4 帧重叠；
- 新增 SQLite 持久化 job/segment、重启恢复、已有 prompt 续查和下载断点；
- 新增 OOM 的 240 → 120 → 60 帧降段策略；
- 新增本地逐帧去重拼接、2× 输出、源音频恢复和 ffprobe 校验；
- 普通合并和 Director timeline 均收敛到“基础合并 → 超分 → 字幕/水印/混音”；
- 新增前端开关、Flash/Seed 选择以及重试、跳过、取消操作；
- 云端离线时保留基础视频，自动退避 24 小时后停止轮询、转人工处理；
- 同一 provider 的多个单集作业串行运行，防止并发显存争用。

本地测试没有提交真实 GPU 推理。实现和测试细节见运维手册：`docs/operations/cloud-video-upscale-runbook.md`。

## 9. 实施完成时的首次云端只读复检

最终复检时，以下地址都返回 HTTP 404：

- 控制面板 `/`、`/api/health`、`/api/comfy/status`；
- 原生 ComfyUI `/system_stats`。

这与早先同一会话中“面板和 ComfyUI ready、工作流可读取”的结果不同。综合判断是当前 SeetaCloud 实例/端口转发已停止或链接已失效，而不是单个 API 路径写错。适配器已把 health/status/start 的网关 404 映射为可恢复的 `PROVIDER_UNAVAILABLE`，不会把父合并任务错误标记为永久失败。

在云端入口恢复之前，默认参数不能直接成功执行真实超分。恢复后应先调用 `GET /api/v1/video-upscale/capabilities` 做无费用检查；任何真实 M19/M20 调用仍需单独授权，因为会产生 GPU 使用。

## 10. 云端开机后的真实验收（2026-09-05）

用户明确通知云端已开机并授权测试后，重新检查得到：

- 控制面板 health：`ok`；
- ComfyUI：`running=true`、`reason=ready`；
- 原生 `/system_stats`：NVIDIA GeForce RTX 5090，约 32 GiB VRAM；
- M20/M19 模板均可读取，必要节点存在。

本次一共产生 4 个真实 GPU prompt：Flash 短片 1 个、Seed 短片 1 个、Flash 跨段样本 2 个。

| 验收项 | 工作流 | 输入 | 总耗时 | 输出结果 |
|---|---|---|---:|---|
| Flash 短片 | M20 | 48 帧，2 秒，24 fps | 135.7 秒 | 2560×1472、48 帧、2.000 秒、AAC 音频 |
| Seed 短片 | M19 | 48 帧，2 秒，24 fps | 146.2 秒 | 2560×1472、48 帧、2.000 秒、AAC 音频 |
| Flash 跨段 | M20 | 241 帧，10.041667 秒，24 fps | 365.2 秒 | 2560×1472、241 帧、10.041667 秒、AAC 音频 |

任务与 prompt：

- Flash 短片 job `08d18a7b-cc95-45c0-84ed-515c62163bcd`，prompt `b51680e4-ff38-4f64-9c70-f7ffe2800546`；
- Seed 短片 job `cf51ca8e-15b8-4587-8f88-03421b0489d0`，prompt `a0f31b6e-8121-4c20-bae6-aa6d43427b64`；
- Flash 跨段 job `399ddbdc-c312-4e2e-9038-aed1a1a1a6c1`，分段 prompt `7ee9235b-383a-44f1-b077-e54d00e5a41a`、`f470dc80-875a-4280-84ba-5afd25a32cdc`。

241 帧样本严格产生两个区间：`start=0/count=240/trim=0` 与 `start=236/count=5/trim=4`。拼接后对输出帧 232–240 做最近源帧像素匹配，依次映射到源帧 232–240，没有重复、跳帧或乱序。最终文件 SHA-256 为 `7A73F7850F774BC5DA8D61D8B64FF7081F342EA6A48CA369DDFDAB56B4718FB3`。

真实测试也暴露了固定工作流启动开销：5 帧尾段仍约需 110 秒。代码已改为正常多段任务只在开头清理一次旧模型，段间不主动卸载；但 M20 工作流自身启用了 `force_offload`，所以尾段仍有较高固定成本。按本次 RTX 5090 实测粗略估算，24 fps 的两分钟视频为 13 段，处理时间约 52–60 分钟；这是基于单次样本的容量估算，不是 SLA。

### 10.1 后续分段长度实验建议

两分钟视频拆为 5 秒、10 秒、20 秒或 30 秒小段时，纯逐帧推理量接近，但总耗时并不相同。每个远端 prompt 都会重复承担排队、模型准备、节点初始化、编码和下载等固定成本；本次 5 帧尾段仍耗时约 110 秒，说明固定开销不可忽略。因此，在显存允许且工作流稳定的前提下，20 秒或 30 秒分段会比大量 5 秒小段更高效。

按本次 RTX 5090 样本粗略外推：240 帧（约 10 秒）预计 13 次请求、52–60 分钟；480 帧（约 20 秒）预计 6–7 次请求、39–46 分钟；720 帧（约 30 秒）预计 4–5 次请求、35–43 分钟。30 秒相对 20 秒的额外收益有限，而显存峰值、OOM 风险以及失败后需要重算的帧数更高。

记录的推荐决策是：生产默认暂不从 240 帧直接上调；FlashVSR 后续先验证 480 帧完整多段任务，连续稳定后再试 720 帧；SeedVR2 继续保留 240 帧，并独立验证 480 帧，不能假设两种模型的显存曲线相同。若正式启用 480 帧，需要同步验证 `480 → 240 → 120 → 60` 的 OOM 回退链；720 帧只作为后续实验参数，并在实验前补齐对应的分级回退策略。

抽帧目检确认两种输出均形成有效放大图像。测试图中的微小时间码/数字会被模型重绘甚至误写，说明生产中仍应坚持“先超分、后烧字幕/水印”，不要把已有小字交给生成式超分。

## 11. 本机 ComfyUI 兼容性核验

本机环境为 ComfyUI 0.33.1、RTX 5070 Ti 16 GiB。结论分两层：

1. 云端原版 M19/M20 **不能原样在本机运行**。本机 `/object_info` 缺少 M19 的 `SeedVR2LoadVAEModel`、`SeedVR2LoadDiTModel`、`SeedVR2VideoUpscaler`，以及 M20 的 `FlashVSRInitPipe`、`FlashVSRNodeAdv`；M19 指定的 `ema_vae_fp16.safetensors` 和 `seedvr2_ema_3b_fp16.safetensors` 也不存在。
2. 本机已有可用的新版替代工作流：`10-视频超分-FlashVSR-2倍.json` 与 `11-视频超分-SeedVR2-2倍.json`。它们的所有活动节点都存在，Flash 所需 INT8/TCDecoder/LQ 模型和 SeedVR2 3B INT8/VAE 模型也齐全。

本地 10 使用 `FlashVSRStreamingSampler=streaming_faithful_lowvram`，具备面向长序列的低显存流式实现；本地 11 含 `SeedVR2TemporalChunk/TemporalMerge`，但保存值 `split_latent=false`，直接处理两分钟素材仍有显存风险。它们与云端 M19/M20 不是同一个 API 契约，也没有 LocalMiniDrama 当前这套逐段 prompt 持久化、断点恢复和去重拼接能力。

推荐做法是继续把 M19/M20 用作云端生产路径；若要本地离线处理，使用现有 10/11 并为其增加独立的本地 ComfyUI 适配器，Seed 长片开启 temporal chunk。不要直接把旧版 M19/M20 JSON 复制到本机并假定能运行。

## 12. 1312×736 尺寸复核与方案修正（2026-09-05）

后续通过控制面板配置接口和原生 ComfyUI `object_info` 再次核验，确认最初把生产契约写成 `1280×736 → 2560×1472` 的依据不成立：

- H3 官方 0.98 MP 预设是 `1344×768`；`1280×736` 属于约 0.9 MP，`1312×736` 是项目自定义但节点合法的尺寸。
- M20 的 `VHS_LoadVideo` 节点 195 使用 `custom_width=0/custom_height=0`，FlashVSR 节点通过节点 192 的倍率动态放大；它并不要求源文件必须是 1280×736。
- M19 的 `VHS_LoadVideo` 节点 25 同样沿用源尺寸；SeedVR2 节点 29 的 `resolution` 表示目标短边，`max_resolution` 表示任意边的上限。控制面板内置模板的 `resolution=1472/max_resolution=2560` 会限制 1312×736 的完整 2× 长边；本次已把 ComfyUI 用户目录中的 M19 副本持久化更新为 `1472/2624`，生产提交还会再次强制覆盖这两个值，以防初始化动作把用户副本恢复为旧默认值。
- 生产契约已修正为 `1312×736 → 2624×1472`。适配器在每次提交完整模板时把 M20 倍率写为 2，把 M19 写为 `resolution=1472/max_resolution=2624`，并继续在上传前用 ffprobe 严格校验输入。

第 10 节的 `1280×736 → 2560×1472` 数据是修正前已经发生的真实 GPU 验收记录，继续作为历史样本保留，不能用来代表当前生产尺寸。当前修改只做模板读取、代码测试和配置校验，没有再次提交付费 GPU 推理。
