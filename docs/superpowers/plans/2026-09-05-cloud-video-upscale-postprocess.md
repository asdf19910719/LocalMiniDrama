# 云端视频超分适配器与生成后处理实施计划

> 执行要求：按测试驱动开发逐项实施；每个任务先写失败测试，确认失败原因正确，再做最小实现并运行相关测试。真实云端 GPU 推理必须单独启用，默认测试不得产生费用。

**目标：** 为 LocalMiniDrama 增加可恢复的云端 FlashVSR/SeedVR2 两倍超分能力，并在单集基础合并完成后、字幕/水印/最终混音前执行。

**架构：** 新增平台 HTTP 适配器、纯分段规划/拼接模块、数据库持久化作业状态机；`videoMergeService` 只通过统一的最终化编排调用它。两种超分方法共享上传、分段、恢复和校验逻辑，差异仅来自工作流映射和模板字段。

**技术栈：** Node.js、Express、SQLite、Vue 3、FFmpeg/ffprobe、Node 内置测试框架及项目现有测试工具。

关联规格：`docs/superpowers/specs/2026-09-05-cloud-video-upscale-postprocess-design.md`

---

## Task 1：锁定现状并建立配置契约

**文件：**

- 修改：`backend-node/config.yaml`
- 修改：`backend-node/src/config/index.js`（以仓库实际配置入口为准）
- 新建：`backend-node/src/services/videoUpscale/videoUpscaleConfig.js`
- 新建测试：`backend-node/tests/services/videoUpscale/videoUpscaleConfig.test.js`
- 修改测试：现有配置加载测试文件

**步骤 1：写失败测试**

覆盖：

- 没有 `video_upscale` 配置时返回 `enabled=false`，不改变旧流程；
- `method=flash` 映射 M20，`method=seed` 映射 M19；
- 默认源尺寸是 `1312×736`、scale=2、frame cap=240、overlap=4；
- 未知 method、非正数 frame cap、overlap 大于分段、非法 URL 会被拒绝；
- 配置快照移除 api_key。

**步骤 2：运行测试并确认红灯**

```powershell
cd E:\project\LocalMiniDrama\backend-node
npm test -- --test-name-pattern="video upscale config"
```

预期：模块不存在或断言失败，且失败来自新增契约。

**步骤 3：实现最小配置解析器**

导出：

```js
getVideoUpscaleConfig()
resolveUpscaleMethod(requestedMethod, config)
createSafeConfigSnapshot(config)
```

配置只描述服务能力，不复用当前视频生成的默认 provider。为生产配置保留 `api_key_env` 和 `tls_verify`，不在仓库写真实凭据。

**步骤 4：运行相关测试并提交**

```powershell
npm test -- --test-name-pattern="video upscale config"
git add backend-node/config.yaml backend-node/src/services/videoUpscale backend-node/tests/services/videoUpscale
git commit -m "feat: define video upscale service configuration"
```

---

## Task 2：实现纯分段规划器

**文件：**

- 新建：`backend-node/src/services/videoUpscale/videoUpscalePlanner.js`
- 新建测试：`backend-node/tests/services/videoUpscale/videoUpscalePlanner.test.js`
- 复用：项目现有 ffprobe 工具；若无合适抽象，新建 `backend-node/src/utils/mediaProbe.js`

**步骤 1：写失败测试**

至少覆盖：

- 240 帧输入只产生一段；
- 241 帧输入产生两段并在第二段保留 4 帧重叠；
- 24 fps、120 秒、2880 帧产生约 12 个主分段且覆盖每一帧；
- 23.976 fps 使用分数表示，不以浮点秒累计起点；
- 尾段小于 frame cap 时正确设置 requested count；
- OOM 后对未完成区间从 240 降到 120，再降到 60；
- 宽高不是 `1312×736` 时返回 `UNSUPPORTED_SOURCE_DIMENSIONS`；
- 没有音轨的视频也能生成计划。

**步骤 2：确认测试失败**

```powershell
npm test -- --test-name-pattern="video upscale planner"
```

**步骤 3：实现纯函数**

建议接口：

```js
validateSourceMedia(probe, config)
buildSegmentPlan({ frameCount, fps, frameCap, overlapFrames })
replanRemainingSegments({ completedSegments, failedSegment, nextFrameCap })
getTargetDimensions(source, scale)
```

计划中的所有区间使用整数帧，保存 `start_frame`、`requested_frame_count`、`trim_leading_frames`，不保存计算后的浮点起止秒。

