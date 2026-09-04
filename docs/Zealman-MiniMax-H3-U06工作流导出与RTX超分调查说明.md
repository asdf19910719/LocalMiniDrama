# Zealman MiniMax H3 U06 工作流导出与 RTX 超分调查说明

## 1. 调查目的与范围

- 调查时间：2026-09-03 至 2026-09-04
- 用户控制页面：`https://uu1119133-7884866342c9.bjb1.seetacloud.com:8443/`
- JupyterLab 入口：`https://a1119133-7884866342c9.bjb1.seetacloud.com:8443/jupyter/lab?title=`
- 调查目标：确认 U06 MiniMax H3 视频生成的真实 ComfyUI 工作流、“超清2×”具体实现、实际运行参数及迁移条件。
- 调查方式：检查网页提供的 API 模板、ComfyUI 输出 PNG 的内嵌 prompt、镜像内完整画布 JSON、自定义节点目录、模型目录和 RTX 环境检测接口。

本文把结论分为：

- **可确认事实**：由真实运行 prompt、画布 JSON、输出尺寸或环境接口直接证明。
- **合理判断**：由文件大小、目录结构和工作流关系推断，并明确保留限制。

本次导出的原始证据位于：`exports/zealman-u06-20260903/`。

## 2. 调查过程

### 2.1 从控制页面取得 API 模板

控制页面公开加载：

```text
/U06-minimax_h3_lightX2v多图参考生视频V5.json
```

该文件是 ComfyUI API/prompt 格式，共 55 个模板节点。网页会在提交前动态替换图片、音频、提示词、种子、时长、LoRA 等输入，并根据“超清2×”状态处理 RTX 节点。

导出文件：

```text
exports/zealman-u06-20260903/U06-template-api.json
```

### 2.2 从输出 PNG 恢复两次真实执行图

ComfyUI 输出 PNG 的 `tEXt` 元数据中保存了本次实际执行的 `prompt`。从两个结果恢复出：

| 证据文件 | 实际节点数 | PNG 尺寸 | RTX 节点 |
| --- | ---: | ---: | --- |
| `comfyui_00026.png` | 31 | 2688×1536 | 有，2×、ULTRA |
| `comfyui_00027.png` | 30 | 1344×768 | 无 |

对应导出的实际 API 图：

```text
run-1-rtx-2x-on-api.json
run-2-rtx-2x-off-api.json
```

这一步证明网页显示的配置最终如何转化为 ComfyUI 生效节点，避免仅凭按钮文字或视频观感推测。

### 2.3 从 JupyterLab 取得完整画布

在镜像中定位并导出以下原始文件：

```text
/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/
  U06-minimax_h3_lightX2v多图参考生视频V5.json
  U06-minimax_h3_多图参考生视频V6.json

/root/ComfyUI/user/default/workflows/M高清放大去水印/
  M07-NVIDA-RTX高清放大.json
```

导出后的可导入画布：

| 文件 | 节点 | 连线 | 分组 |
| --- | ---: | ---: | ---: |
| `U06-V5-canvas.json` | 58 | 57 | 7 |
| `U06-V6-canvas.json` | 60 | 66 | 13 |
| `M07-NVIDA-RTX-canvas.json` | 6 | 2 | 0 |

这些是保留节点坐标、分组、备注和控件值的 ComfyUI 画布格式，可以直接拖入 ComfyUI；API JSON 则主要用于程序调用，不能完整还原作者的画布布局。

### 2.4 比较 V5、V6 与网页真实运行图

| 项目 | U06 V5 | U06 V6 | 网页真实运行 |
| --- | --- | --- | --- |
| 默认 LoRA | `fl2v_turbo_8step_v1.0` | `turbo_v4_step600` | `turbo_v4_step600` |
| 默认 CLIP | `nvfp4_awq` | `int8_convrot` | `nvfp4_awq` |
| `ref_image_size` | `max` | `match` | `max` |
| RTX 节点 | 画布中存在但旁路 | 画布中存在但旁路 | 网页按开关加入或移除 |

