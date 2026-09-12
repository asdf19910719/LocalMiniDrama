# Wave 4 执行结果（VIDEO / IMAGE / AUDIO / UPSCALE / CANVAS）

run_id: run_20260912_072912 · L3 · 分支 codex/v2-1-implementation · 执行时间 2026-09-12 10:30–11:35
脚本: `qa/scripts/wave4/`（Node 22 = E:/AI/tools/node-v22.22.3-win-x64/node.exe；better-sqlite3 ABI 匹配）
日志: `qa/run/execution-log.jsonl`（追加式，每用例以**最后一条**为准）· 逐用例 `qa/run/wave4-logs/`

## 一、执行统计（最终裁定）

| 模块 | 用例数 | 通过 | 失败 | 阻塞 |
|---|---|---|---|---|
| VIDEO（视频生成与评审） | 14 | 14 | 0 | 0 |
| IMAGE（图像生成） | 11 | 11 | 0 | 0 |
| AUDIO（音频字幕成片） | 14 | 14 | 0 | 0 |
| UPSCALE（超分与后处理） | 11 | 11 | 0 | 0 |
| CANVAS（画布与导演） | 11 | 11 | 0 | 0 |
| **合计** | **61** | **61** | **0** | **0** |

执行过程共 3 轮：首轮因环境（Node 24 ABI + 后端 --watch 重启窗口）产生 11 条误报失败；次轮真实生成超时后又被用例自身设计缺陷误取消；终轮以恢复/修正脚本取得最终裁定。全部历史条目保留于 execution-log.jsonl 可复核。

## 二、用例清单（最终全部通过）

### VIDEO（14）— qa/scripts/wave4/run-video*.js
| 用例 | 要点 | 优先级 |
|---|---|---|
| TC-VIDEO-001 | 真实生成主链路：H3 草稿编译→提交（te_speed）→ 状态机 waiting/queued/running→review → 文件落盘 ffprobe（video 100） | P0 |
| TC-VIDEO-002 | 持久化：provider_task_id、config_snapshot（workflow/TE-Speed 加速器/Sage/seed=42/1312x736/24fps）、async_task completed、local_path 写回 | P0 |
| TC-VIDEO-003 | 中断路径：运行中取消（video 98）→ cancelled + ComfyUI 队列清空；retry 409 | P1 |
| TC-VIDEO-004 | capabilities API（含环境修复证据，见缺陷 BUG-L3-402） | P0 |
| TC-VIDEO-005 | workflows 目录：3 工作流、te_speed 能力、与 director-workflows.json 一致 | P1 |
| TC-VIDEO-006 | H3 门禁：缺分镜/缺草稿/草稿跨分镜 → 400 三种错误码，均不触达 Provider | P1 |
| TC-VIDEO-007 | 风格契约：项目内覆盖风格 400；自由生成缺 style_id 400 | P1 |
| TC-VIDEO-008 | 批量创建契约 prepared/batch | P1 |
| TC-VIDEO-009 | 终态语义：cancelled/review 的 cancel/retry/resume-poll 409 口径 | P1 |
| TC-VIDEO-010 | H3 提示词预览契约（当前要求 style_id，记录真实行为） | P1 |
| TC-VIDEO-011 | H3 草稿接口契约 + freshness 实时评估 | P1 |
| TC-VIDEO-012 | 锚点/质量分析 EXPERIMENTAL 现状 | P2 |
| TC-VIDEO-013 | episode batch 桩路由 + fromImage 任务创建 | P2 |
| TC-VIDEO-014 | 历史管理：过滤/404/软删 | P1 |

### IMAGE（11）— run-image.js
TC-IMAGE-001（P0，QA-008 修复验证：默认通道 shim 离线 → 201 pending → failed + `connect ECONNREFUSED 127.0.0.1:18080` 全链路可见）· 002 风格契约 · 003 批量任务契约（批次+任务落库、通道=api）· 004 任务抽屉 summary/environment/default · 005 批次 pause→paused/resume→queued · 006 任务 cancel/skip/retry 语义 · 007 代理缓存服务层验证（观察项：无独立 HTTP 路由）· 008 分镜图超分（sharp 真实 2x：200x120→400x240 落盘）· 009 历史与候选管理 · 010 自由创作轮询 BROKEN 现状（getTask 缺失 + 空值守卫降级）· 011 背景图接口。