**步骤 4：运行测试并提交**

```powershell
npm test -- --test-name-pattern="video upscale planner"
git add backend-node/src/services/videoUpscale/videoUpscalePlanner.js backend-node/tests/services/videoUpscale/videoUpscalePlanner.test.js
git commit -m "feat: add frame-accurate upscale segment planning"
```

---

## Task 3：实现控制面板 HTTP 适配器

**文件：**

- 新建：`backend-node/src/services/videoUpscale/zealmanUpscaleClient.js`
- 新建：`backend-node/src/services/videoUpscale/upscaleErrors.js`
- 新建测试：`backend-node/tests/services/videoUpscale/zealmanUpscaleClient.test.js`

**步骤 1：写 mock HTTP 失败测试**

覆盖：

- health 和 ComfyUI status 的解析；
- ComfyUI stopped 时调用 start，再等待 ready；
- 上传视频并取得远端文件名；
- 加载 M19/M20 配置、复制 `workflow_template`、删除 `_api_config`；
- Flash 修改节点 195，并把节点 192 固定为 2×；Seed 修改节点 25，并把节点 29 固定为 `resolution=1472`、`max_resolution=2624`；
- 提交体必须含 `source=quick`、完整 `workflow_template`、稳定 `client_id`；
- 模板缺少节点/字段时在 POST 前抛 `WORKFLOW_SCHEMA_CHANGED`；
- 轮询 running/queued/success/error；
- 已完成结果选择视频而不是预览图；
- Authorization 只在配置密钥时发送；
- 超时、502、404、OOM 映射为稳定错误码。

明确加入一个回归测试，禁止重新出现以下错误请求：

```json
{"workflow_id":"M20...","input_values":{}}
```

**步骤 2：确认测试失败**

```powershell
npm test -- --test-name-pattern="zealman upscale client"
```

**步骤 3：实现接口**

```js
health()
getComfyStatus()
startComfyAndWait()
uploadVideo(localPath)
loadWorkflowTemplate(workflowId)
submitSegment({ workflowId, remoteVideo, frameCap, skipFrames, filenamePrefix, clientId, targetWidth, targetHeight, scale })
getResult(promptId)
downloadResult(result, destination)
cancelPrompt(promptId)
```

所有请求设置连接、响应和总任务超时；轮询支持 AbortSignal。TLS 只在此客户端按配置处理，不修改全局 `NODE_TLS_REJECT_UNAUTHORIZED`。

**步骤 4：运行测试并提交**

```powershell
npm test -- --test-name-pattern="zealman upscale client"
git add backend-node/src/services/videoUpscale/zealmanUpscaleClient.js backend-node/src/services/videoUpscale/upscaleErrors.js backend-node/tests/services/videoUpscale/zealmanUpscaleClient.test.js
git commit -m "feat: add zealman workflow api adapter"
```

---

## Task 4：增加持久化作业和分段表

**文件：**

- 新建：`backend-node/migrations/33_video_upscale_jobs.sql`
- 修改：`backend-node/src/db/migrate.js`
- 新建：`backend-node/src/services/videoUpscale/videoUpscaleRepository.js`
- 新建测试：`backend-node/tests/services/videoUpscale/videoUpscaleRepository.test.js`

**步骤 1：写失败测试**

覆盖：

- 迁移可以从空库和 v32 库升级；
- `(job_id, segment_index)` 唯一；
- 创建 job 与 segments 在一个事务内完成；
- compare-and-set 状态转换阻止两个 worker 同时领取同一段；
- prompt_id、下载结果和错误状态能够跨数据库重连恢复；
- 配置快照不含 api_key；
- 根据 `next_retry_at` 查询应恢复作业。

**步骤 2：确认测试失败**

```powershell
npm test -- --test-name-pattern="video upscale repository"
```

**步骤 3：实现迁移和 repository**

除规格中的字段外，为常用查询添加索引。所有状态更新写 `updated_at`；状态转换函数显式列出允许的 from/to，不允许任意字符串覆盖。

**步骤 4：验证迁移幂等与回滚行为**

```powershell
npm test -- --test-name-pattern="migration|video upscale repository"
```

**步骤 5：提交**

```powershell
git add backend-node/migrations/33_video_upscale_jobs.sql backend-node/src/db/migrate.js backend-node/src/services/videoUpscale/videoUpscaleRepository.js backend-node/tests/services/videoUpscale/videoUpscaleRepository.test.js
git commit -m "feat: persist video upscale jobs and segments"
```