因此，网页运行图不是原封不动的 V5 或 V6，而是：

```text
V5 API 骨架 + 页面动态输入 + 用户选择的 V6 默认 LoRA + 可选 RTX 2× 分支
```

V6 新增的 `Fast Muter (rgthree)` 和 `Fast Groups Muter (rgthree)` 主要用于画布操作，不改变 H3 核心采样方法。

## 3. 实际生成链路与参数

核心数据流：

```text
参考图片、提示词、音频
  → MiniMaxH3ReferenceToVideo
  → H3SigmaRefiner
  → Euler + beta scheduler 采样
  → 视频 VAE / 音频 VAE 解码
  → RTXVideoSuperResolution 2×（可选）
  → H.264 MP4 合成
```

实际参数：

- 基础 UNET：`minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors`
- LoRA：`minimax/minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors`
- LoRA 强度：0.75
- 文本编码器：`qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`
- 视频 VAE：`minimax_h3_video_vae_fp16.safetensors`
- 音频 VAE：`minimax_h3_audio_vae_fp32.safetensors`
- 预览 VAE：`taeh3.safetensors`
- 原始生成尺寸：1344×768
- 采样器：Euler
- 调度器：beta
- 基础采样步数：8
- H3 Sigma 修整：额外 2 步，sigma 0.65→0，cosine
- 视频编码：H.264、yuv420p、CRF 16、24 fps
- 显存优化：`head_chunks=4`、前馈分块数 4、阈值 4096

`turbo_v4_step600...` 是挂接在基础 UNET 上的加速 LoRA，不是超分模型。它让 H3 使用较少采样步数完成生成；最终分辨率提升由后面的 RTX 节点完成。

## 4. 10 秒、约 35 MB 结果是否使用 RTX 超分

### 4.1 确认结论

如果所指的是本次保存的 `comfyui_00026-audio.mp4`，答案是：**确定使用了 RTX 2× 超分**。

证据链：

1. 时长输入为 10 秒。
2. 工作流使用表达式把它转换为满足 H3 帧数约束的 243 帧。
3. 243 ÷ 24 fps = 10.125 秒。
4. 原始生成尺寸为 1344×768。
5. 实际 prompt 包含节点 `668 / RTXVideoSuperResolution`。
6. 该节点参数为 `scale=2.0`、`quality=ULTRA`。
7. RTX 节点输入来自视频 VAE 解码后的帧。
8. 输出 PNG 尺寸为 2688×1536，正好是宽高各 2 倍。
9. 对照结果 `comfyui_00027` 没有节点 668，尺寸保持 1344×768。

第一次视频记录大小为 33,825,734 字节，约 33.83 MB（十进制）或 32.26 MiB。按约 10.125 秒计算，文件总码率约 26.7 Mbit/s。用户界面或文件管理器显示成约 35 MB 属于正常的单位和取整差异。

### 4.2 为什么文件这么大

35 MB 本身不能单独证明进行了 RTX 超分，因为视频大小还受到画面复杂度、编码器实现、音频和码率控制影响。本次文件偏大的主要原因是：

- 2× 后分辨率达到 2688×1536，像素数是原始 1344×768 的 4 倍；
- 使用 CRF 16，属于偏高质量、低压缩设置；
- AI 视频细节和运动较复杂，H.264 为保持质量会分配更多码率；
- 片段包含音频轨道。

本次能够确认 RTX 超分，依靠的是内嵌 prompt 和输出尺寸，而不是只看 35 MB 的体积。

## 5. “超清2×”的具体实现

真实执行节点为：

```json
{
  "class_type": "RTXVideoSuperResolution",
  "inputs": {
    "resize_type": "scale by multiplier",
    "resize_type.scale": 2,
    "quality": "ULTRA",
    "images": ["1307", 0]
  }
}
```

