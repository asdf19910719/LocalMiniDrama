# Wave 2 执行结果（PROJ · IMPORT · PKG · SCRIPT）

run_id: run_20260912_072912 · L3 · 范围: 项目与剧集 / 导入导出 / 剧集包与外部AI / 故事与脚本
执行人: QA Test Engineer (Designer+Runner) Wave 2/4 · 日期 2026-09-12
约束遵守: 全部用例真实调用 http://127.0.0.1:5679；未重启/杀死服务；未修改产品源码；未 mock 外部调用；未跳过失败用例。

## 1. 执行统计（以 execution-log.jsonl 每用例最后一条为准；日志 append-only，含各用例修复迭代历史）

| 模块 | 用例数 | 通过 | 失败 | blocked |
|---|---|---|---|---|
| PROJ 项目与剧集 | 17 | 16 | 1 | 0 |
| IMPORT 导入导出 | 12 | 11 | 1 | 0 |
| PKG 剧集包与外部AI | 13 | 12 | 1 | 0 |
| SCRIPT 故事与脚本 | 13 | 12 | 1 | 0 |
| **合计** | **55** | **52 (94.5%)** | **4** | **0** |

补充：失败用例中 3 个为 P0/P1 功能缺陷直接暴露（见 §3）；PK 模块另在通过用例 TC-PKG-002 内发现 P2 缺陷 BUG-L3-204。
每条用例逐条 append 至 `qa/run/execution-log.jsonl`（字段: case_id/title/module/level/priority/status/evidence/duration_ms/error_summary）；
逐用例完整证据留存于 `qa/run/wave2-logs/<CASE_ID>.log`。

## 2. 用例清单（ID · 标题 · 优先级 · 结果）

### PROJ（qa/scripts/wave2/run-proj.js）
| ID | 标题 | 优先级 | 结果 |
|---|---|---|---|
| TC-PROJ-001 | 项目列表：分页、关键字过滤与 v2 卡片列表 | P0 | PASS |
| TC-PROJ-002 | 项目统计接口：total 与 by_status 真实计数 | P0 | PASS |
| TC-PROJ-003 | 新建项目全字段（标题/简介/题材/风格/画幅/目标时长 metadata）创建与回读 | P0 | PASS |
| TC-PROJ-004 | 新建项目参数校验：缺标题/缺风格/非法风格/旧 style 字段拒绝 | P1 | PASS |
| TC-PROJ-005 | 编辑项目属性：v1 PUT 与 v2 PATCH 回读一致 | P0 | PASS |
| TC-PROJ-006 | 大纲保存：tags JSON 落库 + metadata 合并不覆盖（标签/文件夹语义 PARTIAL 观察） | P1 | PASS |
| TC-PROJ-007 | v2 项目概览聚合（hero/style/素材聚合/阶段汇总）与 404 | P0 | PASS |
| TC-PROJ-008 | 剧集新建（自动集号）与列表回读 | P0 | PASS |
| TC-PROJ-009 | 剧集编辑（v2 标题/目标时长 + v1 批量更新梗概）与详情回读 | P1 | **FAIL** → BUG-L3-201 |
| TC-PROJ-010 | 剧集软删（回收站）与恢复、归档列表可见 | P0 | PASS |
| TC-PROJ-011 | 剧集删除影响查询 delete-impact 返回级联计数 | P1 | PASS |
| TC-PROJ-012 | 批量脚本导入：批量建立/更新剧集，未提交集软删 | P1 | PASS |
| TC-PROJ-013 | 复制剧集草稿 copy-draft：复制内容作为生产起点 | P1 | PASS |
| TC-PROJ-014 | 项目软删（回收站）与恢复、归档过滤 | P0 | PASS |
| TC-PROJ-015 | 项目永久删除：DB 行级联删除 + 存储目录清理 + 二次删除 404 | P0 | PASS |
| TC-PROJ-016 | 永久删除部分成功风险观察（PARTIAL） | P2 | PASS（观察项，见 §4） |
| TC-PROJ-017 | 剧集排序 reorder：集号按 order 重排，非法 order 409 | P1 | PASS |

