# 发布质量门报告（L3）

- run_id: run_20260912_072912 · 模式 L3 · scope=全项目 · 分支 codex/v2-1-implementation
- 判定人: QA Gatekeeper（独立判定，未采信 Designer/Runner 推理，全部证据自行复核）
- 判定轮次: R1 2026-09-12（HEAD c9c2bbd → FAIL）· R2 2026-09-12（修复轮工作区 → FAIL，范围收窄）· **R3 最终 2026-09-12（commit 8f72e86 → 见下）**

---

# 最终判定（第三轮 · commit 8f72e86）

## 结论

**CONDITIONAL PASS（可发布，附带必须履行的发版条件与已登记的未覆盖维度）**

未给 PASS 的原因：chatgpt_web 捕获回填最后一公里仍未在本窗口闭环（发送半链已真实验证），且第一轮登记的部分发布旅程/非功能维度仍未覆盖。未判 FAIL 的原因：全部 13 个已知缺陷（12 项 + R2 新立 BUG-L3-404）均已修复并经独立验证，当前零开放产品缺陷；唯一未闭环项属外部服务时延下的"未完成验证"，有真实半链证据、历史成功记录与单测佐证，不构成产品缺陷。

## R3 独立复核记录（全部亲自重放）

1. **BUG-L3-404 修复验证成立（决定性项）**：源码确认 dramaImportService.js:143-172 legacy style 迁移链（旧 style 文本 → 风格目录 id/标签匹配 → 未命中回落 rh-101-cinematic → metadata.style_migrated_from_legacy 标注）+ importExample catch 的 400 分流（STYLE/PROJECT_/VALIDATION/FORMAT/UNSUPPORTED 与 格式不正确/缺少/不支持/损坏）。**Gatekeeper 现场重放：POST /dramas/import-example → 201，drama_id=275 真实创建**；与修复者验证的 274 均为 style_id=**rh-115-ink-wash**（"ink wash" 经目录匹配命中真实水墨风格，优于回落默认），episodes=1、characters=4 还原，重复导入产生「 导入1」后缀独立项目（与 TC-IMPORT-012 语义一致）。P0 用例 TC-IMPORT-005 核心断言首次达成。
2. **提交与回归绑定成立**：commit 8f72e86 含 19 个源码文件 + CHANGELOG + LFS 物化示例包 + 全部 QA 证据（588 files / +19,130），工作区无未提交修改；提交点重跑 .qa-commit-backend.log 1157/1157、.qa-commit-front.log 371/371（fail 0）。
3. **簿记修正核实**：BUG-101/102 status → fixed-verified（两项此前的现场复核：configs leaked=0、cancel 响应 already_done=true）；TC-FIX-* priority 已按各 BUG 实际严重级修正（101=P1/102=P3/201=P2/204=P2/205=P2/301=P3/302=P2，其余 P1 正确）。
4. **chatgpt_web 捕获回填现状（如实记录）**：job 67a5d5ee 仍 pending / attempt 81e4bcae 仍 generating、当日 results=0（等待已 50+ 分钟，ChatGPT 网页侧持续"正在生成"无报错）。发送/桥接/任务半链的真实证据（stageF 截图 8 张、产品横幅等待态、DB 任务链）维持有效；捕获机制有 2026-09-07 真实成功记录（attempt 84c25ed6 + results 落库）与扩展单测佐证。

## 发版条件（CONDITIONAL PASS 附带，必须履行）

- **C1（验收条件）**：chatgpt_web 捕获回填闭环——job 67a5d5ee/attempt 81e4bcae 迟到落地后验证 结果→image_generations/V2 候选可见（A-G04 回填路径），或在下一窗口重做一次完整闭环并留证据。若证实为产品缺陷 → 本判定回退 FAIL。建议同时为捕获回填增加超时上界与用户可见失败态（当前无限等待态对用户不可判定）。
- **C2（披露义务）**：发布说明登记未覆盖维度（见下）与行为变更（AI 配置接口/导出不再含明文 Key，依赖明文 Key 的外部脚本需改走服务端）；sim-upscale 为授权模拟通道；TTS 密钥日志问题在无 TTS 配置时不可达但代码仍在（ttsService.js:148）。
- **C3（后续加固建议）**：浏览器扩展 96 项自有测试纳入常规回归； journeys 6/11/12/13/14、A-P04 多 GB 导入、数据工具深项在后续 L2/L3 补齐。