该节点使用 NVIDIA Video Super Resolution 深度学习模型重建边缘、纹理并减轻部分压缩瑕疵，不是 bicubic 等传统插值。NVIDIA VFX SDK 将 Ultra 定义为 VSR 模式 4。

镜像清单里的 `M07-NVIDA-RTX高清放大.json` 是同一节点的独立示例。U06 没有调用整套 M07，而是直接把 `RTXVideoSuperResolution` 放在视频 VAE 解码和 MP4 合成之间。

因此，本次 U06 的“超清2×”与以下工作流无关：

- M01 SUPIR
- M02/M03 SeedVR2
- M04/M05 SeedVR2.5 + FlashVSR
- M10 SeedVR2 + 补帧

## 6. RTX 超分的硬件要求

### 6.1 单独看 RTX VSR 节点

硬件门槛不算特别高，不需要 RTX 5090。NVIDIA 当前 RTX Video SDK 的通用要求是：

- GeForce RTX 20 系列或更新显卡，或者 Turing 架构 RTX 1000 及以上；
- 依赖 RTX Tensor Cores；
- Windows 支持 DX11、DX12、Vulkan、CUDA；
- Linux VFX SDK 当前要求驱动分支至少为 570.190+、580.82+ 或 590.44+。

官方 720p→1080p、1.5×参考延迟为：RTX 2060 约 13 ms/帧、RTX 3080 约 3.29 ms/帧、RTX 4090 约 1.36 ms/帧、RTX 5090 约 1.07 ms/帧。该表不能直接等同于本次 1344×768→2688×1536、2×、Ultra，但足以说明 VSR 本身在中高端 RTX 上通常不是整个工作流最重的环节。

源实例重启后检测到：

```text
GPU: NVIDIA GeForce RTX 4080 SUPER
Driver: 580.105.08
CUDA: 13.0
Compute Capability: 8.9
nvvfxInstalled: true
nodeInstalled: true
ngxAvailable: true
```

这台 4080 SUPER 已满足要求并实际完成了 2× Ultra 处理。

### 6.2 看完整 MiniMax H3 工作流

真正吃硬件的是 MiniMax H3 视频生成，不是最后的 RTX 超分。该流程还要加载 H3 UNET、32B 级 Qwen3-VL 文本编码器、视频/音频 VAE，并处理约 243 帧 latent。画布特意使用 INT8/量化模型、低显存注意力、前馈分块和显存清理节点，说明作者已经针对显存压力做了优化。

实践判断：

- 仅运行 RTX VSR：RTX 20 系列起即可尝试，中端及以上显卡更合适。
- 完整 U06 H3：16 GB 显存属于可运行但需要分块和清理的级别；24 GB 更从容；5090 的 32 GB 对速度和稳定性最好，但不是 RTX 超分节点本身的硬性要求。
- 1344×768→2× Ultra 比常见 720p→1080p 更重，显存占用还会受 ComfyUI 一次传入多少帧影响。
- 工作流 JSON 无法给出精确峰值显存；需要在目标显卡上实际记录 `nvidia-smi` 才能确定。

官方资料：