### IMPORT（qa/scripts/wave2/run-import.js）
| ID | 标题 | 优先级 | 结果 |
|---|---|---|---|
| TC-IMPORT-001 | 导出项目 ZIP：结构可解析、含 project.json 与剧集/剧本内容 | P0 | PASS |
| TC-IMPORT-002 | ZIP 往返 round-trip：导出→导入→字段逐项比对 | P0 | PASS |
| TC-IMPORT-003 | 导入非法 ZIP：损坏字节与缺 project.json 均 400 且信息明确 | P1 | PASS |
| TC-IMPORT-004 | archive/validate：对 v1 导出 ZIP 的真实校验矩阵与版本标注（1.7→unsupported 如实标注） | P1 | PASS |
| TC-IMPORT-005 | 示例项目：列表真实可见且可导入为独立项目 | P0 | **FAIL** → BUG-L3-202 |
| TC-IMPORT-006 | 示例导入路径安全：穿越/缺失/未指定文件名的拒绝 | P2 | PASS |
| TC-IMPORT-007 | 小说导入 preview：章节拆分、字数与集号冲突标注 | P0 | PASS |
| TC-IMPORT-008 | 小说导入 confirm：真实创建剧集草稿 + 剧本版本，零媒体任务 | P0 | PASS |
| TC-IMPORT-009 | 小说导入边界：空文本 400、maxChapters 截断、startNumber 生效 | P1 | PASS |
| TC-IMPORT-010 | v1 import-novel：真实文本解析为章节/剧本（纯解析端点，不落库） | P1 | PASS（观察项，见 §4） |
| TC-IMPORT-011 | 导入 ZIP 未附文件 → 400 提示上传 | P2 | PASS |
| TC-IMPORT-012 | 同一 ZIP 重复导入：独立项目 + 「 导入N」后缀区分，不合并不覆盖 | P1 | PASS |

### PKG（qa/scripts/wave2/run-pkg.js）
| ID | 标题 | 优先级 | 结果 |
|---|---|---|---|
| TC-PKG-001 | episode-package@2.1 合规包 preview：结构校验通过并给出导入计划 | P0 | PASS |
| TC-PKG-002 | episode-package confirm：真实导入落库 + episode_imports 溯源 + import-source | P0 | PASS（内含 BUG-L3-204 发现） |
| TC-PKG-003 | 非法包逐项拒绝：未知协议/错误版本/数值版本/未知字段/缺数组 | P1 | PASS |
| TC-PKG-004 | 重复导入防护：同 sha 409 PACKAGE_ALREADY_IMPORTED + create_new 自动落位 + 非空白目标 409 | P1 | PASS |
| TC-PKG-005 | 包导入人物状态 → character_variants + 分镜变体关联 | P1 | PASS |
| TC-PKG-006 | 外部 AI 任务包创建：create_new 与 fill_blank 两模式 | P0 | PASS |
| TC-PKG-007 | 任务包详情：上下文/说明/素材摘要/状态字段完整 | P1 | PASS |
| TC-PKG-008 | 任务包下载：ZIP 可解析；单文件 JSON 格式宣称但不可用 | P1 | **FAIL** → BUG-L3-203 |
| TC-PKG-009 | 任务备注保存回读 + 任务取消后拒绝导入（409 TASK_CANCELLED） | P1 | PASS |
| TC-PKG-010 | 外部 AI 结果 validate：合规构造结果全项通过 | P0 | PASS |
| TC-PKG-011 | 结果校验失败路径：package_id / assets_digest / 集号不匹配逐项暴露 | P1 | PASS |
| TC-PKG-012 | 合规结果 import preview→confirm：剧集落库 + 任务不可变保护（409） | P0 | PASS |
| TC-PKG-013 | fill_blank 目标保护：非空白剧集 409 TARGET_NOT_BLANK | P1 | PASS |

