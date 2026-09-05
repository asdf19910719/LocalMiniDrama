# 版本历史 / Changelog

**导航：[项目主页](../README.md) | [English](en.md)**

> 版本历史已统一维护于项目根目录，请查阅 → **[CHANGELOG.md](../CHANGELOG.md)**

---

[← 返回项目主页](../README.md)
# 2026-09-05

- 新增 MiniMax H3 Director R2V 的原版 TE-Speed 3.3 + Sage 独立工作流，保留官方 Sage 为默认回滚路径。
- H3 官方 + Sage 工作流统一为 20 步、`simple`、`res_multistep`、video shift 12、audio shift 3。
- 增加 TE-Speed 运行时探针、不可变来源/二进制哈希快照、近似加速能力提示和 A/B 对照工具。
- 实测发现并修复 TE 补丁模型跨任务缓存导致的 CPU/CUDA 状态污染；只对 TE 节点禁用结果复用。
- RTX 5070 Ti 上 1280×736/5 秒的三组 A/B 端到端缩短 37.5%–39.2%，五连跑和 10 秒任务通过。