- [NVIDIA RTX Video SDK Getting Started](https://developer.nvidia.com/rtx-video-sdk/getting-started)
- [NVIDIA VFX SDK Video Super Resolution](https://docs.nvidia.com/maxine/vfx/latest/Filters/VideoSuperResolution.html)
- [NVIDIA VFX SDK Performance Reference](https://docs.nvidia.com/maxine/vfx/latest/WindowsVFXSDK/PerformanceReference.html)

## 7. 网页开关行为

网页把 RTX 2× 默认状态设置为开启；只有浏览器本地存储明确记录为 `off` 时才关闭。因此：

- 第一次没有主动点击开关，实际仍为开启，产生 2688×1536 结果；
- 后来点击一次“超清2×”，实际切换为关闭，产生 1344×768 结果。

判断开关状态时应查看按钮状态和真实 prompt，不应仅依据“我有没有点过”。

## 8. 迁移要求

### 8.1 自定义节点

至少需要：

- `Nvidia_RTX_Nodes_ComfyUI` / `comfyui_nvidia_rtx_nodes`
- `ComfyUI-KJNodes`
- `ComfyUI-VideoHelperSuite`
- `ComfyUI-YCNodes-MiniMax-H3`
- `ComfyUI-Easy-Use`
- `ComfyUI_Comfyroll_CustomNodes`
- `comfyui_memory_cleanup`
- `rgthree-comfy`
- 提供 `WJILatentPreset` 的节点包

### 8.2 模型位置

```text
ComfyUI/models/diffusion_models/minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors
ComfyUI/models/loras/minimax/minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors
ComfyUI/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
ComfyUI/models/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors
ComfyUI/models/vae/minimax_h3_video_vae_fp16.safetensors
ComfyUI/models/vae/minimax_h3_audio_vae_fp32.safetensors
ComfyUI/models/vae_approx/taeh3.safetensors
```

源镜像中这些模型入口显示为几十字节，强烈表明使用了软链接、挂载指针或平台共享模型盘。只复制这些小入口不能完成迁移，需要取得其指向的真实权重，或重新下载权重并保持相同相对路径。

### 8.3 推荐迁移步骤

1. 安装支持 MiniMax H3 的新版 ComfyUI。
2. 安装上述自定义节点。
3. 放置真实模型权重。
4. 导入 `U06-V6-canvas.json`。
5. 先禁用节点 668，以较短时长验证基础 H3 链路。
6. 安装 NVIDIA RTX 节点及其 NGX/VFX 依赖，确认环境检测通过。
7. 开启节点 668，验证输出宽高是否准确变为 2 倍。
8. 若要复刻控制网页，使用 `U06-template-api.json` 作为 API 骨架，并按页面选项修改输入和 RTX 分支。

## 9. 导出与校验结果

导出包：

```text
exports/zealman-u06-20260903.zip
```

ZIP SHA-256：

```text
483e925ae76478289a76aa4d9cbbf70303762d68937fe68b535b0c7bae357b92
```

已完成的校验：

- 8 个 JSON 全部可以解析；
- V5、V6 和 M07 的画布节点数量与导出时一致；
- RTX 开启记录包含且仅包含一个 `RTXVideoSuperResolution`；
- RTX 关闭记录不包含该节点；
- 两张 PNG 的尺寸和内嵌 prompt 相互吻合；
- ZIP 内 12 个文件均可完整解压；
- 导出文件未包含 Jupyter 访问凭据。

## 10. 本地复刻与实机生成验证（2026-09-04）

### 10.1 新建工作流

按照本地现有工作流的 `01`～`08` 编号顺序，新增：

```text
E:\AI\ComfyUI_windows_portable\ComfyUI\user\default\workflows\09-Zealman-U06-MiniMax-H3-R2V-RTX2倍_武侠BOSS战_10秒.json
```

同时保存可直接提交给 ComfyUI `/prompt` 的 API 版本：

```text
E:\AI\h3_director_test\api_09_zealman_u06_h3_rtx2x_wuxia_10s.json
```

迁移时保留了镜像 U06 的核心生成参数：

- MiniMax H3 R2V，基础分辨率 `1344×768`；
- 10 秒输入，经原表达式换算为 243 帧，24 fps；
- `minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors`，LoRA 强度 0.75；
- Euler + beta，基础 8 步，`H3SigmaRefiner` 额外 2 步；
- `RTXVideoSuperResolution`：`scale by multiplier`、2 倍、`ULTRA`；
- H.264 MP4、CRF 16、`yuv420p`，并合成 H3 生成的音轨；
- 保留 `MiniMaxLowVRAMAttention`、`MiniMaxChunkFeedForward`、`VRAMCleanup` 和 `RAMCleanup`，适配本机 16GB 显存。

镜像里的纯界面/便利节点没有强行照搬，而是改成等价的直接参数连线；这包括提示词预设、宽高预设、预览模型、模型切换器和随机种子界面节点。它们不参与最终算法结果，同时避免为了打开工作流而安装无关节点包。`taeh3` 只用于采样预览，也没有放进最终输出链路。

### 10.2 本地依赖与模型

新增并验证可加载的节点包：

```text
custom_nodes/Nvidia_RTX_Nodes_ComfyUI
custom_nodes/ComfyUI-VideoHelperSuite
custom_nodes/Comfyui-Memory_Cleanup
```

RTX 节点依赖使用嵌入式 Python 安装了 `nvidia-vfx 0.1.0.1`，`import nvvfx` 已通过。Turbo LoRA 已下载到：

```text
E:\AI\ComfyUI_windows_portable\ComfyUI\models\loras\minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors
```

LoRA SHA-256：

```text
7098acf3ee75028fd9fcd948f50fcc8d995057fabb76f86bd3ca2c0ffc58e409
```

### 10.3 测试输入

提示词取自用户指定素材目录中的实际文件（原消息路径多了一个“中”字）：

```text
E:\AI视频\测试工作流素材\测试素材\AI视频\CG项目_武侠\战斗场景提示词_新.txt
```

三张参考图使用本地输入目录中的英雄、反派和寺庙环境图。完整提示词已原样写入工作流，没有截断。

### 10.4 实机结果

ComfyUI API 验证和执行结果：

```text
prompt_id: 066f9d48-f29e-4f20-9192-f3593e9b6274
node_errors: {}
status: success
端到端耗时: 00:13:53
```

本机硬件为 RTX 5070 Ti 16GB。采样阶段 GPU 利用率持续为 100%，显存实测约 11.2～14.7GB，10 个采样步约 11 分 13 秒；整个任务没有发生 OOM。

最终视频：

```text
E:\AI\ComfyUI_windows_portable\ComfyUI\output\video\09_zealman_u06_h3_rtx2x_wuxia_10s_00001-audio.mp4
```

媒体验收数据：

- 文件大小：38,084,446 字节（约 36.32 MiB / 38.08 MB）；
- 时长：10.13 秒；
- 视频：H.264 High，`2688×1536`，24 fps，约 29.96 Mbps；
- 音频：AAC-LC，32kHz，双声道，128 kbps；
- 像素格式：`yuv420p`；
- 视频 SHA-256：`129c32a0edb7c05b6e0dc946b66194df498e4acca6eaf962c1d72f29862f443a`。

在 1 秒、5 秒、9 秒分别抽帧检查，均为有效画面：人物身份和左右关系清楚，血潮、剑气、雨夜寺庙及最终高位俯视破坏镜头均存在，没有黑帧或损坏。

### 10.5 RTX 2 倍超分的最终证据

这次本地测试可以确认 RTX 超分实际执行，而不只是工作流中存在一个未使用节点，证据链如下：

1. API 图中 `VAEDecode(1307)` 的输出进入 `RTXVideoSuperResolution(668)`；
2. 节点 668 设置为 2 倍和 `ULTRA`；
3. `RAMCleanup(1310)` 及最终 `VHS_VideoCombine(732)` 只接收节点 668 的输出，不存在绕过 RTX 节点的旁路；
4. ComfyUI 返回 `status: success`，因此整条依赖链完成；
5. 最终文件为 `2688×1536`，恰好是基础生成尺寸 `1344×768` 的横纵各 2 倍。

因此，原先约 35MB 的 10 秒镜像端结果之所以显得清晰，主要由“较高的基础生成分辨率 + RTX VSR 2× Ultra + CRF 16 高码率编码”共同造成；文件较大本身不是超分证据，但本次节点依赖和实际输出尺寸构成了直接证据。

工作流与 API 文件 SHA-256：

```text
画布工作流: 76c4295c06c7aea7ee95bf5512ed917b5bf2fdce43633ba52e450ebfc3aeb5d4
API 工作流: b157e70c264cdaaf6abb0706e82c4bf23634ec580919325ffd345f479e5492f2
```
