// Wave2 用例 YAML 生成器：按执行结果生成 qa/cases/<MODULE>/TC-*.yml（schema 同 wave1）
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/project/LocalMiniDrama';

// [module, id, title, priority, level, reqIds, purpose, file, testId, notes]
const CASES = [
  // PROJ
  ['PROJ', 'TC-PROJ-001', '项目列表：分页、关键字过滤与 v2 卡片列表', 'P0', 'system', ['INV-2.1'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_001_list_pagination_filter', ''],
  ['PROJ', 'TC-PROJ-002', '项目统计接口：total 与 by_status 真实计数', 'P0', 'system', ['INV-2.1'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_002_stats', ''],
  ['PROJ', 'TC-PROJ-003', '新建项目全字段（标题/简介/题材/风格/画幅/目标时长 metadata）创建与回读', 'P0', 'system', ['INV-2.2'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_003_create_full_fields', '画幅/目标时长落 dramas.metadata'],
  ['PROJ', 'TC-PROJ-004', '新建项目参数校验：缺标题/缺风格/非法风格/旧 style 字段拒绝', 'P1', 'system', ['INV-2.2'], 'exception', 'qa/scripts/wave2/run-proj.js', 'PROJ_004_create_validation', ''],
  ['PROJ', 'TC-PROJ-005', '编辑项目属性：v1 PUT 与 v2 PATCH 回读一致', 'P0', 'system', ['INV-2.2'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_005_update_profile', ''],
  ['PROJ', 'TC-PROJ-006', '大纲保存：tags JSON 落库 + metadata 合并不覆盖（标签/文件夹语义 PARTIAL 观察）', 'P1', 'system', ['INV-2.13', 'INV-2.2'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_006_outline_metadata_merge', 'PARTIAL 按真实行为验证：tags/metadata 存 JSON，无独立结构，与文档一致'],
  ['PROJ', 'TC-PROJ-007', 'v2 项目概览聚合（hero/style/素材聚合/阶段汇总）与 404', 'P0', 'system', ['INV-2.1'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_007_overview', ''],
  ['PROJ', 'TC-PROJ-008', '剧集新建（自动集号）与列表回读', 'P0', 'system', ['INV-2.8'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_008_episode_create_list', ''],
  ['PROJ', 'TC-PROJ-009', '剧集编辑（v2 标题/目标时长 + v1 批量更新梗概）与详情回读', 'P1', 'system', ['INV-2.8'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_009_episode_edit', '执行失败→BUG-L3-201：duration 写读不一致'],
  ['PROJ', 'TC-PROJ-010', '剧集软删（回收站）与恢复、归档列表可见', 'P0', 'system', ['INV-2.8'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_010_episode_soft_delete_restore', ''],
  ['PROJ', 'TC-PROJ-011', '剧集删除影响查询 delete-impact 返回级联计数', 'P1', 'system', ['INV-2.8'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_011_delete_impact', ''],
  ['PROJ', 'TC-PROJ-012', '批量脚本导入：批量建立/更新剧集，未提交集软删', 'P1', 'system', ['INV-2.9'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_012_batch_episodes_upsert', ''],
  ['PROJ', 'TC-PROJ-013', '复制剧集草稿 copy-draft：复制内容作为生产起点', 'P1', 'system', ['INV-2.10'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_013_copy_draft', '数据流断言：源剧本→副本 DB+版本行'],
  ['PROJ', 'TC-PROJ-014', '项目软删（回收站）与恢复、归档过滤', 'P0', 'system', ['INV-2.2'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_014_project_soft_delete_restore', ''],
  ['PROJ', 'TC-PROJ-015', '项目永久删除：DB 行级联删除 + 存储目录清理 + 二次删除 404', 'P0', 'system', ['INV-2.3'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_015_permanent_delete', ''],
  ['PROJ', 'TC-PROJ-016', '永久删除部分成功风险观察：DB 事务成功后文件清理失败无回滚（PARTIAL）', 'P2', 'unit', ['INV-2.3'], 'exception', 'qa/scripts/wave2/run-proj.js', 'PROJ_016_partial_delete_risk', '观察项：与文档 PARTIAL 描述一致（projectDeletionService.js deleteProjectPermanently），不判缺陷'],
  ['PROJ', 'TC-PROJ-017', '剧集排序 reorder：集号按 order 重排，非法 order 409', 'P1', 'system', ['INV-2.8'], 'functional', 'qa/scripts/wave2/run-proj.js', 'PROJ_017_reorder', ''],
  // IMPORT
  ['IMPORT', 'TC-IMPORT-001', '导出项目 ZIP：结构可解析、含 project.json 与剧集/剧本内容', 'P0', 'system', ['INV-2.4'], 'functional', 'qa/scripts/wave2/run-import.js', 'IMPORT_001_export_zip_structure', '产物 qa/scripts/wave2/artifacts/TC-IMPORT-001-export.zip'],
  ['IMPORT', 'TC-IMPORT-002', 'ZIP 往返 round-trip：导出→导入→项目/剧集字段逐项比对', 'P0', 'system', ['INV-2.4', 'INV-2.5'], 'functional', 'qa/scripts/wave2/run-import.js', 'IMPORT_002_roundtrip', '导入器对同名标题追加「 导入N」后缀'],
  ['IMPORT', 'TC-IMPORT-003', '导入非法 ZIP：损坏字节与缺 project.json 均 400 且信息明确', 'P1', 'system', ['INV-2.5'], 'exception', 'qa/scripts/wave2/run-import.js', 'IMPORT_003_invalid_zip', ''],
  ['IMPORT', 'TC-IMPORT-004', 'archive/validate：对 v1 导出 ZIP 的真实校验矩阵与版本标注', 'P1', 'system', ['INV-2.5'], 'functional', 'qa/scripts/wave2/run-import.js', 'IMPORT_004_archive_validate', 'v1 包如实标注 1.7→unsupported'],
  ['IMPORT', 'TC-IMPORT-005', '示例项目：列表真实可见且可导入为独立项目', 'P0', 'system', ['INV-2.6'], 'functional', 'qa/scripts/wave2/run-import.js', 'IMPORT_005_example_import', '执行失败→BUG-L3-202：示例文件为 LFS 指针'],
  ['IMPORT', 'TC-IMPORT-006', '示例导入路径安全：穿越/缺失/未指定文件名的拒绝', 'P2', 'system', ['INV-2.6'], 'exception', 'qa/scripts/wave2/run-import.js', 'IMPORT_006_example_path_safety', ''],
  ['IMPORT', 'TC-IMPORT-007', '小说导入 preview：章节拆分、字数与集号冲突标注', 'P0', 'system', ['INV-2.7'], 'functional', 'qa/scripts/wave2/run-import.js', 'IMPORT_007_novel_preview', ''],
  ['IMPORT', 'TC-IMPORT-008', '小说导入 confirm：真实创建剧集草稿 + 剧本版本，零媒体任务', 'P0', 'system', ['INV-2.7'], 'functional', 'qa/scripts/wave2/run-import.js', 'IMPORT_008_novel_confirm', '观察：小说路径不写 episode_imports 溯源'],
  ['IMPORT', 'TC-IMPORT-009', '小说导入边界：空文本 400、maxChapters 截断、startNumber 生效', 'P1', 'system', ['INV-2.7'], 'boundary', 'qa/scripts/wave2/run-import.js', 'IMPORT_009_novel_boundary', ''],
  ['IMPORT', 'TC-IMPORT-010', 'v1 import-novel：真实文本文件解析为章节/剧本（纯解析端点，不落库——与 inventory 措辞差异记录）', 'P1', 'system', ['INV-2.7'], 'functional', 'qa/scripts/wave2/run-import.js', 'IMPORT_010_novel_v1_parse_only', '观察项：后端无「从文本直接建项目」路径，建项目由前端拼装'],
  ['IMPORT', 'TC-IMPORT-011', '导入 ZIP 未附文件 → 400 提示上传', 'P2', 'system', ['INV-2.5'], 'exception', 'qa/scripts/wave2/run-import.js', 'IMPORT_011_import_no_file', ''],
  ['IMPORT', 'TC-IMPORT-012', '同一 ZIP 重复导入：生成独立项目并以「 导入N」后缀区分（不合并、不静默覆盖）', 'P1', 'system', ['INV-2.5'], 'regression', 'qa/scripts/wave2/run-import.js', 'IMPORT_012_duplicate_import', ''],
  // PKG
  ['PKG', 'TC-PKG-001', 'episode-package@2.1 合规包 preview：结构校验通过并给出导入计划', 'P0', 'system', ['INV-2.11'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_001_package_preview', '合规构造包样例 qa/scripts/wave2/artifacts/TC-PKG-001-package.json'],
  ['PKG', 'TC-PKG-002', 'episode-package confirm：真实导入落库（剧集/人物/场景/道具/分镜）+ episode_imports 溯源', 'P0', 'system', ['INV-2.11'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_002_package_confirm', '发现分镜 source_key 丢失→BUG-L3-204'],
  ['PKG', 'TC-PKG-003', '非法包逐项拒绝：未知协议/错误版本/数值版本/未知字段/缺数组', 'P1', 'system', ['INV-2.11'], 'exception', 'qa/scripts/wave2/run-pkg.js', 'PKG_003_invalid_package_codes', ''],
  ['PKG', 'TC-PKG-004', '重复导入防护：同 source_sha256 幂等拒绝 + create_new 自动落位 + 非空白目标 409', 'P1', 'system', ['INV-2.11'], 'exception', 'qa/scripts/wave2/run-pkg.js', 'PKG_004_duplicate_and_target_guard', ''],
  ['PKG', 'TC-PKG-005', '包导入的人物状态 → character_variants + 分镜变体关联（storyboard_character_variants）', 'P1', 'system', ['INV-2.11'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_005_variant_links', ''],
  ['PKG', 'TC-PKG-006', '外部 AI 任务包创建：create_new 与 fill_blank 两种模式真实生成', 'P0', 'system', ['INV-2.12'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_006_wizard_create_package', ''],
  ['PKG', 'TC-PKG-007', '任务包详情：上下文/说明/素材摘要/状态字段完整', 'P1', 'system', ['INV-2.12'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_007_task_detail', ''],
  ['PKG', 'TC-PKG-008', '任务包下载：ZIP 可解析；单文件 JSON 格式宣称但不可用', 'P1', 'system', ['INV-2.12'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_008_task_download', '执行失败→BUG-L3-203：json 分支 getTaskBundle 漏传 db'],
  ['PKG', 'TC-PKG-009', '任务备注保存回读 + 任务取消后拒绝导入', 'P1', 'system', ['INV-2.12'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_009_note_and_cancel', ''],
  ['PKG', 'TC-PKG-010', '外部 AI 结果 validate：合规构造结果（真实 package_id/assets_digest）全项通过', 'P0', 'system', ['INV-2.12'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_010_result_validate_ok', '合规构造结果走真实校验引擎，不伪造生成内容'],
  ['PKG', 'TC-PKG-011', '结果校验失败路径：package_id / assets_digest / 集号不匹配逐项暴露', 'P1', 'system', ['INV-2.12'], 'exception', 'qa/scripts/wave2/run-pkg.js', 'PKG_011_result_validate_fail', ''],
  ['PKG', 'TC-PKG-012', '合规结果 import preview→confirm：剧集落库 + 任务不可变保护（重复导入/改备注均 409）', 'P0', 'system', ['INV-2.12'], 'functional', 'qa/scripts/wave2/run-pkg.js', 'PKG_012_result_import_confirm', '数据流断言：外部结果→episode_script_revisions'],
  ['PKG', 'TC-PKG-013', 'fill_blank 目标保护：非空白剧集选为目标 409 TARGET_NOT_BLANK', 'P1', 'system', ['INV-2.12'], 'exception', 'qa/scripts/wave2/run-pkg.js', 'PKG_013_blank_guard', ''],
  // SCRIPT
  ['SCRIPT', 'TC-SCRIPT-001', '手工编辑剧本：草稿保存（revision 递增）与回读一致', 'P0', 'system', ['INV-3.1'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_001_draft_save_readback', ''],
  ['SCRIPT', 'TC-SCRIPT-002', '草稿乐观锁：过期 expectedRevision → 409 REVISION_CONFLICT；匹配 → 原地更新', 'P1', 'system', ['INV-3.1'], 'exception', 'qa/scripts/wave2/run-script.js', 'SCRIPT_002_optimistic_lock', ''],
  ['SCRIPT', 'TC-SCRIPT-003', '分集大纲/描述：项目 summary 与剧集 description 落库回读', 'P0', 'system', ['INV-3.4'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_003_outline_fields', ''],
  ['SCRIPT', 'TC-SCRIPT-004', '从创意生成故事/剧集（真实 DeepSeek 异步调用）：任务受理→完成→分集正文落库', 'P0', 'system', ['INV-3.2'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_004_story_generation_real', '本功能流唯一在案真实调用；同步端点结构由诊断探针验证（artifacts/TC-SCRIPT-004-sync-probe.json）'],
  ['SCRIPT', 'TC-SCRIPT-005', '生成结果下游可用性（零模型调用）：AI 落库剧集可读取并可保存剧本草稿修订', 'P1', 'system', ['INV-3.2', 'INV-3.1'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_005_generation_downstream', '数据流闭环：LLM→episodes→API→剧本草稿'],
  ['SCRIPT', 'TC-SCRIPT-006', '生成任务反馈边界：空梗概任务失败回填、不存在项目 400、未知任务 404', 'P1', 'system', ['INV-3.3'], 'boundary', 'qa/scripts/wave2/run-script.js', 'SCRIPT_006_task_feedback_boundary', '执行失败→BUG-L3-205：同步空梗概 500'],
  ['SCRIPT', 'TC-SCRIPT-007', '故事任务取消语义观察：取消已结束任务幂等；运行中取消/重启中断语义（代码级证据）', 'P2', 'unit', ['INV-3.3'], 'exception', 'qa/scripts/wave2/run-script.js', 'SCRIPT_007_cancel_semantics', '观察项：与文档 PARTIAL 一致（taskService.js cancelTask / failOrphanedAsyncTasksOnStartup）'],
  ['SCRIPT', 'TC-SCRIPT-008', '剧本版本修订（episode_script_revisions）：批准→再编辑产生递增修订与来源标记', 'P0', 'system', ['INV-3.1'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_008_revision_history', ''],
  ['SCRIPT', 'TC-SCRIPT-009', '剧本版本 diff：两修订逐行差异（add/del/same）', 'P1', 'system', ['INV-3.1'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_009_revision_diff', ''],
  ['SCRIPT', 'TC-SCRIPT-010', '从历史修订复制为新草稿：内容还原且产生新修订', 'P1', 'system', ['INV-3.1'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_010_history_copy', ''],
  ['SCRIPT', 'TC-SCRIPT-011', '剧本确认：空剧本拒绝、confirm-preview 与指纹一致性', 'P0', 'system', ['INV-3.1'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_011_confirm_script', '指纹=sha256(正文) 本地复算核对'],
  ['SCRIPT', 'TC-SCRIPT-012', '场次解析 parse-scenes 与 scene-stats：标题行解析为场次结构', 'P1', 'system', ['INV-3.1'], 'functional', 'qa/scripts/wave2/run-script.js', 'SCRIPT_012_parse_scenes', ''],
  ['SCRIPT', 'TC-SCRIPT-013', '剧集角色提取端点：stub 占位仅返回空角色列表（与 inventory BROKEN 标注一致）', 'P2', 'system', ['INV-3.5'], 'regression', 'qa/scripts/wave2/run-script.js', 'SCRIPT_013_characters_extract_stub', '观察项：BROKEN 按真实行为验证并记录，不判新缺陷'],
];

function yml(c) {
  const [module, id, title, priority, level, reqIds, purpose, file, testId, notes] = c;
  return `id: ${id}
title: "${title}"
state: active
feature_id: F-${module}
requirement_ids: [${reqIds.join(', ')}]
level: ${level}
purpose: ${purpose}
priority: ${priority}
preconditions:
  - "后端 http://127.0.0.1:5679 运行中（L3 共享环境）"
  - "真实数据约束：不 mock 外部服务；测试数据 QA-L3- 前缀"
test_data:
  prefix: "QA-L3-${module}-"
  cleanup: "用例结束对自建项目执行 v2 软删（可复核），ZIP/JSON 产物保留于 qa/scripts/wave2/artifacts/"
steps:
  - "由 qa/${'scripts'}/wave2 自动化脚本真实调用 HTTP API 执行（见 automation.file 内 test_id 对应用例块）"
expected:
  - "全部断言通过（状态码/响应结构/DB 副本三层核对）"
assertions:
  - "以脚本内 cs.eq/cs.expect 断言为准，逐条断言写入执行日志 evidence"
automation:
  status: implemented
  framework: node
  file: ${file}
  test_id: ${testId}
targets:
  files: []
  symbols: []
  generated_by: "wave2-designer"
  generated_at: "2026-09-12"
regression_tags: [${module.toLowerCase()}, wave2, l3]
notes: "${notes.replace(/"/g, '""')}"
`;
}

let n = 0;
for (const c of CASES) {
  const dir = path.join(ROOT, 'qa/cases', c[0]);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, c[1] + '.yml');
  fs.writeFileSync(p, yml(c));
  n++;
}
console.log(`generated ${n} case yml files`);