---

## Task 5：实现本地拼接、音频恢复与校验

**文件：**

- 新建：`backend-node/src/services/videoUpscale/videoUpscaleStitcher.js`
- 新建：`backend-node/src/services/videoUpscale/videoUpscaleValidator.js`
- 新建测试：`backend-node/tests/services/videoUpscale/videoUpscaleStitcher.test.js`
- 新增夹具：`backend-node/tests/fixtures/video-upscale/` 下的小型合成视频

**步骤 1：生成确定性测试夹具**

使用 ffmpeg 测试源生成彩色帧编号、24 fps、带正弦音轨的数秒视频。夹具生成命令写入测试 helper，不提交大体积二进制。

**步骤 2：写失败测试**

覆盖：

- 后续段裁掉 4 个重叠帧；
- 三段拼接后帧编号连续、无重复、无遗漏；
- 输出恢复源音频；
- 23.976 fps 不漂移；
- 云端分段编码参数不一致时进入统一转码路径；
- 最终尺寸、帧数、时长、fps、音轨按规格校验；
- 写入临时文件后原子改名，失败时不覆盖已有成片；
- 无音频输入保持无音频。

**步骤 3：确认测试失败**

```powershell
npm test -- --test-name-pattern="video upscale stitcher|video upscale validator"
```

**步骤 4：实现 ffmpeg 编排**

所有 shell 参数使用参数数组传递，不拼接用户输入。临时目录必须位于项目 storage 下，并验证输出真实路径没有逃逸目标目录。

**步骤 5：运行测试并提交**

```powershell
npm test -- --test-name-pattern="video upscale stitcher|video upscale validator"
git add backend-node/src/services/videoUpscale/videoUpscaleStitcher.js backend-node/src/services/videoUpscale/videoUpscaleValidator.js backend-node/tests/services/videoUpscale
git commit -m "feat: stitch and validate upscaled video segments"
```

---

## Task 6：实现可恢复的超分作业状态机

**文件：**

- 新建：`backend-node/src/services/videoUpscale/videoUpscaleJobService.js`
- 新建：`backend-node/src/services/videoUpscale/videoUpscaleRecoveryService.js`
- 新建测试：`backend-node/tests/services/videoUpscale/videoUpscaleJobService.test.js`
- 新建测试：`backend-node/tests/services/videoUpscale/videoUpscaleRecoveryService.test.js`

**步骤 1：写失败测试**

用 fake client 覆盖完整状态机：

- 正常 Flash 作业逐段提交、下载、拼接并完成；
- Seed 方法只使用 M19；
- 面板离线进入 waiting_provider，按 1/5/15/30 分钟退避，24 小时后停止自动轮询但不删除作业；
- ComfyUI stopped 自动启动；
- 已有 prompt_id 的 queued/running 作业重启后只查询、不重复提交；
- success 但未下载的作业只下载；
- 下载失败不重跑推理；
- OOM 先清理/重试，再把未完成分段缩到 120/60；
- 工作流 schema 错误不自动重试；
- cancel 和 skip 的终态及基础视频保留行为；
- 一个 provider 配置只领取一个推理分段；
- 字幕阶段失败后重试不重复超分。

**步骤 2：确认测试失败**

```powershell
npm test -- --test-name-pattern="video upscale job|video upscale recovery"
```

**步骤 3：实现状态机**

核心方法：

```js
createJob(input)
runJob(jobId)
resumeJob(jobId)
retryJob(jobId)
skipJob(jobId)
cancelJob(jobId)
recoverDueJobs()
```

在外部调用前后写检查点。对“HTTP 请求已发出但客户端没收到响应”的情况，先通过已有 prompt/client 信息对账；不能确认时保持 `reconciling` 子阶段，不立即重提。

**步骤 4：接入应用启动恢复**

在服务启动完成、数据库迁移完成后调用 `recoverDueJobs()`。恢复扫描需要有限批次和互斥领取，避免多进程重复工作。

**步骤 5：运行测试并提交**

```powershell
npm test -- --test-name-pattern="video upscale job|video upscale recovery"
git add backend-node/src/services/videoUpscale/videoUpscaleJobService.js backend-node/src/services/videoUpscale/videoUpscaleRecoveryService.js backend-node/tests/services/videoUpscale
git commit -m "feat: orchestrate recoverable cloud upscale jobs"
```

---

## Task 7：重构合并最终化并插入超分阶段

**文件：**