## 已登记未覆盖维度（uncovered_dimensions，CONDITIONAL PASS 允许项）

chatgpt_capture_backfill（进行中）· desktop_electron · extension_suite_inclusion · journey6 已有视频登记 · journey11 重启恢复 · journey12 迁移对账 · journey13 PostRevision 门禁 · journey14 manifest 溯源 · A-P04 多 GB 导入 · A-D01 数据工具深项 · performance · compatibility_matrix · TTS 真实成功路径

---

# 第二轮判定记录（修复轮工作区 · 判定 FAIL，范围收窄，存档）

## 结论

**FAIL（范围大幅收窄：12 项修复中 11 项经独立复核成立，双硬阻断 401/403 的代码路径已打通；仍 FAIL 仅因以下 3 项残余，全部明确可修）**

1. **新发现 BUG-L3-404（P1，P0 用例 TC-IMPORT-005 仍失败）**：示例导入的 LFS 指针根因确已修复（82MB 真实 ZIP、PK 头、指针防御、available:true 均验证），但示例包内 project.json 为 **v1.3 旧 schema（drama 无 style_id，旧字段 style='ink wash'）**，当前导入校验（dramaImportService.js:135-141）必抛 PROJECT_STYLE_REQUIRED，而 importExample 的 catch 不做 400 分流、一律 500。Gatekeeper 现场重放：POST import-example → 500「project.json 格式不正确：缺少 drama.style_id 字段」。TC-FIX-202 的验证仅覆盖"文件物化+防御就位"，从未验证导入成功——P0 断言"示例项目导入成功"至今未达成。按硬规则：P0 用例失败且无已签 waiver → 不得 PASS/CONDITIONAL PASS。
2. **chatgpt_web 捕获回填未闭环**（处置见下）。
3. **修复未提交**：19 个源码文件 + CHANGELOG + LFS 资产仅存在于工作区，收官提交为 6a8cdea（纯 docs）。已验证状态与仓库状态不一致，发版前必须提交并在提交点重跑双套件绑定证据。

## 修复验证独立复核结果（Gatekeeper 全部亲自重放，非转录）

| 修复 | 独立复核方式 | 结论 |
|---|---|---|
| BUG-401 | 现场 quote API → h3:true；DB video#104（comfyui、provider_task_id 7526e5a0…、1312x736/24fps/seed42、status=review、local_path 在库）；工件 vg_104_4e75bb14.mp4（1,747,074B）亲自 ffprobe=6.000s/1312x736+音轨；V2 API storyboard 156 候选 cand_79abc2be-… 在库且 manifest.artifactPath 指向该文件 | **成立**。V2.1 真实视频生成链路（quote→守卫→提交→出片→候选）端到端打通 |
| BUG-403 | StoryboardStage.vue:360 chatgpt_web 选项 + :655/:1058/:1064-1075 store 接入；8 张 stageF 截图存在并亲自查看：产品横幅"已发送到 ChatGPT 网页，等待生成结果回填"、ChatGPT 网页真实收到拼装提示词+参考图并"正在生成" | **前半段成立**；捕获回填未闭环（见处置） |
| BUG-101 | 现场 GET /ai-configs：5 条配置 leaked=0，api_key='********'，has_api_key=true | **成立**（bug 文件状态漏更，仍 OPEN，需改为 fixed-verified） |
| BUG-102 | 现场对 completed 任务 POST cancel → data.already_done=true、status 保持 completed | **成立**（bug 文件状态同上漏更） |
| BUG-201 | 现场 GET /api/v1/dramas/273（第一轮 Gatekeeper 复现项目）→ episode 190 duration=95 读回 | **成立** |
| BUG-202 | ZIP 头 PK、82,156,132B（与 LFS oid size 一致）、examples available:true、指针防御源码在位；**但导入重放 500 → 新立 BUG-L3-404** | **部分成立（P0 断言仍未达成）** |
| BUG-203 | 以 DB 中 package_id extai_0145ea55… 现场 GET download?format=json → 200 / 26,198B / schema 正确 | **成立** |
| BUG-205 | 现场 POST generation/story 空梗概 → 400 | **成立** |
| BUG-302 | storyboardVariantService 三处 e.status=400 + episodeStoryboardService 两处 + routes/storyboards.js:325/:477 err.status===400 分流 | **成立**（源码级） |
| BUG-301 | routes/characters.js:170 uploadCharacterImageWithLocalPath + DB characters id=73（QA-L3-H3-Ref-林晚）local_path 落库 | **成立** |
| BUG-204 | episodeImportV21.js:343 INSERT INTO storyboards 含 source_key 列 | **成立**（源码级） |
| BUG-402 | aiConfigService deleteConfig 默认移交（:255 及移交 SQL）+ 套件绿 | **成立**（源码级） |

