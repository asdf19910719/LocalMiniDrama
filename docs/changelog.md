# 版本历史 / Changelog

**导航：[项目主页](../README.md) | [English](en.md)**

> 版本历史已统一维护于项目根目录，请查阅 → **[CHANGELOG.md](../CHANGELOG.md)**

---

[← 返回项目主页](../README.md)
# 2026-09-05

- 修复外部 AI JSON 包与“故事梗概→分镜”两条主流程中的视听字段丢失：统一持久化剧集音频策略、分镜环境声/音效/配乐 cue、转场、情绪强度、主镜头标记和引用语义。
- 全能提示词和 H3 编译统一消费完整 Generation Context；H3 严格执行 `none`、`episode_track`、`per_segment` 三种 BGM 策略、对白/旁白归属、参考音频标签和语义覆盖审核。
- 所有项目分镜视频入口统一先准备 H3 草稿，避免批量、画布和 Director 候选绕过门禁；自由创作页拒绝必须绑定项目分镜的 H3 工作流。
- 新增剧集音频策略面板和分镜音频编辑，支持每段视频生成 BGM；最终合成保留 H3/原视频音轨并与后期 TTS、整集 BGM 混音，不再以 TTS 覆盖原声。
- Director 与普通合并的转场同步处理视频 `xfade` 和音频 `acrossfade`，无音轨片段自动补等长静音。
- 合成器按剧集/逐镜对白与旁白 owner 决定是否加入 TTS；烧录选项不再导致 `h3_native` 双声，语音本地路径增加 storage 边界和真实路径检查。
- 故事分镜重新生成按稳定键复用原行并保护手工锁定叶子；H3 拒绝悬空参考标签并要求已提供参考同时出现在定义段与正文。
- 外部包补全人物 `appearance`、基础生图提示词、人物级 `negative_prompt` 与 `voice_profile` 映射，并扩大规范化回读防丢失校验。
- 新增 MiniMax H3 Director R2V 的原版 TE-Speed 3.3 + Sage 独立工作流；项目开关默认开启 TE-Speed，关闭后使用官方 Sage 回滚工作流。
- H3 官方 + Sage 工作流统一为 20 步、`simple`、`res_multistep`、video shift 12、audio shift 3。
- 增加 TE-Speed 运行时探针、不可变来源/二进制哈希快照、近似加速能力提示和 A/B 对照工具。
- 实测发现并修复 TE 补丁模型跨任务缓存导致的 CPU/CUDA 状态污染；只对 TE 节点禁用结果复用。
- RTX 5070 Ti 上 1280×736/5 秒的三组 A/B 端到端缩短 37.5%–39.2%，五连跑和 10 秒任务通过。
- `01-官方-H3-R2V.json` 加入默认开启的原作者 TE-Speed 节点，选中节点按 `Ctrl+B` 可旁路关闭；LocalMiniDrama 使用两个不可变工作流 ID 切换并隔离各自 H3 草稿。
- 新增 H3 测试提示词清晰动作策略：高快门逐帧清晰，禁止正向 motion blur，并加入 temporal smearing、ghosting、double edges、smeared face 负面词。