- 修改：`backend-node/src/services/videoMergeService.js`
- 修改：`backend-node/src/services/mergedEpisodePostProcess.js`
- 修改：`backend-node/src/services/dramaService.js`
- 修改：`backend-node/src/services/episodeGenerationProgressService.js`
- 新建或修改测试：对应 service 测试文件

**步骤 1：写失败集成测试**

覆盖：

- 未传 upscale 选项时调用顺序与旧行为一致；
- 普通合并开启超分时顺序是 merge → upscale → overlays；
- Director timeline 分支同样进入统一最终化，不再提前返回；
- 超分等待时 merge 不被错误标记 completed；
- 超分失败保留 `base_merged.mp4`；
- skip 后使用基础文件继续后处理并在结果元数据标注 `upscale_skipped=true`；
- 本地字幕失败重试复用已完成的 upscaled 文件；
- async task 进度采用设计中的阶段区间。

**步骤 2：确认测试失败**

```powershell
npm test -- --test-name-pattern="video merge.*upscale|episode progress.*upscale"
```

**步骤 3：提取共同最终化函数**

建议新增内部函数或服务：

```js
finalizeMergedVideo({ merge, baseVideoPath, mergeOptions })
```

先让普通分支和 Director 分支都调用它，再插入 upscale。不要在两个分支复制云端逻辑。

**步骤 4：接入 merge_options**

`dramaService.finalizeEpisode` 校验 `upscale.enabled/method/failure_policy`，将其持久化到 merge options。旧请求没有该字段时不创建超分作业。

**步骤 5：运行相关和回归测试并提交**

```powershell
npm test -- --test-name-pattern="video merge|finalize episode|episode progress"
git add backend-node/src/services/videoMergeService.js backend-node/src/services/mergedEpisodePostProcess.js backend-node/src/services/dramaService.js backend-node/src/services/episodeGenerationProgressService.js backend-node/tests
git commit -m "feat: run upscale before episode overlays"
```

---

## Task 8：增加管理 API 与输入校验

**文件：**

- 新建：`backend-node/src/routes/videoUpscale.js`
- 修改：`backend-node/src/routes/index.js`
- 新建测试：`backend-node/tests/routes/videoUpscale.test.js`
- 修改：finalize episode 路由测试

**步骤 1：写失败测试**

覆盖：

- capabilities 只做只读探测，不调用 generate；
- job 查询包含 segments、错误码、next_retry_at、allowed_actions；
- 只有 failed/waiting 才允许 retry/skip；
- completed 不能 cancel；
- method 白名单和布尔/枚举校验；
- 未认证请求遵循项目现有鉴权规则；
- 响应不含 api_key、workflow_template 和服务器堆栈。

**步骤 2：确认测试失败**

```powershell
npm test -- --test-name-pattern="video upscale route"
```

**步骤 3：实现路由**

新增：

```text
GET  /api/v1/video-upscale/capabilities
GET  /api/v1/video-upscale/jobs/:id
POST /api/v1/video-upscale/jobs/:id/retry
POST /api/v1/video-upscale/jobs/:id/skip
POST /api/v1/video-upscale/jobs/:id/cancel
```

错误使用一致 HTTP 语义：输入错误 400、未找到 404、状态冲突 409、服务暂不可用 503；异步操作返回 202。

**步骤 4：运行测试并提交**

```powershell
npm test -- --test-name-pattern="video upscale route|finalize episode"
git add backend-node/src/routes/videoUpscale.js backend-node/src/routes/index.js backend-node/tests/routes
git commit -m "feat: expose video upscale job controls"
```

---

## Task 9：增加前端最终化选项与故障操作

**文件：**

- 修改：`frontend/src/views/FilmCreate.vue`
- 修改或新建：项目实际 API client 模块
- 新建或修改测试：FilmCreate 组件/端到端测试

**步骤 1：写失败前端测试**

覆盖：

- 开关默认关闭；
- 开启后默认选择 FlashVSR；
- SeedVR2 文案说明较慢、偏质量；
- 显示源 `1312×736`、目标 `2624×1472`；
- finalize 请求包含正确 merge_options；
- waiting_provider 显示原因、等待时长、重试、跳过；
- failed 显示错误码但不泄漏内部堆栈；
- 点击 skip 有确认说明“将输出基础分辨率”，之后继续轮询；
- 页面刷新后从 job API 恢复进度。

**步骤 2：确认测试失败**

使用项目现有前端测试命令；若仓库尚无组件测试框架，则至少增加 API 序列化单测并用现有端到端方案覆盖关键路径。