修复后回归：.qa-fix-backend.log 1157/1157、.qa-fix-front.log 371/371（fail 0）——已核对日志。

## chatgpt_web 捕获回填未闭环 —— 明确处置

**定性：不是缺陷、不是豁免项；是"未完成验证项"，作为发版前必须关闭的验收条件。**

- 已真实验证：入口可达（403 修复）→ 通道选择持久化 → 环境检查过 → openTask 9e85389e → 扩展桥接发送成功 → ChatGPT 网页真实收到完整提示词+参考图并进入生成（截图 + DB external_generation_jobs 67a5d5ee / attempts 81e4bcae status=generating）。产品横幅正确呈现等待态（无静默失败）。
- 未验证：生成结果 → 扩展捕获回填 → image_generations/V2 候选可见。
- 减震证据：捕获机制有真实历史成功记录（2026-09-07 attempt 84c25ed6 completed + 2 条 results 落库，DB 可查）；扩展捕获器有单测覆盖（chatgptResultCollector 等 96 项扩展测试绿）；A-G04 迟到结果后台回填设计存在。
- **处置**：不豁免、不 BLOCKED。等待本轮真实尝试落地（job→result→候选可见即算闭环），或在下一窗口重做一次完整闭环；若结果最终未回填且复现排除外部服务因素后仍失败，则升级为新缺陷、判定回退 FAIL。建议同时给捕获回填加超时上界与用户可见的失败态（当前无限"等待生成结果回填"对用户不可判定）。

## 达成 CONDITIONAL PASS / PASS 的最小剩余清单

1. 修 BUG-L3-404（建议：用当前 schema 重导示例包含 style_id，或导入侧对 v1.3 旧 style 字符串映射兜底；importExample catch 套用与 multipart 相同的 格式/缺少/损坏→400 映射）。验收：import-example → 201。
2. 关闭 chatgpt_web 捕获回填验证（上述处置）。
3. 提交工作区全部修复 + CHANGELOG + LFS 资产；在提交点重跑双套件（后端/前端）并在 ComfyUI 预算内保留一次真实出片抽验能力。
4. 簿记修正：BUG-L3-101/102 的 yml status 仍为 OPEN，应改 fixed-verified（两项均经我现场复核成立）；TC-FIX-* 在 execution-log 中 priority 统一记为 P1（应为各 BUG 原级别），不影响证据。
5. 完成上述后，本轮结论可升至 CONDITIONAL PASS（仍带第一轮报告 §五登记的未覆盖维度：桌面/扩展纳入、journey 6/11/12/13/14、A-P04、非功能维度等）；PASS 则还需 14 旅程中承诺范围的闭环证据。若 BUG-L3-404 修复后复验仍失败或捕获回填证实为产品缺陷，判定维持/回退 FAIL。

---

# 第一轮判定记录（2026-09-12 · HEAD c9c2bbd · 判定 FAIL，存档）

- run_id: run_20260912_072912 · 模式 L3 · scope=全项目 · 分支 codex/v2-1-implementation
- 判定人: QA Gatekeeper（独立判定，未采信 Designer/Runner 推理，全部证据自行复核）