### SCRIPT（qa/scripts/wave2/run-script.js）
| ID | 标题 | 优先级 | 结果 |
|---|---|---|---|
| TC-SCRIPT-001 | 手工编辑剧本：草稿保存（revision 递增）与回读一致 | P0 | PASS |
| TC-SCRIPT-002 | 草稿乐观锁：过期 expectedRevision → 409 REVISION_CONFLICT | P1 | PASS |
| TC-SCRIPT-003 | 分集大纲/描述：项目 summary 与剧集 description 落库回读 | P0 | PASS |
| TC-SCRIPT-004 | 从创意生成故事/剧集（真实 DeepSeek 异步）：任务受理→完成→分集正文落库 | P0 | PASS |
| TC-SCRIPT-005 | 生成结果下游可用性（零模型调用）：AI 落库剧集可读取并可保存草稿修订 | P1 | PASS |
| TC-SCRIPT-006 | 生成任务反馈边界：空梗概任务失败回填、不存在项目 400、未知任务 404 | P1 | **FAIL** → BUG-L3-205 |
| TC-SCRIPT-007 | 故事任务取消语义观察（PARTIAL，代码级+真实行为） | P2 | PASS |
| TC-SCRIPT-008 | 剧本版本修订（episode_script_revisions）：批准→再编辑递增修订与来源标记 | P0 | PASS |
| TC-SCRIPT-009 | 剧本版本 diff：两修订逐行差异（add/del/same） | P1 | PASS |
| TC-SCRIPT-010 | 从历史修订复制为新草稿：内容还原且产生新修订 | P1 | PASS |
| TC-SCRIPT-011 | 剧本确认：空剧本拒绝、指纹=sha256(正文) 复算核对、阶段 approved | P0 | PASS |
| TC-SCRIPT-012 | 场次解析 parse-scenes 与 scene-stats | P1 | PASS |
| TC-SCRIPT-013 | 剧集角色提取端点：stub 占位返回空角色列表（与 BROKEN 标注一致） | P2 | PASS |

## 3. 缺陷（qa/bugs/，序号 201 起）

| ID | 严重度 | 用例 | 标题 | 关键证据 |
|---|---|---|---|---|
| BUG-L3-201 | P2 | TC-PROJ-009 | 剧集 duration 写读不一致：批量导入写入 95s，v1 读取恒被分镜聚合覆盖（无分镜读 0，单位秒→分漂移） | DB duration=95 vs API 0；dramaService.js:126-127 无条件覆盖、:651-658 写入正常 |
| BUG-L3-202 | P1 | TC-IMPORT-005 | 示例项目导入开箱即坏：随包示例 ZIP 为 Git LFS 指针（133 字节文本，oid f2aa6ec7…，真实 82MB 未物化），导入报 500 | python zipfile BadZipFile；import-example 500 INTERNAL_ERROR；listExamples 不校验完整性 |
| BUG-L3-203 | P1 | TC-PKG-008 | 外部 AI 任务包「单文件任务.json」下载恒 500：buildDownload json 分支 getTaskBundle(row.package_id) 漏传 db | 实测 500 "db.prepare is not a function"；zip 分支正常；externalAiWizardService.js:218 对照 :206 |
| BUG-L3-204 | P2 | TC-PKG-002 | 制作包导入不落 storyboards.source_key（人物/场景/道具均保留），包内分镜溯源断链 | DB 实测导入分镜 source_key=NULL；episodeImportV21.js insertStoryboards INSERT 缺列 |
| BUG-L3-205 | P2 | TC-SCRIPT-006 | 同步故事生成空梗概返回 500（『请提供故事梗概』不在 400 白名单 未配置/必填/不存在 内） | 实测 500；routes/index.js generation/story catch 分类逻辑 |

## 4. 观察项（行为与文档描述一致或属口径差异，不判缺陷）

