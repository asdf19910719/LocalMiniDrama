# H3 TE-Speed 集成设计

日期：2026-09-05  
状态：已确认，待实施  
范围：为现有 MiniMax H3 Director R2V 官方 + Sage 生成链路增加原作者 TE-Speed 3.3 可选加速变体

## 1. 背景与结论

LocalMiniDrama 当前使用 `minimax_h3_director_r2v` API 工作流，通过 `PathchSageAttentionKJ` 为 MiniMax H3 Ref2VA 提供 SageAttention 加速。工作流固定为 20 步、`simple` scheduler、`res_multistep` sampler，并由 workflow registry、适配器、运行时 hash 和不可变任务快照治理。

TE-Speed 通过在相邻去噪步骤复用 H3 DiT 尾部 block 的残差来减少实际 block 计算量。它是近似缓存加速，不是 CUDA 13、Text Encoder 或超分后处理。原作者 3.3 明确适配新版 ComfyUI H3、block prefetch、10 秒以上长视频、分块 CPU residual、4/8 步和 PDD LoRA。针对当前 Python 3.13、PyTorch 2.13+cu130、RTX 5070 Ti 16GB 环境，原作者版本作为第一候选；OSS 版本只在原作者二进制不兼容或无法稳定运行时作为备用。

集成采用独立工作流变体，不覆盖官方 + Sage 基线，不在同一任务中静默回退算法。

## 2. 目标

- 在隔离 ComfyUI 运行目录验证原作者 TE-Speed 3.3 的 `nodes.pyd` 能否被当前 Python 3.13 加载。
- 从 ComfyUI `/object_info` 获取 `TESpeedMiniMaxH3` 的真实输入 schema，禁止按 OSS 参数猜测原版接口。
- 新增 API 工作流 `minimax_h3_director_r2v_te_speed.json`，连接顺序为 `UNETLoader -> PathchSageAttentionKJ -> TESpeedMiniMaxH3 -> MiniMaxH3Director`。
- 新增稳定工作流 ID `minimax_h3_director_r2v_te_speed`，初始状态为 `configured`；完成真实 A/B 验收后才变为 `verified`。
- 保留当前 `minimax_h3_director_r2v` 的图结构、hash、默认选择和历史任务语义。
- 在任务快照、能力信息和错误中明确记录 TE-Speed 实现、版本、参数和近似加速属性。
- 以相同输入、Seed、分辨率、帧数和采样参数完成官方 + Sage 与官方 + Sage + TE-Speed 的真实本机 A/B。

## 3. 非目标

- 不把 `nodes.pyd` 提交到 LocalMiniDrama 仓库或随桌面应用分发。
- 不在本次集成中启用 PDD、Turbo LoRA、4/8 步、Spectrum 或 Sol-Attn。
- 不改变当前 20 步、`simple`、`res_multistep`、video shift 12、audio shift 3 的生产基线。
- 不把 TE-Speed 作为新视频 Provider，也不接入云端超分后处理链路。
- 不允许普通请求传入任意 TE-Speed 节点参数。
- 不在 TE-Speed 失败后以同一任务 ID 静默改跑官方基线。

## 4. 方案选择

### 4.1 采用方案：并行工作流变体

保留：

```text
minimax_h3_director_r2v
UNETLoader -> Sage -> Director
```

新增：

```text
minimax_h3_director_r2v_te_speed
UNETLoader -> Sage -> TE-Speed -> Director
```

两个变体共用 H3 Director R2V 输入、参考图桥接和输出生命周期，但拥有不同 workflow hash、能力声明和快照。这样可以独立禁用 TE-Speed、准确 A/B，并保证官方基线不依赖 TE-Speed 节点。

### 4.2 不采用：覆盖当前工作流

直接在现有图中插入 TE-Speed 会让官方基线依赖闭源节点，破坏历史 hash 和明确回退路径，因此不采用。

### 4.3 不采用：运行时动态注入节点

由后端临时改写 prompt 图虽然文件较少，但 registry hash 不再完整描述实际执行图，连接顺序与参数也难以在提交前治理，因此不采用。

## 5. 运行环境隔离

第一阶段在独立目录准备实验 ComfyUI，复用当前模型目录而不复制数十 GB 权重。实验运行时使用独立端口，且不与生产 ComfyUI 同时执行 H3 推理。

原作者仓库作为运行时外部依赖安装，只记录：

- Git 仓库 URL；
- 精确 commit ID；
- `nodes.pyd` SHA-256；
- `__init__.py` SHA-256；
- ComfyUI、Python、PyTorch、CUDA 与驱动版本；
- `/object_info/TESpeedMiniMaxH3` 返回的 schema 摘要。

如果 `nodes.pyd` 导入失败、缺少 `TESpeedMiniMaxH3`、导致 ComfyUI 启动异常或无法在当前 Director 内部采样链路工作，则原作者实现判定为不兼容。此时保持生产环境不变，转入 OSS 备用路径；不降级主 Python，也不替换当前生产依赖。

## 6. 工作流与适配器

UI 工作流名称为：

```text
12-官方-H3-R2V-Sage-TE-Speed实验.json
```

项目 API 工作流为：