## 一、执行统计（独立重算自 qa/run/execution-log.jsonl，528 行原始记录去重 236 条，同 case 取末条）

| 维度 | 通过 | 失败 | blocked | 小计 |
|---|---|---|---|---|
| 总计 | 228 | 7 | 1 | 236（通过率 96.6%） |
| P0 | 71 | 3 | 1 | 75 |
| P1 | 131 | 4 | 0 | 135 |
| P2 | 26 | 0 | 0 | 26 |
| system/integration/unit | 214 | 6 | 0 | 220 |
| E2E（真实浏览器） | 14 | 1 | 1 | 16 |

分波次：W1 40（39/1/0）· W2 55（52/4/0）· W3 62（61/1/0）· W4 61（61/0/0）· E2E 16（14/1/1）· 前置 2（2/0/0）
既有套件（收官 HEAD c9c2bbd 复跑）：后端 1157/1157 绿（.qa-final-backend.log）· 前端 371/371 绿（.qa-final-front.log）
失败/阻塞清单：TC-IMPORT-005(P0)→BUG-202 · TC-ASSET-003(P0)→BUG-301 · TC-E2E-011(P0)→BUG-401 · TC-E2E-009(P0,blocked)→BUG-403 · TC-PROJ-009(P1)→BUG-201 · TC-PKG-008(P1)→BUG-203 · TC-SCRIPT-006(P1)→BUG-205 · TC-TASK-007(P1)→BUG-102

## 二、抽查复核记录（Gatekeeper 独立重放，≥8 条 passed + 全部关键缺陷）

| 抽查对象 | 方式 | 结果 |
|---|---|---|
| TC-SHELL-001 | HTTP 重放 3013/5679 + /health | 200 text/html，与日志一致 |
| TC-AICONF-001/018 | GET /api/v1/ai-configs | DeepSeek id=4 text 默认在位；api_key len=35 明文未脱敏——BUG-101 现场复现 |
| TC-VIDEO-001/002 | DB video_generations#100 + ffprobe 工件 | provider_task_id 真实 UUID、snapshot: comfyui/te_speed/seed42/1312x736/24fps/5.0s；工件 ffprobe=5.000000s——真实 ComfyUI 出片证据成立 |
| TC-AUDIO-008 | DB video_merges#14 + episodes.video_url + 工件 | merge completed、episode 179 video_url 已回写（数据流交接验证通过）、mp4 工件在位 |
| TC-IMPORT-001 | zipfile 解析工件 | project.json v1.7 QA-L3 数据完整 |
| TC-STORYBOARD-019/020 | 工件头校验 | srt 内容真实；xls 实为带 BOM 的 HTML 表（产品导出形态如此，非 QA 伪造） |
| TC-UPSCALE-004/008/009 | DB video_upscale_jobs | qa-sim-* 作业 + 真实远端错误 waiting_provider/PROVIDER_UNAVAILABLE retry_count=5——授权模拟且断言真实 |
| TC-E2E-001..016 | 40 张截图存在性 + stage JSON + DB | project 272 / episode 189 / storyboard 156/157 全部在库；E2E 真实浏览器证据充分 |
| TC-SCRIPT-004 | DB | episode 130《暂停三秒》script_content=982 字，与日志一致 |
| TC-STORYBOARD-015 | DB（01:30 时间窗） | DeepSeek 生成 3 镜落库（内景钟表店/外景老街等真实场次标题） |
| BUG-201 重放 | 新建 QA-L3-GK-verify-201(id=273)→写 duration=95→读回 | DB=95，API 读回=0——现场复现 |
| BUG-102 重放 | 对 completed 任务 POST cancel | 200 无 already_done，status 保持 completed——现场复现 |
| BUG-202 | 指针文件 + examples API + .git/lfs | 133 字节 LFS 指针在库且被 API 列为可导入；LFS 对象本地存在（git lfs pull 可修复） |
| BUG-203 | 源码 :206/:218 对照 + wave2 日志 | json 分支漏传 db 实参，日志 500 "db.prepare is not a function" 属实 |
| BUG-401 | GET /api/v2/storyboards/156/video/quote（现场） + 源码 regex | channel=real/comfyui/minimax_h3_...te_speed 但 h3:false；/^minimax[-_]?h3\b/ 对下划线后缀永不匹配；.qa-vsubmit.json=H3_DRAFT_REQUIRED；UI 守卫 4/4 假绿与后端拒绝矛盾——现场复现 |
| BUG-403 | router 源码 + StoryboardStage.vue:357 + 截图 | 无 /film 路由（grep 为空）；"mock 本地通道 · ¥0" 硬编码在案；film-canvas.png(404) 在——缺陷成立，但证据措辞有误（见 §六-4） |