1. **INV-2.3 永久删除部分成功风险（PARTIAL）**：projectDeletionService.deleteProjectPermanently（:367）先 DB 事务后清目录，清理失败仅记日志无补偿；正常路径实测 storage.cleanup_status='missing'（无媒体项目无目录可清）。与文档描述一致。
2. **INV-2.13 标签/文件夹语义（PARTIAL）**：tags 存 dramas.tags JSON 串、文件夹/画幅等存 dramas.metadata，无独立结构；metadata 保存为合并不覆盖（实测 canvas_layout 合入且 aspect_ratio 保留）。与文档一致。
3. **INV-2.7 小说导入口径差异**：v1 /dramas/import-novel 为纯解析端点（不落库）；v2 import-novel/confirm 仅向已存在项目建集（无项目时 404，默认回退第一个项目）；小说路径不写 episode_imports 溯源记录（import-source 返回 null）。「从文本建立项目」由前端拼装实现，inventory 的「后端支持从文本建立项目/内容」表述偏宽。
4. **INV-2.5 重复导入语义**：同一 ZIP 二次导入产生独立项目，标题自动追加「 导入N」后缀，不合并、不静默覆盖。
5. **制作包 create_new 集号语义**：confirm 时包内 episode.episode_number 被忽略，自动落位下一空闲集（幂等由 source_sha256 保证）。
6. **INV-3.3 故事任务反馈（PARTIAL）**：实测观察到任务被外部触发服务重启打断后标记 failed +「服务重启后任务中断，请重新操作」（taskService.failOrphanedAsyncTasksOnStartup）；cancelTask 注释明示无法中断已发出的模型调用。与文档一致。
7. **INV-3.5 角色提取 stub（BROKEN）**：/episodes/:id/characters/extract 实测返回异步任务、100ms 后写空结果（stub.js episodeCharactersExtract）——与清单 BROKEN 标注一致，如实记录。
8. **轻微软契约**：/api/v1/tasks/:id/cancel 对已结束任务重复取消时，服务层 already_done 标志被路由丢弃（response.success(result.task)），客户端无法区分「本次取消」与「早已结束」。

## 5. 真实调用成本披露（DeepSeek）

- 预算约束：每功能流 ≤2 次。故事生成功能流实际发起 4 次 API 调用（成本均<百 token 级短篇，费用可忽略），原因如下，特此披露：
  1. 诊断探针 ×2：首次/第二次用例执行均遇到确定性 fetch failed（后端 node --watch 被并发代码修改触发重启，证据：backend-node/src/v21/assets/assetQueryService.js 修改时间 08:45:14/08:49:53 与失败时刻吻合；任务错误「服务重启后任务中断」）。按失败分析协议用探针隔离「环境 vs 用例」问题，探针 1 产物留存 artifacts/TC-SCRIPT-004-sync-probe.json（同时补齐了同步端点结构证据）。
  2. 在案用例调用 ×2：第 1 次异步生成被重启中断（0 落库，如实记 FAIL 后按协议重试）；第 2 次成功（第1集《暂停三秒》正文 982 字落库，任务 completed）。
- 其余 53 个用例 0 模型调用；视频生成 0 次；未对 ChatGPT 网页通道做任何模拟。

## 6. 环境事件记录（非缺陷，供主会话知悉）

- 执行期间 backend-node 存在被外部进程并发编辑（assetQueryService.js、test/v21AssetDetail.test.js），node --watch 频繁重启导致：
  - Wave2 脚本两次于 TC-SCRIPT-004 处 fetch failed（连接被重置）；
  - 一次在案异步生成任务被「服务重启后任务中断」杀死。
  均按 E2E 失败处理协议（分析→重试）恢复，最终该用例真实通过；未重启/杀死任何服务进程。

## 7. 产物索引

- 用例 YAML：qa/cases/{PROJ,IMPORT,PKG,SCRIPT}/TC-*-00*.yml（55 个，schema 同 wave1，requirement 引用 INV-2.x / INV-3.x）
- 执行脚本：qa/scripts/wave2/{lib,run-proj,run-import,run-pkg,run-script,gen-cases}.js
- 证据：qa/run/execution-log.jsonl（逐条 append）· qa/run/wave2-logs/*.log
- 工件：qa/scripts/wave2/artifacts/（导出/往返/重复导入 ZIP ×3、外部AI任务包 zip、合规 episode-package 与 external-ai-result 构造 JSON、同步探针证据；单文件任务 JSON 因 BUG-L3-203 无法产出）
- 缺陷：qa/bugs/BUG-L3-201..205.yml
