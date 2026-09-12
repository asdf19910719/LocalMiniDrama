# Wave 3 执行结果（ASSET / EPSET / STORYBOARD / MEDIA）

run_id: run_20260912_072912 · L3 · 波次 3/4 · 执行窗口 2026-09-12 01:19–01:50 (UTC+8 本地)
HEAD: `c9c2bbd`（会话开始与结束一致，执行期间无并行提交、无 --watch 重启引发的连接中断；早期开发阶段用 Node24 跑过一轮脚本导致 better-sqlite3 ABI 报错，均已在 Node22 下重跑覆盖，以每用例**最后一条**日志为准）

## 执行统计

| 模块 | 用例 | 通过 | 失败 | 阻塞 |
|---|---|---|---|---|
| ASSET 角色/场景/道具与素材库 | 18 | 17 | 1 | 0 |
| EPSET 本集设定 | 9 | 9 | 0 | 0 |
| STORYBOARD 分镜 | 22 | 22 | 0 | 0 |
| MEDIA 媒体库 | 13 | 13 | 0 | 0 |
| **合计** | **62** | **62** | **1** | **0** |

- 用例 YAML：`qa/cases/<模块>/TC-*-NNN.yml`（62 个，本波新增）；脚本：`qa/scripts/wave3/{lib,run-asset,run-epset,run-storyboard,run-media}.js`；逐条日志 append 至 `qa/run/execution-log.jsonl`。
- 真实模型调用（预算内）：DeepSeek 共 **2 次** —— TC-ASSET-010 提示词润色（12.2s）、TC-STORYBOARD-015 从剧集生成分镜（25.1s，产出 3 镜落库）。图像通道（18080）保持真实离线状态，其成功路径按约留待 E2E 阶段。
- 测试数据：全部 `QA-L3-` 前缀，用例结束对自建项目执行 v2 软删（可复核）。
- 导出产物：`qa/run/wave3-artifacts/TC-STORYBOARD-019-storyboard-sheet.xls`（真实前端导出工具构建的 24 列分镜表）、`TC-STORYBOARD-020-episode.srt`（真实 buildSrt 产物）、`TC-ASSET-003-uploaded.png`（真实上传 PNG 回读件）。

## 失败与缺陷

### BUG-L3-301（P3，来自 TC-ASSET-003 失败）
角色主图上传响应返回 `local_path`，但该值未持久化到 `characters.local_path`（DB 读回 NULL，仅 image_url 写入）。`routes/characters.js:167-169` 调 `characterLibraryService.uploadCharacterImage` 只 UPDATE image_url。主功能不受阻（绝对 URL 自足），属响应契约与 DB 事实不一致。

### BUG-L3-302（P2，测试中发现，由 TC-STORYBOARD-012 触发）
分镜变体关联缺 `sort_order` 时返回 500 INTERNAL_ERROR（「人物状态排序值无效：必须为非空数字」）——客户端可修正的校验错误被记为服务端故障。同类模式：v1 分镜生成对不存在剧集/空剧本亦 500（TC-STORYBOARD-016 证据；剧本空梗概 500 已由 wave2 记 BUG-L3-205）。

## 观察项（与文档标注一致或轻微偏差，不判缺陷）

| 编号 | 内容 | 证据 |
|---|---|---|
| INV-4.1b | 角色「排序」实为 ORDER BY sort_order,name，而 sort_order 无任何 API 写入口（创建恒 0）——排序能力不可达，与 §4「COMPLETE」标注有出入 | characterLibraryService.updateCharacter 白名单；TC-ASSET-002 |
| INV-4.17 | 前端 `addToTeamLibrary` 声明的 `/characters/:id/add-to-team-library`、`/scenes/:id/add-to-team-library` 后端未挂载 → 404，与 §4 BROKEN 一致 | frontweb/src/api/characters.js:38；TC-ASSET-018 |
| INV-5.2b | POST /storyboards 不自动编号：不传 storyboard_number 时默认写 0，前端画布创建自行 max+1 传入；调用方漏传会产生重复镜号 | storyboardCanonicalRepository.js:358；TC-STORYBOARD-004 |
| INV-5.4b/§15.2 | character_ids 同步 `storyboard_characters` 时按角色名去 character_libraries 找同名项并写入**库条目 id**（引用语义错表），找不到则静默跳过——真实项目角色不入表；与 §15「LEGACY 实库为空、角色关联以 JSON 为准」一致 | storyboardService.js:92-97；TC-STORYBOARD-008 |
| INV-5.1/Script↔SB | v2.1 剧本草稿只写 episode_script_revisions，不写 `episodes.script_content`；经典 v1 分镜生成只读该列——两条脚本事实源并存（data-model §10 多重事实源），跨阶段混用时生成拿不到剧本（本轮已在测试夹具中显式补写该列绕开） | episodeStoryboardService.js:1097-1119；TC-STORYBOARD-015 |
| INV-13.3 | 关键词搜索：前端 MediaLibrary.vue 已传 keyword，服务端 assetService.list 只消费 drama_id/type → 不过滤（inventory 归因「前端 service 未转发」与当前代码不符，但净效果相同：搜索不可用） | assetService.js:1-19；TC-MEDIA-003 |
| INV-13.4 | /upload/image 只落盘不写 assets 表（文件可访问、媒体库不可见），与 BROKEN 一致；另：非图片 MIME 拒绝以 500 形式返回（multer 错误走 error 中间件），拒绝语义成立但状态码欠准确 | routes/upload.js；TC-MEDIA-004/011 |
| INV-13.5 | 批量删除为前端顺序循环单删，无批量端点、无事务性；软删不回收物理文件——均与 PARTIAL 一致 | TC-MEDIA-006/007 |
| INV-13.7 | assetService.update 白名单含 description/thumbnail_url/is_favorite，实库无这三列 → 调用 500，与 BROKEN 一致（data-model §2 早已记录该 schema 漂移） | assetService.js:73；TC-MEDIA-005 |

## 其他记录

- HEAD 变化：无（开始/结束均 `c9c2bbd`）；执行期间未观察到 fetch failed（无需启用 3s 重试路径，但脚本已内置）。
- 一次探针清理：curl 验证 `/assets/import/image/12` 时在项目 3 名下临时产生资产 id=211，已即时经 API 软删（复核可查 deleted_at）。
- TC-MEDIA-010 产生一条无项目归属的「孤儿资产」行（id=195，name 含 `QA-L3-MEDIA-` 前缀），保留供复核——assets 无外键，孤儿无法经项目删除联动清理（此即观察项本身）。
- 预算遵守：DeepSeek 2 次（ASSET 润色 1 + 分镜生成 1）；未调用任何润色/流式 LLM 端点；未做 ComfyUI 视频生成；图像成功路径未在本波触碰。