级别复核结论（12 个 BUG 逐个）：101=P1 恰当（安全边界）· 102=P3 恰当（契约完整性）· 201=P2 恰当 · 202=P1 恰当（开箱即坏）· 203=P1 恰当（宣称能力 500，一行修）· 204=P2 恰当 · 205=P2 恰当（校验错误误 500）· 301=P3 恰当（TC-ASSET-003 为 P0 用例但失败子断言仅契约层，主功能上传+绑定可用，定级无虚低）· 302=P2 恰当（模式性缺陷）· 401=P1 恰当（论用户影响可 argue P0）· 402=P1 恰当 · 403=P1 恰当。全部属于"真实缺陷"，无测试脚本问题误报为主缺陷；未发现违规 mock（详见 §五-3）。

## 三、6 个 P1 是否构成发版阻断（逐个）

| BUG | 是否阻断 | 理由 |
|---|---|---|
| BUG-L3-401 V2.1 真实视频生成不可用+守卫假绿+静默失败 | **是（硬阻断）** | V2.1 制作台主旅程（分镜→视频）完全走不通：提交恒 409 H3_DRAFT_REQUIRED，UI 显示 4/4 通过且点击后无任务无候选无报错。产品核心价值路径死亡，且静默失败违反前端错误零容忍。修复前不可发布 |
| BUG-L3-403 chatgpt_web 生图通道不可达 | **是（硬阻断）** | 用户指定的零费用真实生图通道在 V2.1 无任何入口（旧画布路由删除未迁移）；默认可达通道为离线 shim → 分镜图生成必失败；确认 Sheet 硬编码"mock 本地通道 · ¥0"误导。存在付费 API 通道替代方案，故修复或"用户书面接受替代方案并写入发布说明"二选一 |
| BUG-L3-101 明文 api_key 暴露+导出不脱敏 | 否（须修复或书面接受） | 真实安全缺陷（现场复现）。本地单人场景暴露面=本机/局域网 + 导出文件外流；architecture §9.3 已声明可信本机边界。最低要求：前端导出剔除 api_key（改动小）+ 发布说明披露 LAN 风险。若不修必须用户明确签字接受 |
| BUG-L3-202 示例项目导入开箱即坏 | 否（须修复，成本低） | 新手引导路径断；但根因一半是 LFS 未物化（对象在 .git/lfs 本地存在，`git lfs pull` 即愈）。发版前：物化文件 + listExamples 校验 ZIP 头 + 损坏映射 400。不阻断核心制作链 |
| BUG-L3-203 任务包 JSON 下载恒 500 | 否（建议发版前一行修复） | 宣称的第二种下载格式死亡（downloadFormats 失信），zip 替代可用；externalAiWizardService.js:218 补 db 实参即修 |
| BUG-L3-402 删除默认配置后无回退 | 否（建议发版前修复） | 触发路径=删除 AI 配置；后果=video/image/storyboard_image/tts 四类 500，用户可在设置页重新勾默认恢复（可自救但报错不友好）。应做默认移交兜底 |

## 四、需求覆盖矩阵缺口（15 功能域 × 23 页面 × 14 发布旅程）

功能域（feature-inventory 15 组）：14/15 有专属 API/DB 级用例；**第 12 组「桌面、浏览器扩展与适配器」0 专属用例**——Electron 桌面、external-bridge、OpenClaw 适配未测；Chrome 扩展自有套件（96 项）不在本轮双套件内，由 Gatekeeper 会话外补跑 96/96 绿（非本轮证据）。