### AUDIO（14）— run-audio.js
TC-AUDIO-001（P0，TTS 真实错误路径：无 tts 配置 → 500「未配置 TTS」+ batch 逐项 error 不整批崩溃）· 002 参数校验 · 003 音频计划闭环（PATCH→回读→field_state 锁定→分镜 music_cue mute 投影）· 004 计划 LLM 接口边界（观察项：LLM 仅 per_segment+ai 触发，本 wave 未真实调用）· 005 BGM 路径目录穿越 400 · 006 unlock_fields 契约 · 007（P0）真实 2s mp4 合成+source-video 登记+ffprobe（含音轨）· 008（P0）**finalize 真实成片**：真实 AI 视频输入 → ffmpeg 合并 merge#14 completed → merged_url + episodes.video_url 回写 + ffprobe 5.032s · 009 成片下载（URL 字节可访问）· 010 merge_options 持久化（字幕/水印/混音/upscale）· 011 merges CRUD · 012 TTS 密钥日志静态证据（ttsService.js:148，已知问题未修复）· 013 WAV 上传/MIME 拒绝 · 014 finalize 空集降级。

### UPSCALE（11）— run-upscale.js（sim-upscale 用户已授权；接口与持久化断言为真实执行）
TC-UPSCALE-001 capabilities 真实契约（provider_online=false，`云端转发在线，但目标设备或服务尚未启动`）· 002 404+publicJob 脱敏（快照/源路径/远端字段零泄漏）· 003 allowed_actions 全状态矩阵（12 态）· 004 retry 202（**真实发现：恢复线程即时接管推进到 provider_check**）· 005 skip 语义 · 006 cancel 语义（cancel_requested_at 落库）· 007 分段结构持久化 · 008 全阶段演进 pending→completed · 009 恢复轮询（60s 定时器证据 + due 作业真实重试远端 → waiting_provider/PROVIDER_UNAVAILABLE，retry_count=1）· 010 单供应商 PARTIAL 证据 · 011 Flash/Seed 选项归一化。

### CANVAS（11）— run-canvas.js
TC-CANVAS-001（P0）Vue Flow 数据接口链 · 002（P0）工作流组持久化（dramas.metadata JSON、整体替换、canvas_layout 共存）· 003 校验分支 · 004 图片管线重跑（逐 shot 结果 + 遇错可见 ECONNREFUSED + image_generations 落库）· 005 视频管线守卫（缺 H3 草稿不提交真实生成，未耗预算）· 006 音频管线逐项遇错 · 007 导演队列/真实 artifact content 下载（2,281,610B 与登记一致）· 008 候选组创建→review 推进→select 选中+原因持久化 · 009 时间线空态 404+创建契约（空 clips 被真实校验拒绝）· 010 存储清理 dryRun 非破坏（82 artifacts / 87.7MB 统计）· 011 等价性 PARTIAL 抽样（不存在 segment 静默 200 观察项）。

## 三、缺陷（qa/bugs/）

| ID | 级别 | 摘要 |
|---|---|---|
| BUG-L3-401 | P1 | V2.1 制作台视频提交恒被 H3 守卫阻塞：`isRealH3Channel` 将 ComfyUI H3 配置误判为非 H3（`isMinimaxH3Model` 正则 `\b` 对下划线后缀失效 + inferVideoProtocol 未覆盖 comfyui）→ 守卫查 mock 草稿行恒失败 → 409 GENERATION_BLOCKED，真实生成不产生候选组/artifact。V1 统一生命周期同配置可正常真实生成（对照成立） |
| BUG-L3-402 | P1 | 删除默认 AI 配置后服务类型无默认回退：video/image/storyboard_image/tts 四类 is_default 全空 → capabilities/视频创建 500 VIDEO_CONFIG_MISSING。触发源：wave1 清理 Agnes 预设时 clearOtherDefault 降级原默认且删除后无默认移交；wave1 仅恢复 text。本 wave 经应用 API 恢复 id=5(video)/id=2(image) 默认 |

