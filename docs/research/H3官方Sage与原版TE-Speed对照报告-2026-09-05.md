# H3 官方 Sage 与原版 TE-Speed 3.3 对照报告

日期：2026-09-05

设备：NVIDIA GeForce RTX 5070 Ti 16GB

运行时：ComfyUI 0.33.1、Python 3.13.14、PyTorch 2.13.0+cu130

## 结论

采用原作者 `tl2012tl/TE-Speed-MiniMaxH3` 3.3，而不是重写其推理算法。原始
`nodes.pyd` 保持不变，SHA-256 为
`84bb1ba6f82116c764acfada127c3553b238586a8272315337cea3bcb1d0ee9c`，仓库提交为
`beda0e4be76367625b5e82500b7c4867c3d8bbd6`。

TE-Speed 作为第二个独立工作流接入，官方 Sage 工作流仍是默认和回滚路径。TE 工作流在
1280×736、5 秒的三个样本中端到端缩短 37.5%–39.2%，五次不同 seed 连续完整推理成功，
10 秒双参考图任务成功，因此从 `configured` 提升为 `verified`。它属于近似加速，不能承诺与
官方输出逐像素一致。

## 为什么使用原作者版本

- 节点类型是原作者二进制实际注册的 `TESpeedMiniMaxH3`，不是仿写节点。
- 参数来自运行时 `/object_info/TESpeedMiniMaxH3` 的真实 schema：`0.08 / 0.1 / 0.9 / mcs=2 / auto / standard`。
- 原作者 README 将 3.3 描述为适配新版 ComfyUI H3/PDD 接口的版本，并建议 `device=auto`；本集成使用标准 20 步模式，不启用 4/8 步 LoRA 或 PDD。
- “TETAE”是作者在 README 中标注的 B 站身份；本仓库中可执行节点名称是 TE-Speed-MiniMaxH3，没有另一个可单独选择的 `TEE` 节点。

## 工作流差异

两组共同参数：20 steps、`simple` scheduler、`res_multistep` sampler、video shift 12、audio shift 3、Sage auto、compile false、相同 seed/提示词/参考图/尺寸/帧率/编码。

- 官方：`UNETLoader → PathchSageAttentionKJ → MiniMaxH3Director`
- TE：`UNETLoader → PathchSageAttentionKJ → TESpeedMiniMaxH3 → MiniMaxH3Director`

TE 节点参数不接受业务请求覆盖，避免用户请求绕过已验证配置。

## 实测结果

| 样本 | 尺寸/时长 | 官方 Sage | Sage + TE | 缩短 | 结果 |
|---|---:|---:|---:|---:|---|
| 冒烟 | 864×480 / 3s | 67.1s | 42.4s | 36.8% | 72 帧，音视频正常 |
| 静态对白 | 1280×736 / 5s | 309.6s | 188.2s | 39.2% | 120 帧，音视频正常 |
| 快动作 | 1280×736 / 5s | 309.2s | 189.6s | 38.7% | 120 帧，音视频正常 |
| 双参考图 | 1280×736 / 5s | 333.5s | 208.3s | 37.5% | 120 帧，音视频正常 |
| 全局无缓存复核 | 864×480 / 3s | 75.1s | 52.6s | 30.0% | 性能门槛通过 |

五连跑使用 seed 20260950–20260954 强制完整重算，耗时分别为 50.7、42.4、42.4、
44.2、44.4 秒，5/5 成功。10 秒任务为 1280×736、240 帧、24fps、双参考图和生成音频，
耗时 509.5 秒（约 8 分 29 秒）。

接触表人工检查：静态对白、快动作、双参考图和 10 秒镜头均保持人物身份、服装、背景和
动作连续性；未观察到 TE 特有的肢体断裂、显著拖影、参考图混淆或音频缺失。近似采样会改变
细节和运动轨迹，不能用逐像素一致作为质量标准。

## 温度、显存与硬件风险

- 5 秒高分辨率样本峰值温度为 81–82°C，TE 没有高于相同样本的官方峰值。
- 10 秒 TE 峰值 82°C、显存 15773MiB、功耗约 307W；未触发软/硬热降频。
- 五连跑峰值 72–74°C。各任务结束后温度和显存能正常回落。
- 当前结果不表示零硬件磨损，但没有异常过热、驱动重置、OOM 或热降频证据。批量长视频仍应保持散热、监控持续 80°C 以上状态，并采用 20–30 秒分段降低失败重试成本。

## 发现的跨任务缓存问题及修复

原始二进制会在补丁模型对象中保存本轮特征张量。默认 ComfyUI 节点缓存可能在 Director
结束后已把模型卸载到 CPU 的情况下，继续复用上一任务的 TE 补丁对象；下一次不同 seed 推理
会报 `Expected all tensors to be on the same device, cuda:0 and cpu`。

验证过两种修复：

1. 全局 `--cache-none`：五连跑 5/5 成功，但会影响所有 ComfyUI 工作流的节点缓存。
2. 最终方案：保持原始 `nodes.pyd` 不变，在插件 `__init__.py` 给 `TESpeedMiniMaxH3` 增加
   `IS_CHANGED = NaN` 缓存隔离标记，只强制该模型补丁节点每个任务重建。默认缓存模式下再次
   五连跑 5/5 成功，且后四轮为 42–44 秒。

最终注册入口 SHA-256：
`305a0afb643f6907fe2742069cca2cea0cc5dae78478c8ec82d761c98f0684aa`。

同一补丁安装到正式 8188 实例并通过管理接口重启后，使用 seed 20260960 和 20260961
连续执行两次 864×480/3 秒任务，2/2 成功、0 错误，确认正式实例已加载节点且跨任务缓存
隔离生效。

## 生产使用与回滚

- 官方默认工作流：`minimax_h3_director_r2v`
- TE 工作流：`minimax_h3_director_r2v_te_speed`
- ComfyUI 编号工作流：`12-官方-H3-R2V-Sage-TE-Speed实验.json`
- 项目只有在默认视频配置明确选择 TE 工作流时才使用它；现有任务的不可变快照不会被静默切换。
- 回滚只需把默认视频配置切回 `minimax_h3_director_r2v`。不要在单个失败任务内自动改算法重试。
- 如果插件二进制、注册入口、ComfyUI 或工作流哈希变化，应重新降级为 `configured` 并复测。

## 证据文件

完整遥测和媒体探测结果位于
`docs/research/_artifacts/h3-te-speed-original-2026-09-05/`。MP4 保存在隔离 ComfyUI 输出目录，
不纳入 Git；仓库只保存报告、接触表与去敏 JSON。