页面（product-test-map 23 页）：UI E2E 深度覆盖主链 8 页（P01/P02/P11/P12/P13/P14 门禁/P15/P23）；P05/P06/P07/P19/P22 等有 API 级覆盖但 UI 未深测；**P08 已有视频登记 0 用例**；P16/P17/P18/P21 仅路由/静态级。

发布级旅程（验收矩阵 14 条）：完整覆盖 0 条；部分覆盖 #1/2/3/4/5/8/9/10（其中 #8 的 V2.1 半边被 BUG-401 阻断，真实出片仅 V1 链路）；**未覆盖 #6（已有视频登记）、#7（ChatGPT 网页生图，被 BUG-403 阻断）、#11（重启恢复，受禁重启约束仅源码核验）、#12（迁移对账）、#13（PostRevision 门禁）、#14（manifest 溯源）**。

专项缺口：A-P04 多 GB ZIP 导入/离页恢复持久任务（仅小 ZIP 往返）；A-D01 数据工具深项（仅单测级）；A-MG01/02/04 迁移对账 0 执行；性能/兼容性/长时稳定性等非功能维度未执行；TTS 仅真实错误路径（无 TTS 配置），密钥日志问题（ttsService.js:148）仅静态证据。

## 五、未能验证的事项（逐条，必填）

1. V2.1 修复后的真实视频出片验收（BUG-401 修复确认）——ComfyUI 预算尚余 1 次未动用，留作修复后验证。
2. chatgpt_web 通道端到端生图（journey 7）——扩展 service worker/登录态/桥接探针就绪，但产品内无入口，无法验收。
3. Electron 桌面应用全链（内嵌后端、首次配置复制、FFmpeg、vendor lock 运行态）。
4. Chrome 扩展 96 项自有测试（本轮未纳入；Gatekeeper 补跑通过，但不计入本轮证据链）。
5. 应用重启的任务恢复语义（journey 11）——受"禁止重启服务"约束，仅 taskService.js:98 源码核验。
6. 数据迁移/对账（journey 12，A-MG01/02/04）与数据工具深项（A-D01：重定位、物理清理、迁移失败恢复）。
7. A-P04 多 GB 导入与导入中断恢复（数据库/媒体/临时文件零残留断言）。
8. 已有视频登记（P08 / journey 6）全流程。
9. Journey 13（Picture Lock 后仅字幕/音频可改的 PostRevision 门禁）与 Journey 14（交付 manifest 全链溯源）。
10. 性能、兼容性、长时稳定性、并发生成压力等非功能维度（本轮零执行）。
11. TTS 真实供应商成功路径；ttsService.js:148 密钥打印的运行时复现（当前无 TTS 配置，路径不可达）。
12. 旧实现静态/运行时缺席检查（验收矩阵 Phase 6 要求项）未系统执行（仅 BUG-403 覆盖路由缺席）。
13. wave1/wave2 用例在收官 HEAD 的整体复跑（见 §六-1 过程风险）。

## 六、过程风险披露