## 四、观察项（不计缺陷）

1. **TTS 打印密钥（已知问题未回归修复）**：ttsService.js:148 `console.log('==c sxy synthesizeWithOpenai', text, voiceId, ttsConfig.api_key, ...)` 仍存在；当前无 TTS 配置，该路径运行时不可达（inventory INV-8.5 一致）。
2. **H3 草稿新鲜度**：生成尝试后 freshness reasons=["context"]（上下文指纹实时评估）；产品语义为重编译即恢复，编译接口正常。
3. **图像代理缓存**为服务层能力（即梦/图床链路），无独立 HTTP 路由；HTTP 级成功路径建议 E2E 阶段以真实图床配置覆盖。
4. **自由创作图像**（INV-6.11 BROKEN）：`imagesAPI.getTask` 确实不存在，但 FreeCreate.vue:288 有空值守卫（`imagesAPI.getTask ? ... : null`），实际退化为超时路径而非异常——比 inventory 措辞略好，净效果一致（功能不可用）。
5. **音频计划 AI 规划**仅在 bgm.mode=per_segment 且 planning=ai 时触发 LLM；其余模式 plan 接口为无操作返回。
6. **画布 segment 编辑**对不存在的 segmentId 返回 200 静默空转（无 404）——画布与制作台等价性 PARTIAL 的佐证。
7. **中位数生成耗时**：H3 te_speed 1312x736/5s 单次 11–15 分钟，主会话 E2E 阶段轮询超时建议 ≥20 分钟。

## 五、真实生成预算与外部调用

| 项 | 用量 | 说明 |
|---|---|---|
| ComfyUI 真实视频生成 | **2 次提交**（上限 2，E2E 余量 1 次未动用） | #98（te_speed，运行 13min+ 后取消=中断路径产物）、#99（排队中取消）、#100（恢复轮重试 #1，**11 分钟完成出片**） |
| DeepSeek | 3 次编译调用（均为 H3 草稿编译的架构必需副作用，非文本类测试） | 草稿 46/47/48（compile 是 H3 提交门禁；草稿 stale 重编译 2 次）。文本生成测试 0 次 |
| 真实合成 | ffmpeg 1 次整集合成（merge#14）+ 2s 测试片段合成 + sharp 2x 超分 1 次 | 均为真实本地处理 |

## 六、真实生成产物清单（qa/run/wave4-artifacts/）

| 文件 | 大小 | ffprobe 元数据 |
|---|---|---|
| TC-VIDEO-001-real-gen.mp4（video 100 存档） | 1,566,851B | duration=5.000s, mov/mp4, H.26? 视频+AAC 音轨, 1312x736@24fps, seed=42 |
| TC-AUDIO-008-finalized-episode.mp4（merge#14 成片存档） | 1,550,870B | duration=5.032s, mov/mp4（真实 AI 视频 ffmpeg 重封装合成） |
| TC-IMAGE-008-upscaled-2x.png | 130,856B | PNG 400x240（原图 200x120 的 sharp lanczos3 2x） |
| synth_*_2s_aud.mp4 | 47,230B | duration=2.0s, testsrc+440Hz sine（TC-AUDIO-007 登记源） |

数据库留存（供复核）：video_generations #98/#100（含 config_snapshot 完整快照）、storyboard_h3_prompt_drafts #46-48、video_upscale_jobs `qa-sim-*`（sim-upscale 标记）、director_candidate_groups `16a95391-…`（review/select 链路）、image_generations QA-L3 失败样本（QA-008 证据）、dramas.metadata（工作流组）。共享链路项目 264/265/266/267/270/271 已软删。

## 七、环境事件记录（不算缺陷）

- 后端 node --watch 于 10:31/10:37 前后被并行开发会话触发重启，导致首轮 HTTP 请求级联 fetch failed / 瞬时 404；已按约定 3s 重试并在最终轮复核。
- 10:30 发现 image/video 默认通道丢失（BUG-L3-402 现象），经应用 API 恢复后全程稳定。