```text
backend-node/configs/workflows/minimax_h3_director_r2v_te_speed.json
```

原作者节点真实参数必须从 `/object_info` 和一次由 ComfyUI 导出的 API prompt 获取。标准 20 步模式、`device=auto` 和其他字段使用节点实际接受的枚举值；不假定原作者与 OSS 的字段完全一致。

`h3_director_r2v` 适配器升级为 v2：

- 提取公共的 Ref2VA、Sage 与 Director 校验；
- 基线变体不得包含 `TESpeedMiniMaxH3`；
- TE 变体必须包含且只包含一个 `TESpeedMiniMaxH3`；
- 校验图连接为 `UNETLoader -> Sage -> TE-Speed -> Director`；
- 若图中存在 Spectrum 节点则拒绝注册；
- 输出能力包含 `supportsTESpeed` 与 `approximateAcceleration`；
- 业务输入仍只修改 prompt、参考图、尺寸、时长、帧率和 seed，不暴露底层 TE 参数。

## 7. Registry 与任务快照

新增 registry 条目：

```json
{
  "id": "minimax_h3_director_r2v_te_speed",
  "status": "configured",
  "family": "h3_director",
  "adapter": "h3_director_r2v",
  "adapterVersion": "v2",
  "variant": "official_sage_te_speed_original_3_3",
  "workflowFormat": "api",
  "requiredNodes": [
    "UNETLoader",
    "CLIPLoader",
    "VAELoader",
    "MiniMaxH3Director",
    "CreateVideo",
    "SaveVideo",
    "PathchSageAttentionKJ",
    "TESpeedMiniMaxH3"
  ],
  "capabilities": {
    "modes": ["single_reference"],
    "maxReferenceImages": 9,
    "supportsContinuity": false,
    "supportsAudio": true,
    "supportsSage": true,
    "supportsTESpeed": true,
    "approximateAcceleration": true
  }
}
```

任务快照增加：

```json
{
  "acceleration": {
    "kind": "te_speed",
    "implementation": "tl2012tl/TE-Speed-MiniMaxH3",
    "version": "3.3",
    "commit": "安装阶段解析并写入的 40 位 Git commit",
    "binarySha256": "安装阶段计算并写入的 sha256 值",
    "mode": "从 object_info 确认的标准 20 步模式枚举值",
    "device": "auto",
    "approximate": true
  }
}
```

Registry 中的运行时锁使用安装阶段读取的确定值；上述中文内容只描述字段契约，不作为可提交的配置值。

## 8. 状态、错误与回退

- 节点或模型缺失：`testConnection` 失败，TE 变体不可提交，基线仍可用。
- workflow hash 不一致：fail-closed，拒绝提交。
- 二进制不兼容：实验环境停止，生产环境不变，转 OSS 备用评估。
- TE 推理 OOM：当前任务失败并记录 `TE_SPEED_OOM`；用户或调用方可创建新任务选择官方基线。
- TE 运行异常：当前任务失败并记录 `TE_SPEED_RUNTIME_FAILED`，不在同一任务中切换工作流。
- ComfyUI 更新：运行时锁不匹配时 TE 状态降为不可用，重新验证后才恢复。
- Spectrum 同时存在：registry/适配器校验失败。
- 输出媒体异常：按现有 ffprobe 规则失败，不进入 review。
- 服务重启：使用快照中的 workflow ID、hash 和 acceleration 恢复原任务。

## 9. A/B 验收

基线与 TE 变体使用相同：

- 参考图与提示词；
- Seed；
- 1280x736、24 FPS、约 5 秒；
- 20 步、`simple`、`res_multistep`；
- video shift 12、audio shift 3；
- Sage auto、compile false；
- 相同输出编码设置。

样本至少包含静态对白、快速动作和多参考图三个类别。记录端到端耗时、采样耗时、峰值显存、温度、输出帧数/FPS/时长、音频时长、TE FULL/CACHE 统计及视觉对照。

TE 变体提升为 `verified` 的门槛：

- 端到端耗时相对基线至少下降 25%；
- 连续 5 次短视频运行无 OOM、崩溃或任务残留；
- 输出分辨率、FPS、帧数、视频时长和音频流正确；
- 无明显人脸/服装漂移、动作断裂、背景闪烁、嘴型或音画同步退化；
- 一次 10 秒真实分镜运行成功。

通过验收后仍保持官方 + Sage 为默认；TE-Speed 作为显式可选变体运行 20 至 30 个真实镜头后，再单独决定是否调整默认值。

## 10. 测试范围

- Registry：两个变体可并存，TE 变体缺节点、错连接、含 Spectrum、hash 错误时拒绝。
- Adapter：两种图均能绑定相同 R2V 业务输入；TE 参数不会被请求覆盖。
- Provider：连接测试检查 `TESpeedMiniMaxH3`，任务快照保留 acceleration，恢复不切换 workflow。
- API：未开启实验许可时拒绝 configured 工作流；验证后允许正常选择。
- ComfyUI 主机：启动、`object_info`、最小真实推理、正式 A/B、连续运行和 10 秒验收。
- 回归：现有官方 + Sage registry、adapter、provider、视频生成与前端测试全部通过。
