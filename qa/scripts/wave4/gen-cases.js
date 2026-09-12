// Wave4 用例 YAML 生成（qa/cases/<模块码>/TC-<模块码>-<NNN>.yml）
// schema 对齐 qa-test-engineer §9.2 与前序波次格式；automation.file 指向 wave4 runner
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/project/LocalMiniDrama';
const RUNNER = {
  VIDEO: 'qa/scripts/wave4/run-video.js',
  IMAGE: 'qa/scripts/wave4/run-image.js',
  AUDIO: 'qa/scripts/wave4/run-audio.js',
  UPSCALE: 'qa/scripts/wave4/run-upscale.js',
  CANVAS: 'qa/scripts/wave4/run-canvas.js',
};
const FEATURE = { VIDEO: 'F-VIDEO', IMAGE: 'F-IMAGE', AUDIO: 'F-AUDIO', UPSCALE: 'F-UPSCALE', CANVAS: 'F-CANVAS' };

// [module, id, title, requirement, level, purpose, priority, testId, tags, notes]
const CASES = [
  // ---------- VIDEO（INV-7.x，feature-inventory §7）----------
  ['VIDEO', 'TC-VIDEO-001', '真实生成主链路：分镜视频任务提交（ComfyUI H3 te_speed）→ 状态机等待/运行/审核 → 视频文件落盘 ffprobe 可解码', 'INV-7.4', 'system', 'functional', 'P0', 'TC_VIDEO_001', ['video', 'comfyui', 'h3', 'real-gen'], '真实生成预算 #1/2；DeepSeek 副作用：H3 草稿编译 1 次（架构必需，草稿复用于 #2）'],
  ['VIDEO', 'TC-VIDEO-002', '数据流与持久化：provider task id、config 快照（workflow/model）、候选组 artifact 绑定、async_task 完成', 'INV-7.5', 'system', 'functional', 'P0', 'TC_VIDEO_002', ['video', 'persistence'], '复用 TC-VIDEO-001 真实生成产物，不消耗预算；交接点：生成结果→候选组可评审实体'],
  ['VIDEO', 'TC-VIDEO-003', '第 2 次真实生成：运行中取消 → cancelled（Provider 任务清理）+ 重试状态语义', 'INV-7.5', 'system', 'exception', 'P1', 'TC_VIDEO_003', ['video', 'cancel', 'real-gen'], '真实生成预算 #2/2；取消后 ComfyUI 队列清空为 Provider 取消生效证据'],
  ['VIDEO', 'TC-VIDEO-004', '视频供应商能力查询 API（ComfyUI H3 默认通道修复后返回协议能力与约束）', 'INV-7.2', 'system', 'functional', 'P0', 'TC_VIDEO_004', ['video', 'capabilities'], '含环境修复证据：wave1 清理 Agnes 预设触发 clearOtherDefault 后 video/image 默认通道丢失，经应用 API 恢复（非改库）'],
  ['VIDEO', 'TC-VIDEO-005', '工作流目录 GET /videos/workflows：注册表 3 工作流、te_speed 能力标注、与 director-workflows.json 一致', 'INV-7.11', 'system', 'functional', 'P1', 'TC_VIDEO_005', ['video', 'workflow'], ''],
  ['VIDEO', 'TC-VIDEO-006', 'H3 门禁：无 storyboard → H3_STORYBOARD_REQUIRED；无草稿 → H3_DRAFT_REQUIRED；草稿跨分镜被拒', 'INV-7.8', 'system', 'exception', 'P1', 'TC_VIDEO_006', ['video', 'h3', 'guard'], '验证不提交真实生成（门禁先于 provider 调用）'],
  ['VIDEO', 'TC-VIDEO-007', '风格契约：项目内覆盖风格 400；自由生成缺 style_id 400 PROJECT_STYLE_REQUIRED', 'INV-7.1', 'system', 'exception', 'P1', 'TC_VIDEO_007', ['video', 'style'], ''],
  ['VIDEO', 'TC-VIDEO-008', '批量创建契约 POST /videos/prepared/batch：非数组 400；数组内缺草稿项结构化错误不整批崩溃', 'INV-7.4', 'system', 'exception', 'P1', 'TC_VIDEO_008', ['video', 'batch'], '默认通道为 H3，缺分镜/草稿项在门禁处失败，不消耗真实生成'],
  ['VIDEO', 'TC-VIDEO-009', '取消/重试状态语义（不提交生成）：review 任务 cancel/retry 均 409；resume-poll 与 retry 同语义', 'INV-7.5', 'system', 'exception', 'P1', 'TC_VIDEO_009', ['video', 'lifecycle'], ''],
  ['VIDEO', 'TC-VIDEO-010', 'H3 提示词编译/预览契约 POST /videos/h3-preview：编译产物含官方章节结构与时长口径', 'INV-7.8', 'system', 'functional', 'P1', 'TC_VIDEO_010', ['video', 'h3', 'experimental'], 'EXPERIMENTAL 项验证当前真实行为'],
  ['VIDEO', 'TC-VIDEO-011', 'H3 草稿接口契约：GET 缺参 400；compile 缺 workflow_id 400；草稿 freshness 结构', 'INV-7.8', 'system', 'functional', 'P1', 'TC_VIDEO_011', ['video', 'h3'], ''],
  ['VIDEO', 'TC-VIDEO-012', '连续性锚点/质量分析 EXPERIMENTAL：anchors/analyze 接口当前真实行为验证', 'INV-7.9', 'system', 'functional', 'P2', 'TC_VIDEO_012', ['video', 'experimental'], 'inventory 标注「产品标准和自动决策仍未稳定」，按真实行为记录'],
  ['VIDEO', 'TC-VIDEO-013', 'episode 批量桩路由与 fromImage 契约：episode batch 返回空数组（LEGACY）；image→video 任务创建', 'INV-7.4', 'system', 'regression', 'P2', 'TC_VIDEO_013', ['video', 'legacy'], ''],
  ['VIDEO', 'TC-VIDEO-014', '生成历史管理：GET /videos 过滤 drama_id；GET :id 404；DELETE 软删后列表不可见', 'INV-7.1', 'system', 'functional', 'P1', 'TC_VIDEO_014', ['video', 'crud'], '删除对象为已取消的 #2 记录；#1 review 记录保留供 AUDIO finalize'],

  // ---------- IMAGE（INV-6.x）----------
  ['IMAGE', 'TC-IMAGE-001', '默认通道创建图像任务：18080 shim 离线为真实外部状态 → 任务失败状态与错误信息可见（QA-008 修复验证）', 'INV-6.1', 'system', 'exception', 'P0', 'TC_IMAGE_001', ['image', 'shim', 'qa008'], '成功路径 chatgpt_web 由主会话 E2E 覆盖，本模块不测'],
  ['IMAGE', 'TC-IMAGE-002', '风格契约：项目内覆盖 style 400；自由生成缺 style_id 400 PROJECT_STYLE_REQUIRED', 'INV-6.1', 'system', 'exception', 'P1', 'TC_IMAGE_002', ['image', 'style'], ''],
  ['IMAGE', 'TC-IMAGE-003', '批量图像任务契约 POST /image-generation-batches：批次+任务持久化、通道解析', 'INV-6.4', 'system', 'functional', 'P1', 'TC_IMAGE_003', ['image', 'batch'], 'v1 /images/episode/:id/batch 为 LEGACY 桩（返回空数组），批量主入口为 image-generation-batches'],
  ['IMAGE', 'TC-IMAGE-004', '图像任务抽屉数据：summary 按状态聚合、environment/default 通道接口契约', 'INV-6.5', 'system', 'functional', 'P1', 'TC_IMAGE_004', ['image', 'drawer'], ''],
  ['IMAGE', 'TC-IMAGE-005', '图像批次暂停/继续状态语义：pause → paused，resume → 恢复', 'INV-6.6', 'system', 'functional', 'P1', 'TC_IMAGE_005', ['image', 'queue'], ''],
  ['IMAGE', 'TC-IMAGE-006', '图像任务 retry/skip/cancel 状态语义：cancel 后状态机约束', 'INV-6.4', 'system', 'exception', 'P1', 'TC_IMAGE_006', ['image', 'queue'], ''],
  ['IMAGE', 'TC-IMAGE-007', '图像代理缓存：服务层能力验证（image_proxy_cache 键/值语义 + 无独立 HTTP 路由观察项）', 'INV-6.8', 'system', 'functional', 'P2', 'TC_IMAGE_007', ['image', 'proxy'], 'HTTP 级成功路径依赖真实图床配置，记观察项；失败生成不产生缓存写入为真实断言'],
  ['IMAGE', 'TC-IMAGE-008', '分镜图像超分：POST /storyboards/:id/upscale 真实 sharp 2x → 新文件落盘尺寸翻倍', 'INV-6.9', 'system', 'functional', 'P1', 'TC_IMAGE_008', ['image', 'upscale'], '真实本地处理（sharp lanczos3）'],
  ['IMAGE', 'TC-IMAGE-009', '图像生成历史与候选管理：列表过滤 drama_id、详情回读、删除后不可见', 'INV-6.3', 'system', 'functional', 'P1', 'TC_IMAGE_009', ['image', 'crud'], ''],
  ['IMAGE', 'TC-IMAGE-010', '自由创作图像轮询接口现状：imagesAPI 无 getTask 导出（BROKEN 现状如实验证）', 'INV-6.11', 'system', 'regression', 'P2', 'TC_IMAGE_010', ['image', 'broken'], '前端有空值守卫降级为超时路径而非崩溃——与 inventory 措辞的差异记观察项'],
  ['IMAGE', 'TC-IMAGE-011', '剧集背景图接口：GET backgrounds 空态真实行为 + extract 契约', 'INV-6.2', 'system', 'functional', 'P2', 'TC_IMAGE_011', ['image', 'backgrounds'], ''],

  // ---------- AUDIO（INV-8.x）----------
  ['AUDIO', 'TC-AUDIO-001', 'TTS 真实错误路径：无 service_type=tts 配置 → 明确「未配置 TTS」错误；批量接口逐项错误不整批崩溃', 'INV-8.1', 'system', 'exception', 'P0', 'TC_AUDIO_001', ['audio', 'tts'], '应用无 TTS 通道配置为真实外部状态（非 mock）'],
  ['AUDIO', 'TC-AUDIO-002', 'TTS 参数校验：无参 400；空对白分镜 400「分镜对白为空」', 'INV-8.1', 'system', 'exception', 'P1', 'TC_AUDIO_002', ['audio', 'tts'], ''],
  ['AUDIO', 'TC-AUDIO-003', '剧集音频计划：PATCH 更新 → 响应投影回读 → DB 落库（field_state 锁定）→ 分镜 music_cue 投影', 'INV-8.2', 'system', 'functional', 'P0', 'TC_AUDIO_003', ['audio', 'plan'], ''],
  ['AUDIO', 'TC-AUDIO-004', '音频计划 AI 生成接口边界：不存在剧集与无分镜剧集的明确错误（LLM 主路径超预算记观察项）', 'INV-8.2', 'system', 'exception', 'P1', 'TC_AUDIO_004', ['audio', 'plan'], 'DeepSeek 本 wave 0 次预算，LLM 主路径未真实触发（wave2/3 已覆盖）'],
  ['AUDIO', 'TC-AUDIO-005', 'BGM 本地文件路径校验：目录穿越被拒 400 EPISODE_AUDIO_PATH_INVALID', 'INV-8.2', 'system', 'exception', 'P1', 'TC_AUDIO_005', ['audio', 'security'], ''],
  ['AUDIO', 'TC-AUDIO-006', 'unlock_fields 契约：非法字段名 400；合法解锁后 locked=false 且 revision+1', 'INV-8.2', 'system', 'functional', 'P1', 'TC_AUDIO_006', ['audio', 'plan'], ''],
  ['AUDIO', 'TC-AUDIO-007', '真实媒体合成与来源登记：ffmpeg 合成 2s mp4（含音轨）→ source-video 登记 → ffprobe 真实解码', 'INV-8.4', 'system', 'functional', 'P0', 'TC_AUDIO_007', ['audio', 'ffmpeg'], '真实媒体产物保留 qa/run/wave4-artifacts/'],
  ['AUDIO', 'TC-AUDIO-008', 'finalize 真实成片合成：分镜真实视频 → ffmpeg 合并 → completed + merged_url + episodes.video_url + ffprobe', 'INV-8.8', 'system', 'functional', 'P0', 'TC_AUDIO_008', ['audio', 'merge', 'real'], '复用 VIDEO 波次真实生成视频作为合成输入（主流程数据流交接点：生成→成片）'],
  ['AUDIO', 'TC-AUDIO-009', '成片下载契约：GET /episodes/:id/download 返回真实 video_url 且字节可访问', 'INV-8.9', 'system', 'functional', 'P1', 'TC_AUDIO_009', ['audio', 'download'], ''],
  ['AUDIO', 'TC-AUDIO-010', '合并配置契约：字幕/水印/混音选项经 POST /video-merges 持久化并可回读', 'INV-8.6', 'system', 'functional', 'P1', 'TC_AUDIO_010', ['audio', 'merge-options'], '配置面契约验证；真实烧录依赖字幕/混音源，当前无 TTS 通道'],
  ['AUDIO', 'TC-AUDIO-011', 'video-merges 列表/详情/删除与 404：软删后不可见', 'INV-8.8', 'system', 'functional', 'P1', 'TC_AUDIO_011', ['audio', 'crud'], ''],
  ['AUDIO', 'TC-AUDIO-012', 'TTS 供应商覆盖 PARTIAL 现状：openai 分支日志打印 api_key（静态证据）；仅两类协议', 'INV-8.5', 'system', 'regression', 'P2', 'TC_AUDIO_012', ['audio', 'tts', 'security'], 'inventory 记录的密钥泄漏问题现状未修复（file:line 证据）'],
  ['AUDIO', 'TC-AUDIO-013', '音频上传接口：真实 WAV 上传成功落盘；非音频 MIME 拒绝', 'INV-8.1', 'system', 'functional', 'P2', 'TC_AUDIO_013', ['audio', 'upload'], ''],
  ['AUDIO', 'TC-AUDIO-014', 'finalize 降级路径：剧集无任何视频片段 → 明确「本集没有可合成的视频片段」', 'INV-8.8', 'system', 'exception', 'P1', 'TC_AUDIO_014', ['audio', 'merge'], ''],

  // ---------- UPSCALE（INV-9.x）----------
  ['UPSCALE', 'TC-UPSCALE-001', '超分能力查询真实契约：远端不可达时 provider_online=false + 明确错误信息（真实外部状态）', 'INV-9.4', 'system', 'functional', 'P1', 'TC_UPSCALE_001', ['upscale', 'capabilities'], 'Zealman 风格远端不可达为真实外部状态；Flash/Seed 方法披露为真实响应'],
  ['UPSCALE', 'TC-UPSCALE-002', '作业查询契约：不存在 404；publicJob 剥离快照/源路径/远端内部字段', 'INV-9.1', 'system', 'functional', 'P1', 'TC_UPSCALE_002', ['upscale', 'contract'], 'sim-upscale（用户已授权）：作业行为 DB seed'],
  ['UPSCALE', 'TC-UPSCALE-003', 'allowed_actions 状态矩阵（sim 全状态扫描）：retry/skip 仅 failed|waiting_provider，cancel 除终态外可用', 'INV-9.3', 'system', 'functional', 'P1', 'TC_UPSCALE_003', ['upscale', 'state-machine'], 'sim-upscale（用户已授权）'],
  ['UPSCALE', 'TC-UPSCALE-004', '重试语义：failed → 202 pending/retrying（真实 API 持久化）；运行中 → 409 UPSCALE_STATE_CONFLICT', 'INV-9.3', 'system', 'exception', 'P1', 'TC_UPSCALE_004', ['upscale', 'retry'], 'sim-upscale（用户已授权）：初始状态 DB seed，API 转换与持久化为真实执行'],
  ['UPSCALE', 'TC-UPSCALE-005', '跳过语义：waiting_provider → 202 skipped；非可跳态 → 409', 'INV-9.3', 'system', 'exception', 'P1', 'TC_UPSCALE_005', ['upscale', 'skip'], 'sim-upscale（用户已授权）'],
  ['UPSCALE', 'TC-UPSCALE-006', '取消语义：uploading → 202 cancelled（cancel_requested_at 落库）；completed → 409', 'INV-9.3', 'system', 'exception', 'P1', 'TC_UPSCALE_006', ['upscale', 'cancel'], 'sim-upscale（用户已授权）'],
  ['UPSCALE', 'TC-UPSCALE-007', '分段结构持久化：作业含 2 段（index 有序、client/filename 前缀绑定）、分段状态独立', 'INV-9.1', 'system', 'functional', 'P1', 'TC_UPSCALE_007', ['upscale', 'segments'], 'sim-upscale（用户已授权）'],
  ['UPSCALE', 'TC-UPSCALE-008', '状态机全阶段持久化演进（sim 驱动 API 断言）：pending→…→completed 每阶段一致', 'INV-9.1', 'system', 'functional', 'P1', 'TC_UPSCALE_008', ['upscale', 'state-machine'], 'sim-upscale（用户已授权）'],
  ['UPSCALE', 'TC-UPSCALE-009', '恢复轮询：60s 定时器静态证据 + due 作业真实重试远端 → 真实失败状态（sim-seed + real-provider-failure）', 'INV-9.2', 'system', 'functional', 'P1', 'TC_UPSCALE_009', ['upscale', 'recovery'], '作业由 sim seed（已授权），provider 失败路径为真实网络交互'],
  ['UPSCALE', 'TC-UPSCALE-010', '多供应商 PARTIAL 现状：client 绑定 Zealman/ComfyUI 风格协议（静态证据 + capabilities）', 'INV-9.4', 'system', 'regression', 'P2', 'TC_UPSCALE_010', ['upscale', 'provider'], ''],
  ['UPSCALE', 'TC-UPSCALE-011', 'Flash/Seed 后期选项：merge_options.upscale 归一化保留 method（normalizeUpscaleOptions 契约）', 'INV-9.5', 'system', 'functional', 'P2', 'TC_UPSCALE_011', ['upscale', 'options'], ''],

  // ---------- CANVAS（INV-10.x）----------
  ['CANVAS', 'TC-CANVAS-001', 'Vue Flow 数据接口链：项目/剧集/脚本/资产/分镜节点数据经真实 API 齐备且 drama_id 一致', 'INV-10.1', 'system', 'functional', 'P0', 'TC_CANVAS_001', ['canvas', 'data'], ''],
  ['CANVAS', 'TC-CANVAS-002', '工作流组持久化：PUT canvas-layout → dramas.metadata JSON 回读（canvas_layout 与 workflow_groups 共存）', 'INV-10.6', 'system', 'functional', 'P0', 'TC_CANVAS_002', ['canvas', 'persistence'], 'inventory PARTIAL：以 dramas.metadata 保存、非独立实体、无并发约束——按真实语义验证'],
  ['CANVAS', 'TC-CANVAS-003', 'canvas-layout 校验分支：空 body 400；workflow_groups 非数组 400；canvas_layout 非对象 400', 'INV-10.6', 'system', 'exception', 'P1', 'TC_CANVAS_003', ['canvas', 'validation'], ''],
  ['CANVAS', 'TC-CANVAS-004', '工作流组重跑（图片管线）：missing-images 编排创建任务并持久化；通道失败可见（遇错记录）', 'INV-10.7', 'system', 'functional', 'P1', 'TC_CANVAS_004', ['canvas', 'rerun', 'image'], 'shim 离线为真实外部状态；编排遇错不静默'],
  ['CANVAS', 'TC-CANVAS-005', '工作流组重跑（视频管线）：missing-videos 前置守卫（缺图分镜不提交真实生成）', 'INV-10.7', 'system', 'functional', 'P1', 'TC_CANVAS_005', ['canvas', 'rerun', 'video'], '守卫验证不消耗 ComfyUI 预算'],
  ['CANVAS', 'TC-CANVAS-006', '工作流组重跑（音频管线）：retry-failed 编排契约 + extract/batch 逐项遇错记录', 'INV-10.7', 'system', 'functional', 'P1', 'TC_CANVAS_006', ['canvas', 'rerun', 'audio'], ''],
  ['CANVAS', 'TC-CANVAS-007', '导演候选队列：GET queue 快照、jobs/:id 真实记录、artifact content 守卫与真实下载', 'INV-10.9', 'system', 'functional', 'P1', 'TC_CANVAS_007', ['canvas', 'director'], '真实 artifact 来自 VIDEO 波次生成'],
  ['CANVAS', 'TC-CANVAS-008', '候选评审入口：group review 推进 → select 选中并记录原因 → video_generations 状态联动 selected', 'INV-10.9', 'system', 'functional', 'P1', 'TC_CANVAS_008', ['canvas', 'review'], '复用 VIDEO 波次真实候选组（不消耗预算）'],
  ['CANVAS', 'TC-CANVAS-009', '导演时间线（EXPERIMENTAL）：不存在 404 空态真实行为 + 创建契约落库（实库首条记录）', 'INV-10.10', 'system', 'functional', 'P1', 'TC_CANVAS_009', ['canvas', 'timeline'], 'inventory：数据模型和 UI 存在，实库无时间线记录——验证空态与首条创建'],
  ['CANVAS', 'TC-CANVAS-010', 'Director 存储清理：storage usage 统计真实可读 + dryRun 清理非破坏契约', 'INV-10.11', 'system', 'functional', 'P1', 'TC_CANVAS_010', ['canvas', 'storage'], 'dryRun 防破坏；非 dryRun 清理由产品正常使用触发'],
  ['CANVAS', 'TC-CANVAS-011', '画布与线性制作台功能等价（PARTIAL）：画布侧可触达的编辑接口抽样真实行为', 'INV-10.8', 'system', 'regression', 'P2', 'TC_CANVAS_011', ['canvas', 'partial'], ''],
];