1. **被测目标移动**：用户另一开发会话在运行窗口（07:29–11:55）内并行提交 fe58fe6(07:37)、e16880b(08:15)、c9c2bbd(08:58)。wave1 于 fe58fe6/e16880b 之间执行；wave2 执行期间 backend node --watch 被并发修改触发重启（assetQueryService.js 08:45/08:49 与两次 fetch failed 及一次在案 DeepSeek 任务被杀吻合，DeepSeek 实耗 4 次超预算已由 wave2 如实披露）；wave3/wave4/E2E 在收官 HEAD c9c2bbd 固定执行；双套件于 c9c2bbd 复跑全绿。风险量化：wave1/wave2 的通过结论严格说属于移动目标，但其覆盖面（v1 API）与 c9c2bbd 变更面（v21 assetQueryService + V2.1 视图）交集小，且 E2E 主链已在收官 HEAD 复核。**发版修复落地后必须全套件 + 主链 E2E 再跑一遍**。
2. **任务取消竞态**：TC-TASK-009 实证取消不能中止已发出的模型调用，被取消任务 14 秒后被后台完成覆盖为 completed（error 保留取消原因）——对用户有误导性，已登记观察项，建议保存结果前检查取消状态。
3. **Sim-upscale 授权说明**：UPSCALE 11 条按用户 2026-09-12 授权以 sim 前缀作业执行（DB 可查 qa-sim-*），其被测对象是真实接口/状态机/真实远端不可达错误，符合"仅图片超分可模拟"约束，不进入 waivers。除此之外未发现违规 mock：qa/scripts 的 "mock" 命中仅为静态资源路径/生成器注释；E2E C2 的图像提交被产品路由到真实 shim 通道并真实失败（见下条），QA 未伪造任何生成结果。
4. **BUG-403 证据措辞修正**（抽查发现）：其 e2e 补充证据称"走 mock 本地通道出候选"，实测 DB image_generations#232（11:45:38，与 stageC2 提交窗吻合）为 provider=openai/model=local-image-shim/status=failed/ECONNREFUSED 18080，v2 候选为空。即：提交走的是真实 shim 配置并真实失败，无 mock 候选产生。缺陷实质不变（chatgpt_web 无入口 + UI 文案"mock 本地通道 · ¥0"硬编码失实），但报告中"出候选"表述应更正。
5. **流程缺陷**（不影响证据真实性，影响可追溯性）：last.json 全程未更新（selection.total=0、status=running），判定以 execution-log.jsonl + 波次报告为准，Gatekeeper 已补写 gatekeeper_verdict 字段；16 条 E2E 用例与 2 条前置用例无 YAML 文件（仅 stage JSON + 日志）；wave1 测试自身清理程序曾触发 BUG-402（删 Agnes 预设未恢复默认），虽披露合规并经 API 恢复，属测试夹具缺陷；wave3-results.md 合计行笔误（应为 61 过/1 败）；qa/signoff/ 为空（本 run 以用户提供的 docs/current 为基线，未走签字流程，记录在案）。
6. ** waiver 状态**：qa/waivers.draft.yml 结论为零豁免（全部 NOT_WAIVABLE），waived_by=TBD-BY-USER 未签字——按规则草案不生效，8 条未通过用例全部按真实缺陷计。

## 七、发布建议（面向"本地单人使用"场景）

发版前必须（阻断项）：
1. 修 BUG-L3-401：videoConfigResolver.js:33 正则（`/^minimax[-_]?h3\b/` 对 `minimax_h3_director_r2v_te_speed` 永不匹配）+ inferVideoProtocol 纳入 comfyui + V2.1 守卫查草稿改用真实 config id（非 'v21'）。验收：UI 提交真实 ComfyUI 出片 1 次（剩余预算 1 次）且任务/候选/反馈可见。
2. 修 BUG-L3-403：V2.1 分镜图确认 Sheet 恢复通道选择（至少 chatgpt_web + API 配置两项），移除硬编码"mock 本地通道 · ¥0"文案。验收：真实 ChatGPT 网页生图 1 张进入候选。
3. 并行修复批次全部落地后：全套件（后端+前端+扩展）+ 主链 E2E 在最终 HEAD 复跑。

发版前应当（低成本高收益）：
4. BUG-L3-203 一行修复（getTaskBundle 补 db 实参）。
5. BUG-L3-202：`git lfs pull` 物化示例包 + listExamples 校验 ZIP 头 + 损坏导入返回 400。
6. BUG-L3-402：删除配置时 is_default 自动移交；无默认时返回可读 400 而非 500。
7. BUG-L3-101 最小修复：前端 exportConfigs 剔除 api_key；发布说明披露局域网明文风险（后端响应脱敏可列入下版）。
8. 低成本顺手修：BUG-201（getDrama 聚合覆盖改仅空值兜底）、BUG-205/302（错误分类白名单/业务错误码）、BUG-301/102（字段透传）。

发布说明必须披露：
9. sim-upscale 为授权模拟通道；TTS 密钥日志问题（当前配置下不可达）；取消任务不能中止已发出的模型请求；局域网部署的密钥暴露边界；示例项目导入需 LFS 物化（若第 5 项未修）。
