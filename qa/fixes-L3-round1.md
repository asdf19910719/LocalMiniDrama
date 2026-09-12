# L3 缺陷修复记录（run_20260912_072912 后首轮修复）· 2026-09-12

| BUG | 级别 | 修复内容 | 关键文件 | 验证 |
|---|---|---|---|---|
| BUG-L3-401 | P1 | ① `isMinimaxH3Model` 正则 `\b`→`(?![a-z0-9])`（下划线后缀识别恢复，protocol→minimax_h3，quote h3:true）② v21/routes.js 编译侧、storyboardService 守卫侧、统一视频服务提交侧统一为同一带工作流注册表的 H3 服务实例（此前三处两个口径，编译快照与提交快照永不相等→H3_DRAFT_STALE 恒判）③ submitVideo 传入按镜头引用解析的本地参考图路径（含存储根前缀与 /static/ URL 还原），满足 H3 工作流 1-9 张参考图门禁 | videoConfigResolver.js / v21/routes.js / v21/storyboard/storyboardService.js | 真实 ComfyUI H3 任务 79abc2be 派发成功（queue running:1，video_generations#104 running）；UI Sheet 通道选择已生效 |
| BUG-L3-403 | P1 | V2.1 分镜图生成 Sheet 恢复通道选择：接入全局 imageGenerationStore（环境检查→openTask→扩展桥接发送→捕获回填 image_generations→V2 候选自动可见），目标类型 storyboard_main；chatgpt_web/api 双通道可持久化 | StoryboardStage.vue | UI 真实驱动：ChatGPT 网页收到完整拼装提示词+参考图并出图中（截图 e2e-artifacts/stageF-*） |
| BUG-L3-101 | P1 | 路由出口 api_key 掩码（'********'+has_api_key）；更新路径掩码值回写保护；前端导出剔除明文 key（仅 has_api_key）。v2.1 概览服务本就脱敏，不受影响 | aiConfigService.js / routes/aiConfig.js / AIConfigContent.vue | 既有配置测试 6/6 全绿 |
| BUG-L3-402 | P1 | deleteConfig 删除默认配置时按 priority→created_at 向同类型剩余活跃配置移交 is_default | aiConfigService.js | 单测通过；Wave1 环境破坏场景不再复现 |
| BUG-L3-202 | P1 | git lfs checkout 物化真实示例 ZIP（82MB，PK 头验证）；导入路由增加 LFS 指针检测（400+可操作文案），列表标记 available:false | example_drama/*.zip / routes/drama.js | 真实文件落位；防御逻辑就位 |
| BUG-L3-203 | P1 | buildDownload json 分支补传 db 实参 | v21/wizard/externalAiWizardService.js | 修复后 JSON 下载可用（语法/参数级修复） |
| BUG-L3-201 | P2 | getDrama/list 分镜聚合不再无条件覆盖显式 duration：聚合值>0 时才采用（转分钟），否则保留 DB 值 | dramaService.js | 批量导入 95s 场景读回一致 |
| BUG-L3-204 | P2 | V2.1 制作包导入 INSERT 补落 storyboards.source_key | v21/import/episodeImportV21.js | episodePackage 测试 131/131 |
| BUG-L3-205 | P2 | 错误 400 白名单补「请提供」；同步故事生成空梗概返回 400 | routes/index.js | 语义级验证 |
| BUG-L3-302 | P2 | 变体关联/剧集分镜创建的 9 类参数校验错误标记 status=400，路由按 400 分流（原 500） | storyboardVariantService.js / episodeStoryboardService.js / routes/storyboards.js | 校验类请求返回 400+明确文案 |
| BUG-L3-102 | P3 | 取消终态任务响应透传 already_done | routes/task.js | 幂等语义可判别 |
| BUG-L3-301 | P3 | 角色主图上传持久化 local_path（COALESCE 保留旧值），响应返回 local_path | characterLibraryService.js / routes/characters.js | 真实上传验证：DB local_path 落库 ✓ |

回归：后端 1157/1157、前端 371/371（修复后全量重跑）。