function yamlEscape(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

let count = 0;
for (const [moduleCode, id, title, req, level, purpose, priority, testId, tags, notes] of CASES) {
  const dir = path.join(ROOT, 'qa/cases', moduleCode);
  fs.mkdirSync(dir, { recursive: true });
  const content = `id: ${id}
title: ${yamlEscape(title)}
state: active
feature_id: ${FEATURE[moduleCode]}
requirement_ids: [${req}]
level: ${level}
purpose: ${purpose}
priority: ${priority}
preconditions:
  - "后端 http://127.0.0.1:5679 / ComfyUI 8188 在线（L3 共享环境，由主会话管理）"
  - "真实测试约束：不 mock 外部服务；UPSCALE 状态机模拟为用户唯一授权例外（evidence 标注 sim-upscale）"
  - "前置：qa/scripts/wave4/run-video.js 已执行（image/video 默认通道已修复；video-chain.json 可用）"
test_data:
  prefix: "QA-L3-"
  cleanup: "用例自建项目结束后软删（可复核）；真实生成视频/音频产物保留 qa/run/wave4-artifacts/"
steps:
  - "由 qa/scripts/wave4 自动化脚本真实调用 HTTP API 执行（automation.test_id 对应用例块）"
expected:
  - "全部断言通过（状态码/响应结构/DB 副本/文件系统四层核对；BROKEN/PARTIAL/EXPERIMENTAL 项按 feature-inventory 文档行为验证并记录观察项）"
assertions:
  - "以脚本内 cs.eq/cs.expect 断言为准，逐条断言写入执行日志 evidence"
automation:
  status: implemented
  framework: node
  file: ${RUNNER[moduleCode]}
  test_id: ${testId}
targets:
  files: []
  symbols: []
  generated_by: "wave4-designer"
  generated_at: "2026-09-12"
regression_tags: [${moduleCode.toLowerCase()}, wave4, l3]
notes: ${yamlEscape(notes || '')}
`;
  fs.writeFileSync(path.join(dir, `${id}.yml`), content);
  count++;
}
console.log(`[wave4] 已生成 ${count} 条用例 YAML`);