**步骤 3：实现 UI**

把超分配置放在“生成/合并后处理”区域，而不是 H3 模型参数区。进度文字使用业务阶段，不展示节点 ID。

**步骤 4：运行前端检查并提交**

```powershell
cd E:\project\LocalMiniDrama\frontend
npm run lint
npm run build
git add frontend
git commit -m "feat: add cloud upscale controls to episode finalization"
```

---

## Task 10：故障注入与端到端无费用验收

**文件：**

- 新建：`backend-node/tests/integration/videoUpscalePipeline.test.js`
- 新建：`backend-node/tests/helpers/fakeUpscalePanel.js`
- 修改：`docs/research/2026-09-05-cloud-upscale-api-investigation.md`
- 新建：`docs/operations/cloud-video-upscale-runbook.md`

**步骤 1：实现 fake panel**

可脚本化返回：offline、Comfy stopped、queued、running、success、OOM、schema changed、下载中断、损坏输出。记录提交次数，用于证明超时与重启不会重复提交。

**步骤 2：端到端测试**

使用本地小视频和 fake panel 跑：

- Flash 正常路径；
- Seed 正常路径；
- 云端离线 → 后端重启 → 云端恢复 → 完成；
- 推理完成 → 下载失败 → 后端重启 → 只下载；
- OOM → 缩短分段 → 完成；
- 用户 skip → 基础分辨率成片；
- 字幕叠加发生在超分后。

**步骤 3：运行全量后端测试**

```powershell
cd E:\project\LocalMiniDrama\backend-node
npm test
```

预期：全部通过，fake panel 的推理提交计数符合每个场景断言。

**步骤 4：构建前端**

```powershell
cd E:\project\LocalMiniDrama\frontend
npm run lint
npm run build
```

**步骤 5：写运维手册**

手册必须包括：配置、健康检查、启动云端后的恢复、常见错误码、如何重试/跳过、临时文件清理、如何确认没重复计费、如何禁用功能。

**步骤 6：提交**

```powershell
git add backend-node/tests/integration backend-node/tests/helpers docs
git commit -m "test: cover cloud upscale recovery scenarios"
```

---

## Task 11：受控真实云端验收

此任务会产生 GPU 使用，只有得到明确授权后执行；在此之前其余任务均可完成。

**准备：**

- 云端机器已由用户启动并确认计费状态；
- M19/M20 能通过 capabilities 检查；
- 使用不含敏感内容的 2–3 秒 `1312×736` 测试视频；
- 禁止直接用两分钟正片作为首次测试。

**步骤 1：Flash 小样本**

提交 M20，记录上传、排队、推理、下载时间，验证 `2624×1472`、fps、帧数和音频。

**步骤 2：Seed 小样本**

同一输入提交 M19，只验证协议与完整性；视觉对比不包含 RTX。

**步骤 3：长视频边界样本**

使用略超过 240 帧的测试视频，确保至少两段，逐帧检查交界无重复/遗漏。

**步骤 4：验收后关闭测试入口**

确认没有遗留 queued/running prompt，记录云端任务 ID 和测试文件，不自动停止或释放计费实例，除非用户明确授权平台控制动作。

**步骤 5：更新文档并提交**

把实际吞吐、显存峰值、温度（若平台可见）、失败信息和版本写入调研记录，不用推测值代替测量值。

---

## 最终完成检查清单

- [x] 未开启超分的旧流程回归通过。
- [x] Flash 使用 M20，Seed 使用 M19，模板协议回归测试通过。
- [x] 普通/Director 两条合并路径均在 overlays 前超分。
- [x] 两分钟级长视频分段、去重、音频、fps 和时长逻辑通过本地确定性验收。
- [x] offline/stopped/OOM/download failure/restart/cancel/skip 均有自动化覆盖；HTTP 超时由统一可恢复错误映射覆盖。
- [x] 已保存 prompt 的任务恢复时不会重复提交；generate 回包前断线的残余风险已写入运维手册。
- [x] 源分辨率不符时在上传前失败。
- [x] 日志、API、数据库快照均不泄漏密钥。
- [x] 文档与运维手册更新。
- [x] 功能相关后端测试、前端全量测试和生产构建通过；后端全量仅剩 8 个与本功能无关的既有失败。
- [x] 用户明确授权并开机后，RTX 5090 上的 Flash/Seed 短片与 Flash 241 帧跨段真实 GPU 验收通过。
